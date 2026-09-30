/**
 * whisper-cli pinned to the version BOXBLACK was tested with, from BOXBLACK's own Homebrew tap
 * (the formula's source is homebrew-tap/ in this repo). Plain data: the preload bundle imports it.
 */

/** What customers type after `brew install`; the owner is the GitHub account the tap is published under. */
export const WHISPER_TAP_FORMULA = "pharitdev-ctrl/boxblack/boxblack-whisper"

/** The whisper.cpp release the formula builds; the formula's url must say the same (a test checks). */
export const PINNED_WHISPER_VERSION = "1.9.2"

/** Where Homebrew keeps the keg-only formula, on Apple Silicon and on Intel Macs. */
export const PINNED_WHISPER_DIRS = ["/opt/homebrew/opt/boxblack-whisper/bin", "/usr/local/opt/boxblack-whisper/bin"]
