-- ============================================================
-- Phase 6 Migration: Incentive-Marketplace Loop
-- Run in Supabase Dashboard > SQL Editor
-- ============================================================

-- ============================================================
-- 6A: MARKETPLACE SCHEMA
-- ============================================================

-- 1. Marketplace items catalogue
CREATE TABLE IF NOT EXISTS public.marketplace_items (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  category     TEXT        NOT NULL,        -- Mobile_Data | Cooking_Gas | Food_Voucher
  name         TEXT        NOT NULL,
  description  TEXT,
  token_price  INTEGER     NOT NULL CHECK (token_price > 0),
  provider_id  UUID        REFERENCES auth.users(id),  -- NULL = platform-provided
  is_active    BOOLEAN     DEFAULT TRUE,
  stock        INTEGER     DEFAULT -1,     -- -1 = unlimited
  UNIQUE (category, name)
);

ALTER TABLE public.marketplace_items ENABLE ROW LEVEL SECURITY;

-- Anyone can browse active items
DROP POLICY IF EXISTS "Anyone can view active marketplace items" ON public.marketplace_items;
CREATE POLICY "Anyone can view active marketplace items"
  ON public.marketplace_items FOR SELECT
  USING (is_active = TRUE);

-- Only admins/providers manage items (via service_role in Edge Functions)

-- 2. Seed the Abuja pilot catalogue
INSERT INTO public.marketplace_items (category, name, description, token_price) VALUES
  ('Mobile_Data',   '200MB MTN Data',          '200MB MTN data bundle, valid 7 days',            20),
  ('Mobile_Data',   '500MB Airtel Data',        '500MB Airtel data bundle, valid 14 days',        40),
  ('Mobile_Data',   '1GB Glo Data',             '1GB Glo data bundle, valid 30 days',             70),
  ('Cooking_Gas',   '3kg Gas Refill',           '3kg cooking gas cylinder refill — local depot',  80),
  ('Cooking_Gas',   '5kg Gas Refill',           '5kg cooking gas cylinder refill — local depot', 120),
  ('Food_Voucher',  'Emergency Food Pack (1)',   'One-day emergency food pack for 1 adult',        30),
  ('Food_Voucher',  'Emergency Food Pack (4)',   'One-day emergency food pack for 4 adults',       90),
  ('Food_Voucher',  'Weekly Food Voucher',       'Weekly food voucher redeemable at partner stores',200)
ON CONFLICT DO NOTHING;

-- 3. Marketplace orders (escrow state machine)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('PENDING', 'ESCROW_HELD', 'COMPLETED', 'REFUNDED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  confirmed_at      TIMESTAMPTZ,
  buyer_id          UUID        NOT NULL REFERENCES auth.users(id),
  item_id           UUID        NOT NULL REFERENCES public.marketplace_items(id),
  token_amount      INTEGER     NOT NULL,    -- Locked at purchase time (price may change later)
  status            order_status DEFAULT 'PENDING',
  ussd_confirm_code TEXT        GENERATED ALWAYS AS (
                                  UPPER(SUBSTRING(id::TEXT, 1, 6))
                                ) STORED,   -- 6-char code for USSD confirmation
  provider_notified BOOLEAN     DEFAULT FALSE,
  metadata          JSONB       DEFAULT '{}'::jsonb
);

ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Buyers can see their own orders" ON public.marketplace_orders;
CREATE POLICY "Buyers can see their own orders"
  ON public.marketplace_orders FOR SELECT
  USING (auth.uid() = buyer_id);

-- ============================================================
-- 6B: ESCROW STATE MACHINE
-- ============================================================

-- Function 1: purchase_item — deduct tokens, create escrow-held order
CREATE OR REPLACE FUNCTION public.purchase_item(
  p_buyer_id UUID,
  p_item_id  UUID
)
RETURNS UUID  -- returns the new order ID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item          RECORD;
  v_buyer_balance INTEGER;
  v_order_id      UUID;
