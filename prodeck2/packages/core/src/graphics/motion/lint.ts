import { MOTION_HTML_MAX } from "../plan.ts"
import { readShape, shown } from "./shape.ts"
import { REFUSED_TAGS, type RefusedTag } from "./tags.ts"

export { RAW_TEXT_TAGS, REFUSED_TAGS, SMIL_TAGS } from "./tags.ts"

/*
 * The check a fragment Claude wrote passes before it is rendered (spec §6.1). It refuses what nothing in a render
 * can use, what reaches past the stage, and what would leave the renderer unable to set the time; the page around
 * the fragment (a content security policy) and the render's own environment are the second gate behind it.
 *
 * A fragment has one shape: a plain <style> block, then markup, then at most one plain <script> block that ends the
 * fragment. shape.ts reads it that way, and refuses whatever it cannot read for certain, which is what lets this
 * check and a browser's HTML parser read the fragment the same way: the code checked here is exactly the code the
 * page runs, and the markup is exactly the markup it makes.
 *
 * The rules about names in code look only at that script. The rules about tags, attributes and handlers look at
 * the markup, which is all the rest but the styles; the words on screen, and the names of classes and ids, run
 * nothing and so trip no rule about code.
 *
 * Every problem is one line of English that names what was found and says what to do instead, since the
 * problems go back to Claude in a repair, which is the only one a fragment gets.
 */

/** A character a name in code can hold. Thai letters and marks count, so ราคาDate is one name of its own and not Date. */
const NAME = String.raw`[\p{L}\p{M}\p{N}_$]`
/** Not the end of a longer name. */
const AFTER_NAME = String.raw`(?<!${NAME})`
/** Not the start of a longer name. */
const BEFORE_NAME = String.raw`(?!${NAME})`

/** What a rule reads: the whole fragment; the markup, which is all of it but the styles and the script; the code, which is the script's text; or the code as far as it is written at the top of the script. */
type Where = "fragment" | "markup" | "code" | "top"

/** A rule: where it looks, what it looks for, and the problem it makes of what it finds, or none. */
interface Rule {
  in: Where
  pattern: RegExp
  problem: (found: RegExpExecArray) => string | null
}

/** A rule for one thing that is refused: the problem names it and says what to do instead. */
const refuse = (where: Where, name: string, source: string, flags: string, advice: string): Rule => ({ in: where, pattern: new RegExp(source, flags), problem: () => `uses \`${name}\`: ${advice}` })

/** A name in code as a whole: one that merely holds it (relocation, Candidate) is not it. */
const whole = (source: string) => `${AFTER_NAME}${source}${BEFORE_NAME}`
/** A call of a name, which may be spaced from its bracket. */
const called = (source: string) => `${AFTER_NAME}${source}\\s*\\(`
/** An object's property, spaced as the code likes. */
const dotted = (object: string, property: string) => whole(`${object}\\s*\\.\\s*${property}`)
/** An HTML tag, opening or closing, and not another tag that starts with its letters (link is not linearGradient). */
const tag = (name: string) => `</?${name}(?![\\w:-])`
/**
 * A comment in code, which may sit anywhere white space may. Written so that there is only one way to read a run of
 * them, since a rule that could read it in many ways would take a time to fail that grows with the length of the run.
 */
const COMMENT = String.raw`/\*[^*]*\*+(?:[^/*][^*]*\*+)*/|//[^\n\r\u2028\u2029]*`
/** What follows a name that is being assigned to: white space and comments, perhaps an operator (+=, ||=, **= …), and one = that is not the start of == or of =>. */
const ASSIGNED = String.raw`(?:\s|${COMMENT})*(?:\*\*|<<|>>>|>>|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])`
/** Names in code refused for one reason: the problem names the one found. */
const refuseAll = (where: Where, names: string[], advice: string): Rule => ({ in: where, pattern: new RegExp(whole(`(?:${names.join("|")})`), "gu"), problem: (found) => `uses \`${found[0]}\`: ${advice}` })

