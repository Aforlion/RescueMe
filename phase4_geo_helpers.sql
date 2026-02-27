-- ============================================================
-- Phase 4A Supplement: PostGIS Geo-Nearest Guides Helper
-- Requires PostGIS extension to be enabled
-- ============================================================

-- Enable PostGIS if not already done
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add location column to profiles for guide positions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role       TEXT DEFAULT 'USER',   -- USER | GUIDE | ADMIN
  ADD COLUMN IF NOT EXISTS location   GEOGRAPHY(POINT, 4326); -- Guide's current GPS location

-- Create index for fast spatial queries
CREATE INDEX IF NOT EXISTS idx_profiles_location ON public.profiles USING GIST(location);

-- RPC function used by the Edge Function to find nearest guides
CREATE OR REPLACE FUNCTION public.get_nearest_guides(
  incident_lat DOUBLE PRECISION,
  incident_lng DOUBLE PRECISION,
  max_results  INT DEFAULT 2
)
RETURNS TABLE (id UUID, full_name TEXT, trust_score INT, distance_meters DOUBLE PRECISION)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id,
    p.full_name,
    p.trust_score::INT,
    ST_Distance(
      p.location,
      ST_MakePoint(incident_lng, incident_lat)::GEOGRAPHY
    ) AS distance_meters
  FROM public.profiles p
  WHERE
    p.role = 'GUIDE'
    AND p.location IS NOT NULL
  ORDER BY distance_meters ASC
  LIMIT max_results;
$$;
