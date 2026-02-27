-- ============================================================
-- Phase 4 Migration — Part 2 of 2: Schema, Triggers & RLS
-- PREREQUISITE: Run phase4_enums.sql first and confirm it succeeded.
-- ============================================================

-- 1. Extend incidents table with SLA and assignment fields
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS assigned_guide_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sla_deadline       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_by        UUID REFERENCES auth.users(id);

-- 2. Create incident_logs table (append-only audit trail)
-- ============================================================
-- PRIVACY POLICY — incident_logs
-- This table is a write-once compliance ledger.
-- RULE: metadata JSONB must NEVER contain raw PII (phone numbers,
--       full names, addresses, or national IDs).
-- Reference all actors exclusively by UUID (actor_id / assigned_guide_ids).
-- Violations will be caught by the privacy audit query in CI.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.incident_logs (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  incident_id UUID        REFERENCES public.incidents(id) NOT NULL,
  event_type  TEXT        NOT NULL,   -- e.g. ASSIGNED, ACCEPTED, ESCALATED, RESOLVED, RESPONSE_FAILURE
  actor_id    UUID,                   -- user who caused the event (null for system events)
  metadata    JSONB       DEFAULT '{}'::jsonb
);

ALTER TABLE public.incident_logs ENABLE ROW LEVEL SECURITY;

-- Guides can read logs for incidents assigned to them; admins can read all
DROP POLICY IF EXISTS "Guides can read their incident logs" ON public.incident_logs;
CREATE POLICY "Guides can read their incident logs"
  ON public.incident_logs FOR SELECT
  USING (
    auth.uid() = actor_id
    OR EXISTS (
      SELECT 1 FROM public.incidents i
      WHERE i.id = incident_id
        AND auth.uid() = ANY(i.assigned_guide_ids)
    )
  );

-- ============================================================
-- Phase 4B: Immutable Audit Trigger
-- Prevents UPDATE and DELETE on incident_logs — even for service_role
-- ============================================================

-- Trigger function: unconditionally block mutations
CREATE OR REPLACE FUNCTION public.enforce_incident_log_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- Runs as trigger owner, ignores caller's role
AS $$
BEGIN
  RAISE EXCEPTION
    'IMMUTABILITY VIOLATION: The incident audit log is a write-once ledger. '
    'DELETE and UPDATE operations are permanently prohibited on incident_logs. '
    'Attempted operation: %, on record: %',
    TG_OP, OLD.id;
  RETURN NULL;
END;
$$;

-- Attach to incident_logs — fires before any DELETE or UPDATE
DROP TRIGGER IF EXISTS trg_incident_logs_immutable ON public.incident_logs;
CREATE TRIGGER trg_incident_logs_immutable
  BEFORE UPDATE OR DELETE
  ON public.incident_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_incident_log_immutability();

-- Trigger function: prevent hard-deletes on incidents (force ARCHIVED status instead)
CREATE OR REPLACE FUNCTION public.enforce_incident_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RAISE EXCEPTION
    'INTEGRITY VIOLATION: Incidents cannot be permanently deleted. '
    'Set status=''ARCHIVED'' instead. Attempted DELETE on incident: %',
    OLD.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_incidents_no_delete ON public.incidents;
CREATE TRIGGER trg_incidents_no_delete
  BEFORE DELETE
  ON public.incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_incident_soft_delete();


-- ============================================================
-- Phase 4C: Justice Vault Hardening — Time-Bound Access
-- ============================================================

-- 1. Link vault documents to an incident (for evidence tracking)
ALTER TABLE public.vault_documents
  ADD COLUMN IF NOT EXISTS linked_incident_id UUID REFERENCES public.incidents(id),
  ADD COLUMN IF NOT EXISTS access_expires_at  TIMESTAMPTZ;  -- Explicit fallback expiry

-- 2. Time-bound RLS policy for ABUSE / JUSTICE incident types
--    The assigned legal guide can only SELECT the document while the incident is ACTIVE.
DROP POLICY IF EXISTS "Time-bound legal guide access" ON public.vault_documents;
CREATE POLICY "Time-bound legal guide access"
  ON public.vault_documents
  FOR SELECT
  USING (
    -- Standard: users can always see their own documents
    auth.uid() = user_id
    OR
    -- Time-bound: legal guide access only while incident is active
    EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id = vault_documents.linked_incident_id
        AND i.type   IN ('ABUSE', 'JUSTICE')
        AND i.status IN ('PENDING', 'ASSIGNED')          -- Access auto-revokes on RESOLVED / ARCHIVED
        AND auth.uid() = ANY(i.assigned_guide_ids)
    )
  );

-- 3. Guard: prevent non-owner updates to linked_incident_id
DROP POLICY IF EXISTS "Only owners can update their documents" ON public.vault_documents;
CREATE POLICY "Only owners can update their documents"
  ON public.vault_documents
  FOR UPDATE
  USING (auth.uid() = user_id);
