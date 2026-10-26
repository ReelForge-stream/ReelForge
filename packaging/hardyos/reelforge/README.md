# ReelForge

Your own streaming service for movies and TV.

- **Watch anywhere:** browsers, phones, Google TV and Roku. When a device can't play a file as-is,
  ReelForge converts it on the fly, on the graphics card if the server has one.
- **Space Saver** re-encodes files to take up far less room, keeping every audio track, subtitle and chapter.
  Each result is checked before it replaces the original.
- **Duplicates** finds extra copies across folders and keeps the best one.
- **Nothing is deleted on the spot.** Replaced and removed files wait in a holding folder for 14 days.

## After installing

1. Open ReelForge and create your admin account.
2. Add your libraries. Your media folder appears as `/media` (and `/media2` if you picked a second folder).
3. Get the TV apps from https://github.com/ReelForge-stream/ReelForge/releases.

## Graphics card

HardyOS picks the server's NVIDIA, Intel or AMD graphics automatically. ReelForge then uses it for streaming
conversions from the first start. With NVIDIA, HardyOS also installs NVIDIA's container support.