const NO_NETWORK = "the graphic has no network, so draw everything from what is in the fragment"
const ALONE = "the graphic runs alone, with no other thread, window or channel to talk to, so keep everything in the one script"
const NO_MORE_CODE = "no other code can be loaded, so write all the code in the one <script> block"
const NO_CODE_FROM_TEXT = "code cannot be made from text, so write it out"
const NOTHING_KEPT = "nothing can be stored or read back, so keep values in variables"
const COMPUTED = "reading the window or the document by a computed name can reach anything the rules refuse, so use the plain name (window.frame = ...)"
const NOT_MOVED_ON = "the page cannot be navigated or rewritten from code, and nothing in a graphic needs it"
const HISTORY = `${NOT_MOVED_ON} (if a list of earlier values is meant, call it past)`
const OPEN = "no window can be opened, and any call of a name open is taken for that, so call your own function launch"
const ADDRESS = 'an address cannot be set from code: a shape is reused with <use href="#id"> in the markup, and nothing is loaded'
const ADDRESS_BRACKET = (name: string) => `an address cannot be set from code, and this form cannot be told from setting one, so read it as el.${name} (reading an address is fine)`
const HANDLER = "this sets an event handler, not an address, and its code would not be read by these rules, so put the code in the script block and call it from there"
const NO_SRC = "nothing can be loaded into src or srcset, not even a reference to a shape in the fragment, so draw with inline SVG (only href=\"#id\" may point at a shape in the fragment)"
const NOT_CLICKED = "nothing is clicked or sent, since a graphic is drawn and moved by animation"
const HTML_STRING = "a string of HTML would bring back the handlers, tags and addresses the markup may not have, so build shapes with document.createElementNS and setAttribute"
const TIME =
  "the renderer sets time itself, frame by frame, so animate with CSS animations or el.animate(), and put what must be worked out for every frame in window.frame = (t) => { ... }"
const THE_CLOCK = "the clock is not the renderer's time, so delay animations from time 0 (with the word variables) or use the seconds t that window.frame is given"
const RENDERERS_NAME = "this name belongs to the renderer, which cuts a script that carries it out of the page, so use another name"
const NO_PAGE = "the fragment goes inside a page that already has one, so write only the <style> block, the markup and at most one <script> block"
const NOTHING_EMBEDDED = "nothing can be embedded, so draw with HTML and inline SVG"
const NO_SHEETS = "no other file can be loaded, so put the styles in the <style> block"
const PLAIN_TEXT = "the browser reads what is inside this element as plain text, which the check of a fragment's shape cannot follow, so draw text in a <div> or an SVG <text>"
const NO_SMIL = "no SMIL elements: animate with CSS or el.animate()"
const NO_MEDIA = "no media can be played; a graphic is drawn and moved by animation"

/** Why each tag a fragment may not have is refused, and what to do instead. The compiler holds this table to the list of tags: one cannot be in the list and not here, or here and not in the list. */
const ADVICE: Record<RefusedTag, string> = {
  html: NO_PAGE,
  head: NO_PAGE,
  body: NO_PAGE,
  link: NO_SHEETS,
  meta: "the page around the fragment is not the fragment's to change, and a meta tag can even send it elsewhere, so put the styles in the <style> block",
  base: "the page around the fragment is not the fragment's to change, and a base moves every address, of which there are none, so leave it out",
  iframe: NOTHING_EMBEDDED,
  object: NOTHING_EMBEDDED,
  embed: NOTHING_EMBEDDED,
  frame: NOTHING_EMBEDDED,
  frameset: NOTHING_EMBEDDED,
  applet: NOTHING_EMBEDDED,
  portal: NOTHING_EMBEDDED,
  img: "no picture can be loaded, so draw with inline SVG",
  video: NO_MEDIA,
  audio: NO_MEDIA,
  canvas: "the renderer can only move CSS animations and Web Animations and cannot see into a canvas, so draw with inline SVG or HTML elements",
  form: "a form sends the page somewhere and there is nothing to send, so draw with plain elements",
  template: "a template holds markup that is neither drawn nor checked as the rest is, so put the shapes in the fragment itself",
  textarea: PLAIN_TEXT,
  title: PLAIN_TEXT,
  xmp: PLAIN_TEXT,
  plaintext: PLAIN_TEXT,
  noscript: PLAIN_TEXT,
  noembed: PLAIN_TEXT,
  noframes: PLAIN_TEXT,
  animate: NO_SMIL,
  animateTransform: NO_SMIL,
  animateMotion: NO_SMIL,
  set: NO_SMIL,
}
/** The tags code may not create: those above, and a script. Found in any case; named as they are written in the list. */
const CREATED = new Map([...REFUSED_TAGS, "script"].map((name) => [name.toLowerCase(), name]))

