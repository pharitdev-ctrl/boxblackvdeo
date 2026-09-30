#!/bin/sh
# Builds the ffmpeg and ffprobe that ship inside BOXBLACK (Resources/bin), so customers need no
# Homebrew for them and every machine runs the version the app was tested with.
#
# LGPL only (no --enable-gpl, no --enable-nonfree), no network, no outside libraries: every
# decoder, demuxer and filter FFmpeg has on its own stays in, so any file a customer can drop into
# CapCut still opens; encoders and muxers are cut to the ones BOXBLACK uses — mjpeg frames,
# flac/wav/raw audio, the null sink the signal filters write to (which needs wrapped_avframe), and
# the transparent ProRes .mov the graphics renderer (HyperFrames) writes, with a PNG poster of each.
# configure calls the raw s16le muxer pcm_s16le; `ffmpeg -muxers` lists it as s16le.
# The fd protocol is there because HyperFrames, rendering with one worker (its low-memory mode on
# 8 GB Macs), pipes frames into ffmpeg through a file descriptor.
#
# usage: apps/desktop/scripts/build-ffmpeg.sh <work dir> <out dir>
set -eu

VERSION=8.1.2
# the release tarball's checksum; its GPG signature (FFmpeg release key FCF986EA15E6E293A5644F10B4322F04D67658D8) was checked 2026-09-23
SHA256=464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c
MACOS_MIN=12.0

WORK=$(cd "$1" && pwd)
mkdir -p "$2"
OUT=$(cd "$2" && pwd)

cd "$WORK"
[ -f "ffmpeg-$VERSION.tar.xz" ] || curl -sSfLO "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
echo "$SHA256  ffmpeg-$VERSION.tar.xz" | shasum -a 256 -c -
rm -rf "ffmpeg-$VERSION" install
tar xf "ffmpeg-$VERSION.tar.xz"
cd "ffmpeg-$VERSION"

./configure \
  --prefix="$WORK/install" \
  --arch=arm64 --cc=clang \
  --extra-cflags="-mmacosx-version-min=$MACOS_MIN" --extra-ldflags="-mmacosx-version-min=$MACOS_MIN" \
  --disable-autodetect --enable-zlib --enable-bzlib \
  --disable-doc --disable-ffplay --disable-network --disable-devices --disable-debug \
  --disable-encoders --enable-encoder=mjpeg,flac,pcm_s16le,wrapped_avframe,prores_ks,png \
  --disable-muxers --enable-muxer=image2,wav,flac,pcm_s16le,null,mov \
  --disable-protocols --enable-protocol=file,pipe,fd

make -j"$(sysctl -n hw.ncpu)"
make install

cp "$WORK/install/bin/ffmpeg" "$WORK/install/bin/ffprobe" "$OUT/"
cp COPYING.LGPLv2.1 "$OUT/FFMPEG-COPYING.LGPLv2.1"
# the LGPL asks that whoever gets the binaries can get the source they came from and how they were built
{
  echo "BOXBLACK ships ffmpeg and ffprobe $VERSION from the FFmpeg project (https://ffmpeg.org),"
  echo "licensed under the GNU Lesser General Public License version 2.1 or later: see FFMPEG-COPYING.LGPLv2.1."
  echo "They are built, unmodified, from https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
  echo "(SHA-256 $SHA256) with this configuration:"
  echo
  "$OUT/ffmpeg" -hide_banner -buildconf
} > "$OUT/FFMPEG-NOTICE.txt"
"$OUT/ffmpeg" -hide_banner -version | head -1
