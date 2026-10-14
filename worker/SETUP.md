# Desktop users

Use the packaged Bndrm Desktop app and band pairing described in [DESKTOP.md](../docs/DESKTOP.md). The older shared public-worker configuration below is superseded and cannot authenticate to the public processor endpoint. These scripts remain for development and legacy Sites operations.

# Connect your existing Mac processor

Use the existing Bndrm folder and its working .venv. No model reinstall is needed.

1. Download this GitHub repository as a ZIP and unzip it.
2. Stop the current worker with Control+C after any active job finishes.
3. Copy these five files from the ZIP's worker folder into your existing Bndrm folder: worker.py, cloud_worker.py, analyze.py, start_public_worker.py, start-public-worker.sh.
4. In the standalone app's owner administration panel, download the Mac connection and place public-worker-config.json in the same folder.
5. Run:

```sh
cd "/Users/aosborne1/Desktop/Projects/Bandroom"
bash start-public-worker.sh
```

The new connection is separate from worker-config.json, so the earlier connection is retained. Do not run both processors against the same local checkpoint directory. New jobs are processed only while this worker runs; caffeinate keeps the Mac awake during processing. Finished stems and analysis are stored online and can play when the Mac is off.

The worker downloads through short-lived private URLs, retains intermediate outputs locally after network failures, renews job leases, and uploads aligned four-stem results without routing audio through Vercel. Its secret grants processing-queue access and must remain private. Never share or commit public-worker-config.json.