/** Code that sets an attribute of these names with setAttribute or setAttributeNS, as one rule for each call. */
const settingAttribute = (names: string, advice: string): Rule[] => [
  {
    in: "code",
    pattern: new RegExp(String.raw`setAttribute\s*\(\s*["']((?:[\w-]+:)?(?:${names}))["']`, "giu"),
    problem: (found) => `uses \`setAttribute("${found[1]}")\`: ${advice}`,
  },
  {
    in: "code",
    pattern: new RegExp(String.raw`setAttributeNS\s*\([^,()]*,\s*["']((?:[\w-]+:)?(?:${names}))["']`, "giu"),
    problem: (found) => `uses \`setAttribute("${found[1]}")\`: ${advice}`,
  },
]

const RULES: Rule[] = [
  // a comment, which is where a parser's script data escape starts: the check of the shape cannot follow a script after one
  {
    in: "fragment",
    pattern: /<!--/g,
    problem: () => "has an HTML comment (`<!--`): no HTML comments; a CSS /* */ comment is fine",
  },
  // tags with no use in a graphic, that would load or embed something, or that the shape's check cannot follow
  ...REFUSED_TAGS.map((name) => refuse("markup", `<${name}>`, tag(name), "gi", ADVICE[name])),
  // no inline event handlers: an attribute that starts with on runs code the code rules do not read
  {
    in: "markup",
    pattern: new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}_$-])(on[a-z]+)\s*=`, "giu"),
    problem: (found) => `has the event handler \`${found[1]!.toLowerCase()}\`: no inline event handlers; put the code in the script block`,
  },
  // something loaded from a URL or a file: an address in src, srcset or href, a url() that is not a shape in the fragment, an @import
  {
    // an attribute of a tag: in code, src and href are names like any other (a variable called src loads nothing)
    in: "markup",
    pattern: new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}_$-])((?:xlink:)?(?:srcset|src|href))\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`, "giu"),
    problem: (found) => {
      const value = (found[2] ?? found[3] ?? found[4] ?? "").trim()
      // nothing loads nothing
      if (value === "") return null
      // src and srcset load whatever they hold, a reference to a shape in the fragment included: only href points at one
      if (/src/i.test(found[1]!)) return `has \`${found[1]}="${shown(value)}"\`: ${NO_SRC}`
      if (value.startsWith("#")) return null
      return `has \`${found[1]}="${shown(value)}"\`: nothing can be loaded from a URL or a file, so draw with inline SVG (a reference to a shape in the fragment, like href="#id", is fine)`
    },
  },
  {
    // read from where it starts, not to where it ends, so that a run of them costs no more than one
    in: "fragment",
    pattern: new RegExp(String.raw`${AFTER_NAME}url\((?!\s*["']?\s*#)`, "giu"),
    problem: (found) => {
      const call = found.input.slice(found.index, found.index + 200)
      const end = call.indexOf(")")
      return `has \`${shown(end < 0 ? call : call.slice(0, end + 1))}\`: url() may only point at a shape in the fragment, like url(#id), since nothing can be loaded from a URL or a file; draw with inline SVG`
    },
  },
  refuse("fragment", "@import", String.raw`@import(?![\w-])`, "gi", NO_SHEETS),
  // a way to reach the network, another thread or window, or to load or make code
  refuseAll("code", ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"], NO_NETWORK),
  {
    // WebRTC is a family of names (RTCPeerConnection, RTCDataChannel, RTCIceCandidate …), some with a prefix
    in: "code",
    pattern: new RegExp(whole(String.raw`(?:webkit|moz)?RTC[A-Z]\w*`), "gu"),
    problem: (found) => `uses \`${found[0]}\`: ${NO_NETWORK}`,
  },
  refuseAll("code", ["Worker", "SharedWorker", "ServiceWorker", "BroadcastChannel", "MessageChannel", "postMessage"], ALONE),
  refuseAll("code", ["import", "importScripts"], NO_MORE_CODE),
  refuseAll("code", ["eval"], NO_CODE_FROM_TEXT),
  refuse("code", "new Function", whole(String.raw`new\s+Function`), "gu", NO_CODE_FROM_TEXT),
  refuse("code", "Function", `(?<!new\\s+)${whole("Function")}`, "gu", NO_CODE_FROM_TEXT),
  // a way to leave the stage: to move the page on, to open or reach another window, to rewrite the document
  refuse("code", "location", whole("location"), "gu", "the page cannot be moved on or asked for its address (if a place on the stage is meant, call it x, y or spot)"),
  // a call of window.open is a call of open, below; window.open kept without being called is refused as it is
  refuse("code", "window.open", `${dotted("window", "open")}(?!\\s*\\()`, "gu", "no other window can be opened"),
  refuse("code", "open(", called("open"), "gu", OPEN),
  refuseAll("code", ["navigation"], NOT_MOVED_ON),
  refuse("code", "history.", `${AFTER_NAME}history\\s*\\.`, "gu", HISTORY),
  refuse("code", "document.write", `${AFTER_NAME}document\\s*\\.\\s*write(?:ln)?${BEFORE_NAME}`, "gu", NOT_MOVED_ON),
  refuse("code", "document.domain", dotted("document", "domain"), "gu", NOT_MOVED_ON),
  refuse("code", "document.cookie", dotted("document", "cookie"), "gu", NOTHING_KEPT),
  refuseAll("code", ["localStorage", "sessionStorage", "indexedDB"], NOTHING_KEPT),
  refuse("code", "navigator.", `${AFTER_NAME}navigator\\s*\\.`, "gu", "the browser cannot be read or driven from here, and nothing in a graphic needs it"),
  {
    in: "code",
    pattern: new RegExp(String.raw`${AFTER_NAME}(window|self|top|parent|document|this)\s*\[`, "gu"),
    problem: (found) => `uses \`${found[1]}[\`: ${COMPUTED}`,
  },
  refuseAll("code", ["globalThis"], COMPUTED),
  // an address set, or a click, or an event sent: the ways to have the page load or go somewhere. Reading an address is fine.
  {
    in: "code",
    pattern: new RegExp(String.raw`\.\s*(href|action|srcdoc|src)${BEFORE_NAME}(?:\s*\.\s*baseVal)?${ASSIGNED}`, "gu"),
    problem: (found) => `uses \`.${found[1]}\`: ${ADDRESS}`,
  },
  {
    // the bracket form can be read or set with the same words, and there is no telling which
    in: "code",
    pattern: new RegExp(String.raw`\[\s*["'](href|action|srcdoc|src)["']\s*\]`, "gu"),
    problem: (found) => `uses \`["${found[1]}"]\`: ${ADDRESS_BRACKET(found[1]!)}`,
  },
  ...settingAttribute("href|action|srcdoc|src|formaction", ADDRESS),
  ...settingAttribute("on[a-z]+", HANDLER),
  {
    in: "code",
    pattern: new RegExp(String.raw`\.\s*(click|submit|requestSubmit)\s*\(`, "gu"),
    problem: (found) => `uses \`.${found[1]}(\`: ${NOT_CLICKED}`,
  },
  refuse("code", "dispatchEvent(", called("dispatchEvent"), "gu", NOT_CLICKED),
  // a string of HTML made into elements, or an element made that the markup may not hold
  refuseAll("code", ["innerHTML", "outerHTML", "insertAdjacentHTML", "createContextualFragment", "DOMParser", "setHTMLUnsafe", "parseHTMLUnsafe"], HTML_STRING),
  {
    in: "code",
    pattern: new RegExp(String.raw`createElement(?:NS)?\s*\([^()]*?["'](${[...CREATED.values()].join("|")})["']`, "giu"),
    problem: (found) => `creates a \`<${CREATED.get(found[1]!.toLowerCase())}>\` in code: what the markup may not hold cannot be made in code either`,
  },
  // an escape can spell any name above
  {
    in: "code",
    pattern: /\\[ux]/g,
    problem: (found) => `uses \`${found[0]}\`: an escape can spell a name the rules refuse, so write the character itself`,
  },
  // the clock, and time left to the browser, which the renderer replaces frame by frame
  refuseAll("code", ["requestAnimationFrame", "setTimeout", "setInterval"], TIME),
  refuseAll("code", ["Date"], THE_CLOCK),
  refuse("code", "performance.now", dotted("performance", "now"), "gu", THE_CLOCK),
  refuse("code", "Math.random", dotted("Math", "random"), "gu", "every frame must draw the same for the same time, so write the numbers out, a small fixed table, and do not draw them by chance"),
  // the names the renderer finds its own script by, and the timeline the page hands it
  refuse("code", "__timelines", "__timelines", "gi", RENDERERS_NAME),
  refuse("code", "__hf", "__hf", "gi", RENDERERS_NAME),
  refuse("code", "hyperframe", "hyperframe", "gi", RENDERERS_NAME),
  refuse("code", "__player", "__player", "gi", RENDERERS_NAME),
  // the times of the words are declared by the page, for the script: declaring them again is an error that stops the whole script
  {
    in: "top",
    pattern: new RegExp(String.raw`${AFTER_NAME}(?:(?:const|let|var|class)\s+T|function\s*\*?\s*T)${BEFORE_NAME}`, "gu"),
    problem: (found) => `declares \`${found[0]}\` at the top of the script: the page already declares T (the times of the words) for it, so use another name, or keep your code inside a function`,
  },
]

