# Current verification

14 October 2026: See [AUDIO-PIPELINE.md](AUDIO-PIPELINE.md) for real local Demucs/Whisper inference, measured fixture beat errors, chord controls and 31 passing tests. Railway provisioning is blocked by an expired trial; live hosted inference and AudD identification are not yet enabled. The following is the historical 9 October record.

# Verification record

9 October 2026. Local managed Linux environment, Node 24 and PostgreSQL WASM (PGlite). No connected Supabase project, SMTP credentials, hosted Demucs worker or physical phone outputs were available.

| Check | Evidence | Limit |
|---|---|---|
| GarageBand stem timing | Core test stores WAV fixtures with equal leading silence unchanged; Web Audio scheduling test exercises positive/negative offsets and seeks | Synthetic fixtures, no user's GarageBand audio supplied |
| Separation integration | Real Demucs invocation, async backend job protocol, private scoped downloads/uploads, typed metadata and lossless WAV registration implemented | No actual inference or audible quality evaluation run |
| Retry/deduplication | SQL tests execute identical submissions, failure/retry/cancel, stale lease and global allowance | Local SQL engine; provider network and worker crash tests pending |
| Persistent mixes | Existing durable playback API tests save/reload arrangements; SQL migrations store song/arrangement records and revision checks | Live Supabase reload flow pending |
| Band click | Core audio scheduling test permits band click | Physical device audio not measured |
| Audience exclusion | Core tests deny click/cue imports, suppress generated click/cue and ignore restricted stems in solo logic; cloud audio path additionally checks actual stored category/filename | Live Supabase URLs and physical PA output pending |
| Stem play/seek alignment | Scheduled common AudioContext timeline and offset tests pass | Inter-device acoustic synchronization not measured |
| Cross-band privacy | SQL tests use two bands and roles, reject foreign records/allocations and Storage insertion, restrict exact reserved paths and deny user Storage SELECT | Managed Supabase RLS, TUS and private Realtime integration pending |
| Roles/invites | SQL verified invited email, single use, ownership transfer, restricted edits/quotas, delegated transport and revocation tests | Live email delivery and OAuth pending |
| Quota cleanup/export | Reservation capacity, atomic result registration, idempotent completion, ZIP reserve/finalize, reconciliation and song deletion cleanup tests | Cloud bytes removal and actual ZIP worker upload pending |
| Build | Next.js production webpack build and Sites Vinext build pass locally; Python syntax checks pass | Hosted Vercel build initially failed due to omitted hosting JSON, corrected build passed; hourly cron exceeded Hobby limits, so a daily starter schedule was selected |
| Backup | Streaming DB/private-file export and hash manifest script, retention and restore runbooks added | No backup credentials or isolated provider restore drill |

Command: `node --test tests/core.test.mjs tests/platform-db.test.mjs` reports 18 tests passed. `pnpm typecheck` regenerates Next route types before TypeScript, avoiding conflicting generated Vinext types. Python `py_compile` passed for the worker and backup scripts.

PGlite stubs Auth, Storage metadata and Realtime schemas to execute the complete application migrations and RLS policies in a real local PostgreSQL engine. This verifies application SQL behavior, not Supabase service behavior. Core tests use synthetic WAV data and mocked audio scheduling; they do not measure acoustic output skew. RTT/2 describes clock estimate uncertainty only. No guarantee of perfectly synchronized phone output is made.

Public launch remains gated on configuration and the acceptance checklist in PRODUCTION-SETUP.md, including actual separation, two-band provider permissions, SMTP, cross-device playback and backup recovery.
