# RescueMe — Full Project Report

> Last updated: 2026-02-25

---

## What We Built

### Phase 0 — Shared Foundation
A monorepo infrastructure using **Yarn workspaces** with three shared packages:

| Package | Purpose |
|---|---|
| `packages/types` | Zod schemas + TypeScript interfaces for every domain object |
| `packages/supabase` | Singleton Supabase client shared across web & mobile |
| `packages/ui` | Design tokens (`tokens.colors`, `tokens.spacing`, `tokens.borderRadius`) |

---

### Phase 1 — ERS: Emergency Response System ✅

**Mobile** (`apps/mobile/src/screens/SOSScreen.tsx`):
- 5-second safety countdown to prevent accidental triggers
- Real GPS capture via `expo-location` (high-accuracy mode)
- Inserts incident with live lat/lng into Supabase `incidents` table

**Web** (`apps/web/src/app/page.tsx` — ERS Tab):
- Real-time incident feed via Supabase Postgres Changes websocket
- Pulsing red badge for `PENDING` incidents
- **DISPATCH GUIDE** and **CLOSE CASE** action buttons
- Google Maps link from GPS coordinates

**Database**: `incidents` table with RLS — users only see their own signals.

---

### Phase 2 — PALO: Identity Vault ✅

**Mobile** (`apps/mobile/src/screens/PaloScreen.tsx`):
- Native file picker via `expo-document-picker`
- Uploads to a **private** Supabase Storage bucket (`vault-documents`)
- Registers documents with `PENDING` verification status

**Web** (`apps/web/src/app/page.tsx` — PALO Tab):
- Human verification queue: Approve ✅ / Reject ❌
- Colour-coded status chips: VERIFIED (green), PENDING (yellow), REJECTED (red)

**Database**: `vault_documents` table with RLS — users only see their own documents.

---

### Phase 3 — Token Economy ✅

**Mobile** (`apps/mobile/src/screens/WalletScreen.tsx`):
- Terminal-style balance card with live `token_balance` in **RME** credits
- Trust Score progress bar (0–100)
- Full transaction history with +/- colour-coded amounts

**Web** (`apps/web/src/app/page.tsx` — 🪙 LEDGER Tab):
- Tabular transaction log across the platform
- **Reputation Engine**: auto-rewards on key actions:
  - `+50 RME` when a Guide resolves an incident
  - `+20 RME` when an identity document is verified

**Database** (`token_economy.sql` — applied ✅):
- `transactions` ledger table with RLS
- `add_tokens()` — atomic, `SECURITY DEFINER` PL/pgSQL function

---

## Architecture

```
RescueMe (Turborepo Monorepo)
├── apps/
│   ├── mobile/     → Expo React Native (RESCUE · PALO · WALLET tabs)
│   └── web/        → Next.js (ERS · PALO · LEDGER tabs)
└── packages/
    ├── types/      → Zod + TypeScript schemas
    ├── supabase/   → Shared DB client
    └── ui/         → Design tokens
```

**Supabase Tables**: `auth.users` → `profiles` → `incidents`, `vault_documents`, `transactions`

**Project Ref**: `pveilpyiwggkepbnahqe`

---

## What's Next

### Suggested Phase 4 Options

| Option | Description | Impact |
|---|---|---|
| **Auth Flow** | Real login/signup screens (email + magic link) | 🔴 Highest — everything is currently anonymous |
| **Push Notifications** | Alert guides when a new incident fires | 🟠 High — completes the SOS loop |
| **Signed URL Viewer** | Web admin previews vault docs via short-lived URLs | 🟡 Medium — security hardening |
| **Trust Score Algorithm** | Decay over time, weighted by incident type | 🟡 Medium — reputation depth |
| **Edge Function Rewards** | Move `add_tokens` logic server-side for tamper-proofing | 🟡 Medium — production security |
| **Map View** | Leaflet/Mapbox incident heatmap on the Web OS | 🟢 Nice-to-have |
