(1) Per-group look model and where a "behind" flag fits

**The current model**
- `GroupLook = { pattern, tone, accent, exit, edited }` is at packages/core/src/flair/plan.ts:18-27, and `DEFAULT_LOOK` at :29.
- Looks are stored per group id in `StoredOutline.flair.looks: Record<groupId, GroupLook>` (apps/desktop/src/shared/api.ts:495). They are not stored on the group.
- `HighlightGroup` (packages/core/src/highlights/placement.ts:15-30) holds the text: `id, source, edited, lines, beatId?, pointId?, scene?`.
- `EmphasisPoint` (packages/core/src/emphasis/types.ts:18-28) holds `importance` (key/secondary/extra), `type` and `reason`. The level filter works on points: `LEVEL_IMPORTANCE` at types.ts:81 and `pointFilter` at emphasis/filter.ts:118-121.
- Claude sets a look when it picks the text (pick.ts:271-283). The user sets it through `setLook` (apps/desktop/src/main/flair.ts:697-726), which marks it `edited`. The UI is the look popover (LookPopover.tsx:27-91), opened from the ⚙︎ button in HighlightTab.tsx:63-70. That button only shows while the "ท่าข้อความ" switch (`flair.text`) is on.
- `looksInForce` (highlight-state.ts:382-399) runs every look through `enforce`. When `flair.text` is off it returns `DEFAULT_LOOK` for every group, but the stored looks are left alone (:390).

**Where the flag should sit: on the look (recommended), as an optional `behind?: boolean`**
- Why the look:
  - It is per group and visual.
  - Claude already answers looks in the same call.
  - The `edited` flag already means "hands off" to Claude.
  - `regroupFlair` moves a look to the new group that shows the same words, by spreading it (`{ ...look, accent }`, highlight-state.ts:346). `withoutLine` (:230) and `withLineText` (:246) spread it too, so an extra field survives those.
  - The stored outline is read with a plain `JSON.parse` and no sanitiser (project-files.ts:77), so the field stays on disk.
- Why not the group: re-picking replaces Claude's groups (highlights.ts:556-571), and `regroupFlair` carries only looks, cues, inserts and graphics (highlight-state.ts:330-350). A flag on the group would be lost unless the user had edited that group.
- Why not the point: a point serves text, zoom, cutaway, graphic and sound, and can have no text at all. "Behind" is a property of the text only.

**Places that would silently drop a new look field today (all must change)**
- `enforce`, non-edited branch: returns a fresh `{ pattern, tone, accent, exit, edited:false }` (plan.ts:75). The edited branch spreads, so it keeps the field (:74).
- `setLook` rebuilds the look field by field (flair.ts:717-723). It needs `behind: patch.behind ?? look.behind`.
- `acceptHighlights` builds the look field by field (pick.ts:271-277).
- IPC validation copies only the known patch fields (highlight-api.ts:253-265). The patch type is `FlairLookPatch` (api.ts:652-664).
- LookPopover's `change()` resends pattern, tone and exit (LookPopover.tsx:32). That is fine as long as `setLook` falls back to the stored value.

**Not losing the flag when toggled: three patterns already exist**
- Global switch off: stored values stay, only what is in force changes. Looks fall back to default while `flair.text` is off (highlight-state.ts:390). Graphics are neither shown nor written while `flair.graphic` is off (highlights.ts:302; timeline.ts:410).
- Per-item off: `GraphicCue.off` means "kept so it can be switched back on" (graphics/plan.ts:123-124). The list shows it as off (FlairTab.tsx:230-231) and the write skips it (WriteScreen.tsx:91-92).
- Held for a missing capability: `heldExits` (highlight-state.ts:401-417) feeds `HighlightGroupView.heldExit` (api.ts:548-549). LookPopover keeps a held exit when the rest of the look is edited (LookPopover.tsx:29-32). The write page counts it in `proLeftOut` (WriteScreen.tsx:157-159). A "held behind" (feature off, no person in shot, render failed) would follow this pattern exactly.

**Side effects to decide**
- If the flag lives in the look, turning `flair.text` off also turns "behind" off in force (highlight-state.ts:390), unless the write reads the stored flag directly.
- Setting it by hand marks the look `edited`. That makes the group the user's (`usersGroup`, emphasis.ts:47-49), so it survives re-picks and cleanup, and it also exempts the group from the pattern and tone run rules (plan.ts:67,70).

(2) Global switches that exist, and how to add one

