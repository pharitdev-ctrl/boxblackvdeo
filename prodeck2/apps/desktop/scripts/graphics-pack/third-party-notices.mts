/**
 * Writes THIRD-PARTY-NOTICES.txt into the graphics pack: the license of every npm package that a
 * bundle in the pack inlines, and of every library built into sharp's libvips. HyperFrames' dist
 * files are single bundles holding about forty BSD, MIT and ISC packages without one of their
 * notices, and libvips-cpp.dylib holds about thirty C libraries whose texts sharp-libvips only
 * names, so neither is covered by the license files sitting in node_modules. The bundles' own path
 * comments (node_modules/.bun/<package>@<version>/...) say which package and version each piece
 * came from; its license is taken from that exact version's registry tarball. libvips' versions.json
 * says which version of each library it was built from; its license comes from that version's
 * source archive, found through graphics-pack/libvips-sources.txt. librsvg is partly Rust, and the
 * crates it builds in are no longer in its archive: its Cargo.lock names each one's exact version,
 * and each one's license comes from that version's archive on crates.io.
 *
 * build-graphics-pack.sh runs this with the pack's own Node while it builds the pack, and the build
 * fails when anything a bundle names, or libvips was built from, ends up with no license text here.
 *
 *   node third-party-notices.mts <pack dir> <graphics-pack dir> <download cache dir> [--plan]
 *
 * --plan makes only the checks that need no network and lists what a real run would download,
 * all but the Rust crates, which only a library's downloaded Cargo.lock names.
 */
import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, normalize, relative } from "node:path"

export interface StorePackage {
  name: string
  version: string
}

type FetchUrl = (url: string, init?: RequestInit) => Promise<Response>

/**
 * gitlab.freedesktop.org (fontconfig's source) answers 406 to fetch's bare default, with no
 * User-Agent header at all; a browser-shaped one gets past that outright rejection, so every
 * download sends one rather than special-casing that one host. It is not a full fix for that host
 * -- see the note on the "fontconfig" line of libvips-sources.txt -- but it is a plain improvement
 * for any other host that is only that fussy.
 */
const DOWNLOAD_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

/**
 * Packages whose files bundle others from a plain node_modules, whose paths carry no version, and
 * that ship those packages' licenses themselves. Only a person can check that, so a relock that
 * adds another such package fails the build until someone has looked and added it here.
 */
export const SELF_NOTICED: Record<string, string> = {
  prettier: "node_modules/prettier/THIRD-PARTY-NOTICES.md",
  "@img/colour": "node_modules/@img/colour/LICENSE.md (color, color-convert, color-name, color-string)",
  "puppeteer-core":
    "node_modules/puppeteer-core/lib/third_party (the license comment above each bundled module, kept again in lib/es5-iife/puppeteer-core-browser.js)",
}

/**
 * hyperframes/dist ships a couple of bundles compiled straight from its own source rather than
 * bundled by a later pass over a plain node_modules, so they carry none of the path comments
 * storePackages looks for -- nothing says what they inline. Only a person can check that, so every
 * .js under node_modules/hyperframes/dist with no store paths that still looks like a bundle (see
 * looksBundled) must be listed here by hand, or the build fails. Each package named is an ordinary
 * dependency of hyperframes already sitting in node_modules, so its license comes from there
 * rather than a registry download.
 */
export const MINIFIED_BUNDLES: Record<string, string[]> = {
  "node_modules/hyperframes/dist/hyperframe-runtime.js": ["postcss", "nanoid"],
  "node_modules/hyperframes/dist/hyperframe.runtime.iife.js": ["postcss", "nanoid"],
}

const HYPERFRAMES_DIST = "node_modules/hyperframes/dist/"

