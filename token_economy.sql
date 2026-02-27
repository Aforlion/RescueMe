-- RescueMe Phase 3: Token Economy Infrastructure

-- 1. Update Profiles with token balance if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='token_balance') THEN
        ALTER TABLE public.profiles ADD COLUMN token_balance INTEGER DEFAULT 0;
    END IF;
END $$;

-- 2. Create Transactions Table
CREATE TYPE transaction_type AS ENUM ('REWARD', 'STAKE', 'TRANSFER', 'PENALTY');

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  amount INTEGER NOT NULL,
  type transaction_type NOT NULL,
  description TEXT,
  reference_id UUID, -- Optional link to incident or document
  metadata JSONB DEFAULT '{}'::jsonb
);

-- 3. Enable RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Users can see their own transactions
CREATE POLICY "Users can see own transactions." ON public.transactions FOR SELECT USING (auth.uid() = user_id);

-- Only system/service role should insert/update transactions (for shared security)
-- In this development phase, we'll allow insert for testing if needed, 
-- but in production, this would be restricted to Edge Functions.
CREATE POLICY "Users can see their own balance." ON public.profiles FOR SELECT USING (auth.uid() = id);

-- 5. Helper Function to add tokens (to be called via Edge Functions or Admin RPC)
CREATE OR REPLACE FUNCTION public.add_tokens(target_user_id UUID, amount_to_add INTEGER, trans_type transaction_type, trans_desc TEXT)
RETURNS void AS $$
BEGIN
    -- Insert transaction log
    INSERT INTO public.transactions (user_id, amount, type, description)
    VALUES (target_user_id, amount_to_add, trans_type, trans_desc);

    -- Update profile balance
    UPDATE public.profiles
    SET token_balance = token_balance + amount_to_add
    WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