BEGIN
  -- Lock item row to prevent race conditions
  SELECT * INTO v_item FROM public.marketplace_items
  WHERE id = p_item_id AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found or no longer available.';
  END IF;

  IF v_item.stock = 0 THEN
    RAISE EXCEPTION 'Item "%" is out of stock.', v_item.name;
  END IF;

  -- Check buyer balance
  SELECT token_balance INTO v_buyer_balance
  FROM public.profiles WHERE id = p_buyer_id FOR UPDATE;

  IF v_buyer_balance < v_item.token_price THEN
    RAISE EXCEPTION
      'Insufficient tokens. Cost: % RME, Balance: % RME.',
      v_item.token_price, v_buyer_balance;
  END IF;

  -- Deduct from buyer (STAKE = tokens are locked, not spent yet)
  UPDATE public.profiles
  SET token_balance = token_balance - v_item.token_price
  WHERE id = p_buyer_id;

  INSERT INTO public.transactions (user_id, amount, type, description, reference_id)
  VALUES (p_buyer_id, -v_item.token_price, 'STAKE',
          'Marketplace escrow: ' || v_item.name, p_item_id);

  -- Decrement stock if finite
  IF v_item.stock > 0 THEN
    UPDATE public.marketplace_items SET stock = stock - 1 WHERE id = p_item_id;
  END IF;

  -- Create escrow order
  INSERT INTO public.marketplace_orders (buyer_id, item_id, token_amount, status)
  VALUES (p_buyer_id, p_item_id, v_item.token_price, 'ESCROW_HELD')
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

