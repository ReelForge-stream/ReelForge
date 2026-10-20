<#
.SYNOPSIS
  Builds the ReelForge Windows installer: ReelForge-Setup-<version>.exe

.DESCRIPTION
  1. Builds the web UI (npm) straight into the server module
  2. Runs the tests and builds the module (dotnet)
  3. Downloads Jellyfin Server for Windows and the WinSW service wrapper
  4. Compiles the installer with Inno Setup

  Requirements: .NET 10 SDK, Node.js 20+, Inno Setup 6 (https://jrsoftware.org/isdl.php)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\packaging\windows\build.ps1
#>
param(
    [string]$Version = '0.1.0',
    [string]$JellyfinVersion = '12.2',
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster

$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$root  = Resolve-Path (Join-Path $here '..\..')
$stage = Join-Path $here 'stage'
$cache = Join-Path $here 'downloads'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Yellow }
function Need($cmd, $hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd not found. $hint" }
}

Step 'Checking tools'
Need dotnet 'Install the .NET 10 SDK: https://dotnet.microsoft.com/download/dotnet/10.0'
Need npm    'Install Node.js 20 or newer: https://nodejs.org'
$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 not found. Install it from https://jrsoftware.org/isdl.php (or: winget install JRSoftware.InnoSetup)' }

Step 'Building the web UI'
Push-Location (Join-Path $root 'web')
npm ci --no-audit --no-fund
npm run build
Pop-Location

Step 'Building the server module'
Push-Location (Join-Path $root 'server')
if (-not $SkipTests) {
    # Integration tests use jellyfin-ffmpeg when it's been downloaded already.
    $ff = Join-Path $stage 'server\ffmpeg.exe'
    if (Test-Path $ff) { $env:REELFORGE_FFMPEG = $ff; $env:REELFORGE_FFPROBE = Join-Path $stage 'server\ffprobe.exe' }
    dotnet test ReelForge.Tests -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
}
dotnet build ReelForge -c Release "-p:Version=$Version" "-p:AssemblyVersion=$Version.0" "-p:FileVersion=$Version.0"
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
Pop-Location

Step 'Downloading Jellyfin Server and WinSW'
New-Item -ItemType Directory -Force $cache | Out-Null
$jfZip = Join-Path $cache "jellyfin_$JellyfinVersion-amd64.zip"
if (-not (Test-Path $jfZip)) {
    Invoke-WebRequest "https://repo.jellyfin.org/files/server/windows/stable/v$JellyfinVersion/amd64/jellyfin_$JellyfinVersion-amd64.zip" -OutFile $jfZip -ErrorAction SilentlyContinue
    if (-not (Test-Path $jfZip)) {
        Invoke-WebRequest "https://repo.jellyfin.org/files/server/windows/latest-stable/amd64/jellyfin_$JellyfinVersion-amd64.zip" -OutFile $jfZip
    }
}
$winsw = Join-Path $cache 'WinSW-x64.exe'
if (-not (Test-Path $winsw)) {
    Invoke-WebRequest 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' -OutFile $winsw
}

Step 'Staging'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $stage 'module') | Out-Null
Expand-Archive $jfZip -DestinationPath $stage
Rename-Item (Join-Path $stage 'jellyfin') 'server'
if (-not (Test-Path (Join-Path $stage 'server\ffmpeg.exe'))) { throw 'This Jellyfin build has no ffmpeg.exe; check the download.' }
Copy-Item $winsw (Join-Path $stage 'ReelForgeService.exe')
& (Join-Path $here 'rebrand-web.ps1') -WebDir (Join-Path $stage 'server\jellyfin-web') -OverridesDir (Join-Path $root 'brand\web-overrides')
Copy-Item (Join-Path $root 'server\ReelForge\bin\Release\net10.0\ReelForge.dll') (Join-Path $stage 'module')

$meta = [ordered]@{
    category    = 'General'
    guid        = '6f1d0c52-8a3e-4c1b-9b7e-3d5a2e9f4c71'
    name        = 'ReelForge'
    description = 'New UI plus Media Manager: duplicate finder and GPU space saver.'
    overview    = 'ReelForge'
    owner       = 'ReelForge'
    targetAbi   = "$JellyfinVersion.0.0"
    version     = "$Version.0"
    timestamp   = (Get-Date).ToUniversalTime().ToString('o')
    changelog   = ''
    status      = 'Active'
    autoUpdate  = $false
    assemblies  = @('ReelForge.dll')
}
$meta | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $stage 'module\meta.json')

Step 'Compiling the installer'
Push-Location $here
& $iscc "/DAppVersion=$Version" "/DJellyfinVersion=$JellyfinVersion" 'ReelForge.iss'
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup failed' }
Pop-Location

$out = Join-Path $here "dist\ReelForge-Setup-$Version.exe"
Write-Host "`nDone: $out" -ForegroundColor Green
