# Audio processing

The standalone deployment uses the owner-operated Mac worker documented in worker/SETUP.md. It stores inputs and four lossless stems in private Cloudflare R2, and records jobs, progress, analysis and charts in Supabase. The earlier rehearsal implementation remains in the source for regression tests; its ChatGPT Sites credentials are not used by the standalone deployment.

Demucs htdemucs generates vocals, drums, bass and other. librosa estimates tempo, beat timing and chords. LRCLIB lyrics are looked up before Whisper transcription. Edited charts and tabs are preserved when analysis finishes. User confirmation is needed for musical estimates. Authored untimed tabs use estimated phrase timing rather than automatic note transcription.

Uploaded files are checked against per-band size, duration and storage reservations. WAV metadata is read through a bounded range request. Compressed inputs are decoded by the Mac before becoming playable stems. Originals are retained. Jobs deduplicate and use expiring leases; local checkpoints survive network failures. Download and upload URLs bind one object and one operation. The Mac receives queue credentials, never R2 or database administration credentials.

First model downloads can take additional time. The status panel reports the current processing step and available measured progress. A step estimate is not a promised overall completion time. Uploads wait in the queue when the Mac is offline.
