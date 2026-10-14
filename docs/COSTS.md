# Planning costs, researched 9 October 2026

These are estimates in USD, excluding taxes, domain registration, email, independent backup storage and unusual traffic. No live worker benchmark or bill was available. Configure provider spending alerts; application source-minute caps do not stop all hosting or egress charges.

| Component | Current published basis | Small beta assumption |
|---|---|---|
| Vercel Pro | $20 per developer seat/month, $20 included usage credit; delivery and functions billed by usage | One seat, low API traffic: start around $20/month, inspect metered usage |
| Supabase Pro | $25/month including first project, additional projects from $10/month | Production + minimum staging: start around $35/month before upgrades |
| Supabase audio storage | 100 GB included, $0.0213/GB-month above; uncached egress 250 GB included then $0.09/GB; cached egress 250 GB included then $0.03/GB | Ten bands using 2 GB each fit storage allocation, repeated multi-device rehearsals can dominate egress |
| Railway Hobby worker | $5/month minimum including $5 usage; container RAM $10/GB-month, CPU $20/vCPU-month, egress $0.05/GB | Persistently allocated 4 GB RAM alone is about $40/month; CPU adds actual consumed resources |

Approximate beta baseline with Vercel + two Supabase projects + a continuously allocated 4 GB worker is $95/month before CPU, SMTP and backups. Worker idle RAM can cost money; a minimum plan price is not its full monthly cost. CPU duration and memory must be measured. Do not quote a per-song price until benchmarked.

Illustrative inference calculation only: 2 vCPU and 4 GB RAM for five processing minutes gives 2×5×$0.000463 + 4×5×$0.000231 ≈ $0.00925 of those metered resources. A threefold slower processing time triples this estimate. This excludes always-on idle memory, downloads, container startup and failed attempts. It is not a measured Demucs runtime.

44.1 kHz stereo 24-bit WAV uses roughly 15.876 MB/minute per stem; four stems for a five-minute song use about 318 MB, plus the original. Twenty songs at that duration can exceed a 2 GB band limit. One five-minute four-stem playback download on four devices is about 1.27 GB before reuse/caching. Stored ZIP exports briefly duplicate the stems and require quota space; they expire after 24 hours.

Official sources:

- https://vercel.com/pricing
- https://vercel.com/docs/functions/usage-and-pricing
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/backups
- https://docs.railway.com/pricing/plans

The UI shows beta source-minute allowances before processing and does not charge payment. Billing was not added. Admin-assigned entitlements and a global AI source-minute ceiling control beta usage. Set host limits and billing alerts independently.
