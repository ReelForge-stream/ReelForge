#!/bin/sh
# Starts ReelForge: puts the bundled module in Jellyfin's plugin folder (unless the same or a newer
# version is already there, e.g. from ReelForge's own updates), presets GPU streaming on first start,
# then runs Jellyfin.
set -eu

data="${JELLYFIN_DATA_DIR:-/config}"
plugins="$data/plugins"
bundled="${RF_VERSION:-0.0.0}.0"
mkdir -p "$plugins"

newest=""
for dir in "$plugins"/ReelForge_*; do
  [ -d "$dir" ] || continue
  v="${dir##*/ReelForge_}"
  if [ -z "$newest" ] || [ "$(printf '%s\n%s\n' "$newest" "$v" | sort -V | tail -n 1)" = "$v" ]; then
    newest="$v"
  fi
done

if [ -z "$newest" ] || [ "$(printf '%s\n%s\n' "$newest" "$bundled" | sort -V | tail -n 1)" != "$newest" ]; then
  echo "ReelForge: installing module $bundled"
  mkdir -p "$plugins/ReelForge_$bundled"
  cp /usr/share/reelforge/plugin/ReelForge.dll /usr/share/reelforge/plugin/meta.json "$plugins/ReelForge_$bundled/"
else
  echo "ReelForge: module $newest already installed (bundled: $bundled)"
fi

# First start only: point Jellyfin's streaming conversions at the graphics card the installer passed in.
# Jellyfin fills in every setting not listed here with its defaults; later changes in the UI are kept.
# Decoding is limited to formats every supported card handles; newer ones (VP9, AV1) can be ticked in Playback settings.
config_dir="${JELLYFIN_CONFIG_DIR:-$data/config}"
encoding="$config_dir/encoding.xml"
gpu="${RF_GPU:-none}"
if [ ! -f "$encoding" ] && [ "$gpu" != "none" ]; then
  mkdir -p "$config_dir"
  case "$gpu" in
    nvidia)
      accel="nvenc"; device="" ;;
    intel)
      accel="qsv"; device="<QsvDevice>${RF_RENDER_DEVICE:-/dev/dri/renderD128}</QsvDevice>" ;;
    amd)
      accel="vaapi"; device="<VaapiDevice>${RF_RENDER_DEVICE:-/dev/dri/renderD128}</VaapiDevice>" ;;
    *)
      accel="" ;;
  esac
  if [ -n "$accel" ]; then
    echo "ReelForge: first start, using the $gpu graphics card for streaming ($accel)"
    cat > "$encoding" <<XML
<?xml version="1.0" encoding="utf-8"?>
<EncodingOptions xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <HardwareAccelerationType>$accel</HardwareAccelerationType>
  $device
  <EnableHardwareEncoding>true</EnableHardwareEncoding>
  <HardwareDecodingCodecs>
    <string>h264</string>
    <string>hevc</string>
    <string>mpeg2video</string>
    <string>vc1</string>
  </HardwareDecodingCodecs>
</EncodingOptions>
XML
  fi
fi

exec /jellyfin/jellyfin "$@"