const STORE_PATH = /node_modules\/\.(bun|pnpm)\/([^/"'`\s]+)\/node_modules\/((?:@[^/"'`\s]+\/)?[^/"'`\s]+)/g
const PLAIN_BUNDLE_PATH = /^\s*\/\/(?:#region)? (?:\.\.\/)*node_modules\/(?!\.bun\/|\.pnpm\/)/m
const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|patents)/i
/** Rust crates dual-licensed under the Unlicense (memchr, say) ship it as a top-level UNLICENSE. */
const CRATE_LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|patents|unlicense)/i
/** The mark, in a libvips-sources.txt line's last column, for a library whose Cargo.lock names Rust crates built into it. */
const CARGO_LOCK = "cargo-lock"
const CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index"
const RULE = "=".repeat(78)

/**
 * True for a script with no store paths that still looks like a bundle: esbuild's __commonJS
 * helper always builds this exact object literal, whatever minification does to the variable names
 * around it, and a single line this long is not something anything but a bundler would produce.
 */
export function looksBundled(source: string): boolean {
  return source.includes("{exports:{}}") || source.split("\n").some((line) => line.length > 50_000)
}

/** Every package a bundler inlined from a bun or pnpm store, going by the paths it left in the bundle. */
export function storePackages(source: string): { packages: StorePackage[]; unreadable: string[] } {
  const packages = new Map<string, StorePackage>()
  const unreadable = new Set<string>()
  for (const [, store, folder, name] of source.matchAll(STORE_PATH)) {
    // bun names the folder <name, its "/" as "+">@<version>, plus "+<hash>" when it has peers;
    // pnpm adds "_<peers>" or "(<peers>)". Any other folder is not this package's own, so its
    // version would be a guess.
    const prefix = `${name!.replace("/", "+")}@`
    const version = folder!.startsWith(prefix) ? /^[^_+(]+/.exec(folder!.slice(prefix.length))?.[0] : undefined
    if (version) packages.set(`${name}@${version}`, { name: name!, version })
    else unreadable.add(`node_modules/.${store}/${folder}/node_modules/${name}`)
  }
  return { packages: [...packages.values()], unreadable: [...unreadable] }
}

/** {v} is the version, {v_} and {v-} the same with its dots as _ or -, {vmm} its major.minor. */
export function expandSourceUrl(template: string, version: string): string {
  return template
    .replaceAll("{v_}", version.replaceAll(".", "_"))
    .replaceAll("{v-}", version.replaceAll(".", "-"))
    .replaceAll("{vmm}", version.split(".").slice(0, 2).join("."))
    .replaceAll("{v}", version)
}

export interface SourceLine {
  /** the library's key in sharp-libvips' versions.json */
  key: string
  /** the library's names in sharp-libvips' README.md table */
  names: string[]
  url: string
  /** license files beyond the archive's top level, relative to it */
  extras: string[]
}

export function parseSourceList(text: string): SourceLine[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [key, names, url, ...extras] = line.split(/\s+/)
      return { key: key!, names: (names ?? "").split(","), url: url ?? "", extras }
    })
}

export interface LockedCrate {
  name: string
  version: string
  /** where Cargo takes it from; none for one of the workspace's own crates, found by its path */
  source?: string
}

/** Every [[package]] a Cargo.lock locks. */
export function lockedCrates(lock: string): LockedCrate[] {
  const tables: Record<string, string>[] = []
  let table: Record<string, string> | undefined
  for (const line of lock.split("\n").map((line) => line.trim())) {
    if (line === "[[package]]") tables.push((table = {}))
    else if (line.startsWith("[")) table = undefined
    else if (table) {
      const [, key, value] = /^(\w+) = "(.*)"$/.exec(line) ?? []
      if (key) table[key] = value!
    }
  }
  return tables.map(({ name, version, source }) => ({ name: name!, version: version!, ...(source ? { source } : {}) }))
}

/** The license, or license-file, a crate's Cargo.toml gives in its [package] table. */
function manifestLicense(manifest: string): string | undefined {
  let inPackage = false
  const found: string[] = []
  for (const line of manifest.split("\n").map((line) => line.trim())) {
    if (line.startsWith("[")) inPackage = line === "[package]"
    else if (inPackage && /^license(-file)?\s*=/.test(line)) found.push(line)
  }
  return found.length > 0 ? found.join("; ") : undefined
}

/** The first column of the licensing table in sharp-libvips' README.md. */
export function readmeLibraries(readme: string): string[] {
  return readme
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|")[1]!.trim())
    .filter((name) => name && name !== "Library" && !/^-+$/.test(name))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Every .js/.mjs/.cjs file under dir, relative to base; symlinks such as node_modules/.bin are not followed. */
function scriptFiles(dir: string, base: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const stat = lstatSync(full)
    if (stat.isDirectory()) scriptFiles(full, base, files)
    else if (stat.isFile() && /\.[cm]?js$/.test(name)) files.push(relative(base, full))
  }
  return files
}

/** The package a file under node_modules/ belongs to, a nested one as a/node_modules/b. */
function owningPackage(file: string): string {
  const parts = file.split("/")
  const owner: string[] = []
  let at = 1
  while (at < parts.length) {
    const width = parts[at]!.startsWith("@") ? 2 : 1
    owner.push(...parts.slice(at, at + width))
    at += width
    if (parts[at] !== "node_modules") break
    owner.push("node_modules")
    at++
  }
  return owner.join("/")
}

/** Entry names as tar lists them; files only. */
function tarList(archive: string): string[] {
  return execFileSync("tar", ["-tf", archive], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    .split("\n")
    .filter((entry) => entry && !entry.endsWith("/"))
}

/** An entry's path below the archive's top folder, split into parts. */
function below(entry: string): string[] {
  return entry.replace(/^\.\//, "").split("/").slice(1)
}

/** Follow a symlinked license entry (glib's COPYING, say) through no more than this many hops before giving up. */
const MAX_SYMLINK_HOPS = 5

/**
 * The archive entry a symlink found at `entry` targets, resolved relative to `entry`'s own folder,
 * or null if that target is an absolute path, escapes the archive's top folder, or names nothing
 * tar listed. `allEntries` is every entry in the archive, not just the ones requested from tarRead,
 * since a symlink's target is often not one of those (glib's COPYING points inside LICENSES/, which
 * nothing else asks for).
 */
function symlinkTarget(entry: string, link: string, allEntries: string[]): string | null {
  if (link.startsWith("/")) return null
  const clean = entry.replace(/^\.\//, "")
  const top = clean.split("/")[0]!
  const resolved = normalize(join(dirname(clean), link))
  if (resolved === ".." || resolved.startsWith("../") || resolved.split("/")[0] !== top) return null
  return allEntries.find((candidate) => candidate.replace(/^\.\//, "") === resolved) ?? null
}

/**
 * Reads the entries all in one extraction: a .tar.xz is then decompressed once, not once per file.
 * A requested entry that turns out to be a symlink (glib-2.89.4/COPYING, pointing at
 * LICENSES/LGPL-2.1-or-later.txt) is not itself a license text -- tar extracts it as a dangling
 * link since only the named entries are pulled out -- so its target is resolved and extracted too,
 * and its text is what's returned for the symlink's own name. `allEntries` lets a target outside
 * the requested set (the common case) be found; it defaults to `entries` for a caller with nothing
 * broader to offer.
 */
function tarRead(archive: string, entries: string[], scratch: string, allEntries: string[] = entries): Map<string, string> {
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  // resolves(entry) is the real entry whose text answers for it: itself, until a symlink hop says otherwise
  const resolves = new Map<string, string>(entries.map((entry) => [entry, entry]))
  const extracted = new Set<string>()
  let pending = [...new Set(entries)]
  for (let hop = 0; pending.length > 0; hop++) {
    if (hop === MAX_SYMLINK_HOPS) throw new Error(`${pending.join(", ")}: symlink chain longer than ${MAX_SYMLINK_HOPS} hops`)
    execFileSync("tar", ["-xf", archive, "-C", scratch, ...pending])
    for (const entry of pending) extracted.add(entry)
    const next = new Set<string>()
    for (const entry of pending) {
      if (!lstatSync(join(scratch, entry)).isSymbolicLink()) continue
      const link = readlinkSync(join(scratch, entry))
      const target = symlinkTarget(entry, link, allEntries)
      if (!target) throw new Error(`${entry} is a symlink to "${link}", which points outside the archive or names no entry tar listed`)
      for (const [requested, current] of resolves) if (current === entry) resolves.set(requested, target)
      if (!extracted.has(target)) next.add(target)
    }
    pending = [...next]
  }
  return new Map(entries.map((entry) => [entry, readFileSync(join(scratch, resolves.get(entry)!), "utf8")]))
}

async function download(url: string, file: string, fetchUrl: FetchUrl): Promise<string | null> {
  if (existsSync(file)) return null
  try {
    // no explicit timeout: undici's default 300s header and body timeouts already bound a stall,
    // without cutting off a slow 160 MB download
    const response = await fetchUrl(url, { headers: { "User-Agent": DOWNLOAD_USER_AGENT } })
    if (response.status !== 200) {
      await response.body?.cancel()
      return `could not download ${url}: it answered ${response.status}`
    }
    const body = new Uint8Array(await response.arrayBuffer())
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.part`, body)
    renameSync(`${file}.part`, file)
    return null
  } catch (error) {
    return `could not download ${url}: ${message(error)}`
  }
}

