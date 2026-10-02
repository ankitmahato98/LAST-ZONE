#!/usr/bin/env bash
#
# Regenerates the Android launcher icons and splash screens for LAST ZONE.
#
# The game ships no binary art, so the icon is drawn procedurally here instead of
# being dropped in as an opaque PNG: the "zone" ring and crosshair match the
# in-game brand mark (see public/favicon.svg and src/styles/main.css).
#
# Requires ImageMagick 6 (`convert`). Run from anywhere:
#
#   tools/generate-android-icons.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RES="$REPO_ROOT/android/app/src/main/res"

BG_DEEP="#070B0E"
BG_SURFACE="#0A1218"
ACCENT="#4EF0C8"
ACCENT_DIM="#2C8C79"

command -v convert >/dev/null 2>&1 || {
  echo "error: ImageMagick (convert) is required to generate the icons" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# draw_icon <size> <mode>
#   mode = "full"         opaque tile (legacy launcher icon)
#          "round"        opaque circle (legacy round icon)
#          "foreground"   transparent, art inside the adaptive-icon safe zone
# ---------------------------------------------------------------------------
draw_icon() {
  local size="$1"
  local mode="$2"
  local out="$3"
  local cx=$((size / 2))
  local cy=$((size / 2))

  # Adaptive icons crop to the inner 72/108 of the canvas, so the art is scaled
  # down inside a foreground layer and sits at full size on a legacy tile.
  local scale
  case "$mode" in
    foreground) scale=$((size * 62 / 100)) ;;
    *) scale=$((size * 86 / 100)) ;;
  esac

  local r_outer=$((scale / 2))
  local r_inner=$((scale * 27 / 100))
  local dot=$((size * 5 / 100))
  if [ "$dot" -lt 2 ]; then dot=2; fi
  local ring_width=$((size * 7 / 100))
  if [ "$ring_width" -lt 2 ]; then ring_width=2; fi
  local tick_len=$((scale * 20 / 100))

  local tmp_bg tmp_fg
  tmp_bg="$(mktemp /tmp/lz-icon-bg-XXXXXX.png)"
  tmp_fg="$(mktemp /tmp/lz-icon-fg-XXXXXX.png)"

  # Background layer: deep surface colour with an off-centre teal glow.
  convert -size "${size}x${size}" radial-gradient:"$BG_SURFACE"-"$BG_DEEP" "$tmp_bg"

  if [ "$mode" = "round" ]; then
    # Legacy round icon: mask the tile into a circle.
    convert "$tmp_bg" \
      \( -size "${size}x${size}" xc:none -fill white \
         -draw "circle $cx,$cy $cx,0" \) \
      -alpha set -compose DstIn -composite "$tmp_fg"
    mv "$tmp_fg" "$tmp_bg"
  fi

  # Foreground layer: zone ring with three gaps, inner ring, core dot, crosshair.
  convert -size "${size}x${size}" xc:none \
    -stroke "$ACCENT" -strokewidth "$ring_width" -fill none \
    -draw "stroke-dasharray $((scale * 62 / 100)) $((scale * 20 / 100)) circle $cx,$cy $cx,$((cy - r_outer))" \
    -stroke "$ACCENT_DIM" -strokewidth "$((ring_width / 2 > 0 ? ring_width / 2 : 1))" \
    -draw "circle $cx,$cy $cx,$((cy - r_inner))" \
    -stroke "$ACCENT" -strokewidth "$((ring_width / 2 > 0 ? ring_width / 2 : 1))" \
    -draw "line $((cx - r_outer + ring_width)),$cy $((cx - r_outer + ring_width + tick_len)),$cy" \
    -draw "line $((cx + r_outer - ring_width)),$cy $((cx + r_outer - ring_width - tick_len)),$cy" \
    -draw "line $cx,$((cy - r_outer + ring_width)) $cx,$((cy - r_outer + ring_width + tick_len))" \
    -draw "line $cx,$((cy + r_outer - ring_width)) $cx,$((cy + r_outer - ring_width - tick_len))" \
    -stroke none -fill "$ACCENT" \
    -draw "circle $cx,$cy $cx,$((cy - dot))" \
    "$tmp_fg"

  if [ "$mode" = "foreground" ]; then
    # -depth 8 keeps the PNGs small and avoids any 16-bit decoder edge cases.
    convert "$tmp_fg" -depth 8 "$out"
    rm -f "$tmp_fg"
  else
    convert "$tmp_bg" "$tmp_fg" -compose over -composite -depth 8 "$out"
    rm -f "$tmp_fg"
  fi
  rm -f "$tmp_bg"
}

