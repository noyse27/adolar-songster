#!/bin/sh
# Generates a small library of synthetic "songs" for the isolated demo
# deployment (see ../docker-compose.demo.yml). Real songs are never checked
# into this repository or downloaded here - a public demo has no licensed
# music source (no real Adolar instance to proxy through, see
# routes/adolar.ts), and bundling real audio would be a copyright problem
# anyway. This generates clearly-synthetic clips (a plain sine tone per
# song, so each one is at least audibly distinguishable) entirely with
# ffmpeg's built-in lavfi source - no audio files of any kind are shipped
# or downloaded.
#
# Runs once as a one-shot compose service (see the "demo-songs" service in
# docker-compose.demo.yml), writing into the shared demo_songs volume that
# the frontend's nginx then serves read-only at /demo-songs/ (see
# frontend/nginx.conf) - backend/src/services/demoReset.ts seeds song_ref
# rows (source='local') whose stream_ref points at that same path, so
# routes/songs.ts's existing 302-redirect-to-stream_ref path (used for any
# non-Adolar song) serves them with no code changes needed.
#
# The filename/title/year/frequency list here is kept in sync BY HAND with
# backend/src/services/demoSongLibrary.ts - every filename generated here
# must have a matching DEMO_SONGS entry there, and vice versa.
set -eu

OUT_DIR="${OUT_DIR:-/songs}"
DURATION="${DEMO_SONG_SECONDS:-25}"

mkdir -p "$OUT_DIR"

# filename|title|frequency-hz
# One entry per backend/src/services/demoSongLibrary.ts DEMO_SONGS entry,
# same order. Frequencies are spread out so consecutive demo songs are at
# least audibly different from one another.
SONGS='
fading-radio-waves.mp3|Fading Radio Waves|220
copper-sky-motel.mp3|Copper Sky Motel|233
velvet-highway.mp3|Velvet Highway|247
neon-rainfall.mp3|Neon Rainfall|262
static-and-satellites.mp3|Static & Satellites|277
paper-boats.mp3|Paper Boats|294
glasshouse-parade.mp3|Glasshouse Parade|311
dial-up-sunrise.mp3|Dial-Up Sunrise|330
concrete-orchard.mp3|Concrete Orchard|349
low-battery-blues.mp3|Low Battery Blues|370
tangerine-static.mp3|Tangerine Static|392
borrowed-umbrellas.mp3|Borrowed Umbrellas|415
nightbus-constellation.mp3|Nightbus Constellation|440
slow-motion-fireworks.mp3|Slow Motion Fireworks|466
afterglow-archive.mp3|Afterglow Archive|494
quiet-static-kingdom.mp3|Quiet Static Kingdom|523
'

echo "$SONGS" | while IFS='|' read -r filename title freq; do
  [ -z "$filename" ] && continue
  out_path="${OUT_DIR}/${filename}"

  if [ -f "$out_path" ]; then
    echo "generate-library: '$filename' already exists, skipping"
    continue
  fi

  echo "generate-library: rendering '$filename' ($title)"
  # -nostdin (and redirecting stdin from /dev/null): without this, ffmpeg
  # reads from the same stdin this `while read` loop is consuming line-by-
  # line, silently stealing a few bytes on each invocation and corrupting
  # every entry after the first (seen in bloeki's/Adolar's equivalent
  # generators: a title like "Nachtzug" turning into "chtzug").
  ffmpeg -y -nostdin -loglevel error \
    -f lavfi -i "sine=frequency=${freq}:duration=${DURATION}" \
    -metadata title="${title}" \
    -metadata artist="Songster Demo" \
    -codec:a libmp3lame -b:a 96k \
    "$out_path" < /dev/null
done

echo "generate-library: done, $(find "$OUT_DIR" -name '*.mp3' | wc -l) song(s) in $OUT_DIR"
