# Automatic recording processing — 14 October 2026

## What a dropped mixed recording does

The file-first import stores audio privately and reads duration. AudD catalog fingerprinting, when configured, supplies title, artist, album and other catalog fields. Embedded tags/filenames are fallbacks and are labeled as unverified. Recognition does not claim to provide tempo, lyrics or chords.

When the worker is healthy, the import queues a durable automatic analysis job, without asking for a form or another audio upload. Existing uploads have a **Process uploaded song** button. Jobs survive navigation, expose queued/processing/completed/failed states, deduplicate by source, and offer bounded retries. Completion automatically saves four stems and analysis to the song. The original remains downloadable and is muted to avoid playing the mixed song twice. Musical stem categories and shared/device monitoring rules are unchanged: generated click and imported click/cues are denied to audience devices. Separation cannot guarantee removing click or cues already baked into a musical recording.

The worker uses real Demucs htdemucs inference: vocals, drums, bass and other, aligned stereo 44.1 kHz 24-bit WAV. Guitar/keys/backing vocals are not separate model outputs. Librosa estimates beats from the drums, with mixed-audio fallback. Whisper base transcribes the vocal audio into timed segments. Original chroma template code estimates major/minor/seventh chords and a global key from other + bass. Results are estimates, not a retrieved official score. Instrument tabs are not generated. Silence or uncertain harmony yields no reliable estimate, rather than invented chords/key; transcription can omit or mishear sung words.

Both audible and visual click use the actual detected beat timestamps on the shared playback timeline, including seeking and nonuniform tempo. Time signature and downbeat still require review. First-beat adjustment shifts the map. The timing editor offers a confirmed manual BPM override. A default 120 BPM value cannot enable click on an unprocessed upload. No reliable detected beat map means manual confirmation is required. Charts retain manual edits and auto-generated lyrics/chords are editable.

## Connected Mac queue

The owner can now redeem a signed-in, one-time Mac setup link to download worker-config.json. Its high-entropy code must match MAC_SETUP_CODE; secrets never enter source or a general download. With BACKGROUND_SECRET, SITES_WORKER_TOKEN and AUTO_PROCESS_UPLOADS=true configured server-side, file-first uploads queue on the backend immediately, even while the Mac is offline. Running the existing start-worker.sh connects that Mac to the private job queue. Completion saves four stems, beat timing, lyrics and chord estimates. The library and editor refresh results automatically. Original mixed audio is muted. The private Sites dispatch credential may expire and must be renewed; unattended permanent machine authentication remains unverified. AudD catalog identification still requires a separate credential.

## Mac alternative

The worker can run on a Mac using CPU processing. For credential-free local use, process_song.py produces four WAVs and analysis.json. Import all four WAVs into the song and choose **Import results processed on your Mac** to load its beat map, transcribed lyrics and chord estimates. This bypasses online worker credentials and paid hosting. The Mac kit has architecture-specific PyTorch pins; Intel needs 2.2.x. Existing authored charts are retained. Automatic online queue processing still needs the private Sites connection credentials described below.

## Optional hosted activation for the existing private Sites app

Provisioning was attempted on 14 October 2026. Railway returned **“Your trial has expired. Please select a plan to continue using Railway.”** No Bandroom worker project was created. This is the remaining hosting dependency; live processing is unavailable until it is resolved.

1. Select/reactivate a Railway billing plan in your account. No plan or payment was selected for you.
2. Create a dedicated Bandroom project/service from this repository; set service root directory **worker**, Dockerfile **Dockerfile**, start command **python entrypoint.py**. Do not reuse the unrelated trading application.
3. Begin with at least 4 GiB RAM / 2 vCPU and benchmark full-length music. CPU/RAM usage, not a per-song model API fee, determines hosting cost. Set a Railway spend alert; a plan minimum does not cover an always-running 4 GiB allocation. No provider credits are consumed by Demucs/Whisper.
4. Generate a cryptographically random shared secret (for example `openssl rand -hex 32`). Set server-only **BACKGROUND_SECRET** to the same value in Sites environment settings and the Railway worker. Never add it to source or NEXT_PUBLIC settings.
5. Worker variables: **WORKER_MODE=legacy**, **BANDROOM_URL=https://bandroom-live.workspace-126520.chatgpt.site**, **BACKGROUND_SECRET**, **SITES_SERVICE_TOKEN**. For this private deployment, retrieve the owner's `siwc_bypass_bearer_token` from the Sites get_site response and supply it as SITES_SERVICE_TOKEN. It is sensitive and may expire; it is not a proven permanent machine identity. Automatic credential renewal is not configured. Before operating unattended, establish a supported renewable service credential or activate the separately scoped Supabase worker deployment. Never publish that token. Private Sites dispatch uses the OAI-Sites-Authorization header. The app remains owner-private.
6. Redeploy Sites after runtime settings changes. Start the worker, verify separation/config reports enabled after heartbeat, then drop a licensed mixed recording or press Process uploaded song on an existing recording. The worker needs outbound access to the private app and the official model downloads. Docker includes CPU PyTorch, FFmpeg, libsndfile, Demucs, librosa and Whisper.
7. For actual catalog identification, separately create an AudD token at https://dashboard.audd.io and add server-only **AUDD_API_TOKEN** and **RECOGNITION_ENABLED=true** to Sites. Redeploy. No token was available, so live identification has not been validated. Catalog matching can fail for originals, covers, live recordings and poor samples; those remain editable.