async function eachAtMost<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!)
    }),
  )
}

interface Notice {
  /** where the text came from, inside the archive or the repo */
  file: string
  text: string
}

interface Section {
  title: string
  lines: string[]
  notices: Notice[]
}

function registryTarball(pkg: StorePackage): string {
  return `https://registry.npmjs.org/${pkg.name}/-/${pkg.name.split("/").pop()}-${pkg.version}.tgz`
}

function fallbackName(pkg: StorePackage): string {
  return `${pkg.name.replace("/", "+")}@${pkg.version}.txt`
}

export async function thirdPartyNotices(options: {
  pack: string
  graphicsPackDir: string
  cacheDir: string
  fetchUrl?: FetchUrl
  selfNoticed?: Record<string, string>
  minifiedBundles?: Record<string, string[]>
  plan?: boolean
}): Promise<{ problems: string[]; text: string; downloads: string[] }> {
  const { pack, graphicsPackDir, cacheDir } = options
  const fetchUrl = options.fetchUrl ?? fetch
  const selfNoticed = options.selfNoticed ?? SELF_NOTICED
  const minifiedBundles = options.minifiedBundles ?? MINIFIED_BUNDLES
  const problems: string[] = []

  // 1. What the bundles in the pack inline, from the path comments bundlers leave behind
  const inlined = new Map<string, StorePackage & { files: string[] }>()
  const plainBundlers = new Set<string>()
  const minifiedPkgs = new Map<string, string[]>()
  for (const file of scriptFiles(join(pack, "node_modules"), pack)) {
    const source = readFileSync(join(pack, file), "utf8")
    const hasStorePaths = source.includes("node_modules/")
    if (file.startsWith(HYPERFRAMES_DIST) && !hasStorePaths && looksBundled(source)) {
      const names = minifiedBundles[file]
      if (!names) {
        problems.push(
          `${file} looks like an esbuild bundle (its __commonJS helper, or a single very long line) with no path comments saying what it inlines; add it to MINIFIED_BUNDLES in graphics-pack/third-party-notices.mts`,
        )
      } else {
        for (const name of names) {
          if (!minifiedPkgs.has(name)) minifiedPkgs.set(name, [])
          minifiedPkgs.get(name)!.push(file)
        }
      }
    }
    if (!hasStorePaths) continue
    const found = storePackages(source)
    for (const pkg of found.packages) {
      const key = `${pkg.name}@${pkg.version}`
      if (!inlined.has(key)) inlined.set(key, { ...pkg, files: [] })
      inlined.get(key)!.files.push(file)
    }
    for (const path of found.unreadable) {
      problems.push(`${file} inlines ${path}, which names no version of ${path.split("/node_modules/").pop()} to take its license from`)
    }
    if (PLAIN_BUNDLE_PATH.test(source)) plainBundlers.add(owningPackage(file))
  }
  for (const owner of plainBundlers) {
    if (!(owner in selfNoticed)) {
      problems.push(
        `node_modules/${owner} bundles packages from a plain node_modules (no versions in its paths); check it carries their licenses and add it to SELF_NOTICED in graphics-pack/third-party-notices.mts`,
      )
    }
  }
  for (const [owner, where] of Object.entries(selfNoticed)) {
    if (!plainBundlers.has(owner)) problems.push(`SELF_NOTICED lists ${owner}, which no longer bundles from a plain node_modules; remove it`)
    else if (!existsSync(join(pack, where.split(" ")[0]!))) problems.push(`SELF_NOTICED says ${owner} carries its bundled licenses in ${where}, which is not in the pack`)
  }

  // packages MINIFIED_BUNDLES names: each must actually be in node_modules, with a license to give it.
  // These are ordinary dependencies of hyperframes already unpacked in the pack, so nothing here needs a download.
  const minifiedSections = new Map<string, Section>()
  for (const [name, files] of minifiedPkgs) {
    const dir = join(pack, "node_modules", name)
    if (!existsSync(dir)) {
      problems.push(`MINIFIED_BUNDLES says ${files[0]} inlines ${name}, which is not in node_modules; check the package name`)
      continue
    }
    const licenseFile = readdirSync(dir).find((entry) => LICENSE_FILE.test(entry) && lstatSync(join(dir, entry)).isFile())
    if (!licenseFile) {
      problems.push(`MINIFIED_BUNDLES says ${files[0]} inlines ${name}, but node_modules/${name} ships no license file`)
      continue
    }
    const version: string = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version
    minifiedSections.set(name, {
      title: `${name} ${version}`,
      lines: [`inlined into: ${files.join(", ")}`, `source: node_modules/${name} (already in the pack; named by hand in MINIFIED_BUNDLES)`],
      notices: [{ file: licenseFile, text: readFileSync(join(dir, licenseFile), "utf8") }],
    })
  }

  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const packages = [...inlined.values()].sort((a, b) => order(a.name, b.name) || a.version.localeCompare(b.version, "en", { numeric: true }))

  // license texts committed for packages, or Rust crates, whose own archive ships none. One that
  // covers no inlined package may still cover a crate, which only a Cargo.lock inside a library's
  // archive names; when some library reads one, such a text is checked in step 4 instead.
  const fallbackDir = join(graphicsPackDir, "bundled-licenses")
  const fallbacks = new Set(existsSync(fallbackDir) ? readdirSync(fallbackDir).filter((name) => name.endsWith(".txt")) : [])
  const fallbackCovers = (name: string) => name.slice(0, -".txt".length).replace("+", "/")
  const sources = parseSourceList(readFileSync(join(graphicsPackDir, "libvips-sources.txt"), "utf8"))
  const readsCargoLock = sources.some((line) => line.extras.includes(CARGO_LOCK))
  for (const name of [...fallbacks].sort()) {
    const covers = fallbackCovers(name)
    if (!inlined.has(covers) && !readsCargoLock) problems.push(`graphics-pack/bundled-licenses/${name} covers ${covers}, which no bundle inlines any more; delete it`)
  }

  // 2. What libvips was built from, against the committed source list
  const libvipsDir = join(pack, "node_modules/@img/sharp-libvips-darwin-arm64")
  const versions: Record<string, string> = JSON.parse(readFileSync(join(libvipsDir, "versions.json"), "utf8"))
  const readme = readmeLibraries(readFileSync(join(libvipsDir, "README.md"), "utf8"))
  const libvipsPackage: string = JSON.parse(readFileSync(join(libvipsDir, "package.json"), "utf8")).version
  for (const [key, version] of Object.entries(versions)) {
    if (!sources.some((line) => line.key === key)) problems.push(`libvips was built with ${key} ${version}, which graphics-pack/libvips-sources.txt has no line for`)
  }
  for (const line of sources) {
    if (!(line.key in versions)) problems.push(`graphics-pack/libvips-sources.txt has a line for ${line.key}, which libvips was not built with; remove it`)
  }
  const claimed = sources.flatMap((line) => line.names)
  for (const name of readme) {
    if (!claimed.includes(name)) problems.push(`sharp-libvips' README.md names ${name}, which no line of graphics-pack/libvips-sources.txt claims`)
  }
  for (const line of sources) {
    for (const name of line.names) {
      if (!readme.includes(name)) problems.push(`graphics-pack/libvips-sources.txt claims ${name} for ${line.key}, which sharp-libvips' README.md does not name`)
    }
  }
  const builtFrom = sources.filter((line) => line.key in versions).map((line) => ({ ...line, version: versions[line.key]!, url: expandSourceUrl(line.url, versions[line.key]!) }))

  const downloads = [...packages.map(registryTarball), ...builtFrom.map((line) => line.url)]
  if (problems.length > 0 || options.plan) return { problems, text: "", downloads }

  // 3. The npm packages' licenses, from each one's own registry tarball at the version inlined
  const packageSections = new Map<string, Section>()
  const packageProblems = new Map<string, string>()
  await eachAtMost(packages, 6, async (pkg) => {
    const key = `${pkg.name}@${pkg.version}`
    const url = registryTarball(pkg)
    const archive = join(cacheDir, "npm", `${pkg.name.replace("/", "+")}@${pkg.version}.tgz`)
    const failed = await download(url, archive, fetchUrl)
    if (failed) return void packageProblems.set(key, `${key}: ${failed}`)
    let files: Map<string, string>
    try {
      const entries = tarList(archive)
      files = tarRead(archive, entries.filter((entry) => below(entry).length === 1 && LICENSE_FILE.test(below(entry)[0]!)), join(cacheDir, "extract", key), entries)
    } catch (error) {
      rmSync(archive, { force: true })
      return void packageProblems.set(key, `${key}: ${url} is not an archive tar can read (${message(error)})`)
    }
    const fallback = fallbackName(pkg)
    const notices = [...files].map(([entry, text]) => ({ file: below(entry).join("/"), text }))
    if (notices.length === 0) {
      if (!fallbacks.has(fallback)) {
        return void packageProblems.set(key, `${key} ships no license file in ${url}; write its license text to graphics-pack/bundled-licenses/${fallback}`)
      }
      notices.push({
        file: `no license file in the package; this text is graphics-pack/bundled-licenses/${fallback} in the BOXBLACK repo`,
        text: readFileSync(join(fallbackDir, fallback), "utf8"),
      })
    } else if (fallbacks.has(fallback)) {
      return void packageProblems.set(key, `graphics-pack/bundled-licenses/${fallback} covers ${key}, whose tarball ships its own license now; delete it`)
    }
    packageSections.set(key, { title: `${pkg.name} ${pkg.version}`, lines: [`inlined into: ${pkg.files.join(", ")}`, `source: ${url}`], notices })
  })
  for (const pkg of packages) {
    const problem = packageProblems.get(`${pkg.name}@${pkg.version}`)
    if (problem) problems.push(problem)
  }

  // 4. libvips' libraries, from the source archive of each at the version it was built with
  const librarySections = new Map<string, Section>()
  const libraryProblems = new Map<string, string[]>()
  // the Rust crates a library's Cargo.lock takes from crates.io, keyed by the library's line
  const lockedBy = new Map<string, LockedCrate[]>()
  const crateSections = new Map<string, Section>()
  const crateUrl = (crate: LockedCrate) => `https://static.crates.io/crates/${crate.name}/${crate.name}-${crate.version}.crate`

  /** Each crate the lock takes from crates.io, its license from that crate's own archive at the locked version. */
  const readCrates = async (line: (typeof builtFrom)[number], lock: string, troubles: string[]): Promise<number> => {
    const library = `${line.names.join(", ")} ${line.version}`
    const crates: LockedCrate[] = []
    for (const crate of lockedCrates(lock)) {
      // no source: one of the library's own crates, whose code and license are the archive itself
      if (!crate.source) continue
      if (crate.source === CRATES_IO) crates.push(crate)
      else troubles.push(`${line.key} ${line.version}: its Cargo.lock takes ${crate.name} ${crate.version} from ${crate.source}, and only a crate from crates.io can have its license fetched here`)
    }
    lockedBy.set(line.key, crates)
    const crateProblems = new Map<string, string>()
    await eachAtMost(crates, 8, async (crate) => {
      const key = `${crate.name}@${crate.version}`
      const url = crateUrl(crate)
      const archive = join(cacheDir, "crates", `${key}.crate`)
      const failed = await download(url, archive, fetchUrl)
      if (failed) return void crateProblems.set(key, `${key}: ${failed}`)
      let entries: string[]
      try {
        entries = tarList(archive)
      } catch (error) {
        rmSync(archive, { force: true })
        return void crateProblems.set(key, `${key}: ${url} is not an archive tar can read (${message(error)})`)
      }
      const licenses = entries.filter((entry) => below(entry).length === 1 && CRATE_LICENSE_FILE.test(below(entry)[0]!))
      const manifest = entries.find((entry) => below(entry).join("/") === "Cargo.toml")
      let texts: Map<string, string>
      try {
        texts = tarRead(archive, manifest ? [...licenses, manifest] : licenses, join(cacheDir, "extract", "crates", key), entries)
      } catch (error) {
        return void crateProblems.set(key, `${key}: ${message(error)}`)
      }
      const notices = licenses.map((entry) => ({ file: below(entry).join("/"), text: texts.get(entry)! }))
      const lines = [`locked by: ${library}'s Cargo.lock`, `source: ${url}`]
      const fallback = fallbackName(crate)
      if (notices.length === 0) {
        const license = `its Cargo.toml: ${(manifest && manifestLicense(texts.get(manifest)!)) ?? "no license given"}`
        if (!fallbacks.has(fallback)) {
          return void crateProblems.set(key, `${key} ships no license file in ${url} (${license}); write its license text to graphics-pack/bundled-licenses/${fallback}`)
        }
        lines.push(license)
        notices.push({
          file: `no license file in the crate; this text is graphics-pack/bundled-licenses/${fallback} in the BOXBLACK repo`,
          text: readFileSync(join(fallbackDir, fallback), "utf8"),
        })
      } else if (fallbacks.has(fallback)) {
        return void crateProblems.set(key, `graphics-pack/bundled-licenses/${fallback} covers ${key}, whose crate ships its own license now; delete it`)
      }
      crateSections.set(key, { title: `${crate.name} ${crate.version}`, lines, notices })
    })
    for (const crate of crates) {
      const problem = crateProblems.get(`${crate.name}@${crate.version}`)
      if (problem) troubles.push(problem)
    }
    return crates.length
  }

  await eachAtMost(builtFrom, 4, async (line) => {
    const label = `${line.key} ${line.version}`
    const troubles: string[] = []
    libraryProblems.set(line.key, troubles)
    const extension = /\.(tar\.gz|tar\.xz|tgz)$/.exec(line.url)?.[0] ?? ".tar"
    const archive = join(cacheDir, "sources", `${line.key}-${line.version}${extension}`)
    const failed = await download(line.url, archive, fetchUrl)
    if (failed) return void troubles.push(`${label}: ${failed}`)
    let entries: string[]
    try {
      entries = tarList(archive)
    } catch (error) {
      rmSync(archive, { force: true })
      return void troubles.push(`${label}: ${line.url} is not an archive tar can read (${message(error)})`)
    }
    const top = entries.filter((entry) => below(entry).length === 1 && LICENSE_FILE.test(below(entry)[0]!))
    // a project that keeps its license only in its sources has it named in the extra column instead
    if (top.length === 0 && line.extras.every((extra) => extra.endsWith("/*") || extra === CARGO_LOCK)) troubles.push(`${label}: ${line.url} has no license file at its top level`)
    const wanted = [...top]
    const openingComments = new Set<string>()
    const crates = new Map<string, string[]>()
    let cargoLock: string | undefined
    for (const extra of line.extras) {
      if (extra === CARGO_LOCK) {
        cargoLock = entries.find((candidate) => below(candidate).join("/") === "Cargo.lock")
        if (!cargoLock) troubles.push(`${label}: ${line.url} has no Cargo.lock at its top level`)
        continue
      }
      if (extra.endsWith("/*")) {
        // vendored dependencies, one folder each (librsvg's Rust crates, until its release tarballs
        // stopped carrying them): every folder's own license files
        const folder = extra.slice(0, -2).split("/")
        for (const entry of entries) {
          const parts = below(entry)
          if (parts.length < folder.length + 2 || parts.slice(0, folder.length).join("/") !== folder.join("/")) continue
          const crate = parts[folder.length]!
          if (!crates.has(crate)) crates.set(crate, [])
          if (parts.length === folder.length + 2 && LICENSE_FILE.test(parts.at(-1)!)) {
            crates.get(crate)!.push(entry)
            wanted.push(entry)
          }
        }
        if (crates.size === 0) troubles.push(`${label}: ${line.url} has nothing under ${extra.slice(0, -1)}`)
        continue
      }
      const entry = entries.find((candidate) => below(candidate).join("/") === extra)
      if (!entry) {
        troubles.push(`${label}: ${line.url} has no ${extra}`)
        continue
      }
      wanted.push(entry)
      if (/\.[ch]$/.test(extra)) openingComments.add(entry)
    }
    if (troubles.length > 0) return
    let texts: Map<string, string>
    try {
      texts = tarRead(archive, cargoLock ? [...wanted, cargoLock] : wanted, join(cacheDir, "extract", line.key), entries)
    } catch (error) {
      return void troubles.push(`${label}: ${message(error)}`)
    }
    const notices: Notice[] = []
    for (const entry of wanted) {
      let text = texts.get(entry)!
      let file = below(entry).join("/")
      if (openingComments.has(entry)) {
        const comment = /^\s*(\/\*[\s\S]*?\*\/)/.exec(text)?.[1]
        if (!comment) {
          troubles.push(`${label}: ${file} in ${line.url} does not open with a comment`)
          continue
        }
        text = comment
        file = `${file} (its opening comment)`
      }
      notices.push({ file, text })
    }
    const bare = [...crates].filter(([, files]) => files.length === 0).map(([crate]) => crate)
    const lines = [`source: ${line.url}`]
    if (crates.size > 0) {
      lines.push(`its archive vendors ${crates.size} dependencies, the ones built into it among them; their own license files follow its own`)
      if (bare.length > 0) lines.push(`vendored with no license file of their own (each one's Cargo.toml in the archive names its license): ${bare.join(", ")}`)
    }
    if (cargoLock) {
      const count = await readCrates(line, texts.get(cargoLock)!, troubles)
      lines.push(`its Cargo.lock takes ${count} crates from crates.io, built into it along with its own code; their licenses are in section 5`)
    }
    librarySections.set(line.key, { title: `${line.names.join(", ")} ${line.version}`, lines, notices })
  })
  for (const line of builtFrom) problems.push(...(libraryProblems.get(line.key) ?? []))
  // the committed texts left unchecked above: once every Cargo.lock is read, each must cover an inlined package or a crate one of them locks
  if (readsCargoLock && builtFrom.every((line) => !line.extras.includes(CARGO_LOCK) || lockedBy.has(line.key))) {
    const locked = new Set([...lockedBy.values()].flat().map((crate) => `${crate.name}@${crate.version}`))
    for (const name of [...fallbacks].sort()) {
      const covers = fallbackCovers(name)
      if (!inlined.has(covers) && !locked.has(covers)) {
        problems.push(`graphics-pack/bundled-licenses/${name} covers ${covers}, which no bundle inlines and no Cargo.lock locks any more; delete it`)
      }
    }
  }
  const rustCrates = builtFrom.flatMap((line) => lockedBy.get(line.key) ?? [])
  downloads.push(...rustCrates.map(crateUrl))
  if (problems.length > 0) return { problems, text: "", downloads }

  // 5. The file itself; a text met before is not repeated, only pointed back to
  const seen = new Map<string, string>()
  const render = (section: Section) => {
    const out = [RULE, section.title, ...section.lines, ""]
    for (const notice of section.notices) {
      out.push(`----- ${notice.file} -----`)
      const earlier = seen.get(notice.text)
      if (earlier) out.push(`(the same text as ${earlier}, above)`, "")
      else {
        seen.set(notice.text, `${section.title}: ${notice.file}`)
        out.push(notice.text.trimEnd(), "")
      }
    }
    return out.join("\n")
  }
  const text = [
    "THIRD-PARTY NOTICES",
    "",
    "Some code in this pack sits inside files that belong to another package, so the license that",
    "came with it is not next to it. This file carries those licenses, each with the exact place the",
    "code was taken from. BOXBLACK's build-graphics-pack.sh writes it while it builds the pack, and",
    "fails the build when anything named below would be left without its license text.",
    "",
    "1. npm packages inlined into bundles",
    "",
    "The files named under each package are bundles whose bundler left a path comment",
    "(node_modules/.bun/<package>@<version>/... or node_modules/.pnpm/...) for the code it inlined.",
    "Each license text is taken from that package's own tarball on the npm registry, at that version.",
    "",
    ...packages.map((pkg) => render(packageSections.get(`${pkg.name}@${pkg.version}`)!)),
    RULE,
    "",
    "2. Packages inlined into hyperframes' own bundles, which carry no path comment",
    "",
    "hyperframes/dist compiles a couple of bundles straight from its own source, so neither carries",
    "the path comments section 1 relies on. MINIFIED_BUNDLES in third-party-notices.mts names each",
    "one by hand; each package's license is its own copy already sitting in node_modules.",
    "",
    ...[...minifiedSections.keys()].sort().map((name) => render(minifiedSections.get(name)!)),
    RULE,
    "",
    "3. Packages that bundle others and carry those licenses themselves",
    "",
    ...Object.entries(selfNoticed).map(([owner, where]) => `- ${owner}: ${where}`),
    "",
    RULE,
    "",
    "4. Libraries built into libvips",
    "",
    `node_modules/@img/sharp-libvips-darwin-arm64 ${libvipsPackage} links these into lib/libvips-cpp.*.dylib. It was`,
    `built by the scripts at https://github.com/lovell/sharp-libvips/tree/v${libvipsPackage} from the source`,
    "archives named below, at the versions its versions.json lists; each license text is taken from",
    "that archive. libvips itself is under LGPL-3.0-or-later: LGPL-3.0.txt and GPL-3.0.txt at the pack's root.",
    "",
    ...builtFrom.map((line) => render(librarySections.get(line.key)!)),
    RULE,
    "",
    "5. Rust crates built into libvips' libraries",
    "",
    "A library in section 4 that is partly written in Rust has the crates it depends on compiled into",
    "libvips-cpp.*.dylib along with it. Its source archive does not carry them, but its Cargo.lock names",
    "each one at the exact version it was built with. Every crate a Cargo.lock takes from crates.io is",
    "here, the ones only that library's tests, benchmarks and tools use among them, since the lock does",
    "not say which those are. Each license text is taken from that crate's own archive on crates.io,",
    "at the locked version.",
    "",
    ...rustCrates.map((crate) => render(crateSections.get(`${crate.name}@${crate.version}`)!)),
  ].join("\n")
  return { problems, text: `${text.trimEnd()}\n`, downloads }
}

if (import.meta.main) {
  const [pack, graphicsPackDir, cacheDir] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
  if (!pack || !graphicsPackDir || !cacheDir) {
    console.error("usage: node third-party-notices.mts <pack dir> <graphics-pack dir> <download cache dir> [--plan]")
    process.exit(2)
  }
  const plan = process.argv.includes("--plan")
  const { problems, text, downloads } = await thirdPartyNotices({ pack, graphicsPackDir, cacheDir, plan })
  if (problems.length > 0) {
    console.error(`build-graphics-pack.sh: the pack's third-party notices would be incomplete:\n- ${problems.join("\n- ")}`)
    process.exit(1)
  }
  if (plan) console.log(downloads.join("\n"))
  else {
    writeFileSync(join(pack, "THIRD-PARTY-NOTICES.txt"), text)
    console.log(`third-party notices OK: licenses from ${downloads.length} archives written to ${join(pack, "THIRD-PARTY-NOTICES.txt")}`)
  }
}