**What exists**
- The settings file `AppSettings` (settings.ts:12-24):
  - `cut`: preset, cutFillers, cutRetakes, cutBadPicture.
  - `subtitles`: enabled, length, polish.
  - `highlights`: enabled, position, hideSubtitles, custom (`HighlightOptions`, styles.ts:28-36; default at :150).
  - `flair`: enabled (deprecated), level, text, sound, zoom, insert, graphic (`FlairOptions`, flair/catalogue.ts:8-24).
  - `vision.frameEveryS`, `appearance`, `capcut.pro`.
- The Settings page, General tab, shows only appearance, CapCut Pro, the graphics pack row and the graphic files cleanup row (SettingsScreen.tsx:425-462; the cleanup row is `GraphicFilesRow` at :202-237).
- Everything else is switched on the post-production page. All of these are app-wide:
  - GraphicsTab (GraphicsTab.tsx:33-46): `highlights.enabled`, `flair.text`, `zoom`, `insert`, `graphic`.
  - HighlightSettings (TabSettings.tsx:50-115): position, style, custom colours.
  - SubtitleSettings (:118-146), including hideSubtitles.
  - LevelControl (:149-161), used in EmphasisTab.tsx:228.
  - The sound switch (SoundTab.tsx:27).

**How to add a switch**
1. Add the type and default in core: `FlairOptions` plus `DEFAULT_FLAIR_OPTIONS` (catalogue.ts:8-24).
2. Add it to the settings sanitiser (settings.ts:123-131). `read()` rebuilds every field explicitly and `update()` returns `read()` (:138-154), so a missing field is dropped.
3. Add it to both IPC checks. Each copies the flags one by one:
   - highlight-api.ts:77-85 (preview options and plan runs; `PostRequest.view` goes through it at :99).
   - timeline-api.ts:41-58 (write request).
4. Put a `Switch` in GraphicsTab that calls `room.changeFlair` (ClipRoom.tsx:635-657; saved through `updateSettings`). Any change to `flair` re-runs the preview, because `flairKey = JSON.stringify(flair)` is one of the placement inputs (ClipRoom.tsx:388-390).
5. Add i18n keys `flair.x` and `flair.xHint` (i18n.ts:447-461; Thai only, i18n.ts:1-5).

A flair flag travels inside `flair: FlairOptions`. A highlights option would have to be threaded separately through `HighlightViewOptions` (api.ts:517-524), `HighlightRequest` (api.ts:788-797) and both checks.

(3) How highlight text position is decided

- `HIGHLIGHT_POSITIONS = auto | top | middle | bottom`; the default is auto (styles.ts:7,150).
- `placementOf` (highlight-state.ts:147-155):
  - A fixed position is used as is.
  - With auto, it merges the `keepClear` band of every scene the group plays over into one full-width vertical band. It has height only, no x.
- `keepClear` comes from the vision prompt (vision/describe.ts:67). It covers faces, products being shown and text already in the picture. It explicitly excludes the body, hands and background, and it is Claude's estimate from sampled frames.
- `anchorFor` (layout.ts:81-119) for auto:
  - First it tries the room above the band, then below it, with a margin, then with no margin.
  - Then it shrinks the text down to 0.6 to fit beside the band; a tie goes above.
  - Only when nothing fits does it cover the band, as little as possible (`dodge: "over"`).
  - With no picture analysed it falls back to the top (`no-picture`).
  - The floor is -0.52 while subtitles are on (:21-25, :92).
- Fixed positions (layout.ts:82-86):
  - top: block's top edge at y=0.72.
  - middle: block centred at y=0.1.
  - bottom: block's bottom edge at -0.52 (CapCut y runs +1 at the top to -1 at the bottom).
- The UI shows the result per group as "หลบไว้เหนือหน้า / ใต้หน้า / วางทับน้อยที่สุด" (HighlightTab.tsx:61; i18n.ts:435-438). The `Dodge` type is at layout.ts:78.
- Graphics also keep off the highlight text bands (highlights.ts:264-273), so a behind group still reserves its band.

**Answer: auto avoids the face on purpose, and puts the text on the torso when it goes below.**
- That works against the effect. Text behind the head is avoided. Text "below" the face sits on the chest, where the person would hide most of it.
- A behind group needs its own placement: overlap the person deliberately, but keep enough of each line visible.
- The `keepClear` band is too coarse to measure how much of a line the person hides. The per-frame person mask would have to be used.
- On draft 0917 today (read only), the highlight text sits at y 0.14–0.83, above the face. The current `draft_info.json` has no cutout overlay track. **UNVERIFIED:** whether the spike's overlay was reverted or written to another timeline copy, and which groups showed the behind effect.

