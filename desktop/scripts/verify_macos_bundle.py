"""Verify the actual app users receive, copied from its final DMG.

An ad-hoc signature proves bundle integrity, not Apple notarization. This test
never removes quarantine, changes Gatekeeper, or claims notarization approval.
"""
from pathlib import Path
import os
import plistlib
import subprocess
import sys
import tempfile
import time


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def main():
    if sys.platform != 'darwin':
        raise SystemExit('This verification requires a macOS runner')
    images = list(Path(sys.argv[1]).glob('*.dmg'))
    if len(images) != 1:
        raise SystemExit(f'Expected one final DMG, found {len(images)}')
    with tempfile.TemporaryDirectory(prefix='bndrm-install-check-') as temporary:
        root = Path(temporary)
        mount = root / 'mounted'
        mount.mkdir()
        run('hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', mount, images[0])
        try:
            apps = list(mount.glob('*.app'))
            if len(apps) != 1:
                raise RuntimeError('The DMG must contain exactly one application')
            app = root / 'installed' / apps[0].name
            app.parent.mkdir()
            run('ditto', apps[0], app)
        finally:
            run('hdiutil', 'detach', mount)
        # Fail on precisely the missing resource-seal error reported by the user,
        # as well as invalid nested code, symlinks, changed files or signatures.
        run('codesign', '--verify', '--deep', '--strict', '--verbose=2', app)
        run('codesign', '--display', '--verbose=2', app)
        if not (app / 'Contents' / '_CodeSignature' / 'CodeResources').is_file():
            raise RuntimeError('The application has no sealed resource manifest')
        processors = list((app / 'Contents' / 'Resources').rglob('bndrm-processor'))
        processors = [p for p in processors if p.is_file() and os.access(p, os.X_OK)]
        if len(processors) != 1:
            raise RuntimeError(f'Expected one installed processor, found {processors}')
        run(processors[0], '--self-test')
        run(sys.executable, Path(__file__).with_name('smoke_test.py'), processors[0])
        with (app / 'Contents' / 'Info.plist').open('rb') as source:
            info = plistlib.load(source)
        executable = app / 'Contents' / 'MacOS' / info['CFBundleExecutable']
        # Clean CI keychain has no paired band. Launching the local controller
        # must stay alive without generating any pairing credential or job.
        process = subprocess.Popen([str(executable)])
        try:
            time.sleep(8)
            if process.poll() is not None:
                raise RuntimeError(f'Installed controller exited early: {process.returncode}')
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        print('Final DMG: resource seal, strict nested signatures, installed audio inference and controller startup passed.', flush=True)
        print('Signing tier: ad-hoc beta. Developer ID/notarization approval has NOT been tested or claimed.', flush=True)


if __name__ == '__main__':
    main()
