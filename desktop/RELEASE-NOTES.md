Bndrm Desktop 0.2.6 beta opens invitation email drafts in the system default email app. Mail links keep the workspace open and are limited to a single recipient with subject/body fields; the online workspace receives no general native permissions. The website now explains draft sending and offers a copyable email message as a fallback.

Bndrm Desktop 0.2.5 beta fixes verification of MP3 files with embedded album artwork. Only audio streams are decoded; valid audio no longer fails because a video encoder is unavailable. The actual frozen verifier is regression-tested using a synthetic MP3 with JPEG cover art.

Bndrm Desktop 0.2.4 beta refreshes the app branding and keeps installed builds connected to the production website. Localhost overrides are limited to development builds, use a separate credential entry, and cannot redirect a packaged app. The desktop library identifies itself so the website can hide its redundant download button.

Bndrm Desktop 0.2.3 beta adds browser launch support. Install this update once to register bndrm://open. Open Bndrm Desktop from a waiting song or processing queue in the browser; the connected processor starts automatically. Opening the link while the app is already running brings its existing window forward. Links cannot run commands, change the connected band, or approve access.

The website temporarily pauses earlier Mac installer downloads until this verified release is published.

Bndrm Desktop 0.2.2 beta fixes the Mac app bundle signature. Both Mac installers are checked after mounting the final disk image and copying the app to a fresh folder. This includes strict code-signature verification, controller startup, and audio-processor inference from the installed bundle.

The Mac beta uses an ad-hoc signature, not an Apple Developer ID certificate or Apple notarization. macOS may require approval in System Settings > Privacy & Security. This release does not disable Gatekeeper or remove quarantine.

Bndrm Desktop 0.2.1 beta introduces the Soft Daylight design: warm cream surfaces, forest green controls and the supplied Bndrm monogram, including native app icons. Download the matching installer from https://bndrm.vercel.app/desktop.

Bndrm Desktop beta for Apple silicon Macs, Intel Macs and Windows 64-bit PCs.

Install the matching DMG or Windows installer, open Bndrm, click Connect your band, sign in, select the intended band and approve the displayed code. Open Library & Session and drop a song into the library. Keep Bndrm Desktop running while it processes. Band members use https://bndrm.vercel.app on phones and tablets.

The installers bundle Python, FFmpeg, Demucs and Whisper. Approximately 220 MB of model weights download on first use. Allow several GB for the app, models and temporary lossless stems. No Homebrew or Python installation is required on the user's computer. This beta targets macOS 14 or newer and Windows 10/11 64-bit.

These early beta installers are unsigned. On Mac, drag Bndrm to Applications, try opening it, then use System Settings > Privacy & Security > Open Anyway if macOS blocks it. On Windows, review the SmartScreen publisher warning and use More info > Run anyway only for the installer obtained from this repository. Organizations may block unsigned apps. Signed and notarized releases require publisher certificates before general distribution.

The computer processes only its paired band's queue. Revoke a computer in Bndrm's Band workspace settings. Disconnect clears the local credential vault entry, but use Revoke to disable the server connection. Closing the desktop app stops its processing. Files and checkpoints are kept for interrupted delivery and automatically removed after the server confirms success; uninstalling does not automatically delete retained audio or models in the app's local data directory.

Demucs produces vocals, drums, bass and other. It does not generate a click track. Tempo, chord and lyric timing estimates require review, and instrument tabs must be supplied. Internet access remains necessary for accounts, private uploads and synchronized web sessions. Playback synchronization retains the web application's existing limitations.

This release passed the bundled dependency/startup checks on all build platforms. Actual device playback and recognition accuracy require user testing. Installer updates are available from https://bndrm.vercel.app/desktop.
