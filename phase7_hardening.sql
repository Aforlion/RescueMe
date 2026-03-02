-- ============================================================
-- Phase 7: Emergency Bug Fixes & Hardening
-- ============================================================

-- 1. Patch incident_status enum with ON_SCENE and ACCEPTED
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'incident_status' AND e.enumlabel = 'ON_SCENE') THEN
    ALTER TYPE public.incident_status ADD VALUE 'ON_SCENE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'incident_status' AND e.enumlabel = 'ACCEPTED') THEN
    ALTER TYPE public.incident_status ADD VALUE 'ACCEPTED';
  END IF;
END $$;

-- 2. Add phone column and unique constraint to profiles
--    This ensures USSD lookup reliability. 
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD CONSTRAINT unique_guide_phone UNIQUE (phone);

-- 3. Helper to remove a guide from an incident's assigned list (used in ussd_gateway rejection)
CREATE OR REPLACE FUNCTION public.remove_guide_from_incident(
  p_incident_id UUID,
  p_guide_id    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.incidents
  SET assigned_guide_ids = array_remove(assigned_guide_ids, p_guide_id)
  WHERE id = p_incident_id;
END;
$$;

-- 4. [CLEANUP] Remove deprecated single assigned_guide_id column (Phase 4 moved to array)
-- Only run if certain no legacy code depends on it
-- ALTER TABLE public.incidents DROP COLUMN IF EXISTS assigned_guide_id;
