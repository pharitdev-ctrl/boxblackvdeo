/*
 * Reading a fragment the way a browser's HTML parser reads it, so that the check of a fragment and the parser
 * cannot disagree about which text is code.
 *
 * A fragment has one shape: a plain <style> block, then markup, then at most one plain <script> block at the very
 * end. The parser reads the style block as raw text up to its first end tag, and a script as raw text up to its
 * end tag. Everything else it reads as tags and text, and a fragment written in the plain way below is read the
 * same by any parser that follows the standard: the tags are clean, no comment, declaration or instruction
 * opens a state that swallows what follows, no element makes its inside raw text (the linter refuses them all),
 * and no svg or math element is left open, since inside one the parser reads a script's text as markup. What is
 * not written that way is refused rather than guessed at; that is the whole method.
 */

/** How a fragment is built. Every problem about its shape says it, so that a repair has the whole rule. */
export const SHAPE = "start with one `<style>` block, then markup, then at most one plain `<script>` block at the very end"

/** A fragment read as its parts. */
export interface Shape {
  /** the markup: all the rest but for the script, which leaves a line break where it was */
  markup: string
  /** the text of the script, from its opening tag to the last end tag of a script; empty when there is none. It is the code the page runs. */
  code: string
  /** what is wrong with how the fragment is built and how its tags are written, in English */
  problems: string[]
}

/** Part of a long text, for a problem that names it. */
export const shown = (text: string) => (text.length > 60 ? `${[...text].slice(0, 57).join("")}…` : text)
const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length

const LETTER = /[A-Za-z]/
const SPACE = /\s/

/** A start tag read from its `<`: where it ends, its name, whether it closes itself, and how it was written. */
interface StartTag {
  end: number
  name: string
  selfClosing: boolean
  /** a tag name, attribute name or unquoted value with a character a tokenizer only tolerates, or a value with a < or > in it */
  unreadable: boolean
  /** the text ended before the tag, or a quote, did */
  unended: boolean
}

/**
 * Reads the start tag that begins at `at` as a tokenizer does: a name up to white space, / or >; then attributes,
 * each a name up to white space, /, > or =, and perhaps an = and a value, in quotes to the same quote or bare up
 * to white space or >; a / that is not followed by > is nothing; the tag ends at the first > that is not in a
 * quote. The plain way to write a tag is read the same by every parser; what a tokenizer only tolerates (a quote,
 * = or < in a name or a bare value, a < or > in a quoted value) is marked unreadable, since the text it holds
 * would be read differently by a check that does not follow these states.
 */
