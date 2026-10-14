# Standalone production setup

Target repository: https://github.com/andrewosborne918/Bandroom
Vercel project: bandroom-public (`prj_byeQCG1y5ZvJG5mkR8BRoOT5VqFW`)
Supabase project: hxwpdflqzmrgnxmodhgn
Production origin: https://bandroom-public.vercel.app

## Already configured in Vercel

The project uses Next.js, Node 24, repository root, `pnpm install --frozen-lockfile`, and `pnpm build:vercel`. Production configuration includes the supplied Supabase URL and publishable key, APP_PLATFORM=supabase, APP_ENV=production, APP_ORIGIN, AUDIO_STORAGE=r2, the R2 endpoint, R2_BUCKET=bandroom-audio, and generated private WORKER_SECRET and CRON_SECRET values.

Preview deployments must not receive production database or R2 credentials. They display setup state until a separate staging project is configured.

## Supabase database

All eight initial migrations were applied to this project on 14 October 2026 and verified. Their repository filenames match the actual Supabase migration versions. Do not rerun the initial schema in the SQL Editor.

The repository contains ordered SQL migrations in supabase/migrations. If the GitHub integration applies them automatically, inspect its migration results before running them manually. Otherwise apply each migration in filename order to the new project using the SQL Editor, or use `supabase link --project-ref hxwpdflqzmrgnxmodhgn` followed by `supabase db push` from a reviewed checkout. Never apply initial migrations twice. The database stores authorization and quotas even when audio objects live in R2.

For this production project, set these Auth settings:

- Site URL: https://bandroom-public.vercel.app
- Redirect allowlist: https://bandroom-public.vercel.app/auth/callback and https://bandroom-public.vercel.app/auth/callback?type=recovery
- Email/password signup enabled, email confirmation enabled, minimum password length 12.
- Custom SMTP configured for invitations, signup confirmations and recovery emails. The default Supabase email service is restricted and is not a general public signup mailer.

Use the project's server secret key or legacy service_role key as Vercel production `SUPABASE_SERVICE_ROLE_KEY`. Enter it directly into Vercel, never GitHub or chat. The publishable key is different and cannot administer the server database.

Configure private Realtime access. App state is refreshed periodically even when Realtime is unavailable. Supabase's Free storage file limit is not used for audio when AUDIO_STORAGE=r2.

## Cloudflare R2

1. In R2, create a private Standard bucket named `bandroom-audio`.
2. Keep public development URL and custom-domain access disabled.
3. In bucket Settings, paste docs/r2-cors.json as the CORS policy.
4. Under R2 API tokens, create an Object Read & Write token restricted to this bucket.
5. Put its S3 Access Key ID into Vercel production `R2_ACCESS_KEY_ID`.
6. Put its S3 Secret Access Key into Vercel production `R2_SECRET_ACCESS_KEY`.

Use the S3 credentials, not the Cloudflare API token value. Current endpoint:
https://381577f10d96aac67edc6463a7aadfc8.r2.cloudflarestorage.com

Private logical folders hold originals, stems, temporary uploads and exports in one bucket. Uploads go directly to R2; the API checks reservation size and decoder metadata before approving them. Retry reuploads the file from its beginning. Pending uploads are cleaned up by the authenticated maintenance task.

## Application owner and Mac connection

After registering and confirming your Bandroom account, copy your user UUID from Supabase Authentication > Users. Set Vercel production APPLICATION_OWNER_IDS to that UUID. Redeploy after adding secrets or changing build-time public configuration.

In Bandroom, open application administration (shield icon) and Download Mac connection. This download is restricted to application owners. Follow worker/SETUP.md using public-worker-config.json. The Mac has only queue credentials, not database or R2 administrator keys. This owner-operated worker handles the public processing queue, including other authorized bands. Uploads wait safely when the Mac is offline. Initial model downloads and actual processing require the Mac to be awake and online.

## Public access

The production origin is configured for public access. Vercel Authentication protects previews only. Test the assigned production domain in a private browser window, then register a second account and verify separate band libraries. Do not make private storage buckets public to solve a website sign-in problem.

## Readiness and acceptance

GET /api/setup/status reports configuration readiness without exposing keys. Account/server/storage/database/workerCredentials must all be true before the app is usable. WorkerOnline becomes true when the Mac connects. This check does not prove SMTP delivery or actual stem separation.

Test a small audio upload, a real four-stem separation, pause/resume/seek, edited lyrics and tabs after reload, live stem switches, and an audience device with imported click and cues excluded. Test a second band cannot download the first band's audio. Inspect queued/failed jobs and test retries. Confirm signup and password reset messages arrive.

## Existing rehearsal library

Existing songs, audio and edited charts remain on the rehearsal deployment. Do not delete it until the library has been transferred and verified in the new band workspace. Deploying source code does not transfer private user data. A library migration is a separate step after the destination database, storage and owner account are working.
