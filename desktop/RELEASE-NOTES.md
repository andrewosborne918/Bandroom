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
