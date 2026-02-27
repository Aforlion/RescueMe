# Phase 5 Progress Report — Skill-Based Onboarding & P2P Verification

**Date**: 2026-02-25  
**Status**: Implementation Complete — Pending SQL Deployment

---

## Deliverables

| File | Component |
|---|---|
| [`phase5_migration.sql`](file:///c:/RescueMe/phase5_migration.sql) | Skill taxonomy, verifications table, P2P triggers, updated `get_nearest_guides` |
| [`packages/types/src/index.ts`](file:///c:/RescueMe/packages/types/src/index.ts) | `SkillTag`, `SkillTier`, `Role`, `Endorsement`, extended `Profile` |
| [`process_incident_assignment/index.ts`](file:///c:/RescueMe/supabase/functions/process_incident_assignment/index.ts) | `INCIDENT_SKILL_MAP` + 4-tier adaptive guide matching |
| [`ussd_gateway_spec.md`](file:///c:/RescueMe/ussd_gateway_spec.md) | Full SMS/USSD API contract |
| [`ussd_gateway/index.ts`](file:///c:/RescueMe/supabase/functions/ussd_gateway/index.ts) | Africa's Talking webhook handler |

---

## Schema Update: Skill Taxonomy

### `skill_categories` (reference table — seeded)

| Category | Tags |
|---|---|
| Medical | Nurse, Doctor, Paramedic, CPR_Certified |
| Legal | Lawyer, Paralegal, Human_Rights_Officer |
| Technical | Welder, Mechanic, Electrician |
| Logistics | Driver, Vulcanizer, Dispatcher |
| Safety | Firefighter |

### `profiles` extensions
```sql
ADD COLUMN skills_set  TEXT[]  DEFAULT '{}'
ADD COLUMN skill_tier  TEXT    DEFAULT 'NOVICE'  -- NOVICE | COMPETENT | EXPERT
```

---

## P2P Endorsement Logic Flow

```
Endorser (trust_score >= 70, GUIDE role)
    │
    ├─ INSERT into verifications { endorser_id, recipient_id, skill_tag }
    │
    ├─ TRIGGER: enforce_endorsement_rate_limit
    │     └─ Raises EXCEPTION if endorser has ≥3 endorsements in last 30 days
    │
    └─ TRIGGER: process_endorsement (AFTER INSERT)
          ├─ trust_score += 5 (per endorsement, max +15 from endorsements alone)
          ├─ skills_set = array_append(skills_set, skill_tag)
          ├─ skill_tier: NOVICE → COMPETENT at 3 endorsements, → EXPERT at 10
          └─ add_tokens(+5, 'REWARD', 'P2P Endorsement: Nurse skill verified')
```

**Self-regulation**: The `trust_score >= 70` gate means only established guides can vouch for newcomers. The 30-day rate limit prevents coordinated manipulation. The `UNIQUE (endorser_id, recipient_id, skill_tag)` constraint prevents double-endorsement.

---

## Adaptive SLA Skill-Matching Flow

```
Incident INSERT (type = 'HEALTH')
    │
    ▼
INCIDENT_SKILL_MAP['HEALTH'] → ['Nurse', 'Doctor', 'Paramedic', 'CPR_Certified']
    │
    ├─ Tier 1: get_nearest_guides(lat, lng, required_skills=['Nurse',...])  ← Geo + Skill
    ├─ Tier 2: profiles WHERE skills_set && ['Nurse'] ORDER BY trust_score  ← Skill only
    ├─ Tier 3: get_nearest_guides(lat, lng, required_skills=NULL)            ← Geo, any guide
    └─ Tier 4: profiles WHERE role='GUIDE' ORDER BY trust_score             ← Last resort
    
Chosen strategy is logged to incident_logs.metadata.match_strategy
```

This guarantees assignment never fails due to skill unavailability.

---

## SMS/USSD Logic Flow

```
Feature Phone Guide (no smartphone)
    │
    ├─ Receives SMS:
    │     "[RESCUEME SOS] ACCIDENT | Reply 1=Accept 2=Reject 3=Backup | Ref: A3F9"
    │
    ├─ Replies: "1"
    │
    ├─ ussd_gateway Edge Function:
    │     ├─ Auth: X-AT-APIKey header validation
    │     ├─ Lookup: profiles WHERE phone='+234...' AND role='GUIDE'
    │     ├─ Lookup: incidents WHERE assigned_guide_ids @> [guide_id]
    │     ├─ INSERT incident_logs: { event='ACCEPTED', channel='SMS' }
    │     ├─ UPDATE incidents: accepted_by = guide_id
    │     └─ Send SMS: "You accepted A3F9. Navigate to 6.45N, 3.38E. Trust+5 on completion."
    │
    └─ Same flow works for USSD (*384#) with interactive menu
```

---

## Deployment

```bash
# 1. Run SQL migration
# Supabase Dashboard > SQL Editor > phase5_migration.sql

# 2. Deploy both Edge Functions
supabase functions deploy process_incident_assignment
supabase functions deploy ussd_gateway

# 3. Set USSD gateway secrets
# AT_API_KEY, AT_USERNAME → Supabase Dashboard > Edge Functions > ussd_gateway > Secrets

# 4. Register Africa's Talking webhook
# URL: https://pveilpyiwggkepbnahqe.supabase.co/functions/v1/ussd_gateway
```

---

## Phase 5 Audit Checklist

- [x] `skill_categories` seeded with 14 skill tags across 5 categories
- [x] `profiles.skills_set` indexed with GIN for fast array matching
- [x] `verifications` table with self-endorsement guard and unique constraint
- [x] Rate-limit trigger: 3 vouches per 30-day rolling window
- [x] `process_endorsement` trigger: trust boost + tier upgrade + token reward
- [x] `INCIDENT_SKILL_MAP` in Edge Function with 4-tier fallback strategy
- [x] USSD gateway handles SMS reply codes and USSD interactive menu
- [x] Guide identified by `profiles.phone` — no smartphone required
- [ ] **Pending**: Run `phase5_migration.sql`
- [ ] **Pending**: Deploy `process_incident_assignment` (updated) and `ussd_gateway`
