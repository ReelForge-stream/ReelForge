<p align="center"><img src="brand/logo-horizontal.svg" alt="ReelForge" height="72"></p>

<p align="center">Self-hosted media server for Windows. Streams on the GPU, finds duplicates, and shrinks your library.<br>
<a href="https://reelforge.stream">reelforge.stream</a></p>

---

ReelForge is a faster, friendlier replacement for Plex on Windows. It is one product with three layers:

| Layer | What it is | Why |
|---|---|---|
| **Engine** | Jellyfin Server 12.2 (unmodified) | Library scanning, metadata, users, transcoding and every existing Jellyfin TV/phone app keep working, and upstream fixes arrive for free. |
| **ReelForge module** | `ReelForge.dll`, a Jellyfin plugin | Adds the **Media Manager** (duplicates + Space Saver), serves the **new UI** from inside the DLL, and **keeps itself updated** from this repo. |
| **ReelForge UI** | React app at `http://<server>:8096/reelforge/` | The new interface: home, libraries, details, player, and the Media Manager screens. |

The installer runs it all as a single Windows service, so there is nothing else to install or run.

## Install

Download the latest **`ReelForge-Setup-x.y.z.exe`** from [Releases](https://github.com/ReelForge-stream/ReelForge/releases) and run it. Then open http://localhost:8096 to create your admin account and add your libraries.

**Media on a NAS?** Do two things:
- Add libraries by network path (`\\nas\media\Movies`), not by mapped drive letter. A Windows service can't see `Z:` drives.
- Run the service as your Windows account: open services.msc, then **ReelForge Media Server → Log On**. The default account (LocalSystem) has no access to network shares.

## Updates

You don't need to do anything:
- On startup, ReelForge registers this repo's update feed with the server.
- The server's daily **Update Plugins** task installs new releases. Since the UI ships inside the module, that covers the interface too.
- A restart (or the next reboot) activates an update.

New Jellyfin engine versions arrive with a new installer.

## Releasing (maintainers)

```bash
# on GitHub: Actions → Release → Run workflow → version 0.2.0
# or from a terminal:
git tag v0.2.0 && git push origin v0.2.0
```

The [Release workflow](.github/workflows/release.yml) then:
1. tests and builds the module and attaches `ReelForge_0.2.0.0.zip`;
2. builds `ReelForge-Setup-0.2.0.exe` on Windows and attaches it;
3. adds the version to the update feed (the `update-feed` branch's `manifest.json`).

Every server picks it up within a day.

## Try it on an existing Jellyfin install

You can run this next to Plex. ReelForge uses port 8096 and Plex uses 32400.

1. Install **Jellyfin Server 12.2 for Windows** from https://jellyfin.org/downloads/server.
2. Open http://localhost:8096 and finish the setup wizard. Create your admin account, then add your Movies and TV folders. These can be the same folders Plex uses; nothing is moved or renamed.
3. Stop the Jellyfin service.
4. Download `ReelForge_x.y.z.0.zip` from Releases and unzip it into `C:\ProgramData\Jellyfin\Server\plugins\ReelForge_x.y.z.0\`.
5. Start the service again and open **http://localhost:8096/reelforge/**.
6. In **Media Manager → Overview**, click **Use the GPU for streaming**. This switches Jellyfin's transcoder to NVENC, which fixes most buffering on phones and remote devices.

To preview the UI without a server, add `?demo` to the URL (for example `http://localhost:8096/reelforge/?demo`), or run `npm run dev` in `web/` and open `/reelforge/?demo`.

## Media Manager

### Duplicates
- Matching uses TMDb/IMDb/TVDb IDs. Without those it falls back to title + year for movies, and series + season + episode for TV.
- Matches work across folders and drives (`D:\Movies` vs `E:\Downloads`).
- Each copy is scored on resolution, HDR, codec efficiency × bitrate, audio channels and subtitles. The best copy is kept and the rest are pre-selected for removal.
- **Different editions are never pre-selected.** This covers Director's Cut, Extended, Theatrical, IMAX, 3D and `{edition-…}`.
- The server refuses to remove every copy of a title, and refuses anything that isn't a duplicate. File paths are always resolved server-side, never taken from the request.
- A removed file's own subtitles, NFO and artwork go with it. A sidecar shared with the copy you keep stays put.

### Space Saver
- Every file is estimated from data Jellyfin already has, so a scan of thousands of titles takes seconds.
- Files are re-encoded to **HEVC** (or **AV1** on cards that support it) at one of three quality presets.
- **Left alone:** Dolby Vision (the DV layer would be lost), HDR10+, disc images, extras under 3 minutes, files that are already efficient, and anything that would save less than 15% / 150 MB. HDR10/HLG files are opt-in.
- Each file is encoded on the NVIDIA GPU (NVENC, with CUDA decoding). It falls back to the CPU (x265 / SVT-AV1) only if the card can't do the job.
- **Every audio track, subtitle, chapter and font attachment is kept.** MP4 text subtitles become SRT, because Matroska can't hold them.
- **Each result is verified before anything changes.** Its duration must match within 0.5%, the audio and subtitle track counts must match, and it must actually be smaller. Otherwise the original is kept.
- The new file takes the original's name as `.mkv`, so external subtitles still match. The creation date is kept, so "Recently added" doesn't reshuffle.
- Watched status survives, because Jellyfin keys it by TMDb/TVDb IDs.
- By default conversions **pause while anyone is watching**, can be limited to a time window (for example 11 pm–7 am), and run at below-normal priority.

### Removed files (the safety net)
Nothing is deleted on the spot. Removed duplicates and replaced originals move into a hidden `.reelforge-holding` folder inside the same library folder. Because it's on the same disk, this is an instant rename. Jellyfin ignores the folder.

Files stay there for 14 days by default (configurable from 0 to 60). You can **put back** or **delete now** at any time from the UI.

> Disk space is only freed once held files are deleted for good. To free it immediately, use **Removed files → Delete all now**.

## GPU notes

The module live-tests the card at startup and shows the result in **Media Manager → Overview**.

| Card | Streaming (NVENC) | Space Saver HEVC | AV1 |
|---|---|---|---|
| Quadro 4000 (2010, Fermi) | ✗ no NVENC, CPU only | CPU only (slow) | ✗ |
| Quadro P4000 (Pascal) | ✓ | ✓ 8/10-bit | CPU only |
| Quadro RTX 4000 (Turing) | ✓ | ✓, better quality | CPU only |
| RTX 4000 Ada | ✓ | ✓ | ✓ |

Quadro cards have no limit on simultaneous NVENC sessions, so you can raise "Files at once" in Settings.

## Building the Windows installer

Requirements: Windows 10/11 x64, the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0), [Node.js 20+](https://nodejs.org) and [Inno Setup 6](https://jrsoftware.org/isdl.php).

```powershell
powershell -ExecutionPolicy Bypass -File .\packaging\windows\build.ps1
```

The output is `packaging\windows\dist\ReelForge-Setup-0.1.0.exe`. It:
- installs Jellyfin 12.2, the ReelForge module and a service wrapper (WinSW) to `C:\Program Files\ReelForge`;
- keeps all data in `C:\ProgramData\ReelForge`, which survives upgrades and uninstall;
- registers the **ReelForge Media Server** service with auto-start and restart on failure;
- optionally opens port 8096 on private networks;
- adds Start-menu shortcuts.

**Media on a NAS share?** See Install above for the two settings it needs.

## Project layout

```
server/ReelForge/        Jellyfin module (C#, .NET 10, Jellyfin 12.2 API)
  Core/                             Pure logic: duplicate matching, scoring, savings estimates, ffmpeg arguments
  Services/                         Library reader, holding area, GPU probe, conversion queue
  Api/                              Admin-only REST API (/ReelForge/*) + UI host (/reelforge/*)
  Web/                              Built UI, embedded into the DLL (generated by `npm run build`)
server/ReelForge.Tests/  43 tests, including real ffmpeg conversions
web/                                ReelForge UI (React + TypeScript + Vite)
packaging/windows/                  build.ps1, Inno Setup script, Windows service definition
brand/                              Logo, app icons, fonts and exports (see brand/README.md)
scripts/update-manifest.py          Adds a release to the update feed
.github/workflows/                  CI on every push; tagged releases
```

### Development
```bash
cd web && npm install && npm run dev                               # UI at http://localhost:5173/reelforge/?demo
VITE_SERVER=http://myserver:8096 npm run dev                       # against a real server
cd server && dotnet test ReelForge.Tests                # unit + integration tests
dotnet build ReelForge -c Release                       # module DLL
```

## What was verified

Verification ran against a real **Jellyfin 12.2** server with generated test media:
- The module loads, and the admin API rejects unauthenticated calls (401).
- Duplicates are found across folders for both movies and episodes. Editions are flagged.
- Remove-all and non-duplicate requests are refused.
- A real removal moved the file and its `.srt` to holding, and restore put both back.
- Two real conversions (MKV and MP4 sources) completed. Each was verified, swapped in, and re-read by Jellyfin as HEVC (373 MB → 86 MB).

NVENC itself couldn't be exercised because the build machine has no GPU. The NVENC arguments were checked against ffmpeg's encoder option list, and the CPU encoder path was run end-to-end.

## Roadmap
1. **Plex migration:** import watched status, ratings and collections from the Plex database.
2. **Remote access:** a step-by-step for NetBird, plus an optional `media.<domain>` reverse proxy with SSO for family members who won't install a VPN.
3. **Player polish:** audio/subtitle pickers, quality menu, skip intro, next-episode countdown.
4. **Space Saver extras:** shrink lossless audio (TrueHD/DTS-HD → EAC3), an auto-convert rule for new downloads, and a 30-second "before/after" preview clip.
5. **Make ReelForge the default page** at `http://<server>:8096/` and bundle the fonts for offline LANs.
