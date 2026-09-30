export { layoutGroup, LINE_WIDTH_RATIO, textUnits, type Dodge, type HighlightPlacement } from "./layout.ts"
export { groupsFromWords } from "./manual.ts"
export { acceptHighlights, findQuote, HIGHLIGHT_PROMPT, HIGHLIGHT_PROMPT_VERSION, HighlightReplySchema, PART_BREAK, pickHighlights, type HighlightPoint, type HighlightReply, type HighlightSentence } from "./pick.ts"
export { placeHighlights, SCENE_LABEL_MAX_US, timeHighlights, type HighlightGroup, type HighlightLine, type PlacedGroup, type PlacedLine, type TimedGroup } from "./placement.ts"
export {
  accentOnBar,
  DEFAULT_HIGHLIGHT_OPTIONS,
  HIGHLIGHT_FONTS,
  HIGHLIGHT_POSITIONS,
  HIGHLIGHT_STYLE_IDS,
  HIGHLIGHT_STYLES,
  maxHighlightChars,
  PICKABLE_STYLE_IDS,
  styleFor,
  type HighlightFontId,
  type HighlightOptions,
  type HighlightPosition,
  type HighlightStyle,
  type HighlightStyleId,
  type Palette,
  type PickableStyleId,
} from "./styles.ts"
export { BLACK, contrast, hexOf, luminance, onSurface, readableAccent, rgbOf, strokeFor, WHITE, type Rgb } from "./colour.ts"