/** Ways a fragment moves: a keyframes rule, a Web Animation, or a function drawn for the time it is given. */
const MOVES = [/@(?:-webkit-)?keyframes(?![\w-])/i, /\.animate\s*\(/, new RegExp(`${AFTER_NAME}window\\s*\\.\\s*frame${BEFORE_NAME}`, "u")]
const NO_MOVES = "has no animation: a graphic that does not move is not a motion graphic; add @keyframes with an animation, or el.animate(...), or set window.frame = (t) => { ... }"

/**
 * Where the comment, string or template that starts at `from` ends; null when none starts there. One never ended runs
 * to the end of the line, or of the code. A line ends at a line feed or a carriage return (a parser turns a lone
 * carriage return into a line feed before the script is run), and a comment ends as well at U+2028 and U+2029,
 * which JavaScript takes for line ends too.
 */
function endOfQuoted(code: string, from: number): number | null {
  const c = code[from]
  if (c === "/" && code[from + 1] === "/") {
    let end = from + 2
    while (end < code.length && !"\n\r\u2028\u2029".includes(code[end]!)) end++
    return end
  }
  if (c === "/" && code[from + 1] === "*") {
    const end = code.indexOf("*/", from + 2)
    return end < 0 ? code.length : end + 2
  }
  if (c === '"' || c === "'" || c === "`") {
    for (let i = from + 1; i < code.length; i++) {
      if (code[i] === "\\") i++
      else if (code[i] === c) return i + 1
      else if (c !== "`" && (code[i] === "\n" || code[i] === "\r")) return i
    }
    return code.length
  }
  return null
}

/**
 * The code as far as it is written at the script's own top level, which is where a declaration meets the page's:
 * every comment, string and template, and everything inside brackets, is blanked to spaces. A regular expression
 * with a bracket or a quote in it can throw the reading of it off, which costs a missed or a needless repair.
 */
function topLevel(code: string): string {
  let top = ""
  let depth = 0
  for (let i = 0; i < code.length; ) {
    const end = endOfQuoted(code, i)
    if (end !== null) {
      top += " ".repeat(end - i)
      i = end
      continue
    }
    const c = code[i]!
    if ("([{".includes(c)) depth++
    else if (")]}".includes(c)) depth = Math.max(0, depth - 1)
    top += depth === 0 && !"([{)]}".includes(c) ? c : " "
    i++
  }
  return top
}

/** The most problems returned; a longer list ends with a line for the rest. */
const MAX_PROBLEMS = 12

/**
 * What is wrong with a fragment, in English, each problem once and on one line: none when it passes. Every rule is
 * checked, so one round of repair can put right everything found, up to twelve problems and a line for the rest. An
 * empty fragment has no other problem, and one too long is not read further: it has to be cut first.
 */
export function lintFragment(html: string): string[] {
  if (html.trim() === "") return ["the fragment is empty: write a <style> block, then the markup, then at most one <script> block"]
  if (html.length > MOTION_HTML_MAX) return [`the fragment is ${html.length} characters, more than the ${MOTION_HTML_MAX} allowed: keep only what the animation needs (fewer shapes, shorter styles)`]
  const { markup, code, problems: shape } = readShape(html)
  const text = { fragment: html, markup, code, top: topLevel(code) }
  const found = new Set<string>()
  const add = (problem: string) => void found.add(problem.replace(/\s+/g, " "))
  for (const problem of shape) add(problem)
  for (const rule of RULES) {
    for (const match of text[rule.in].matchAll(rule.pattern)) {
      const problem = rule.problem(match)
      if (problem !== null) add(problem)
    }
  }
  if (!MOVES.some((way) => way.test(html))) add(NO_MOVES)
  const problems = [...found]
  return problems.length > MAX_PROBLEMS ? [...problems.slice(0, MAX_PROBLEMS), `and ${problems.length - MAX_PROBLEMS} more`] : problems
}