(4) Could Claude's highlight pick choose the behind groups, and what a prompt change costs

- The prompt is `HIGHLIGHT_PROMPT` (pick.ts:23-64) with version `HIGHLIGHT_PROMPT_VERSION = "highlights-2026-09-27-points"` (:15).
- One call returns the style plus, per group: point, lines, pattern, tone, accentLine, accentWord, exit (`HighlightReplySchema`, pick.ts:66-86).
- **What Claude is shown now** (`describe`, pick.ts:305-329; `pointLine`, :298-303): the brief, styles, patterns, exits, and each point's kind, importance and type label, beat, time, words or scene description, and reason.
  - It gets no picture facts for speech points: no scene kind (talking-head), no `keepClear`, no frames. The request is text only (:354).
  - To choose behind groups it would need at least scene kind or "person in shot", and the band. There is a precedent: the graphics call passes scene kind, `keepClear` and some frames (graphics/direct.ts:55-56, 155, 559).
- **What a prompt change entails:**
  - Add a field to the schema. Follow `tone`'s pattern: `.default(...)` plus a `??` fallback, because a transport may skip schema defaults (pick.ts:77, 273-274).
  - Carry the answer into the look in `acceptHighlights` (pick.ts:271-283), and extend `enforce` so it keeps the field.
  - Add prompt text and the extra request data.
  - Bump the version string and update the test that pins it (pick.test.ts:282-283). post-flow.test.ts keys fake replies by `HIGHLIGHT_PROMPT.system` (:297, 333, 374), so the text can change safely there.
- **The version is informational only for this prompt:**
  - Nothing caches highlight picks by it; results are stored in the outline, and `StoredOutline.promptVersion` is the planner's.
  - The license server can override only the vision and planner prompts (prompts.ts:7-20).
  - main does not pass `prompt:` to `pickHighlights` (highlights.ts:530-542).
  - So bumping it invalidates nothing. Old projects keep their groups until the user re-runs the text pick.

(5) Write page summary rows and pre-write checks

- **Summary** (WriteScreen.tsx:136-161): one row per work, in the form `switchOn ? t("write.x", { count }) : off(labelKey)` (:99, 147-155). Conditional warning rows follow: zoomsLost (:156), proLeftOut (:157-159).
- **Checks** (:163-202): the `Check` component has states ok, wait, fail, warn and going (:22-53).
  - The graphics render row (:189-195) is the model for a cutout render. It has a Progress bar, the state "going" without holding the write (i18n `write.check.graphicsGoing`), and a separate warn row for failed renders.
  - `canWrite` is at :85-86.
- **The write itself** waits for renders before it reads the draft (timeline.ts:407-437), then checks CapCut is closed again.
- **Result rows** (:219-246) come from `WriteResult` (api.ts:809-831) and its `dropped` counts (`DROPPED_NAMES`, :35).
- **The preview's render state** comes from `graphicView` (highlights.ts:290-323), which starts renders in the background, plus the `graphics` progress events (api.ts:461-465).
- Given ~55–60 MB per second of overlay, disk space would fit a "warn" check. Cleanup would parallel `GraphicFilesRow` (SettingsScreen.tsx:202-237). Rendered files are recognised by the path `/Movies/CapCut/BOXBLACK/graphics/` (capcut/bin.ts:40).

**Write-path touchpoints (observed)**
- Layer order follows the order of `tracks[]`, not `render_index` (memory capcut-draft-format-facts.md:41-42).
- Today the writer appends in this order: subtitles (timeline.ts:468), highlight bars and text (:512; capcut/highlights.ts:197-230), zooms, cutaways, graphics, sounds.
- `addOverlayTracks` only appends (overlays.ts:75). To sit above the behind text and below the subtitles, the overlay track would have to be spliced into the list, and the subtitles track, which today is inserted first, would have to move above it.
- `addZooms` writes keyframes only to the first video track, timed in each piece's source time (capcut/zoom.ts:85, 94). The overlay piece plays its own file from 0, so the zoom keyframes would have to be copied and re-timed for it.

**UNVERIFIED:** which tests pin the full `FlairOptions` object; the exact track order the spike used for draft 0917.