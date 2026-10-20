<#
.SYNOPSIS
  Puts ReelForge's logo and name on the classic admin dashboard (the jellyfin-web folder).

.DESCRIPTION
  Replaces the banner logos, icons, favicons, page title and web-app manifest with the files in
  brand/web-overrides. Image file names carry a content hash that changes between versions, so
  files are matched by name prefix ("banner-light.*.png"). Nothing else in the web app changes.
  Jellyfin is GPL-2.0; its license and source notices are left in place.
#>
param(
    [Parameter(Mandatory)] [string]$WebDir,
    [Parameter(Mandatory)] [string]$OverridesDir
)

$ErrorActionPreference = 'Stop'
$replaced = 0

function Replace-Hashed([string]$stem, [string]$ext, [string]$source) {
    $hits = Get-ChildItem -LiteralPath $WebDir -File | Where-Object { $_.Name -like "$stem.*.$ext" -or $_.Name -eq "$stem.$ext" }
    foreach ($h in $hits) { Copy-Item -LiteralPath $source -Destination $h.FullName -Force; $script:replaced++ }
    return $hits.Count
}

foreach ($name in 'banner-light', 'banner-dark', 'icon-transparent', 'notificationicon', 'touchicon', 'touchicon144') {
    $src = Join-Path $OverridesDir "$name.png"
    if ((Replace-Hashed $name 'png' $src) -eq 0) { Write-Warning "No $name image found in $WebDir" }
}
Replace-Hashed 'favicon' 'ico' (Join-Path $OverridesDir 'favicon.ico') | Out-Null

$fav = Join-Path $WebDir 'favicons'
if (Test-Path $fav) {
    foreach ($f in Get-ChildItem -LiteralPath $fav -Filter 'touchicon*.png') {
        $src = Join-Path $OverridesDir $f.Name
        if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination $f.FullName -Force; $replaced++ }
    }
}

$index = Join-Path $WebDir 'index.html'
$html = [IO.File]::ReadAllText($index)
$html = $html -replace '<title>Jellyfin</title>', '<title>ReelForge</title>'
$html = $html -replace '(<meta name="application-name" content=")Jellyfin(")', '${1}ReelForge${2}'
$html = $html -replace '(<meta name="apple-mobile-web-app-title" content=")Jellyfin(")', '${1}ReelForge${2}'
[IO.File]::WriteAllText($index, $html)

$manifest = Join-Path $WebDir 'manifest.json'
if (Test-Path $manifest) {
    $m = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
    $m.name = 'ReelForge'
    $m.short_name = 'ReelForge'
    $m.description = 'ReelForge server settings'
    $m.theme_color = '#17202A'
    $m.background_color = '#17202A'
    $m | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath $manifest
}

Write-Host "Rebranded the admin dashboard: $replaced images replaced, title and manifest updated."

# --- The engine's startup page ("... started successfully. Redirecting in 5") ------------------
# It lives next to the server (ServerSetupApp\index.mstemplate.html), not in jellyfin-web.
# Only visible text, the logo and colours change; {{template}} placeholders are untouched.
$setupPage = Join-Path (Split-Path -Parent $WebDir) 'ServerSetupApp\index.mstemplate.html'
if (Test-Path -LiteralPath $setupPage) {
    $page = [IO.File]::ReadAllText($setupPage)
    $logo = [IO.File]::ReadAllText((Join-Path (Split-Path -Parent $OverridesDir) 'logo-horizontal.svg'))
    $logo = $logo -replace '^<svg ', '<svg class="logo" role="img" aria-label="ReelForge" '
    $before = $page
    $page = [regex]::Replace($page, '<svg class="logo"[\s\S]*?</svg>', [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $logo }, 1)
    $page = $page -replace '(?s)(<title>.*?)Jellyfin(\s*</title>)', '${1}ReelForge${2}'
    $page = $page.Replace('Jellyfin is still starting.', 'ReelForge is still starting.')
    $page = $page.Replace('Jellyfin has encountered an error and was not able to start.', 'ReelForge ran into an error and couldn''t start.')
    $page = $page.Replace("'Jellyfin started successfully.'", "'ReelForge started successfully.'")
    $page = $page.Replace("'Continue to Jellyfin'", "'Continue to ReelForge'")
    $page = $page.Replace('--jf-background: #101010;', '--jf-background: #17202A;')
    $page = $page.Replace('--jf-paper: #202020;', '--jf-paper: #212C38;')
    $page = $page.Replace('--jf-primary: #00a4dc;', '--jf-primary: #FF8A1F;')
    $page = $page.Replace('--jf-primary-dark: #00729a;', '--jf-primary-dark: #E06F0A;')
    if ($page -eq $before) { Write-Warning 'Startup page layout changed; nothing rebranded there.' }
    [IO.File]::WriteAllText($setupPage, $page)
    Write-Host 'Rebranded the startup page.'
} else {
    Write-Warning "No startup page found at $setupPage"
}
