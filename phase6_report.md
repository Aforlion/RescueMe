# Phase 6 Report — Incentive-Marketplace Loop

**Date**: 2026-02-27  
**Status**: ✅ SQL Deployed — Edge Functions Hardened — Ready for GitHub Push

---

## Deliverables

| File | Component |
|---|---|
| [`phase4_migration.sql`](file:///c:/RescueMe/phase4_migration.sql) | Incident logs, vault hardening — idempotent (PII policy comment added) |
| [`phase5_migration.sql`](file:///c:/RescueMe/phase5_migration.sql) | `get_nearest_guides` — severity radius + dual-sort — idempotent |
| [`phase6_migration.sql`](file:///c:/RescueMe/phase6_migration.sql) | Marketplace schema, escrow functions, push notifications, auto-refund |
| [`supabase/functions/_shared/smsClient.ts`](file:///c:/RescueMe/supabase/functions/_shared/smsClient.ts) | Shared circuit-breaker notification client |
| [`supabase/functions/ussd_gateway/index.ts`](file:///c:/RescueMe/supabase/functions/ussd_gateway/index.ts) | USSD/SMS handler — PII-clean, circuit breaker integrated |
| [`supabase/functions/process_incident_assignment/index.ts`](file:///c:/RescueMe/supabase/functions/process_incident_assignment/index.ts) | Guide dispatch — CRITICAL severity path, admin escalation |
| [`packages/types/src/index.ts`](file:///c:/RescueMe/packages/types/src/index.ts) | `MarketplaceItem`, `MarketplaceOrder`, `OrderStatus` |

---

## 6A — Marketplace Schema

### `marketplace_items`

```sql
id            UUID PRIMARY KEY
category      TEXT  -- Mobile_Data | Cooking_Gas | Food_Voucher
name          TEXT
description   TEXT
token_price   INTEGER (> 0)
provider_id   UUID  -- NULL = platform-provided
is_active     BOOLEAN DEFAULT TRUE
stock         INTEGER DEFAULT -1  -- -1 = unlimited
```

### Abuja Pilot Seed Data

| Category | Item | Price (RME) |
|---|---|---|
| Mobile_Data | 200MB MTN | 20 |
| Mobile_Data | 500MB Airtel | 40 |
| Mobile_Data | 1GB Glo | 70 |
| Cooking_Gas | 3kg Refill | 80 |
| Cooking_Gas | 5kg Refill | 120 |
| Food_Voucher | Emergency Pack (1) | 30 |
| Food_Voucher | Emergency Pack (4) | 90 |
| Food_Voucher | Weekly Voucher | 200 |

### `marketplace_orders`

```sql
id                UUID PRIMARY KEY
buyer_id          UUID → auth.users
item_id           UUID → marketplace_items
token_amount      INTEGER  -- locked at purchase time
status            order_status  -- PENDING → ESCROW_HELD → COMPLETED | REFUNDED
ussd_confirm_code TEXT(6)  -- auto-generated from order UUID prefix
confirmed_at      TIMESTAMPTZ
```

---

## 6B — Escrow State Machine

```
Buyer clicks "Redeem"
    │
    ▼
purchase_item(buyer_id, item_id)                     [SECURITY DEFINER]
    ├─ SELECT marketplace_items FOR UPDATE            ← Row lock prevents race
    ├─ SELECT profiles FOR UPDATE                     ← Balance lock
    ├─ RAISE EXCEPTION if balance < price
    ├─ UPDATE profiles SET token_balance -= price
    ├─ INSERT transactions (type=STAKE, amount=-price)
    ├─ UPDATE marketplace_items SET stock -= 1 (if finite)
    └─ INSERT marketplace_orders (status=ESCROW_HELD)         ← Returns order_id
              │
              │  (tokens held — neither buyer nor provider has them)
              │
    ┌─────────┴──────────────────────────────┐
    │                                        │
    ▼                                        ▼
confirm_receipt(order_id, code?)        cancel_order(order_id)
    ├─ Validate USSD code if provided       ├─ Must be PENDING or ESCROW_HELD
    ├─ SELECT order FOR UPDATE              ├─ Refund tokens to buyer
    ├─ RAISE if status ≠ ESCROW_HELD        ├─ INSERT transactions (TRANSFER)
    ├─ Credit provider (if peer-to-peer)    └─ UPDATE orders SET status=REFUNDED
    ├─ INSERT transactions (TRANSFER)
    └─ UPDATE orders SET status=COMPLETED
```

### USSD Confirmation Flow
```
Buyer receives item → dials *384*confirm#
    → Enter 6-char order code (e.g. "AB12CD")
    → ussd_gateway calls confirm_receipt(order_id, "AB12CD")
    → Tokens released to provider
    → SMS: "[RESCUEME] Order AB12CD confirmed. Enjoy your Gas Refill!"
```

---

## 6C — Anti-Gaming Velocity Check

### Logic (inside `add_tokens`)

```
add_tokens(user, +30 RME, REWARD, "Incident resolved")
    │
    ├─ Is this a REWARD and amount > 0?
    │     YES → Continue
    │     NO  → Skip check, credit normally
    │
    ├─ SUM all REWARD transactions in last 24h for this user
    │     Result: 35 RME
    │
    ├─ 35 + 30 = 65 > velocity_limit (50)?
    │     YES → Flag account, RAISE EXCEPTION with custom ERRCODE 'RU001'
    │     NO  → Credit tokens normally
    │
    └─ EXCEPTION message (visible to user):
          "Your account has been flagged for manual review due to
           unusually high token activity (65 RME in 24 hours).
           No tokens will be credited until the review is complete."
```

### Error Handling in Client Code

```typescript
try {
  await supabase.rpc('add_tokens', { ... });
} catch (err) {
  if (err.code === 'RU001') {
    Alert.alert('Account Under Review', err.message);
  }
}
```

### `flagged_accounts` Schema
```sql
id          UUID PRIMARY KEY
user_id     UUID → auth.users
reason      TEXT  -- VELOCITY_BREACH | SUSPICIOUS_PATTERN | MANUAL
metadata    JSONB -- { 24h_total, attempted_amount, threshold }
reviewed    BOOLEAN DEFAULT FALSE
reviewed_at TIMESTAMPTZ
resolved_by UUID
resolution  TEXT
```

---

## 6D — Pre-Build Hardening & Reliability Layer

### Escrow Auto-Refund (24h Buyer Protection)

New function `public.auto_cancel_stale_escrow(p_order_id UUID)` — callable by the buyer if the provider has not confirmed within 24 hours.

```
autoCancelStaleEscrow(order_id)
    ├─ SELECT order FOR UPDATE
    ├─ RAISE if status ≠ ESCROW_HELD
    ├─ RAISE if age < 24h  (returns exact eligibility timestamp)
    ├─ UPDATE profiles SET token_balance += token_amount   ← Refund
    ├─ INSERT transactions (type=TRANSFER, description=Auto-refund)
    └─ UPDATE orders SET status=REFUNDED
```

### Triage Priority — Adaptive Radius

`get_nearest_guides` updated with `incident_severity` and `max_radius` parameters.

| Mode | `ST_DWithin` Radius | Trigger |
|------|--------------------|---------|
| `STANDARD` | 8,000 m | All other incident types |
| `CRITICAL` | 15,000 m | `HEALTH` or `MEDICAL` incident type |
| `max_radius > 0` | explicit override | Caller-supplied value |

**Sort order:** `distance_meters ASC, trust_score DESC` — most reliable guide wins ties.

**Empty-set fallback (CRITICAL):** If zero guides are found across all 4 matching attempts, the system logs `ESCALATE_TO_ADMIN` (not the generic `NO_GUIDES_AVAILABLE`) with structured payload for manual dispatch.

### Circuit Breaker — SMS → Push Fallback

Shared `_shared/smsClient.ts` — single `notifyGuide()` entry point used by both Edge Functions:

```
notifyGuide({ phone, guideId, message, incidentId })
    │
    ├─ SMS via Africa's Talking
    │     ├─ res.ok  → ✅ done
    │     └─ failure → log NOTIFICATION_FAILURE to incident_logs
    │                  fall through ↓
    └─ INSERT push_notifications (status=PENDING)
         → console.warn for Edge Function log visibility
```

- Function **never throws** — circuit breaker absorbs all failures
- SLA-breach penalisation now also notifies the guide via the same path
- New `public.push_notifications` table stores fallback queue (RLS: guides see own rows only)

### PII Scrubbing

| Surface | Finding | Resolution |
|---------|---------|------------|
| `ussd_gateway` — incident_logs insert | `session_id` from Africa's Talking was stored | Removed — only `{ channel }` retained |
| Guide phone lookup | Phone used for DB lookup only | ✅ Never written to any log |
| `process_incident_assignment` — all logEvent() calls | UUID-only references | ✅ Already clean |
| `incident_logs` DDL | No privacy documentation | Added 7-line PRIVACY POLICY comment block |
| `push_notifications` table | New table | `recipient_id` UUID only — no PII by design |

---

## Security Properties

| Property | Mechanism |
|---|---|
| Double-spend prevention | PostgreSQL `FOR UPDATE` row lock inside `purchase_item()` |
| Partial state impossible | All deductions + order creation in same `SECURITY DEFINER` block |
| Velocity farming | Rolling 24h REWARD sum checked before every credit |
| Escrow integrity | Only `confirm_receipt()` or `cancel_order()` can move tokens out of escrow |
| Audit trail | Every state change inserts to `transactions` (immutable via Phase 4 triggers) |

---

## Deployment

```sql
-- Run in order in Supabase Dashboard > SQL Editor (all idempotent — safe to re-run)
-- 1. phase4_migration.sql  ✅ Ran 2026-02-27
-- 2. phase5_migration.sql  ✅ Ran 2026-02-27
-- 3. phase6_migration.sql  ✅ Ran 2026-02-27
```

```bash
# Deploy Edge Functions
npx supabase functions deploy ussd_gateway
npx supabase functions deploy process_incident_assignment
# _shared/ is auto-bundled by the Supabase CLI
```

> [!IMPORTANT]  
> `phase6_migration.sql` must run **after** `token_economy.sql` (Phase 3) since it replaces `add_tokens()` which was originally defined there.

---

## Phase 6 Audit Checklist

### Core Marketplace
- [x] 8 marketplace items seeded for Abuja pilot
- [x] `marketplace_orders.ussd_confirm_code` generated automatically from order UUID
- [x] `purchase_item()` — row-locked, atomic, raises on insufficient balance
- [x] `confirm_receipt()` — validates USSD code, releases escrow to provider
- [x] `cancel_order()` — refunds buyer, guards against double-refund
- [x] `flagged_accounts` table with review workflow fields
- [x] `add_tokens()` — velocity check with user-visible exception + custom ERRCODE
- [x] `MarketplaceItem`, `MarketplaceOrder`, `OrderStatus` types exported
- [x] `phase6_migration.sql` deployed ✅

### Hardening (2026-02-27)
- [x] `auto_cancel_stale_escrow()` — 24h buyer protection, idempotent guards
- [x] `push_notifications` table — RLS-protected fallback queue
- [x] `get_nearest_guides` — `ST_DWithin` 8km/15km, `trust_score` secondary sort
- [x] CRITICAL incident type → 15km radius, `ESCALATE_TO_ADMIN` on empty set
- [x] `_shared/smsClient.ts` — circuit breaker, SMS → push fallback, never throws
- [x] `ussd_gateway` — circuit breaker integrated, `session_id` PII removed
- [x] `process_incident_assignment` — CRITICAL severity path, SLA breach notifications
- [x] All 3 SQL files fully idempotent — `DROP POLICY/TRIGGER IF EXISTS` on every statement
- [x] `incident_logs` PRIVACY POLICY comment added to DDL
