-- RescueMe Foundational Schema
-- Phase 1: ERS & PALO Core

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'USER', -- USER, GUIDE, ADMIN
  trust_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Incidents Table (ERS)
CREATE TYPE incident_type AS ENUM ('MEDICAL', 'SECURITY', 'FIRE', 'OTHER');
CREATE TYPE incident_status AS ENUM ('PENDING', 'ASSIGNED', 'RESOLVED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS public.incidents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  type incident_type DEFAULT 'OTHER',
  status incident_status DEFAULT 'PENDING',
  description TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location GEOGRAPHY(POINT, 4326),
  user_id UUID REFERENCES auth.users(id),
  assigned_guide_id UUID REFERENCES public.profiles(id)
);

-- 3. Vault Documents Table (PALO)
CREATE TYPE verification_status AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

CREATE TABLE IF NOT EXISTS public.vault_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id),
  title TEXT NOT NULL,
  document_type TEXT,
  verification_status verification_status DEFAULT 'PENDING',
  file_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- 4. Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_documents ENABLE ROW LEVEL SECURITY;

-- 5. Basic Policies (For Development)
-- Profiles: Users can read all, write own
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile." ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Incidents: Users can read all, insert own
CREATE POLICY "Incidents are viewable by everyone." ON public.incidents FOR SELECT USING (true);
CREATE POLICY "Users can trigger SOS." ON public.incidents FOR INSERT WITH CHECK (true); -- Simplified for Initial PoC
CREATE POLICY "Guides can update status." ON public.incidents FOR UPDATE USING (true); -- Simplified for Initial PoC

-- Vault: Private
CREATE POLICY "Users can see own documents." ON public.vault_documents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can upload own documents." ON public.vault_documents FOR INSERT WITH CHECK (auth.uid() = user_id);
