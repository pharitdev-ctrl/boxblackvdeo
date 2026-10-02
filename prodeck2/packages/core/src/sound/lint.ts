import { shown } from "../graphics/motion/shape.ts"
import { SOUND_CODE_MAX } from "./spec.ts"

/*
 * The check a sound Claude composed passes before it is rendered (spec §6.1). It refuses what a sound has no use for
 * and what would reach past the offline audio context it is given: the network, other threads, code loaded or made
 * from text, the page and the browser, timers and the clock, other audio, and promises. The sealed page the sound
 * renders in is the second gate behind it.
 *
 * A sound has one shape: `function compose(ctx, cue, kit) { ... }` and nothing before it or after its closing
 * brace, since the harness runs the text as one function expression and a second statement would run with it.
 *
 * The names are matched in the code alone. The code is read the way JavaScript reads it: comments, the insides of
 * strings and the text of templates are left out, and the code inside a template's ${ } is read as code. One thing
 * cannot be read that way without a parser: a regular expression, inside which a quote or a comment's opening is
 * neither. A / where a value is expected starts one, and is refused, since a sound needs none; a / after a value is
 * a division. What the check cannot read for certain it refuses rather than guesses at.
 *
 * Every problem is one line of English that names what was found and says what to do instead, since the problems
 * go back to Claude in a repair, which is the only one a sound gets.
 */

/** A character a name in code can hold. Thai letters and marks count, so ราคาDate is one name of its own and not Date. */
const NAME = String.raw`[\p{L}\p{M}\p{N}_$]`
const NAME_CHARACTER = new RegExp(NAME, "u")
/** A name in code as a whole: one that merely holds it (prefetch, topNote) is not it. */
const whole = (source: string) => `(?<!${NAME})${source}(?!${NAME})`

