# ReelForge for Roku

The ReelForge app for Roku TVs and streaming sticks. It's built on the open-source
[Jellyfin app for Roku](https://github.com/jellyfin/jellyfin-roku) (GPL-2.0, see `LICENSE`), with the
ReelForge look and these additions:

- **The ReelForge look**, like the web app: a top menu (Home, Movies, TV Shows, My List, Search, Settings), a big
  billboard on Home with **Play** and **More Info**, wide picture cards with the title on them, ReelForge fonts and
  colors, and restyled movie, show and library pages. The player, settings and music screens are unchanged.
- **Billboard** at the top of Home. It rotates through new and unwatched movies and shows every 9 seconds. When you
  move down to the rows, it shows whatever you're on. You can turn it off in Settings › User Interface › Home Rows.
- **IMDb and Rotten Tomatoes scores** on movie and show pages, from the ReelForge server (IMDb scores need the OMDb key
  in the ReelForge web app under Settings › General).
- **Sign in with a QR code.** The sign-in screen shows a QR code. Scan it with your phone's camera, tap
  **Sign in**, and the TV signs in, with no typing on the remote. Admins can pick which profile the TV signs in as
  (handy for a kids' TV). You can also open `<server>/reelforge/link` on any phone or computer and type the
  6-digit code, or use **Sign in a TV** in the profile menu.
- **"Are you still watching?"** after 2 episodes in a row play on their own with no button pressed.
  You can change the number, or set it to 0 to turn this off, in Settings › Playback.

Everything else (sign-in, profiles, libraries, search, cast pages, subtitles, audio tracks, Live TV, music)
works the same as in the Jellyfin app, since ReelForge runs on Jellyfin.

## Install it on your Roku (one TV at a time)

Roku only allows apps from its store, plus **one** app you install yourself in developer mode on each Roku.
It stays installed, also after restarts, until you replace it with another one.

1. **Download the app.** From the latest [ReelForge release](https://github.com/ReelForge-stream/ReelForge/releases),
   save `ReelForge-Roku-<version>.zip` on a computer on the same network as the TV. Don't unzip it.
2. **Turn on developer mode on the Roku.** With the Roku remote, press
   **Home ×3, Up ×2, Right, Left, Right, Left, Right**.
   - A Developer Settings screen appears. Note the address it shows (e.g. `http://192.168.1.57`).
   - Choose **Enable installer and restart**, accept the agreement, and set a password.
   - The username is always `rokudev`.
3. **Install the app.** On the computer, open the address from step 2 in a browser and sign in with `rokudev`
   and your password. Click **Upload**, pick the .zip, then **Install with zip**.
   ReelForge opens on the TV, and from now on it's in your list of apps.
4. **Sign in.** The app finds your ReelForge server on your network automatically. You can also type its address,
   e.g. `192.168.1.10:8096` or `https://home.reelforge.stream`. Then scan the QR code with your phone and tap
   **Sign in**, or use your password on the right.
   - The QR link uses the address the TV connected with. If that's a home address (192.168…), your phone needs
     to be on the home Wi-Fi.
   - Codes renew by themselves every 9 minutes, or press **New QR code**.

**Updating by itself (recommended):** in the ReelForge web app, open **Media Manager › TVs**. Each TV shows up there
after ReelForge opens on it once. Click **Turn on automatic updates** and enter that TV's developer password (the one
from step 2). From then on, whenever your server gets a new ReelForge version, the server installs the matching app
on the TV the next time the app opens there (the app closes and reopens by itself), or right away with **Update now**.
- The server and the TV need to be on the same home network.
- The password is checked against the TV, stored encrypted on the server, and only sent to that same Roku (the
  server checks its serial number first).
- If you turn developer mode off and on again, the password changes: save the new one.

**Updating by hand:** repeat step 3 with the newer .zip (it replaces the old one).

**Several TVs:** repeat for each Roku. Each one needs developer mode turned on once.

## If something goes wrong

- **The installer page doesn't load:** check that the computer and the Roku are on the same network, and use
  `http://` (not https) with the exact address the Roku showed.
- **"Install failed":** make sure you uploaded the .zip from the release as-is, not an unzipped folder.
- **A crash or a frozen screen:** the Roku keeps a debug log. Open a terminal on the computer and run
  `telnet <roku-address> 8085`, reproduce the problem, then copy what appears in the terminal into a bug report.

## Building it yourself

```
cd tv/roku
npm ci
npm run build          # → out/roku.zip
scripts/check-branding.sh
python3 scripts/set-version.py 1.2.3   # what releases do before building
```

Every ReelForge release builds and attaches the .zip automatically (`.github/workflows/release.yml`, job `roku`).

## Credits

Based on [jellyfin-roku](https://github.com/jellyfin/jellyfin-roku) by the Jellyfin project and its contributors,
used under the GNU General Public License v2. The ReelForge changes are under the same license.
