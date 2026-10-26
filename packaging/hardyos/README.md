# ReelForge on HardyOS

`ReelForge-<version>.hardyapp` installs ReelForge on a HardyOS NAS in one click from the App Store. Each
release attaches one, built from [`reelforge/`](reelforge) by the `docker` job in
`.github/workflows/release.yml`.

**What it sets up:**
- **The container:** ReelForge runs as its own user, from the `ghcr.io/reelforge-stream/reelforge:<version>`
  image (Jellyfin 12.2 with the ReelForge module already installed).
- **Datasets:** `apps/stream.reelforge.server/config` holds settings, accounts and watch history, and is
  snapshotted and backed up. `…/cache` holds artwork and conversions in progress.
- **Your media folder:** you pick it at install, and it appears in ReelForge as `/media`. You can add an
  optional second folder, which appears as `/media2`.
- **The graphics card:** NVIDIA, Intel or AMD, picked automatically. On first start ReelForge sets streaming
  conversions to use it (NVENC, Quick Sync or VA-API).
- **Networking:** host networking, so the Google TV and Roku apps find the server by themselves.
  It needs ports 8096 (TCP) and 7359 (UDP).

The package format is described in [FORMAT.md](FORMAT.md), with a JSON schema in
[app.schema.json](app.schema.json).

## Until the HardyOS App Store exists

HardyOS doesn't ship Docker or the App Store yet. In the meantime you can try the package on any Linux
machine with Docker. The reference tool does exactly what HardyOS will do:

```
python3 scripts/hardyapp.py validate packaging/hardyos/reelforge
python3 scripts/hardyapp.py pack packaging/hardyos/reelforge --version 0.9.9
sudo python3 scripts/hardyapp.py install ReelForge-0.9.9.hardyapp --root /srv/hardytest --answer media=/srv/media
sudo python3 scripts/hardyapp.py uninstall stream.reelforge.server --root /srv/hardytest
```

## One-time GitHub setting

The first release pushes the image to GitHub Packages as **private**. Make it public once, so NAS boxes can
download it without signing in: open the repository on GitHub, go to **Packages → reelforge → Package
settings → Change visibility → Public**.
