# ReelForge for Google TV / Android TV

A native TV app for your ReelForge server: Chromecast with Google TV, Google TV Streamer,
NVIDIA Shield, Sony/TCL/Hisense Google TV sets and any other Android TV device (Android 8+).

- Finds ReelForge servers on your network by itself, or type the address (e.g. `192.168.1.20:8096`).
- Who's watching profiles, Home rows, Movies / TV with A–Z jump, typo-tolerant search, My List.
- Plays most files directly; anything the TV can't decode is converted by the server automatically.
- Subtitles, audio tracks and picture quality from the player and Settings.
- Updates itself: Settings → Check for updates installs the newest release from GitHub.

## Install (sideload)

The app isn't in the Play Store. You install it once; after that it updates itself.

**1. Allow app installs on the TV**

1. Settings → System → About → scroll to **Android TV OS build** and press OK on it 7 times
   ("You are now a developer").
2. Install **Downloader** (by AFTVnews) from the Play Store.
3. Settings → Apps → Security & restrictions → **Unknown sources** → turn on **Downloader**.

**2. Download and install ReelForge**

1. Open Downloader and enter the address of the APK from the latest release:
   `https://github.com/ReelForge-stream/ReelForge/releases/latest`
   then pick **ReelForge-AndroidTV-x.y.z.apk**.
2. Choose **Install**, then **Open**. You can delete the APK file afterwards when Downloader asks.
3. ReelForge appears in your apps row. Long-press it → Move to put it up front.

**Alternative: adb from a computer**

```
adb connect <tv-ip>:5555            # Settings → System → Developer options → USB/Network debugging on
adb install -r ReelForge-AndroidTV-x.y.z.apk
```

**Updates:** the first time you use Settings → Check for updates, Android asks you to allow
ReelForge to install apps. Allow it once; from then on updates install with one click.

## Build

```
export ANDROID_HOME=/path/to/android-sdk     # platforms;android-35, build-tools;35.0.0
./gradlew testDebugUnitTest assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
```

Screen tests against a real server (writes screenshots):

```
RF_TEST_SERVER=http://localhost:8096 RF_TEST_USER=me RF_TEST_PASSWORD=... RF_SHOTS=/tmp/shots \
  ./gradlew testDebugUnitTest -Proborazzi.test.record=true
```

## Signing (releases)

Every release must be signed with the **same key**, or Android refuses to update the installed app.
The Release workflow reads the key from these repository secrets
(GitHub → Settings → Secrets and variables → Actions → New repository secret):

| Secret | Value |
| --- | --- |
| `RF_ANDROID_KEYSTORE_B64` | the keystore file, base64-encoded (`base64 -w0 reelforge.keystore`) |
| `RF_ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `RF_ANDROID_KEY_PASSWORD` | key password (same as above) |
| `RF_ANDROID_KEY_ALIAS` | `reelforge` |

Never commit the keystore (the repo is public). Keep a backup somewhere safe: if it's lost,
everyone has to uninstall and reinstall the app once.
