# Personal band use and costs

Bndrm is a non-commercial app for the owner and the musicians he plays with.
It stays on Vercel Hobby. There are no subscriptions, paid storage upgrades,
checkout prompts or plans to launch commercial billing.

## Current setup

- Vercel hosts the website and API.
- Supabase supplies accounts, band permissions, metadata and processing jobs.
- Cloudflare R2 stores private recordings, stems and temporary exports.
- Each band's connected Bndrm Desktop processor performs audio separation.

No paid hosting upgrade or Netlify migration is planned. Keep real and sandbox
checkout flags false. Public billing routes reject requests independently of
those flags, and the unused Stripe webhook destinations are disabled. Existing
billing migrations and internal lifecycle code remain for compatibility; no
user data or account permissions are removed by this change.

## Storage

The personal owner account retains unlimited application storage on owned bands.
Band members share that library without requiring separate subscriptions.
Other workspaces retain the existing 2 GiB allowance, which is a resource limit,
not a commercial free tier. Storage meters remain visible.

Unlimited application storage is not unlimited free provider storage. R2 Standard
includes a shared 10 GB-month free allowance, then usage charges. Request costs
also apply beyond included allowances; download egress is free. Budget alerts
are not a hard spending cap. A global zero-spend upload guard has not been
implemented. Monitor provider usage before adding large libraries or more bands.

Existing file-size, queue and desktop processing limits remain in force. Daily
maintenance continues reconciling usage, clearing expired reservations and
processing temporary-file cleanup. No songs are deleted to change this policy.

Provider plans and terms can change. Check [Vercel Hobby](https://vercel.com/docs/plans/hobby),
[Supabase pricing](https://supabase.com/pricing), and [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
for current limits. Reassess hosting terms before any future commercial use.

## Invitation-only access

Only the personal app owner may create workspaces or invitation links. Public
signup is rejected by an Auth database trigger unless an active owner-issued
invitation exists for that email. Existing accounts without a band cannot create
workspaces. Existing band members keep their access.

In Band settings, enter an email and role, then choose Create invitation link.
Copy the link or use Email invitation to open an email draft in your mail app.
The app does not send the message automatically and needs no email-provider
subscription. Send the link only to its intended recipient: it contains a
single-use Supabase authentication token. Opening it does not consume it; the
recipient must submit the invitation form, choose a password, and join. Band
membership requires the verified email to match the invitation. The Supabase
auth token can expire before the 48-hour band invitation; generate a new link
if needed. A replacement invitation invalidates the previous band invitation.

`invitation_owners` is private and service-managed. Initial ownership is seeded
only from existing personal account owners who already own a band. Removing a
band member revokes access through the existing membership policies.

## Browser-to-desktop processing

The library shows queued and running processing jobs above its song cards and
labels each waiting song. Missing uploads are labeled separately; opening Desktop
cannot process audio that has not been uploaded. Completed jobs refresh library
summaries automatically. Open Bndrm Desktop uses the bndrm://open URL scheme,
registered by Desktop 0.2.3 and newer. Users must install that update once.
The link only opens/focuses the controller; it does not contain credentials,
approve a computer, change bands, or execute commands. Existing pairing and
processing permissions still apply. Install/update links remain available if
the browser cannot find a compatible desktop app.
