// The PowerShell that installs (or updates) a ReelForge Agent on a Windows PC. Run it from Apex RMM
// (which runs scripts as SYSTEM) or in an administrator PowerShell window. Safe to run again.

export const REPO = 'ReelForge-stream/ReelForge';

/** Single quotes are the only thing that can break out of a PowerShell '...' string. */
const ps = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function installScript(server: string, key: string, version: string): string {
  const base = server.trim().replace(/\/+$/, '');
  return `# ReelForge Agent: converts files for your ReelForge server on this PC's graphics card.
# Run as SYSTEM (Apex RMM) or as Administrator. Running it again updates the agent.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Server  = ${ps(base)}
$Key     = ${ps(key)}
$Version = ${ps(version)}
$Dir     = Join-Path $env:ProgramFiles 'ReelForge Agent'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

# Stop the old one if this is an update.
$svc = Get-Service ReelForgeAgent -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Stopped') { Stop-Service ReelForgeAgent -Force; Start-Sleep -Seconds 2 }

# 1. The agent (the release matching your server, or the newest one).
$urls = @("https://github.com/${REPO}/releases/download/v$Version/ReelForge-Agent.exe",
          'https://github.com/${REPO}/releases/latest/download/ReelForge-Agent.exe')
$got = $false
foreach ($u in $urls) {
  try { Invoke-WebRequest -Uri $u -OutFile (Join-Path $Dir 'ReelForge.Agent.exe') -UseBasicParsing; $got = $true; break } catch { }
}
if (-not $got) { throw 'Could not download ReelForge-Agent.exe from GitHub.' }

# 2. ffmpeg: the same build your server uses, straight from the server.
$zip = Join-Path $env:TEMP 'reelforge-ffmpeg.zip'
Invoke-WebRequest -Uri "$Server/ReelForge/AgentApi/Ffmpeg?key=$Key" -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath (Join-Path $Dir 'ffmpeg') -Force
Remove-Item $zip -Force

# 3. Pair with the server.
& (Join-Path $Dir 'ReelForge.Agent.exe') pair --server $Server --key $Key
if ($LASTEXITCODE -ne 0) { throw "Pairing with $Server failed." }

# 4. Run as a Windows service that starts with the PC and restarts if it stops.
if (-not $svc) {
  New-Service -Name ReelForgeAgent -DisplayName 'ReelForge Agent' -StartupType Automatic \`
    -Description 'Converts files for a ReelForge server on this PC''s graphics card.' \`
    -BinaryPathName ('"' + (Join-Path $Dir 'ReelForge.Agent.exe') + '" run') | Out-Null
  sc.exe failure ReelForgeAgent reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null
}
Start-Service ReelForgeAgent
Write-Output "ReelForge Agent is running on $env:COMPUTERNAME and paired with $Server."
`;
}

export function uninstallScript(): string {
  return `# Removes the ReelForge Agent from this PC (also remove it in Media Manager → Agents).
$svc = Get-Service ReelForgeAgent -ErrorAction SilentlyContinue
if ($svc) { Stop-Service ReelForgeAgent -Force -ErrorAction SilentlyContinue; sc.exe delete ReelForgeAgent | Out-Null }
Remove-Item -Recurse -Force (Join-Path $env:ProgramFiles 'ReelForge Agent') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $env:ProgramData 'ReelForge Agent') -ErrorAction SilentlyContinue
Write-Output "ReelForge Agent removed from $env:COMPUTERNAME."
`;
}

/** Friendly names for encoder ids. */
export function encoderLabel(e: string): string {
  return (
    {
      hevc_nvenc: 'NVIDIA HEVC',
      av1_nvenc: 'NVIDIA AV1',
      hevc_amf: 'AMD HEVC',
      av1_amf: 'AMD AV1',
      libx265: 'Processor HEVC',
      libsvtav1: 'Processor AV1',
    } as Record<string, string>
  )[e] ?? e;
}

/** An address the other PCs can reach: "localhost" on the server is no good to them. */
export function looksLocalOnly(server: string): boolean {
  return /^https?:\/\/(localhost|127\.|\[::1\])/i.test(server.trim());
}
