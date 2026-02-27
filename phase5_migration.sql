-- ============================================================
-- Phase 5 Migration: Skill Taxonomy & P2P Endorsements
-- Run in Supabase Dashboard > SQL Editor
-- ============================================================

-- ============================================================
-- 5A: GRANULAR SKILL TAXONOMY
-- ============================================================

-- 1. Skill category reference table (lookup / validation)
CREATE TABLE IF NOT EXISTS public.skill_categories (
  id           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  category     TEXT    NOT NULL,   -- Medical, Legal, Technical, Logistics
  tag          TEXT    NOT NULL UNIQUE,
  description  TEXT
);

INSERT INTO public.skill_categories (category, tag, description) VALUES
  ('Medical',   'Nurse',                 'Registered Nurse or Nursing Assistant'),
  ('Medical',   'Doctor',                'Licensed Medical Doctor'),
  ('Medical',   'Paramedic',             'Emergency Medical Technician or Paramedic'),
  ('Medical',   'CPR_Certified',         'CPR / Basic Life Support certified'),
  ('Legal',     'Lawyer',                'Licensed Legal Practitioner'),
  ('Legal',     'Paralegal',             'Certified Paralegal'),
  ('Legal',     'Human_Rights_Officer',  'Human Rights or Social Justice Officer'),
  ('Technical', 'Welder',                'Certified Welder'),
  ('Technical', 'Mechanic',              'Vehicle or Equipment Mechanic'),
  ('Technical', 'Electrician',           'Licensed Electrician'),
  ('Logistics', 'Driver',                'Licensed Vehicle Driver'),
  ('Logistics', 'Vulcanizer',            'Tyre Repair and Vehicle Recovery Specialist'),
  ('Logistics', 'Dispatcher',            'Emergency Dispatch and Coordination Specialist'),
  ('Safety',    'Firefighter',           'Trained Firefighter or Fire Safety Officer')
ON CONFLICT (tag) DO NOTHING;

-- 2. Extend profiles with skill fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS skills_set  TEXT[]  DEFAULT '{}',   -- e.g. ['Nurse', 'CPR_Certified']
  ADD COLUMN IF NOT EXISTS skill_tier  TEXT    DEFAULT 'NOVICE' CHECK (skill_tier IN ('NOVICE', 'COMPETENT', 'EXPERT'));

-- Index for fast skill-matching queries in the Edge Function
CREATE INDEX IF NOT EXISTS idx_profiles_skills ON public.profiles USING GIN(skills_set);

-- ============================================================
-- 5B: P2P ENDORSEMENT LOGIC
-- ============================================================

-- 3. Verifications table: one Guide vouches for another's skill
CREATE TABLE IF NOT EXISTS public.verifications (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  endorser_id   UUID        NOT NULL REFERENCES auth.users(id),
  recipient_id  UUID        NOT NULL REFERENCES auth.users(id),
  skill_tag     TEXT        NOT NULL REFERENCES public.skill_categories(tag),
  statement     TEXT,                    -- Optional written endorsement
  CONSTRAINT no_self_endorsement CHECK (endorser_id <> recipient_id),
  CONSTRAINT unique_endorsement    UNIQUE (endorser_id, recipient_id, skill_tag)
);

ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;

-- Users can see endorsements made for them
DROP POLICY IF EXISTS "Recipients can read their endorsements" ON public.verifications;
CREATE POLICY "Recipients can read their endorsements"
  ON public.verifications FOR SELECT
  USING (auth.uid() = recipient_id OR auth.uid() = endorser_id);

-- Only high-trust guides (trust_score >= 70) can create endorsements
DROP POLICY IF EXISTS "High-trust guides can endorse" ON public.verifications;
CREATE POLICY "High-trust guides can endorse"
  ON public.verifications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND trust_score >= 70
        AND role = 'GUIDE'
    )
  );

-- Anti-spam: enforce 3 endorsements per 30-day rolling window (via trigger)
CREATE OR REPLACE FUNCTION public.enforce_endorsement_rate_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  recent_count INT;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.verifications
  WHERE endorser_id = NEW.endorser_id
    AND created_at > NOW() - INTERVAL '30 days';

  IF recent_count >= 3 THEN
    RAISE EXCEPTION
      'RATE LIMIT: You can only endorse 3 users per 30-day period. '
      'Next window opens on %',
      (SELECT MIN(created_at) + INTERVAL '30 days'
       FROM public.verifications
       WHERE endorser_id = NEW.endorser_id
         AND created_at > NOW() - INTERVAL '30 days');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_endorsement_rate_limit ON public.verifications;
