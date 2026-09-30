/*
 * The tags a fragment may not have, in one place. The linter is built from this list (it must give each tag its
 * advice, which the compiler checks), the code rule that forbids making one with createElement is built from it,
 * and so are the tests that a page holds none and the fuzz of what a browser's parser makes of a fragment: a tag
 * added here is refused, refused in code, and tried by the fuzz, and one cannot be in one of them and not the rest.
 */

/**
 * Tags refused because a browser's parser reads their inside as plain text, up to the tag that ends them, where the
 * check of a fragment's shape reads it as markup: a script in one is text to the browser and a script to the check,
 * or the other way round. So none is allowed, wherever it stands. (An iframe is plain text to the parser as well,
 * but it is refused first as something embedded, and is in the list below with the rest of those.)
 */
export const RAW_TEXT_TAGS = ["textarea", "title", "xmp", "plaintext", "noscript", "noembed", "noframes"] as const

/** SVG's animation elements, which the renderer cannot seek: a graphic moves with CSS animations and el.animate(). */
export const SMIL_TAGS = ["animate", "animateTransform", "animateMotion", "set"] as const

/** Every tag a fragment may not have. Code may not make them either, with createElement. */
export const REFUSED_TAGS = [
  // a page of its own
  "html",
  "head",
  "body",
  // something loaded, or a change to the page around the fragment
  "link",
  "meta",
  "base",
  // something embedded
  "iframe",
  "object",
  "embed",
  "frame",
  "frameset",
  "applet",
  "portal",
  // a picture or media to load, or a surface the renderer cannot see into
  "img",
  "video",
  "audio",
  "canvas",
  // a submission, and markup that is neither drawn nor checked as the rest is
  "form",
  "template",
  ...RAW_TEXT_TAGS,
  ...SMIL_TAGS,
] as const

export type RefusedTag = (typeof REFUSED_TAGS)[number]
