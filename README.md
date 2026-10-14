# Bndrm

A standalone band playback app with private song libraries, aligned stems, band click and cues, audience output, lyrics, chord charts and tabs. Users sign in with Bndrm email accounts. No ChatGPT account is required.

## Hosting

- Website and API: Next.js on Vercel.
- Accounts, band membership, jobs and song metadata: Supabase PostgreSQL with row-level security.
- Audio: private Cloudflare R2 with expiring, operation-specific signed URLs.
- Audio separation and analysis: the owner's existing Mac, using Demucs, librosa and Whisper. No Modal or Railway service is needed.

The production project is `bandroom-public`; the intended origin is `https://bndrm.vercel.app`. This source is a standalone migration of the rehearsal app. Existing ChatGPT Sites data is not automatically moved.

See [production setup](docs/PRODUCTION-SETUP.md) for the remaining account settings and [Mac worker setup](worker/SETUP.md).

## Local development

Use Node.js 24 and the pinned pnpm version in package.json. Copy `.env.example` to `.env.local`, fill development-only credentials, then run:

```
pnpm install --frozen-lockfile
pnpm dev
```

Production credentials belong in Vercel environment variables. Never commit connection files, database passwords or storage secrets. Use an independent Supabase project and R2 bucket for previews or local development.

## Verification

```
pnpm test
pnpm typecheck
pnpm build:vercel
```

Tests exercise song privacy, database permissions, reservations, job retries, chart persistence, shared audio caching, click/cue exclusion, timeline offsets and signed storage URL boundaries. A live acceptance test also requires configured credentials, confirmed accounts, a private R2 bucket and a connected Mac worker.

## Audio and chart limits

The htdemucs model creates vocals, drums, bass and other stems. Tempo and chord estimates may need correction. Lyrics lookup uses LRCLIB before Whisper fallback; catalog recognition requires an optional AudD credential. Authored chords and tabs remain editable. Untimed charts and tabs use estimated timing; the app does not extract accurate tablature automatically.

All stems share the original recording start, including leading silence. Import GarageBand exports from the same song range. Personal audio preferences are independent from the band's saved backing arrangement. Browser scheduling is synchronized to an estimated shared clock; output hardware, Bluetooth, network and browser behavior can affect actual audible synchronization.