/** The one way a sound starts: the function, its name and its three parameters, spaced as Claude likes, and the brace of its body. */
const HEAD = /^function\s+compose\s*\(\s*ctx\s*,\s*cue\s*,\s*kit\s*\)\s*\{/
const SHAPE = "write exactly one function compose(ctx, cue, kit) { ... } and nothing before it or after its closing brace"

/** The characters a line ends at, for a comment and for a regular expression. */
const LINE_END = "\n\r\u2028\u2029"
/** The words after which a value is expected, so that a / after one starts a regular expression. */
const BEFORE_A_VALUE = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await", "extends"])
/** The words whose ( ) is the head of a statement, so that a / after its ) starts the statement and a regular expression. */
const HEADS = new Set(["if", "while", "for", "with"])

/** The code as JavaScript reads it, in the same places as the text it was read from, and what could not be read. */
interface Reading {
  /** the text with every comment, the inside of every string and the text of every template made spaces (line ends kept), and every regular expression too */
  code: string
  problems: string[]
}

/**
 * Reads the text as code. What is left out is made spaces, so that a place in the code is the same place in the
 * text. Whether a value has just ended is followed as the text is read, which is what tells a division from a
 * regular expression: after a name, a number, a string, a template, ] or the ) of anything but a head, a / divides;
 * anywhere else it starts a regular expression, which is read to its end and refused. After }, a block's or an
 * object's, it is taken to start one, which is the stricter reading.
 */
function read(text: string): Reading {
  let code = ""
  const problems: string[] = []
  let i = 0
  /** a value has just ended, so that a / divides */
  let afterValue = false
  /** the name just read, when the last thing read was a name */
  let word = ""
  /** for each ( still open, whether it opened the head of if, while, for or with */
  const parens: boolean[] = []
  /** for each template's ${ still open, the braces opened inside it and not yet closed */
  const holes: number[] = []
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) code += LINE_END.includes(text[k]!) ? text[k] : " "
  }

  /** Reads a template's text from i, which is just past its backtick or the } that ends a ${ }, to its end or its next ${. */
  const templateText = () => {
    const from = i
    for (; i < text.length; i++) {
      if (text[i] === "\\") i++
      else if (text[i] === "`") {
        blank(from, i)
        code += "`"
        i++
        afterValue = true
        return
      } else if (text[i] === "$" && text[i + 1] === "{") {
        blank(from, i + 2)
        i += 2
        holes.push(0)
        afterValue = false
        return
      }
    }
    i = text.length
    blank(from, i)
    problems.push(`has a template that never ends (\`${shown(text.slice(from - 1))}\`): end every template with its backtick`)
  }

  while (i < text.length) {
    const c = text[i]!
    const next = text[i + 1]
    if (/\s/.test(c)) {
      code += c
      i++
    } else if (c === "/" && next === "/") {
      let end = i + 2
      while (end < text.length && !LINE_END.includes(text[end]!)) end++
      blank(i, end)
      i = end
    } else if (c === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2)
      const end = close < 0 ? text.length : close + 2
      if (close < 0) problems.push(`has a comment that never ends (\`${shown(text.slice(i))}\`): end every /* comment with */`)
      blank(i, end)
      i = end
    } else if (c === '"' || c === "'") {
      // a string ends at its quote; one that meets the end of its line first never ends, as JavaScript reads it
      let end = i + 1
      let ended = false
      while (end < text.length) {
        if (text[end] === "\\") end += text[end + 1] === "\r" && text[end + 2] === "\n" ? 3 : 2
        else if (text[end] === c) {
          ended = true
          end++
          break
        } else if (text[end] === "\n" || text[end] === "\r") break
        else end++
      }
      end = Math.min(end, text.length)
      if (ended) {
        // the quotes stay, so that the string is still a value where it stood
        code += c
        blank(i + 1, end - 1)
        code += c
      } else {
        problems.push(`has a string that never ends on its line (\`${shown(text.slice(i, end))}\`): end every string with its quote on the line it starts on`)
        blank(i, end)
      }
      i = end
      afterValue = true
      word = ""
    } else if (c === "`") {
      code += "`"
      i++
      word = ""
      templateText()
    } else if (c === "}" && holes.at(-1) === 0) {
      // the end of a template's ${ }: the template's text goes on
      holes.pop()
      code += " "
      i++
      word = ""
      templateText()
    } else if (NAME_CHARACTER.test(c)) {
      let end = i + 1
      while (end < text.length && NAME_CHARACTER.test(text[end]!)) end++
      word = text.slice(i, end)
      code += word
      i = end
      afterValue = !BEFORE_A_VALUE.has(word)
    } else if (c === "/" && !afterValue) {
      // a regular expression: its text up to the / that ends it outside a class, on its line, then its flags
      let end = i + 1
      let inClass = false
      let ended = false
      while (end < text.length && !LINE_END.includes(text[end]!)) {
        const d = text[end]
        if (d === "\\") {
          if (LINE_END.includes(text[end + 1] ?? "\n")) break
          end += 2
          continue
        }
        if (d === "[") inClass = true
        else if (d === "]") inClass = false
        else if (d === "/" && !inClass) {
          ended = true
          end++
          break
        }
        end++
      }
      if (ended) while (end < text.length && NAME_CHARACTER.test(text[end]!)) end++
      end = Math.min(end, text.length)
      problems.push(
        `has the regular expression \`${shown(text.slice(i, end))}\` (a / where a value is expected starts one): the check cannot read a regular expression for certain and a sound needs none, so leave it out`,
      )
      blank(i, end)
      i = end
      afterValue = true
      word = ""
    } else if ((c === "+" || c === "-") && next === c) {
      // ++ and -- leave things as they were: after a value they end one (i++), before one they leave one expected (++i)
      code += c + c
      i += 2
      word = ""
    } else if (c === "." && /^[0-9][0-9_]*$/.test(word)) {
      // the point of a number (1. or 10.5): the number goes on, and is a value
      code += c
      i++
      afterValue = true
      word = ""
    } else {
      if (c === "(") parens.push(HEADS.has(word))
      if (c === "{" && holes.length > 0) holes[holes.length - 1]!++
      if (c === "}" && holes.length > 0) holes[holes.length - 1]!--
      code += c
      i++
      // a ) that closes no ( is read as a head's, the stricter reading
      afterValue = c === ")" ? parens.pop() === false : c === "]"
      word = ""
    }
  }
  return { code, problems }
}

