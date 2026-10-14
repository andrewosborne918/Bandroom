# Bndrm Desktop

## User workflow

Download the installer for your computer from https://bndrm.vercel.app/desktop. Install it, open Bndrm Desktop, and choose Connect your band. Sign in in the Library & Session window, select your band, and approve the code in the Band workspace panel. Codes expire after ten minutes. Owners, administrators and editors can pair computers. A band can pair up to ten computers; the queue claims one job at a time using transactional leases.

Open Library & Session. Drop a mixed recording into the existing import area to queue verification, four-stem Demucs separation and analysis. Or import aligned GarageBand stems with the existing multi-file importer. All job progress, results, arrangements, monitoring controls and session playback use the existing records and endpoints. Keep Desktop open while processing. Other devices use the website and their own accounts to join the private band/session. The leader can hear click; an additional audience device receives only musical stems.

The desktop app's Python runtime, FFmpeg, Demucs and Whisper are bundled. Models download on first launch. No Terminal, Homebrew or Conda setup is required for users. Mac 14+ (Apple silicon or Intel) and Windows 10/11 x64 are the initial targets. CPU processing avoids a cloud inference charge. Current band duration, storage and processing allowances still apply and are displayed before submission. Internet is required for the cloud library, accounts and session coordination. Estimates and the existing synchronization limitations remain; no new accuracy or millisecond guarantee has been measured.

## Security and recovery

Pairing requests generate a 256-bit device secret and a ten-character approval code. Only SHA-256 hashes are stored on the server. Pending codes expire after ten minutes. Pair creation is rate limited to six requests per minute per IP. Only the secret holder can poll the connection. Approval checks current editor membership and band suspension in the same transaction; codes cannot be reused or moved to a different band. The credential is stored in macOS Keychain or Windows Credential Manager, passed over stdin to the bundled processor, and never included in source code or process arguments.

Every processor request rechecks revocation, current editor membership and suspension. Queue claims, verification, exports, signed input/output URLs, progress, resume and completion are band-scoped. The old shared WORKER_SECRET is rejected by the standalone processor API. Legacy Sites processing remains separate. Native commands are allowed only from the bundled local controller window; the remote Bndrm window has no native capability and every custom command also checks its window label.

Revoke a processor in the band workspace panel to stop future server access. Disconnect in Desktop stops it and clears its saved local credential; it does not revoke the server record. Closing the entire app stops processing and its child tools. Interrupted results and leases remain in the band-specific application-data directory until the server acknowledges success. Network retries reuse checkpoints and deterministic stem IDs. If a lease was reassigned, its old processor cannot complete it. Failed jobs use the existing Retry action in the song import panel. Uninstalling does not delete retained data automatically. To remove retained originals, stems, models and checkpoints, quit the app and remove its application-data directory:

- Mac: `~/Library/Application Support/app.bndrm.desktop`
- Windows: `%LOCALAPPDATA%\app.bndrm.desktop`

## Building and releasing

The GitHub workflow `.github/workflows/desktop.yml` builds Apple silicon DMG, Intel DMG and Windows NSIS EXE installers. It packages Python with PyInstaller, bundles FFmpeg, checks imports and FFmpeg startup, and runs real Demucs separation plus analysis on generated test audio. Installers are uploaded as Actions artifacts. A beta GitHub release is published only after all three builds pass. The website reads public releases to show actual available assets, so it never advertises an installer that has not built successfully. The workflow uses the repository's scoped GITHUB_TOKEN. No Supabase server keys, R2 keys, publisher credentials or processor secret are needed for unsigned beta builds.

Run local web checks with `npm test` and `npm run build`. Build the native app on the matching OS with Python 3.11, FFmpeg and Rust 1.90 installed:

```sh
python -m pip install -r desktop/requirements-build.txt pillow==11.3.0
python desktop/scripts/build_ffmpeg.py
python desktop/scripts/build_processor.py
python desktop/scripts/make_icons.py
cd desktop
npm ci
npm run build -- --bundles dmg
```

Use `--bundles nsis` on Windows. Intel Macs use PyTorch 2.2.2 because later PyTorch Mac releases do not supply Intel wheels; other targets use 2.5.1. Windows uses CPU wheels. The lockfiles pin native and JavaScript dependency resolution. Python's primary packages are pinned but all transitive packages are not fully locked yet. Review new dependencies when refreshing the build.

## Publisher signing setup

Unsigned beta installers can produce OS warnings and may be blocked by organization policies. For broad distribution, obtain a Developer ID Application certificate through an Apple Developer account and a Windows code-signing certificate. Configure credentials directly in GitHub Actions secrets, never in source or chat.

For a signed local Mac build, import the Developer ID Application certificate into Keychain Access. Set `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password), and `APPLE_TEAM_ID` in the build environment. Tauri will sign and notarize using those values. For CI, certificate import into a temporary keychain is also required; follow https://v2.tauri.app/distribute/sign/macos/. Hardened-runtime entitlements and signatures for all bundled Python/native libraries need verification before publishing a notarized build. The unsigned workflow does not currently import publisher certificates or claim notarization.

For Windows, configure a trusted signing provider or certificate and Tauri's `bundle.windows.signCommand` using https://v2.tauri.app/distribute/sign/windows/. The unsigned workflow has no Windows signing credentials. Download-and-install updates are available through the desktop Updates button. Automatic silent updates are not enabled; they require a separate updater signing key and signed release manifest.

## Licenses

Tauri: MIT/Apache-2.0. Demucs and Whisper: MIT. librosa: ISC. PyTorch and torchaudio: BSD-style licenses. The installer builds a minimal FFmpeg 7.1.1 with GPL, nonfree and third-party codec features disabled. FFmpeg runs as a separate executable under LGPL 2.1+. Its exact checksum-verified source archive, configuration and license are bundled, alongside Python dependency license notices. Imported songs and charts remain private band content.
