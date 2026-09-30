# Carried into Task 7b's fix round (from the re-review of Task 7's fix round, which approved it)

- `apps/desktop/src/main/flair.ts`, the plan's merge: an edited graphic of another kind now goes at the next plan and frees its point and place, but Claude's unedited sounds on its moment stay, because `gone` still filters on `!graphic.edited`. Decided: they go, as in the clean-up: `gone` is every stored graphic that is not in the new list. Every edited motion graphic is in `mine`, hence in the list, so nothing else changes. One cue added to the test of that merge.
- `apps/desktop/scripts/release-check.ts`: the stray message says "beside host.js" even when `host.js` is absent. Wording only; mend if the file is open anyway.

Left as they are (known limits, no version of the app wrote such shapes): a version-1 file whose `cues`, `zooms` or `inserts` are malformed still stops the clean-up; a pre-M25 file with a `null` graphic entry, an edited entry with no anchor or `graphics: {}` still stops M25's step; `update` on a file that is JSON but no outline hands the change `null` (no caller of the app is exposed).
