# Song recognition and editable information

Uploaded audio can be identified with AudD's supported standard recognition API. A bounded, mono 22.05 kHz 16-bit WAV excerpt of up to 12 seconds is selected from the first 90 seconds, favoring music over leading silence. This is a separate temporary sample; stored stems, offsets, playback timeline and original audio are not changed. A batch of existing stems triggers one lookup, from its first stem. A mixed recording generally provides a better match; use **Identify from mixed recording** for a separate reference lookup when needed. That reference button performs identification only and does not save the reference as a playback track.

Song editor fields now include title, artist, album, release date, genre, ISRC, label, catalog link and notes. A recognized result is presented as a possible match. **Use matched details** fills those fields; **Save song** persists them. Every field can be changed afterward. **Not this song** dismisses a wrong match. No match, provider errors, missing credentials, or your own original recording all leave the same manual editing fields available. Recognition does not infer lyrics, chord charts, tabs, tempo, time signature, key or a tempo map. Confirm those for your band's arrangement using the existing editor.

The standard AudD API performs catalog fingerprint recognition, rather than asking a text model to invent song information. Some covers, live versions and isolated instrument stems are not recognizable. Users can disable automatic lookup using the checkbox before importing. A short excerpt is sent to the external provider; the interface discloses this. Provider credentials remain on the server, and excerpts are not retained by the application after the request. Publish appropriate privacy disclosures for AudD under its terms before production use.

## Activation

1. Create an API token at https://dashboard.audd.io/.
2. On Vercel, set server-only AUDD_API_TOKEN, RECOGNITION_ENABLED=true, and RECOGNITION_MONTHLY_CAP=10000 (or your chosen ceiling). Keep production and staging tokens/limits independent; never use NEXT_PUBLIC for the token. Redeploy.
3. On the existing Sites deployment, add server runtime AUDD_API_TOKEN and RECOGNITION_ENABLED=true through its environment settings. No token was available in this session, so the deployed interface shows manual entry and a configuration notice.
4. Apply the additive `202610100001_recognition.sql` migration to each Supabase project with `supabase db push` after linking the correct project. It creates private per-band cached recognition records and server-only transactional claims. No remote migration was run without project credentials.
5. Test with a licensed known mixed recording, an original, a false match, a provider timeout, a replay of the same sample, and two isolated bands. Confirm metadata survives a reload and click/track timing stays unchanged.

The Supabase path caches the same song/sample result, claims a two-minute lease to prevent concurrent duplicate requests, limits retry attempts to three, enforces 20 provider claims/hour/user, 200/month/band and a configurable global monthly ceiling. Claims count even if the provider subsequently fails, since the request may still be billable. Cached successful/no-match requests do not consume another call. Only service-role code can invoke the claim RPC; users cannot override the global ceiling. The legacy private Sites path has a CAS cache/lease and 20 claims/hour/account; it does not have the multi-band global ceiling. Provider-level budgets still apply.

Provider errors and logs do not expose the token or private signed audio links. The app sends the short file itself, not an original object's URL. Inputs are validated and capped at 529,244 bytes before buffering, below Vercel's function payload threshold. Recognition uses a 25-second provider timeout and does not hold up the saved audio import if it fails.

## Cost and evidence

Official AudD pricing checked 10 October 2026: first 300 evaluation requests free; entry-level paid file recognition is $5 per 1,000 requests, with volume discounts. Confirm the provider's current contract before activation. There is no payment collection in Bandroom. Sources: https://audd.io/ and https://docs.audd.io/.

`pnpm test` passes 24 tests. Added tests cover bounded sample extraction, leading silence, actual provider request/response shape with mocked responses, no-match/failure/unconfigured states, editable metadata persistence, keeping charts/timing untouched, cross-band denial, cache deduplication and spending caps. Live AudD identification was not run because no API token was provided. Existing Supabase setup dependencies still apply.