/**
 * What is wrong with the shape: the text must open with the function's head, and the brace that opens its body must
 * be closed by the very last character, or by the last but a semicolon, counting the braces of the code alone. What
 * follows it is named.
 */
function shapeProblems(text: string, code: string): string[] {
  const head = HEAD.exec(text)
  if (head === null) return [`starts with \`${shown(text.slice(0, 30))}\` instead of \`function compose(ctx, cue, kit) {\`: ${SHAPE}`]
  let depth = 0
  for (let k = head[0].length - 1; k < code.length; k++) {
    if (code[k] === "{") depth++
    else if (code[k] === "}" && --depth === 0) {
      const after = text.slice(k + 1).trim()
      // one semicolon after the function is fine: the harness leaves it out
      return after === "" || after === ";" ? [] : [`has \`${shown(after)}\` after the function's closing brace: ${SHAPE}`]
    }
  }
  return [`never closes the function: it has more { than } outside its strings and comments; ${SHAPE}`]
}

/** A rule: what it looks for, in the code or (raw) in the whole text, and the problem it makes of what it finds. */
interface Rule {
  raw?: boolean
  pattern: RegExp
  problem: (found: RegExpExecArray) => string
}

/** Names in code refused for one reason: the problem names the one found. */
const refuseAll = (names: string[], advice: string): Rule => ({ pattern: new RegExp(whole(`(?:${names.join("|")})`), "gu"), problem: (found) => `uses \`${found[0]}\`: ${advice}` })

/** The page's names that are plain words too, refused only where they are used as the page's. */
const PLAIN_WORDS = "(?:self|top|parent|frames|open|history|location)"

const NO_NETWORK = "the sound has no network, so build everything from the nodes of ctx and from kit"
const ALONE = "the sound is built in the one function, with no other thread or channel to talk to"
const NO_MORE_CODE = "no other code can be loaded, so write all the code in the one function"
const NO_CODE_FROM_TEXT = "code cannot be made from text, so write it out"
const NO_PAGE = "the sound has no page and no browser to reach, only ctx, cue and kit, so build it from those (a value of your own needs another name)"
const TIMERS = "the sound is rendered offline once the function returns, so schedule every change on a node or an AudioParam, at its time in seconds from 0"
const THE_CLOCK = "the clock is not the sound's time and would make every render differ, so count in seconds from 0 and take chance from kit.rand()"
const ONLY_CTX = "build every node on the ctx you are given: no other audio context, no file to decode, no media element or stream, and no worklet"
const RENDERED = "the app renders the context once the function returns; do not start, suspend or resume it"
const NO_WAITING = "nothing waits: the function returns once everything is scheduled and the app renders afterwards, so use no async, await, Promise or then"

