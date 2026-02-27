# Bug Audit Report — RescueMe Backend

**Date:** 2026-02-27
**Status:** Audit Complete — 7 Issues Identified

## 🔴 High Severity (Critical Logic/Security)

### 1. Acceptance Race Condition (Atomic Ownership)
- **File:** `ussd_gateway/index.ts` (Line 101)
- **Bug:** Multiple assigned guides can "Accept" the same incident. Currently, the second guide to reply overwrites the first one because there is no `WHERE accepted_by IS NULL` clause.
- **Impact:** Chaos in coordination; multiple guides arriving at the same scene while the system thinks only the last one exists.

### 2. Missing "On-Scene" Menu Logic
- **File:** `ussd_gateway/index.ts` (Lines 10-15, 84)
- **Bug:** The USSD menu lists "4. Mark as On-Scene", but the code only maps actions 1-3. Selecting 4 will result in "Unrecognised code".
- **Impact:** Guides cannot inform dispatcher they have arrived, affecting SLA tracking and response analytics.

### 3. Incomplete Rejection Flow
- **File:** `ussd_gateway/index.ts` (Line 122)
- **Bug:** Rejection only notifies the guide but doesn't remove them from `assigned_guide_ids` or update the incident to signify a vacancy.
- **Impact:** The `checkSla` loop will still penalise the rejecting guide because their ID is still in the assigned list and they didn't "accept".

### 4. Concurrency Risk in Token Velocity Check
- **File:** `phase6_migration.sql` (Line 255 - `add_tokens`)
- **Bug:** The velocity check sums rewards without locking the user's profile. Two parallel requests could both read a balance below the threshold and both succeed, bypassing the limit.
- **Impact:** Potential for token farming via rapid parallel API triggers.

## 🟡 Medium Severity (UX & Tech Debt)

### 5. Inconsistency: `assigned_guide_id` vs `assigned_guide_ids`
- **File:** `schema.sql` vs `phase4_migration.sql`
- **Finding:** Table has both a single UUID column and a UUID array column.
- **Impact:** Dev confusion and wasted storage. Code currently uses the array version correctly, but the single column should be deprecated.

### 6. Escrow Ownership Check
- **File:** `phase6_migration.sql` (`confirm_receipt`, `cancel_order`)
- **Finding:** These `SECURITY DEFINER` functions perform operations based on `order_id` but don't explicitly verify that `auth.uid()` belongs to the buyer/provider.
- **Impact:** If an `order_id` is guessed/leaked, an attacker could grief users by prematurely confirming or cancelling their orders.

### 7. SLA Check Timeout Sensitivity
- **File:** `process_incident_assignment/index.ts` (Line 98)
- **Finding:** `checkSla` relies on a 120s `setTimeout` inside an Edge Function isolate.
- **Impact:** If the isolate exceeds Supabase's total execution time limit or crashes, the penalty logic is lost. (Minor for now, but high risk as project scales).

---

## Proposed Fixes (Implementation Plan)

### Phase A: Database Hardening
- [ ] **SQL Fix (add_tokens)**: Add `FOR UPDATE` lock on profiles *before* summing rewards.
- [ ] **SQL Fix (Escrow)**: Add `WHERE buyer_id = auth.uid()` guards to `cancel_order` and `confirm_receipt`.
- [ ] **SQL Fix (Stock)**: Restore item stock on `cancel_order` / `auto_cancel_stale_escrow`.
- [ ] **SQL Fix (Schema)**: Add `ACCEPTED` to `incident_status` enum.

### Phase B: Logic Hardening
- [ ] **Edge Function (ussd_gateway)**: Add atomic check for `accepted_by IS NULL` on accept.
- [ ] **Edge Function (ussd_gateway)**: Implement "4. On-Scene" action (maps to new `ARRIVED` log event).
- [ ] **Edge Function (ussd_gateway)**: Update rejection to remove guide ID from array.
- [ ] **Edge Function (process_incident_assignment)**: Add `WHERE status = 'ASSIGNED'` to SLA escalation update.
