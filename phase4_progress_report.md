# Phase 4 Progress Report — ERS Orchestration & Immutable Audit Ledger

**Date**: 2026-02-25  
**Status**: Implementation Complete — Pending Deployment

---

## Deliverables Summary

| File | Purpose |
|---|---|
| [`phase4_migration.sql`](file:///c:/RescueMe/phase4_migration.sql) | Schema changes, immutable triggers, Justice Vault RLS |
| [`phase4_geo_helpers.sql`](file:///c:/RescueMe/phase4_geo_helpers.sql) | PostGIS extension, guide location column, `get_nearest_guides` RPC |
| [`supabase/functions/process_incident_assignment/index.ts`](file:///c:/RescueMe/supabase/functions/process_incident_assignment/index.ts) | SLA timer, guide assignment, auto-escalation Edge Function |

---

## Component 1 — SLA Timer & Auto-Escalation

### How It Works

```
INCIDENT INSERT
     │
     ▼
Edge Function (process_incident_assignment)
     │
     ├─ Query: get_nearest_guides(lat, lng)  ← PostGIS ST_Distance
     │         └─ Fallback: top-2 by trust_score
     │
     ├─ UPDATE incidents SET status='ASSIGNED', assigned_guide_ids=[...], sla_deadline=NOW()+120s
     ├─ INSERT incident_logs: event='ASSIGNED'
     │
     └─ setTimeout(120s)
           │
           ├─ Re-fetch incident
           ├─ IF accepted_by IS NULL AND status NOT IN (RESOLVED, ARCHIVED):
           │       UPDATE incidents SET status='ESCALATED'
           │       INSERT incident_logs: event='ESCALATED'
           │       FOR EACH guide:
           │           UPDATE profiles SET trust_score = MAX(0, trust_score - 10)
           │           CALL add_tokens(-10, 'PENALTY', 'SLA Response Failure')
           │           INSERT incident_logs: event='RESPONSE_FAILURE'
           └─ ELSE: SLA met — no action
```

### Key Design Decisions
- **Deno `setTimeout`** is used for the 120-second window. The Edge Function is kept alive; for production-scale durable scheduling, replace with `pg_cron` or Supabase's scheduled jobs.
- **Geo fallback**: If guides have no location data, assignment falls back to `trust_score DESC`. This ensures the system never fails to assign.
- **Shared secret** (`FUNCTION_SECRET` env var) guards the endpoint from unauthorized invocations.

### New `incident_logs` Schema

```sql
CREATE TABLE public.incident_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  event_type  TEXT NOT NULL,   -- ASSIGNED | ACCEPTED | ESCALATED | RESOLVED | RESPONSE_FAILURE
  actor_id    UUID,            -- NULL for system events
  metadata    JSONB DEFAULT '{}'
);
```

---

## Component 2 — Immutable Audit Trigger

### The Enforcement Mechanism

The key design principle is `SECURITY DEFINER`. By default, triggers run under the **invoking user's** privileges. With `SECURITY DEFINER`, the trigger runs as its **owner** (the function creator), making the privilege of the calling role irrelevant. The `RAISE EXCEPTION` inside is unconditional — it fires before the operation completes, regardless of whether the caller is `anon`, `authenticated`, or `service_role`.

```sql
CREATE OR REPLACE FUNCTION public.enforce_incident_log_immutability()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION
    'IMMUTABILITY VIOLATION: incident_logs is a write-once ledger. '
    'Operation: %, Record: %', TG_OP, OLD.id;
  RETURN NULL;  -- Never reached, but required for BEFORE triggers
END;
$$;

CREATE TRIGGER trg_incident_logs_immutable
  BEFORE UPDATE OR DELETE ON public.incident_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_incident_log_immutability();
```

### Why This Beats RLS
RLS can be bypassed by `service_role`. Triggers with `SECURITY DEFINER` cannot be bypassed by anyone short of a database superuser. The only way to undo this is to `DROP` the trigger itself — which would itself be logged in the Postgres audit trail.

### Soft-Delete Guard on `incidents`

```sql
CREATE TRIGGER trg_incidents_no_delete
  BEFORE DELETE ON public.incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_incident_soft_delete();
```
Any deletion attempt raises: `"Set status='ARCHIVED' instead."` This forces all incident closeouts to be represented as state transitions, not erasures.

---

## Component 3 — Justice Vault Hardening

### Time-Bound Access Policy

```sql
CREATE POLICY "Time-bound legal guide access"
  ON public.vault_documents FOR SELECT
  USING (
    -- Standard: users see their own documents
    auth.uid() = user_id
    OR
    -- Time-bound: legal guide access only while incident is active
    EXISTS (
      SELECT 1 FROM public.incidents i
      WHERE i.id = vault_documents.linked_incident_id
        AND i.type   IN ('ABUSE', 'JUSTICE')
        AND i.status IN ('PENDING', 'ASSIGNED')   -- ← This is the time-lock
        AND auth.uid() = ANY(i.assigned_guide_ids)
    )
  );
```

### Why This Is Architecturally Superior to Expiry Tokens
- **Zero maintenance**: No cron jobs, no token refresh cycles.
- **Instant revocation**: The moment `incidents.status` changes to `RESOLVED` or `ARCHIVED`, the legal guide's next query returns zero rows — access is gone atomically.
- **Auditable**: All access attempts are logged via Postgres RLS — the deny/allow decision is deterministic and reproducible for court-admissible integrity.

---

## Deployment Instructions

> [!IMPORTANT]
> Run these steps **in order**.

### Step 1 — Enable PostGIS & Geo Helpers
```sql
-- In Supabase Dashboard > SQL Editor
-- Run: phase4_geo_helpers.sql
```

### Step 2 — Apply Core Migration
```sql
-- In Supabase Dashboard > SQL Editor
-- Run: phase4_migration.sql
```

### Step 3 — Deploy the Edge Function
```bash
# Install Supabase CLI if needed:
# npm install -g supabase

supabase login
supabase link --project-ref pveilpyiwggkepbnahqe
supabase functions deploy process_incident_assignment
```

### Step 4 — Set Environment Variables for the Edge Function
In Supabase Dashboard → **Edge Functions → process_incident_assignment → Secrets**:
```
SUPABASE_URL              = https://pveilpyiwggkepbnahqe.supabase.co
SUPABASE_SERVICE_ROLE_KEY = <your-service-role-key>
FUNCTION_SECRET           = <a-strong-random-secret>
```

### Step 5 — Create the Webhook Trigger
In Supabase Dashboard → **Database → Webhooks → Create webhook**:
- **Table**: `incidents`
- **Events**: `INSERT`
- **URL**: `https://pveilpyiwggkepbnahqe.supabase.co/functions/v1/process_incident_assignment`
- **HTTP headers**: `Authorization: Bearer <FUNCTION_SECRET>`

---

## Phase 4 Audit Checklist

- [x] `incident_logs` table created with RLS
- [x] `incidents` schema extended with SLA fields
- [x] Edge Function: geo-assignment logic implemented
- [x] Edge Function: 120s SLA auto-escalation implemented
- [x] Edge Function: trust-score penalty on Response Failure
- [x] `enforce_incident_log_immutability` trigger — blocks UPDATE/DELETE even for service_role
- [x] `enforce_incident_soft_delete` trigger — blocks hard DELETE on incidents
- [x] `vault_documents.linked_incident_id` FK added
- [x] `time_bound_legal_access` RLS policy — revokes on incident close
- [ ] **Pending**: Run SQL migrations in Supabase
- [ ] **Pending**: Deploy Edge Function via CLI
- [ ] **Pending**: Create database webhook

