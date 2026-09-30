# whisper-cli exactly as BOXBLACK was tested with it: whisper.cpp 1.9.2 with the ggml that ships
# inside that release, built in. Homebrew's own whisper-cpp follows the newest release and links a
# separate ggml formula that updates on its own, so the same command gives different engines on
# different days; this formula never changes unless BOXBLACK moves to a newer, tested version.
#
# Keg-only, so it sits beside Homebrew's whisper-cpp without a clash. BOXBLACK looks for it in
# $(brew --prefix)/opt/boxblack-whisper/bin before anything on PATH.
class BoxblackWhisper < Formula
  desc "Speech-to-text engine for BOXBLACK: whisper.cpp 1.9.2 with its own ggml"
  homepage "https://github.com/ggml-org/whisper.cpp"
  url "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.2.tar.gz"
  sha256 "a6abd064fcca8b85e794d205abf328c522e9451db43a3eadc178b883b7d0e9cd"
  license "MIT"

  keg_only "BOXBLACK finds it in its own prefix, beside Homebrew's whisper-cpp"

  depends_on "cmake" => :build
  depends_on arch: :arm64
  depends_on :macos

  def install
    args = %w[
      -DBUILD_SHARED_LIBS=OFF
      -DWHISPER_USE_SYSTEM_GGML=OFF
      -DWHISPER_BUILD_EXAMPLES=ON
      -DWHISPER_BUILD_TESTS=OFF
      -DWHISPER_BUILD_SERVER=OFF
      -DWHISPER_SDL=OFF
      -DWHISPER_CURL=OFF
      -DWHISPER_COMMON_FFMPEG=OFF
      -DGGML_METAL=ON
      -DGGML_METAL_EMBED_LIBRARY=ON
      -DGGML_NATIVE=OFF
    ]
    system "cmake", "-S", ".", "-B", "build", *args, *std_cmake_args
    system "cmake", "--build", "build", "--target", "whisper-cli"
    bin.install "build/bin/whisper-cli"
  end

  test do
    help = shell_output("#{bin}/whisper-cli --help 2>&1")
    # BOXBLACK's word timings come from DTW
    assert_match "--dtw", help
    # one binary, nothing from Homebrew's ggml
    refute_match "ggml", shell_output("otool -L #{bin}/whisper-cli")
  end
end
