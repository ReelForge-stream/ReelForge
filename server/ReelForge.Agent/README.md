# ReelForge Agent

Lets other Windows PCs on your network convert Space Saver files on their graphics cards, so a big queue finishes sooner.

## How it works

- The agent is a Windows service (`ReelForgeAgent`). It only makes outgoing connections to your ReelForge server; nothing listens on the PC.
- Every few seconds it checks in. When there's a file in the Conversions queue that its card can handle, the server hands it over:
  1. The agent streams the original from the server (it never needs access to your NAS).
  2. It converts on NVIDIA NVENC or AMD AMF into `C:\ProgramData\ReelForge Agent\work`.
  3. It uploads the result back.
- The server checks the result exactly like its own conversions: same length, same audio and subtitle tracks, and actually smaller. Only then does it swap the file in; the original goes to Removed files as usual.
- **Cancelling** a file in Media Manager stops the agent within seconds.
- **If a PC goes off or loses the network,** its file goes back in the queue after 2 minutes for another PC (or the server). After three failed attempts a file is marked failed.
- **What each PC can do:** each agent test-encodes on its card at start-up (and every 6 hours). It only takes files it can actually do; for example, 10-bit HDR files only go to cards that passed a 10-bit test.
- **Updates:** the agent updates itself to match the server's version when idle, from this repo's GitHub releases.

## Install

In ReelForge go to **Media Manager → Agents → Add a PC**, then copy the install script and run it:

- **From Apex RMM:** run it as SYSTEM.
- **On the PC itself:** run it in an Administrator PowerShell.

The script:
1. downloads `ReelForge-Agent.exe` from this repo's releases;
2. copies the server's own `ffmpeg.exe` (so every PC uses the same build);
3. pairs with the server using the pairing key;
4. installs and starts the service.

Running the script again updates the agent. The uninstall script is on the same page.

Requirements:
- Windows 10/11 64-bit.
- An NVIDIA GTX 10-series or newer, or an AMD Radeon RX 5000 or newer, with a current driver.
- Free disk space for the largest converted file.

## Command line

```
ReelForge.Agent.exe pair --server http://192.168.1.10:8096 --key XXXX-XXXX-XXXX [--name NAME]
ReelForge.Agent.exe probe          # which encoders work on this PC
ReelForge.Agent.exe run [--cpu]    # what the service runs; --cpu also allows processor encoding
```

The log is `C:\ProgramData\ReelForge Agent\agent.log`.