# ---------------------------------------------------------------------------
# draw_splash <width> <height>
# ---------------------------------------------------------------------------
draw_splash() {
  local w="$1"
  local h="$2"
  local out="$3"
  local short=$((w < h ? w : h))
  local badge=$((short * 34 / 100))
  local tmp badge_png
  tmp="$(mktemp /tmp/lz-splash-XXXXXX.png)"
  badge_png="$(mktemp /tmp/lz-badge-XXXXXX.png)"

  draw_icon "$badge" foreground "$badge_png"

  # Dark background with a soft centre glow and the brand mark in the middle.
  convert -size "${w}x${h}" radial-gradient:"$BG_SURFACE"-"$BG_DEEP" "$tmp"
  convert "$tmp" "$badge_png" -gravity center -compose over -composite -depth 8 "$out"
  rm -f "$tmp" "$badge_png"
}

# ---------------------------------------------------------------------------
# Launcher icons
# ---------------------------------------------------------------------------
write_density() {
  local dir="$1"
  local legacy_size="$2"
  local adaptive_size="$3"
  local out_dir="$RES/$dir"
  mkdir -p "$out_dir"
  draw_icon "$legacy_size" full "$out_dir/ic_launcher.png"
  draw_icon "$legacy_size" round "$out_dir/ic_launcher_round.png"
  draw_icon "$adaptive_size" foreground "$out_dir/ic_launcher_foreground.png"
}

write_density mipmap-mdpi 48 108
write_density mipmap-hdpi 72 162
write_density mipmap-xhdpi 96 216
write_density mipmap-xxhdpi 144 324
write_density mipmap-xxxhdpi 192 432

# ---------------------------------------------------------------------------
# Splash screens (regenerated at the sizes Capacitor's template ships)
# ---------------------------------------------------------------------------
# Landscape: 480x320 mdpi, 800x480 hdpi, 1280x720 xhdpi, 1600x960 xxhdpi, 1920x1280 xxxhdpi
draw_splash 480 320 "$RES/drawable-land-mdpi/splash.png"
draw_splash 800 480 "$RES/drawable-land-hdpi/splash.png"
draw_splash 1280 720 "$RES/drawable-land-xhdpi/splash.png"
draw_splash 1600 960 "$RES/drawable-land-xxhdpi/splash.png"
draw_splash 1920 1280 "$RES/drawable-land-xxxhdpi/splash.png"

# Portrait: 320x480 mdpi, 480x800 hdpi, 720x1280 xhdpi, 960x1600 xxhdpi, 1280x1920 xxxhdpi
draw_splash 320 480 "$RES/drawable-port-mdpi/splash.png"
draw_splash 480 800 "$RES/drawable-port-hdpi/splash.png"
draw_splash 720 1280 "$RES/drawable-port-xhdpi/splash.png"
draw_splash 960 1600 "$RES/drawable-port-xxhdpi/splash.png"
draw_splash 1280 1920 "$RES/drawable-port-xxxhdpi/splash.png"

# Default drawable (used when no density-specific asset matches).
draw_splash 480 320 "$RES/drawable/splash.png"

echo "LAST ZONE android icons and splash screens regenerated in $RES"
