# Costs and usage

No customer billing is enabled. The owner-operated Mac handles audio processing. Website, metadata and private object storage are supplied by Vercel, Supabase and Cloudflare R2, each subject to its current plan limits and terms. Free allowances are not unlimited; consult the provider dashboards before increasing usage. Commercial use must follow Vercel plan requirements.

Per-band quotas and AI processing caps are enforced by the database. The app owner can inspect usage and suspend a band or disable processing. R2 budget alerts do not constitute a hard spending cap. Keep the worker private and monitor aggregate storage and request usage before inviting a large number of bands.

## Storage plans

Free workspaces include 2 GiB. The header shows remaining space; Band settings
break down stored audio and space reserved for uploads, processing and exports.
Account allowances are private service-managed records in `storage_account_overrides`.
The personal owner account has unlimited storage (`storage_limit = NULL`) on owned
workspaces. Membership alone does not inherit the allowance; transferring ownership
to a free account restores the free ceiling without deleting existing audio.
File-size limits, processing-minute limits and queue limits still apply.

Chosen launch price: **Bndrm Plus — 25 GiB, $8/month or $80/year per band (USD)**.
Checkout is not enabled until Stripe is connected and subscription lifecycle handling
is verified. Do not grant paid capacity based on a browser redirect or client claims.

At current list prices, 25 GiB is about $0.40/month in R2 Standard storage.
For an $8 domestic U.S. card subscription, Stripe Payments (2.9% + $0.30) and
Billing (0.7%) total about $0.59, leaving approximately $7.01 before hosting,
database, requests, backups, taxes, refunds, support and development costs.
This is contribution before those expenses, not guaranteed profit. The annual
plan leaves roughly $6.00/month after those same storage and payment assumptions.
The existing desktop processor is required; this price does not include hosted GPUs.

Sources checked October 29, 2026: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[Stripe Payments](https://stripe.com/pricing), [Stripe Billing](https://stripe.com/billing/pricing),
and [BandHelper pricing](https://www.bandhelper.com/main/pricing.html).