const RULES: Rule[] = [
  // the network
  refuseAll(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"], NO_NETWORK),
  // WebRTC is a family of names (RTCPeerConnection, RTCDataChannel …), some with a prefix
  { pattern: new RegExp(whole(String.raw`(?:webkit|moz)?RTC\w+`), "gu"), problem: (found) => `uses \`${found[0]}\`: ${NO_NETWORK}` },
  // other threads and channels
  refuseAll(["Worker", "SharedWorker", "ServiceWorker", "postMessage", "BroadcastChannel", "MessageChannel"], ALONE),
  // code loaded, or made from text
  refuseAll(["import", "importScripts"], NO_MORE_CODE),
  refuseAll(["eval", "Function"], NO_CODE_FROM_TEXT),
  // a function's constructor, read from it, is Function; a class's own constructor and a key of that name are not read
  { pattern: new RegExp(String.raw`\.\s*(constructor)(?!${NAME})`, "gu"), problem: () => `uses \`constructor\`: ${NO_CODE_FROM_TEXT}` },
  // the page and the browser
  refuseAll(["document", "window", "globalThis", "navigator", "localStorage", "sessionStorage", "indexedDB", "caches"], NO_PAGE),
  {
    // names that are plain words too (a top note, frames of a buffer, a filter that opens) are the page's only when used as
    // its objects are: not a property after a dot, and read with a dot or a bracket, or called, plainly, by ?. or as a tag (\x60 is the backtick)
    pattern: new RegExp(String.raw`(?<!\.\s*)${whole(PLAIN_WORDS)}(?=\s*(?:\?\.|[.[(\x60]))`, "gu"),
    problem: (found) => `uses \`${found[0]}\`: ${NO_PAGE}`,
  },
  {
    // the page's address set moves the page on; a name of one's own declared at the same place is not it
    pattern: new RegExp(String.raw`(?<!\.\s*)(?<!(?:const|let|var)\s+)${whole("location")}(?=\s*(?:\*\*|<<|>>>|>>|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>]))`, "gu"),
    problem: () => `uses \`location\`: ${NO_PAGE}`,
  },
  // time, which is the render's: every change is scheduled on the context
  refuseAll(["setTimeout", "setInterval", "requestAnimationFrame", "queueMicrotask"], TIMERS),
  refuseAll(["Date", "performance"], THE_CLOCK),
  // audio outside the context the sound is given
  refuseAll(
    ["AudioContext", "webkitAudioContext", "OfflineAudioContext", "decodeAudioData", "createMediaElementSource", "createMediaStreamSource", "createMediaStreamDestination", "audioWorklet", "AudioWorkletNode"],
    ONLY_CTX,
  ),
  // the context, which the app renders
  { pattern: /\.\s*(startRendering|suspend|resume)\s*\(/gu, problem: (found) => `uses \`.${found[1]}(\`: ${RENDERED}` },
  // promises, which would leave work for after the function returns
  refuseAll(["async", "await", "Promise"], NO_WAITING),
  { pattern: /\.\s*then\s*\(/gu, problem: () => `uses \`.then(\`: ${NO_WAITING}` },
  // a browser reads the rest of the line after these as a comment, and this check does not
  {
    pattern: /<!--|-->/g,
    problem: (found) => `has \`${found[0]}\`: a browser reads the rest of its line as a comment, which this check does not, so leave it out (for i-- > 0, put a space after the --)`,
  },
  // an escape can spell any name above, in a string as well, where a name is not read
  { raw: true, pattern: /\\[ux]/g, problem: (found) => `uses \`${found[0]}\`: an escape can spell a name the rules refuse, so write the character itself` },
]

/** The most problems returned; a longer list ends with a line for the rest. */
const MAX_PROBLEMS = 12

/**
 * What is wrong with a composed sound's code, in English, each problem once and on one line: none when it passes.
 * Every rule is checked, so one round of repair can put right everything found, up to twelve problems and a line
 * for the rest. Empty code has no other problem, and code too long is not read further: it has to be cut first.
 */
export function lintCompose(code: string): string[] {
  const text = code.trim()
  if (text === "") return [`the code is empty: ${SHAPE}`]
  if (code.length > SOUND_CODE_MAX) return [`the code is ${code.length} characters, more than the ${SOUND_CODE_MAX} allowed: keep only what the sound needs (fewer voices, shared helpers)`]
  const reading = read(text)
  const found = new Set<string>()
  const add = (problem: string) => void found.add(problem.replace(/\s+/g, " "))
  for (const problem of shapeProblems(text, reading.code)) add(problem)
  for (const problem of reading.problems) add(problem)
  for (const rule of RULES) {
    for (const match of (rule.raw ? text : reading.code).matchAll(rule.pattern)) add(rule.problem(match))
  }
  const problems = [...found]
  return problems.length > MAX_PROBLEMS ? [...problems.slice(0, MAX_PROBLEMS), `and ${problems.length - MAX_PROBLEMS} more`] : problems
}
