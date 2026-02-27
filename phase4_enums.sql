-- ============================================================
-- Phase 4 — Part 1 of 2: ENUM Extensions ONLY
-- Run this first, then run phase4_migration.sql
-- ============================================================

-- Extend incident_type enum with Justice category values
ALTER TYPE incident_type ADD VALUE IF NOT EXISTS 'ABUSE';
ALTER TYPE incident_type ADD VALUE IF NOT EXISTS 'JUSTICE';

-- Extend incident_status with orchestration states
ALTER TYPE incident_status ADD VALUE IF NOT EXISTS 'ESCALATED';
ALTER TYPE incident_status ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- After running this, click "Run" and WAIT for success confirmation.
-- Then open phase4_migration.sql and run it as a separate query.
