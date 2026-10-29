# Rehearsal upgrade · 29 October 2026

## Implemented

- Library / Prepare / Perform navigation, responsive song cards, cream/forest styling, accessible controls and an optional dark performance view. Phones enter the chart view directly.
- Named band setlists, explicit saves, optimistic revisions and protection against cross-band song references. The existing default set remains available to older clients.
- Per-song arrangement presets that preserve mute, volume, pan and solo without changing audio identity.
- Native Web Audio section/range loops, count-in on start, and 50–125% practice speed with SoundTouch pitch correction. Tempo is shared in the playback transport. Speed and loop changes require stopping playback.
- Waveform, detected beat ticks, downbeat placement and section-start editing, including keyboard-accessible numeric timing controls. Save the song to retain edits. Existing individual-stem and full-mix audition controls remain in the Audio tab.
- Set preparation that stores encoded audio within the device budget and reports file availability/errors separately from selected-song decoding. Stop pauses after the current file. Access is checked before each download.
- Compact session polls: unchanged charts are retained on the device; only changed songs are sent. Realtime change notifications remain primary; a 10-second fallback poll recovers missed state.
- Paginated, searchable metadata catalogs. Full charts/audio manifests load for the selected song or set, rather than every library entry.
- Click-only musician devices skip backing downloads/decoding. Audience devices continue to exclude click and private guide tracks.
- Fixed-scope, database-backed request limits; bounded diagnostic events; owner-visible preparation timings and failure counts; offline status; an error recovery screen; and a direct processing retry action.
- A read-only load harness and new database/audio/privacy/regression tests.

## Validation

- 76 automated tests pass, including two-band RLS, foreign-song rejection, setlist revision conflicts, compact state merge, loop offset/silence scheduling, audience click exclusion, cache isolation, catalog privacy, request limits and a local PGlite snapshot/restore exercise.
- Type checking and the Next.js production build pass. Final release checks should run `pnpm test`, `pnpm typecheck`, and `APP_PLATFORM=supabase pnpm build:vercel`.
- Browser checks use the actual Bndrm components with an in-memory development fixture at `/dev-preview`: named set creation/saving, catalog search, arrangement capture/recall, waveform editing, original-speed playback, 75% chorus-loop playback, and a 390×844 musician layout.
- `/dev-preview` returns 404 in production. It contains generated example music and does not access customer data.
- A local development health-endpoint smoke load completed 100 requests from 10 clients with zero failures. This is a harness/server smoke check, not a user-capacity benchmark or a database/session load test.

## Release dependency and approval

The new app requires `supabase/migrations/20261029141110_rehearsal_upgrade.sql` (or the actual migration version recorded by Supabase when it is applied). Apply the reviewed migration before deploying this app. Do not merge/deploy the upgrade against an unmigrated production database.

The migration removes the old uniqueness constraint that limited each band to one default and one non-default set, replacing it with a unique partial index for the default only. It adds set revisions, indexes, editor-scoped setlist mutation policies/column grants, invoker RPCs for set saves/catalog reads, and a private, checked request-limiter gateway. It preserves song/audio records. Direct setlist updates cannot reassign band ownership or toggle the default marker.

Automatic approval review rejected applying this migration to production because it changes schema, a constraint and access permissions. No production migration was applied. Explicit user approval of this production migration is required before retrying it. Source changes remain reviewable independently.

After approval:

1. Apply the exact reviewed migration to the existing Bndrm Supabase project. Reconcile the repository filename with the server-returned migration version; do not apply it twice.
2. Check function permissions/RLS with Supabase advisors and read-only verification.
3. Deploy the tested source to the existing Vercel project/domain. Preserve the current audience and private R2 configuration.
4. Use two real band accounts to verify signup/recovery email delivery, song saves, desktop processing, set preparation and session readiness. Verify an existing cached desktop webview after restart.
5. Run the staging load exercise below with approved test-account credentials and an agreed workload.

The migration is additive to existing behavior except for the setlist uniqueness replacement. Reverting the application to the previous deployment remains possible without deleting new setlists or audio. Do not restore the old two-column uniqueness constraint after multiple named sets exist.

## Physical and operational acceptance still required

Software scheduling tests do not establish audible synchronization. Measure wired Mac/phone/PA output together, including seeks, loop boundaries, speed changes, count-in, backgrounding and reconnects. SoundTouch adds processing delay and can introduce artifacts; the source, click and imported guides pass through one correction bus to preserve their relative alignment. Test output routing on actual hardware before relying on practice-speed playback on stage.

Saved-on-device audio still requires online authorization. This release does not grant offline access after membership revocation and does not implement offline multi-device sessions.

Demucs still produces vocals/drums/bass/other. This release does not claim improved separation quality, reliable automatic tablature, or calibrated chord confidence. Model replacement needs a representative evaluation set and listening tests.

Bands retain their own paired desktop processors. Hosted processing is not provisioned and no new paid services, billing plans or model APIs are enabled. Scaling web accounts is different from scaling simultaneous audio processing.

The local snapshot/restore test does not prove a production Supabase/R2 restore. Perform the existing backup runbook against an isolated provider environment before opening a broad public beta. Verify SMTP delivery, provider capacity/budgets and account recovery on the active deployment. The existing leaked-password-protection advisory remains an operator setting to resolve before broad public signup.

## Staging load exercise

Use `scripts/load-rehearsal.mjs` against staging, with a private file containing only the Cookie header value of an approved test account. Never commit that file or use personal production sessions. The harness makes GET requests only and reports statuses, p50/p95/p99, total response bytes and failures without printing credentials.

```
chmod 600 /private/tmp/bndrm-staging-cookie
node scripts/load-rehearsal.mjs --url https://STAGING_ORIGIN --path /api/band/catalog --cookie-file /private/tmp/bndrm-staging-cookie --clients 10 --requests 100
```

Test catalog browsing, cold/warm audio authorization and compact session polls separately. For an active session, use its actual endpoint and version manifest. Begin with a small pilot; increase concurrent devices/bands while recording database latency, Realtime delivery, audio preparation failure rate, storage growth and processor queue delay. Establish an actual supported capacity from these results, rather than inferring it from registered account counts.

SoundTouch's MPL-2.0 license is distributed at `public/audio/SoundTouch-LICENSE.txt`. The unmodified processor is copied from the pinned dependency during each build; source is available at https://github.com/cutterbl/SoundTouchJS/tree/master/packages/audio-worklet.
