# Costs and usage

No customer billing is enabled. Each band’s connected desktop handles audio processing. Website, metadata and private object storage are supplied by Vercel, Supabase and Cloudflare R2, each subject to its current plan limits and terms. Free allowances are not unlimited; consult the provider dashboards before increasing usage. Commercial use must follow Vercel plan requirements.

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
The Stripe sandbox is connected. Real checkout remains disabled until the account
is activated, live prices and webhook credentials are configured, and tax setup is
confirmed. Paid capacity comes only from verified Stripe state; redirects and
client claims never grant it. Sandbox and live billing records are isolated.

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

## Billing operation and launch

Run setup with the connected sandbox environment:

    node --env-file=.env.local scripts/setup-billing.mjs

This creates/reuses the Plus product, monthly/annual prices, customer portal and
signed webhook endpoint. Live events use /api/billing/webhook; sandbox events use
/api/billing/sandbox-webhook and separate server-only sandbox credentials. It writes secrets only to the ignored local environment.
Keep the webhook secret in Vercel sensitive variables; use a restricted Stripe key
with only the required customer, subscription, invoice, charge, Checkout, portal,
product/price and webhook permissions for production.

Required events are listed in lib/billing-policy.ts. The handler verifies signatures,
rejects events from the wrong mode, deduplicates updates, and re-reads current
subscriptions rather than trusting old event snapshots. Unpaid sessions never
fulfill an upgrade. Renewal failure or expiry restores the free ceiling without
removing songs. Canceling normally retains Plus until the paid period ends.
Full refunds, disputes and fraud warnings hold paid storage for owner review.
Use Owner administration → Billing reviews to inspect Stripe and resolve the
specific reviewed event. Resolving a hold cannot grant storage on an unpaid plan.
Deleting a workspace first expires pending checkout and cancels renewable
subscriptions without creating a final charge or automatic refund. Stripe retains
its own financial records; customer-card details are never stored in this app.

To launch real payments after sandbox verification:

1. The account owner must claim the Stripe resource, supply the real business and
   identity details, add a payout bank account, and finish Stripe activation.
2. Confirm business jurisdiction and existing tax registrations. Do not enable
   automatic tax without active registrations and a verified tax calculation.
3. Connect live credentials through Vercel, pull them into the ignored
   .env.stripe-live.local file, and run setup with that env file and the explicit
   --live flag. This keeps the local sandbox environment separate. Configure the resulting live price IDs, portal configuration and signing
   secret. Never reuse sandbox resource IDs or secrets for live billing.
4. After verification, set BILLING_LIVE_ENABLED=true and redeploy. Until then,
   customers see pricing with checkout disabled. BILLING_SANDBOX_ENABLED permits
   app-owner-only tests and should remain false in the public deployment.

Daily maintenance refreshes effective storage allowances. Every new upload,
separation, retry and ZIP reservation also refreshes the allowance in the database,
so a missed webhook cannot keep an expired paid allocation usable.