-- Function 2: confirm_receipt — release escrow, credit provider/platform
CREATE OR REPLACE FUNCTION public.confirm_receipt(
  p_order_id    UUID,
  p_confirm_code TEXT   -- 6-char USSD code or NULL (app flow skips code check)
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order  RECORD;
  v_item   RECORD;
BEGIN
  SELECT o.*, i.name AS item_name, i.provider_id
  INTO v_order
  FROM public.marketplace_orders o
  JOIN public.marketplace_items  i ON i.id = o.item_id
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found.', p_order_id;
  END IF;

  -- [SECURITY FIX]: Only the buyer can confirm receipt
  IF v_order.buyer_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only the buyer of this order can confirm receipt.';
  END IF;

  IF v_order.status <> 'ESCROW_HELD' THEN
    RAISE EXCEPTION
      'Order % cannot be confirmed — current status is %.', p_order_id, v_order.status;
  END IF;

  -- Validate USSD confirmation code if provided
  IF p_confirm_code IS NOT NULL
     AND UPPER(p_confirm_code) <> v_order.ussd_confirm_code THEN
    RAISE EXCEPTION
      'Invalid confirmation code. Expected %, got %.',
      v_order.ussd_confirm_code, UPPER(p_confirm_code);
  END IF;

  -- Release escrow: credit provider if peer-to-peer, else mark platform redemption
  IF v_order.provider_id IS NOT NULL THEN
    UPDATE public.profiles
    SET token_balance = token_balance + v_order.token_amount
    WHERE id = v_order.provider_id;

    INSERT INTO public.transactions (user_id, amount, type, description, reference_id)
    VALUES (v_order.provider_id, v_order.token_amount, 'TRANSFER',
            'Marketplace sale: ' || v_order.item_name, p_order_id);
  END IF;

  -- Mark order complete
  UPDATE public.marketplace_orders
  SET status = 'COMPLETED', confirmed_at = NOW()
  WHERE id = p_order_id;
END;
$$;

-- Function 3: cancel_order — refund buyer from escrow
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT * INTO v_order
  FROM public.marketplace_orders
  WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found.', p_order_id;
  END IF;

  -- [SECURITY FIX]: Only the buyer can cancel their own order
  IF v_order.buyer_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only the buyer can cancel this order.';
  END IF;

  IF v_order.status NOT IN ('PENDING', 'ESCROW_HELD') THEN
    RAISE EXCEPTION
      'Order % cannot be cancelled — status is %.', p_order_id, v_order.status;
  END IF;

  -- Refund tokens to buyer
  UPDATE public.profiles
  SET token_balance = token_balance + v_order.token_amount
  WHERE id = v_order.buyer_id;

  INSERT INTO public.transactions (user_id, amount, type, description, reference_id)
  VALUES (v_order.buyer_id, v_order.token_amount, 'TRANSFER',
          'Escrow refund for cancelled order', p_order_id);

  -- [STOCK FIX]: Restore item stock on cancellation
  UPDATE public.marketplace_items SET stock = stock + 1 
  WHERE id = v_order.item_id AND stock >= 0;

  UPDATE public.marketplace_orders
  SET status = 'REFUNDED'
  WHERE id = p_order_id;
END;
$$;

-- ============================================================
-- 6C: ANTI-GAMING VELOCITY CHECK
-- ============================================================

-- 4. Flagged accounts review queue
CREATE TABLE IF NOT EXISTS public.flagged_accounts (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  user_id     UUID        NOT NULL REFERENCES auth.users(id),
  reason      TEXT        NOT NULL,   -- VELOCITY_BREACH | SUSPICIOUS_PATTERN | MANUAL
  metadata    JSONB       DEFAULT '{}'::jsonb,
  reviewed    BOOLEAN     DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID        REFERENCES auth.users(id),
  resolution  TEXT
);

ALTER TABLE public.flagged_accounts ENABLE ROW LEVEL SECURITY;

-- Only admins can see flagged accounts (via service_role)

-- 5. Replace add_tokens with velocity-checking version
CREATE OR REPLACE FUNCTION public.add_tokens(
  target_user_id  UUID,
  amount_to_add   INTEGER,
  trans_type      transaction_type,
  trans_desc      TEXT,
  velocity_limit  INTEGER DEFAULT 50    -- Max REWARD tokens in 24h
)
RETURNS JSONB   -- Returns { "status": "ok"|"flagged", "message": "..." }
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_24h_rewards     INTEGER;
  v_flag_id         UUID;
  v_already_flagged BOOLEAN;
  v_dummy_balance   INTEGER;
BEGIN
  -- 1. [RACE CONDITION FIX]: Lock the profile row at the start to serialize all token ops for this user
  SELECT token_balance INTO v_dummy_balance FROM public.profiles WHERE id = target_user_id FOR UPDATE;

  -- Velocity check applies ONLY to REWARD transactions
  IF trans_type = 'REWARD' AND amount_to_add > 0 THEN

    -- Sum all REWARD tokens earned in the last 24 hours
    SELECT COALESCE(SUM(amount), 0) INTO v_24h_rewards
    FROM public.transactions
    WHERE user_id    = target_user_id
      AND type       = 'REWARD'
      AND amount     > 0
      AND created_at > NOW() - INTERVAL '24 hours';

    IF (v_24h_rewards + amount_to_add) > velocity_limit THEN

      -- Check if already flagged in the last 24h to avoid duplicate flags
      SELECT EXISTS(
        SELECT 1 FROM public.flagged_accounts
        WHERE user_id    = target_user_id
          AND reason     = 'VELOCITY_BREACH'
          AND reviewed   = FALSE
          AND created_at > NOW() - INTERVAL '24 hours'
      ) INTO v_already_flagged;

      IF NOT v_already_flagged THEN
        INSERT INTO public.flagged_accounts (user_id, reason, metadata)
        VALUES (
          target_user_id,
          'VELOCITY_BREACH',
          jsonb_build_object(
            '24h_total_before',  v_24h_rewards,
            'attempted_amount',  amount_to_add,
            'threshold',         velocity_limit,
            'window_start',      NOW() - INTERVAL '24 hours',
            'would_have_total',  v_24h_rewards + amount_to_add
          )
        )
        RETURNING id INTO v_flag_id;
      END IF;

      -- Tokens are NOT credited. Raise a notice so the caller can inform the user.
      RAISE EXCEPTION
        'ACCOUNT_UNDER_REVIEW: Your account has been flagged for manual review '
        'due to unusually high token activity (% RME earned in the last 24 hours). '
        'No tokens will be credited until the review is complete. '
        'Contact support if you believe this is an error.',
        v_24h_rewards + amount_to_add
        USING ERRCODE = 'RU001';  -- Custom error code for client detection
    END IF;

  END IF;

  -- All clear — credit the tokens
  INSERT INTO public.transactions (user_id, amount, type, description)
  VALUES (target_user_id, amount_to_add, trans_type, trans_desc);

  UPDATE public.profiles
  SET token_balance = token_balance + amount_to_add
  WHERE id = target_user_id;

  RETURN jsonb_build_object('status', 'ok', 'credited', amount_to_add);
END;
$$;

-- ============================================================
-- 6D: PUSH NOTIFICATIONS FALLBACK QUEUE
-- Secondary channel when Africa's Talking SMS is unavailable.
-- PRIVACY: recipient_id is a UUID — no raw phone/name stored.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_notifications (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  recipient_id  UUID        NOT NULL REFERENCES auth.users(id),
  incident_id   UUID        REFERENCES public.incidents(id),
  message       TEXT        NOT NULL,
  channel       TEXT        NOT NULL DEFAULT 'PUSH',
  status        TEXT        NOT NULL DEFAULT 'PENDING'  -- PENDING | SENT | FAILED
);

ALTER TABLE public.push_notifications ENABLE ROW LEVEL SECURITY;

-- Guides can only read their own push notifications
DROP POLICY IF EXISTS "Guides can view their own push notifications" ON public.push_notifications;
CREATE POLICY "Guides can view their own push notifications"
  ON public.push_notifications FOR SELECT
  USING (auth.uid() = recipient_id);

-- ============================================================
-- 6E: ESCROW AUTO-REFUND (24h buyer protection)
-- Callable by buyer if provider has not confirmed within 24h.
-- No PII stored — all references by UUID only.
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_cancel_stale_escrow(
  p_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
BEGIN
  -- Lock the order row for consistent read-then-write
  SELECT * INTO v_order
  FROM public.marketplace_orders
  WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found.', p_order_id;
  END IF;

  -- Guard 1: only ESCROW_HELD orders qualify
  IF v_order.status <> 'ESCROW_HELD' THEN
    RAISE EXCEPTION
      'Order % cannot be auto-cancelled — current status is %. '
      'Only ESCROW_HELD orders are eligible for auto-cancellation.',
      p_order_id, v_order.status;
  END IF;

  -- Guard 2: must be older than 24 hours
  IF NOW() - v_order.created_at < INTERVAL '24 hours' THEN
    RAISE EXCEPTION
      'Order % is not yet eligible for auto-cancellation. '
      'Auto-cancellation becomes available 24 hours after purchase. '
      'Eligible at: %.',
      p_order_id,
      (v_order.created_at + INTERVAL '24 hours')::TEXT;
  END IF;

  -- Refund: return locked tokens to buyer
  UPDATE public.profiles
  SET token_balance = token_balance + v_order.token_amount
  WHERE id = v_order.buyer_id;

  -- Audit: record the refund in the transaction ledger
  INSERT INTO public.transactions (user_id, amount, type, description, reference_id)
  VALUES (
    v_order.buyer_id,
    v_order.token_amount,
    'TRANSFER',
    'Auto-refund: marketplace escrow held >24h without provider confirmation',
    p_order_id
  );

  -- [STOCK FIX]: Restore item stock on auto-refund
  UPDATE public.marketplace_items SET stock = stock + 1 
  WHERE id = v_order.item_id AND stock >= 0;

  -- Update order status to REFUNDED
  UPDATE public.marketplace_orders
  SET status = 'REFUNDED'
  WHERE id = p_order_id;

END;
$$;