The optional Supabase/Vercel deployment instead uses **WORKER_MODE=cloud**, its own BANDROOM_URL and shared **WORKER_SECRET**, plus all dependencies in PRODUCTION-SETUP.md. Apply additive migration `202610140001_audio_analysis.sql` to the appropriate configured Supabase project. Compressed file-first uploads queue analysis durably against an original asset while decoder verification is pending; inference claims only verified assets. No Supabase project or credentials are configured in the current environment.

## Reproduce verification

```
pnpm test
pnpm typecheck
pnpm build:vercel
python -m py_compile worker/*.py
# In a Python environment with CPU torch/torchaudio and worker requirements:
python -m demucs --int24 -n htdemucs -d cpu -o OUTPUT INPUT.wav
python worker/analyze.py INPUT.wav OUTPUT/htdemucs/INPUT ANALYSIS.json
```

Actual local inference ran on an 11-second fixture: official Whisper JFK test speech over a generated 120 BPM drum pattern and simple harmonic audio. Four distinct nonzero stereo 44.1 kHz 24-bit WAV files preserved identical duration. Whisper returned two timed speech segments, including “country.” Detected BPM was 120.14 across 22 beats; median grid error was 27.12 ms, maximum 38.73 ms on this synthetic fixture. The speech-heavy separated harmonic track correctly withheld unreliable key/chords. A clean C–F–G–C control produced those chord labels and key C; a single C chord control withheld global key.

These are real model executions, not mocked separation outputs. They do not establish sung-word accuracy or separation quality for the user's recording. Algorithmic beat error is not a measurement of phone-to-phone acoustic synchronization. No physical phones or PA were measured; the displayed clock uncertainty remains a network-clock estimate, not guaranteed output skew.

31 Node/PostgreSQL tests pass, covering source-job deduplication, automatically saved analysis/stems, original muting, malformed analysis payloads, variable beat/section timing and seeking, manual override, GarageBand silence alignment, retry safety, mix persistence, audience exclusion and cross-band authorization. Provider calls in recognition tests are mocked. Next.js and Sites builds are separately checked. Browser QA is unavailable in this managed environment.

## Primary sources / licenses

- Demucs code and htdemucs: https://github.com/facebookresearch/demucs — MIT. Preserve third-party notices.
- Whisper code and models: https://github.com/openai/whisper — MIT. Singing accuracy is not guaranteed.
- Librosa beat tracking: https://librosa.org/doc/latest/generated/librosa.beat.beat_track.html — ISC library.
- AudD API and cost: https://docs.audd.io and https://audd.io. Requires a provider credential independently of the worker.
- Sesh is a UX reference only; a supported developer API has not been verified and is not used.

## Worker reliability update, 14 October

The Mac worker stores each claimed job in .bandroom-cache, with owner-only directory permissions, and saves its lease before processing. Original downloads, completed separation and analysis are checkpointed. Transient connections and HTTP 5xx are retried with backoff; file uploads rewind before each retry. Finished audio is deleted locally only after a successful finish response or a completed server status. Restarted workers resume the same job and reuse cached audio, renewing or recovering leases via a CAS-protected endpoint. Credentials rejected with 401/403 produce a specific reconnect instruction. This cannot restore temporary files discarded by the older worker. Failed jobs retain checkpoints until Retry is selected.

34 Node/SQL tests and three Python reliability tests pass. The tests cover duplicate-free lease recovery, checkpoint retention on connection loss, full streamed upload retransmission, and authentication errors. This update has not yet been exercised on the user’s Mac.
