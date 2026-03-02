-- Add missing enum values for incident_status
DO  BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'incident_status' AND e.enumlabel = 'ACCEPTED') THEN
    ALTER TYPE public.incident_status ADD VALUE 'ACCEPTED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'incident_status' AND e.enumlabel = 'ON_SCENE') THEN
    ALTER TYPE public.incident_status ADD VALUE 'ON_SCENE';
  END IF;
END ;