CREATE TRIGGER trg_endorsement_rate_limit
  BEFORE INSERT ON public.verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_endorsement_rate_limit();

-- 4. Auto-update trust score and skill_tier on new endorsement
CREATE OR REPLACE FUNCTION public.process_endorsement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  endorsement_count INT;
  new_trust         INT;
  new_tier          TEXT;
BEGIN
  -- Count how many total endorsements recipient has
  SELECT COUNT(*) INTO endorsement_count
  FROM public.verifications
  WHERE recipient_id = NEW.recipient_id;

  -- Trust score boost: +5 per endorsement, capped at +15 total from endorsements
  -- Fetch current score and add clipped boost
  SELECT LEAST(100, trust_score + LEAST(5, GREATEST(0, 15 - (endorsement_count - 1) * 5)))
  INTO new_trust
  FROM public.profiles
  WHERE id = NEW.recipient_id;

  -- Determine skill tier thresholds
  new_tier := CASE
    WHEN endorsement_count >= 10 THEN 'EXPERT'
    WHEN endorsement_count >= 3  THEN 'COMPETENT'
    ELSE                              'NOVICE'
  END;

  -- Apply updates to recipient profile
  UPDATE public.profiles
  SET
    trust_score = new_trust,
    skill_tier  = new_tier
  WHERE id = NEW.recipient_id;

  -- Append to skills_set if tag not already present
  UPDATE public.profiles
  SET skills_set = array_append(skills_set, NEW.skill_tag)
  WHERE id = NEW.recipient_id
    AND NOT (skills_set @> ARRAY[NEW.skill_tag]);

  -- Log the endorsement as a token reward
  PERFORM public.add_tokens(
    NEW.recipient_id,
    5,
    'REWARD',
    format('P2P Endorsement: %s skill verified by peer', NEW.skill_tag)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_process_endorsement ON public.verifications;
CREATE TRIGGER trg_process_endorsement
  AFTER INSERT ON public.verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.process_endorsement();

-- ============================================================
-- 5C: Update get_nearest_guides to support skill filtering,
--     adaptive radius for CRITICAL incidents, and reliability sort
-- ============================================================
--
-- Parameters:
--   incident_lat / incident_lng  — incident coordinates
--   max_results                  — max guides to return (default 2)
--   required_skills              — NULL = no skill filter
--   incident_severity            — 'STANDARD' (8 km) | 'CRITICAL' (15 km)
--   max_radius                   — explicit metre override; 0 = use severity defaults
--
-- Sort priority: distance ASC (closest first), trust_score DESC (most reliable wins ties)
CREATE OR REPLACE FUNCTION public.get_nearest_guides(
  incident_lat       DOUBLE PRECISION,
  incident_lng       DOUBLE PRECISION,
  max_results        INT     DEFAULT 2,
  required_skills    TEXT[]  DEFAULT NULL,
  incident_severity  TEXT    DEFAULT 'STANDARD',  -- 'STANDARD' | 'CRITICAL'
  max_radius         INT     DEFAULT 0             -- metres; 0 = use severity defaults
)
RETURNS TABLE (
  id               UUID,
  full_name        TEXT,
  trust_score      INT,
  distance_meters  DOUBLE PRECISION,
  skills_set       TEXT[]
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.full_name,
    p.trust_score::INT,
    ST_Distance(
      p.location,
      ST_MakePoint(incident_lng, incident_lat)::GEOGRAPHY
    ) AS distance_meters,
    p.skills_set
  FROM public.profiles p
  WHERE
    p.role     = 'GUIDE'
    AND p.location IS NOT NULL
    AND (
      required_skills IS NULL          -- no filter: any guide
      OR p.skills_set && required_skills -- guide has at least one required skill
    )
    AND ST_DWithin(
      p.location,
      ST_MakePoint(incident_lng, incident_lat)::GEOGRAPHY,
      -- Radius resolution: explicit override > severity default
      CASE
        WHEN max_radius > 0           THEN max_radius
        WHEN incident_severity = 'CRITICAL' THEN 15000   -- 15 km for critical incidents
        ELSE 8000                                         -- 8 km standard
      END
    )
  ORDER BY
    distance_meters ASC,    -- closest first
    p.trust_score   DESC    -- break ties by reliability
  LIMIT max_results;
$$;

