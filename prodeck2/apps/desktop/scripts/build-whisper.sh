#!/bin/sh
# Builds the whisper-cli that ships inside BOXBLACK (Resources/bin), so transcribing on the Mac
# needs nothing installed: whisper.cpp 1.9.2 with the ggml of that release built in, Metal on,
# the same build as the boxblack-whisper formula in homebrew-tap/ (its output was checked word for
# word against Homebrew's whisper-cpp 1.9.2). MIT licensed; its licence ships beside it.
#
# Needs cmake on the build machine (brew install cmake). The customer's Mac needs nothing.
#
# usage: apps/desktop/scripts/build-whisper.sh <work dir> <out dir>
set -eu

VERSION=1.9.2
# the release tarball's checksum, the same one Homebrew recorded for whisper-cpp 1.9.2
SHA256=a6abd064fcca8b85e794d205abf328c522e9451db43a3eadc178b883b7d0e9cd
MACOS_MIN=12.0

WORK=$(cd "$1" && pwd)
mkdir -p "$2"
OUT=$(cd "$2" && pwd)

cd "$WORK"
[ -f "whisper.cpp-$VERSION.tar.gz" ] || curl -sSfL -o "whisper.cpp-$VERSION.tar.gz" "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v$VERSION.tar.gz"
echo "$SHA256  whisper.cpp-$VERSION.tar.gz" | shasum -a 256 -c -
rm -rf "whisper.cpp-$VERSION"
tar xzf "whisper.cpp-$VERSION.tar.gz"
cd "whisper.cpp-$VERSION"

cmake -S . -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN" \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_USE_SYSTEM_GGML=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
  -DWHISPER_SDL=OFF -DWHISPER_CURL=OFF -DWHISPER_COMMON_FFMPEG=OFF \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_NATIVE=OFF
cmake --build build --target whisper-cli -j"$(sysctl -n hw.ncpu)"

cp build/bin/whisper-cli "$OUT/whisper-cli"
cp LICENSE "$OUT/WHISPER-LICENSE"
{
  echo "BOXBLACK ships whisper-cli from whisper.cpp $VERSION (https://github.com/ggml-org/whisper.cpp),"
  echo "with the ggml library of that release built in. Both are MIT licensed: see WHISPER-LICENSE."
  echo "Built, unmodified, from https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v$VERSION.tar.gz"
  echo "(SHA-256 $SHA256)."
} > "$OUT/WHISPER-NOTICE.txt"
"$OUT/whisper-cli" --help 2>&1 | grep -q -- "--dtw" && echo "whisper-cli $VERSION built"
