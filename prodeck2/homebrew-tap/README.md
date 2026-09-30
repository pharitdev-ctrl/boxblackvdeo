# BOXBLACK Homebrew tap

The command-line tools BOXBLACK uses that do not ship inside the app, pinned to the versions the
app was tested with.

```
brew install pharitdev-ctrl/boxblack/boxblack-whisper
```

| Formula | What it is | Why not Homebrew's own |
|---|---|---|
| `boxblack-whisper` | whisper.cpp 1.9.2 (`whisper-cli`) with its own ggml built in, Metal on | `whisper-cpp` follows the newest release and links a separate `ggml` formula that updates by itself |

It is keg-only, so it can sit beside `whisper-cpp`; BOXBLACK looks in
`$(brew --prefix)/opt/boxblack-whisper/bin` first.

The copy in the BOXBLACK repo (`homebrew-tap/`) is the source; the tap repository is published
from it.
