#!/usr/bin/env bash
# Fails if "Jellyfin" shows up anywhere a viewer would read it: settings text, English translations,
# the manifest, or quoted strings in the app code (registry names and server checks are allowed).
set -euo pipefail
cd "$(dirname "$0")/.."
bad=0
if grep -n "Jellyfin" settings/settings.json locale/en_US/translations.ts manifest; then bad=1; fi
if grep -rnE '"[^"]*Jellyfin[^"]*"|`[^`]*Jellyfin[^`]*`' source components --include=*.bs --include=*.xml \
  | grep -vE ":[0-9]+:\s*'" | grep -vE '"Jellyfin"\)|"Who is JellyfinServer\?"|registry_|RegistryReadAll\("Jellyfin"\)'; then bad=1; fi
if [ "$bad" = 1 ]; then echo "::error::Jellyfin branding found in the Roku app (see above)"; exit 1; fi
echo "Branding check passed"