function readStartTag(text: string, at: number): StartTag {
  let i = at + 1
  while (i < text.length && !/[\s/>]/.test(text[i]!)) i++
  const name = text.slice(at + 1, i)
  const tag: StartTag = { end: text.length, name, selfClosing: false, unreadable: !/^[A-Za-z][A-Za-z0-9:-]*$/.test(name), unended: false }
  for (;;) {
    while (i < text.length && SPACE.test(text[i]!)) i++
    if (i >= text.length) return { ...tag, unended: true }
    if (text[i] === ">") return { ...tag, end: i + 1 }
    if (text[i] === "/") {
      if (text[i + 1] === ">") return { ...tag, end: i + 2, selfClosing: true }
      i++
      continue
    }
    const from = i
    while (i < text.length && !/[\s/>=]/.test(text[i]!)) i++
    if (i === from || /["'<`]/.test(text.slice(from, i))) tag.unreadable = true
    while (i < text.length && SPACE.test(text[i]!)) i++
    if (text[i] !== "=") continue
    i++
    while (i < text.length && SPACE.test(text[i]!)) i++
    const quote = text[i]
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, i + 1)
      if (close < 0) return { ...tag, unended: true }
      if (/[<>]/.test(text.slice(i + 1, close))) tag.unreadable = true
      i = close + 1
    } else {
      const start = i
      while (i < text.length && !/[\s>]/.test(text[i]!)) i++
      if (/["'<=`]/.test(text.slice(start, i))) tag.unreadable = true
    }
  }
}

const UNREADABLE = "that the check cannot read: write a tag name in letters and digits, an attribute name without quotes or =, and an attribute value in quotes with no < or > in it"

/**
 * The problems in the way the markup's tags are written: a < that starts no tag (which includes a comment,
 * a declaration, CDATA and an instruction, all of which a parser reads in states of their own), a tag or a
 * quote never ended, and a tag the plain reading above cannot be sure of; and an svg or math element left open,
 * inside which a parser reads text as markup, or closed that was never opened.
 */
function scanTags(markup: string): string[] {
  const problems: string[] = []
  const open: string[] = []
  for (let at = markup.indexOf("<"); at >= 0; at = markup.indexOf("<", at)) {
    const next = markup[at + 1] ?? ""
    if (LETTER.test(next)) {
      const tag = readStartTag(markup, at)
      if (tag.unended) problems.push(`has \`${shown(markup.slice(at, at + 40))}\` that never ends: end every tag with a >, and every quote with its pair`)
      else if (tag.unreadable) problems.push(`has \`${shown(markup.slice(at, tag.end))}\` ${UNREADABLE}`)
      const name = tag.name.toLowerCase()
      if ((name === "svg" || name === "math") && !tag.selfClosing) open.push(name)
      at = Math.max(tag.end, at + 1)
    } else if (next === "/" && LETTER.test(markup[at + 2] ?? "")) {
      const end = /^<\/([A-Za-z][A-Za-z0-9:-]*)\s*>/.exec(markup.slice(at, at + 200))
      if (end === null) {
        const close = markup.indexOf(">", at)
        problems.push(`has \`${shown(markup.slice(at, close < 0 ? at + 40 : close + 1))}\` ${UNREADABLE}`)
        at = close < 0 ? markup.length : close + 1
        continue
      }
      const name = end[1]!.toLowerCase()
      if (name === "svg" || name === "math") {
        const opened = open.lastIndexOf(name)
        if (opened < 0) problems.push(`has \`</${name}\` with no \`<${name}>\` before it: close an \`<svg>\` and a \`<math>\` only once, with its own end tag`)
        else open.length = opened
      }
      at += end[0].length
    } else {
      problems.push(
        `has \`${shown(markup.slice(at, at + 12).trimEnd())}\` where no tag starts: write &lt; for a less-than sign in text, and leave out <! declarations, comments and CDATA and <? instructions`,
      )
      at += 1
    }
  }
  for (const name of open) problems.push(`has an \`<${name}>\` that is never closed: close every \`<svg>\` and \`<math>\` with its end tag`)
  return problems
}

/**
 * The fragment as its parts, and what is wrong with the way it is built. The style block is the first thing, and
 * ends at the first end tag of a style; the script is taken from the first <script that follows it to the last
 * </script, whatever is wrong with it, so that code a fragment hides between two of them is still read as code;
 * one never closed runs to the end. The markup is what is left, and its tags are scanned.
 */
export function readShape(html: string): Shape {
  const problems: string[] = []
  // the one character a parser rewrites: into U+FFFD in a script, a value or a name, and dropped from text
  if (html.includes("\u0000")) problems.push("has a NUL character (U+0000), which a parser changes or drops, so the text it runs would not be the text that was checked: a fragment holds only text, tabs and line breaks")
  const text = html.trim()
  const lead = html.length - html.trimStart().length
  const styled = html.startsWith("<style>", lead)
  if (!styled) problems.push(`starts with \`${shown(text.slice(0, 30))}\` instead of a plain \`<style>\` block: ${SHAPE}`)

  // the style block is raw text to its first end tag: a script named inside it is not one, and it is not read as code
  let styleText = ""
  let after = html
  let styleClosed = false
  if (styled) {
    const from = lead + "<style>".length
    const end = html.slice(from).search(/<\/style/i)
    if (end < 0) {
      styleText = html.slice(from)
      after = ""
    } else {
      styleText = html.slice(from, from + end)
      const tagEnd = html.indexOf(">", from + end)
      after = tagEnd < 0 ? "" : html.slice(tagEnd + 1)
      styleClosed = true
      // its end tag is plain as well: nothing after the name, so that it ends at the > every parser takes it to
      if (!html.startsWith("</style>", from + end)) {
        const written = html.slice(from + end, tagEnd < 0 ? from + end + 30 : tagEnd + 1)
        problems.push(`has \`${shown(written)}\` instead of a plain \`</style>\` to end the styles: ${SHAPE}`)
      }
    }
  }
  if (count(styleText, /<script/gi) > 0) problems.push(`has \`<script\` in the styles, where it is no script: a script goes at the very end and nowhere else; ${SHAPE}`)

  const opens = [...after.matchAll(/<script/gi)].map((found) => found.index)
  const closes = [...after.matchAll(/<\/script/gi)].map((found) => found.index)
  let markup = after
  let code = ""
  const open = opens[0]
  if (open !== undefined) {
    const tagEnd = after.indexOf(">", open)
    const from = tagEnd < 0 ? after.length : tagEnd + 1
    const close = closes.filter((index) => index >= from).at(-1)
    const closeEnd = close === undefined ? -1 : after.indexOf(">", close)
    markup = `${after.slice(0, open)}\n${closeEnd < 0 ? "" : after.slice(closeEnd + 1)}`
    code = after.slice(from, close ?? after.length)
  }

  const styles = (styled ? 1 : 0) + count(markup, /<style/gi)
  const styleEnds = (styleClosed ? 1 : 0) + count(markup, /<\/style/gi)
  if (styles > 1) problems.push(`has ${styles} \`<style\` tags, but a fragment has just one style block: ${SHAPE}`)
  if (styled && !styleClosed) problems.push(`has a \`<style>\` that is never closed: end it with \`</style>\` before the markup; ${SHAPE}`)
  if (styleEnds > 1) problems.push(`has ${styleEnds} \`</style\`, but a fragment has just one: ${SHAPE}`)
  if (styles === 0 && styleEnds > 0) problems.push(`has a \`</style\` with no \`<style>\` before it: ${SHAPE}`)

  // a script is counted wherever the letters are, in the code and in the svg too: a parser reads a second one in the code as an escape
  if (opens.length > 1) problems.push(`has ${opens.length} \`<script\` tags, but a fragment has at most one script: ${SHAPE}`)
  if (opens.length === 1) {
    const opening = after.slice(open).match(/^<script[^>]*>?/i)?.[0] ?? ""
    if (opening !== "<script>") problems.push(`has \`${shown(opening)}\` for its script, which must have no attributes (no src, no type): ${SHAPE}`)
  }
  if (opens.length > 0 && closes.length === 0) problems.push(`has a \`<script>\` that is never closed: end it with \`</script>\` as the very last thing; ${SHAPE}`)
  if (closes.length > 1) problems.push(`has ${closes.length} \`</script\`, but only the very last thing may end the script, and the code may not hold one: ${SHAPE}`)
  if (opens.length === 0 && closes.length > 0) problems.push(`has a \`</script\` with no \`<script>\` before it: ${SHAPE}`)
  if (opens.length > 0 && closes.length > 0 && !text.endsWith("</script>")) {
    problems.push(`ends with \`${shown(after.slice(closes.at(-1)).trim())}\` instead of a plain \`</script>\` as the very last thing: ${SHAPE}`)
  }

  problems.push(...scanTags(markup))
  return { markup, code, problems }
}
