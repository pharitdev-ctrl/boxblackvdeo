import { expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { MINIFIED_BUNDLES, expandSourceUrl, lockedCrates, looksBundled, parseSourceList, readmeLibraries, storePackages, thirdPartyNotices } from "./graphics-pack/third-party-notices.mts"

test("reads name@version from the store paths a bundler leaves in a bundle", () => {
  const bundle = [
    "// ../../node_modules/.bun/@babel+parser@7.29.9/node_modules/@babel/parser/lib/index.js",
    '  "../../node_modules/.bun/entities@7.0.1/node_modules/entities/dist/esm/decode.js"() {',
    "  // ../../node_modules/.bun/bpm-detective@2.0.5/node_modules/bpm-detective/lib/detect.js",
    "//#region node_modules/.pnpm/scule@1.3.0/node_modules/scule/dist/index.mjs",
    // a package installed with peers: bun appends a hash, pnpm the peers
    "// ../../node_modules/.bun/react-dom@19.0.0+b1ab299f0a400331/node_modules/react-dom/index.js",
    "// node_modules/.pnpm/react-dom@18.2.0_react@18.2.0/node_modules/react-dom/index.js",
    "// ../../node_modules/.bun/entities@7.0.1/node_modules/entities/dist/esm/escape.js",
  ].join("\n")
  expect(storePackages(bundle)).toEqual({
    packages: [
      { name: "@babel/parser", version: "7.29.9" },
      { name: "entities", version: "7.0.1" },
      { name: "bpm-detective", version: "2.0.5" },
      { name: "scule", version: "1.3.0" },
      { name: "react-dom", version: "19.0.0" },
      { name: "react-dom", version: "18.2.0" },
    ],
    unreadable: [],
  })
})

test("a store path that does not name its own package's version is not guessed at", () => {
  // a dependency reached through another package's store folder: the folder's version is not its version
  expect(storePackages("// ../../node_modules/.bun/css-select@5.2.2/node_modules/nth-check/lib/index.js")).toEqual({
    packages: [],
    unreadable: ["node_modules/.bun/css-select@5.2.2/node_modules/nth-check"],
  })
})

test("fills a source archive's url from the version libvips was built with", () => {
  expect(expandSourceUrl("https://example.test/expat/R_{v_}/expat-{v}.tar.xz", "2.8.3")).toBe("https://example.test/expat/R_2_8_3/expat-2.8.3.tar.xz")
  expect(expandSourceUrl("https://example.test/freetype/VER-{v-}.tar.gz", "2.14.3")).toBe("https://example.test/freetype/VER-2-14-3.tar.gz")
  expect(expandSourceUrl("https://example.test/glib/{vmm}/glib-{v}.tar.xz", "2.89.4")).toBe("https://example.test/glib/2.89/glib-2.89.4.tar.xz")
})

test("reads the source list and the libraries sharp-libvips' README names", () => {
  expect(parseSourceList("# a comment\n\nvips  libvips,libnsgif  https://example.test/vips-{v}.tar.xz  libvips/foreign/libnsgif/gif.c\npng libpng https://example.test/png-{v}.tar.xz\n")).toEqual([
    { key: "vips", names: ["libvips", "libnsgif"], url: "https://example.test/vips-{v}.tar.xz", extras: ["libvips/foreign/libnsgif/gif.c"] },
    { key: "png", names: ["libpng"], url: "https://example.test/png-{v}.tar.xz", extras: [] },
  ])
  const readme = "## Licensing\n\n| Library       | Used under the terms of |\n|---------------|---|\n| aom           | BSD 2-Clause |\n| libnsgif      | MIT License |\n\nUse of libraries under LGPLv3...\n"
  expect(readmeLibraries(readme)).toEqual(["aom", "libnsgif"])
})

test("a script with no store paths still looks bundled by esbuild's __commonJS literal, or one very long line", () => {
  // minification renames the helper's own variables, but not the object literal it builds
  expect(looksBundled('"use strict";var oe=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var mod=oe((exports)=>{exports.run=()=>1})\n')).toBe(true)
  expect(looksBundled(`var x="${"a".repeat(50_001)}"\n`)).toBe(true)
  expect(looksBundled("module.exports = 1 // an ordinary file, not a bundle\n")).toBe(false)
})

test("MINIFIED_BUNDLES seeds hyperframes' two runtime bundles with the packages they inline", () => {
  expect(MINIFIED_BUNDLES).toEqual({
    "node_modules/hyperframes/dist/hyperframe-runtime.js": ["postcss", "nanoid"],
    "node_modules/hyperframes/dist/hyperframe.runtime.iife.js": ["postcss", "nanoid"],
  })
})

// ---- a small pack on disk, and a fake registry and source hosts serving tarballs made here ----

function write(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function tarball(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const dir = mkdtempSync(join(tmpdir(), "notices-tar-"))
  for (const [path, text] of Object.entries(files)) write(join(dir, "src", path), text)
  const roots = [...new Set(Object.keys(files).map((path) => path.split("/")[0]!))]
  const out = join(dir, "out.tar.gz")
  execFileSync("tar", ["-czf", out, "-C", join(dir, "src"), ...roots], { env: { ...process.env, COPYFILE_DISABLE: "1" } })
  return new Uint8Array(readFileSync(out))
}

// like tarball, but some paths are symlinks (given as path -> target) rather than files -- the way
// glib-2.89.4/COPYING ships as a link to LICENSES/LGPL-2.1-or-later.txt in the real archive
function tarballWithSymlinks(files: Record<string, string>, symlinks: Record<string, string>): Uint8Array<ArrayBuffer> {
  const dir = mkdtempSync(join(tmpdir(), "notices-tar-"))
  for (const [path, text] of Object.entries(files)) write(join(dir, "src", path), text)
  for (const [path, target] of Object.entries(symlinks)) {
    mkdirSync(dirname(join(dir, "src", path)), { recursive: true })
    symlinkSync(target, join(dir, "src", path))
  }
  const roots = [...new Set([...Object.keys(files), ...Object.keys(symlinks)].map((path) => path.split("/")[0]!))]
  const out = join(dir, "out.tar.gz")
  execFileSync("tar", ["-czf", out, "-C", join(dir, "src"), ...roots], { env: { ...process.env, COPYFILE_DISABLE: "1" } })
  return new Uint8Array(readFileSync(out))
}

function serve(archives: Record<string, Uint8Array<ArrayBuffer>>) {
  const urls: string[] = []
  const headers: (HeadersInit | undefined)[] = []
  const fetchUrl = async (url: string, init?: RequestInit) => {
    urls.push(url)
    headers.push(init?.headers)
    const body = archives[url]
    return body ? new Response(body) : new Response("Not Found", { status: 404 })
  }
  return { fetchUrl, urls, headers }
}

const NSGIF_HEADER = "/*\n * Copyright 2004 Richard Wilson <richard.wilson@netsurf-browser.org>\n * Licenced under the MIT License\n */"

function makePack(options: { extraBundle?: string; versions?: Record<string, string>; readme?: string[]; fallbacks?: Record<string, string>; extraSources?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "notices-"))
  const pack = join(root, "pack")
  const graphicsPackDir = join(root, "graphics-pack")
  write(
    join(pack, "node_modules/hyperframes/dist/cli.js"),
    [
      "// ../../node_modules/.bun/@scope+lib@1.2.3/node_modules/@scope/lib/index.js",
      "var lib = 1",
      "// ../../node_modules/.bun/bare@2.0.0/node_modules/bare/index.js",
      "// ../core/dist/index.js",
      options.extraBundle ?? "",
    ].join("\n"),
  )
  write(join(pack, "node_modules/hyperframes/dist/worker.js"), "  // ../../node_modules/.bun/@scope+lib@1.2.3/node_modules/@scope/lib/util.js\n")
  write(join(pack, "node_modules/citty/dist/_chunks/libs/scule.mjs"), "//#region node_modules/.pnpm/scule@1.3.0/node_modules/scule/dist/index.mjs\n")
  write(join(pack, "node_modules/prettier/index.cjs"), "// node_modules/fast-glob/out/index.js\n")
  write(join(pack, "node_modules/prettier/THIRD-PARTY-NOTICES.md"), "# Licenses of bundled dependencies\n")
  write(join(pack, "node_modules/plain/index.js"), "module.exports = 1 // not a bundle\n")
  const libvips = join(pack, "node_modules/@img/sharp-libvips-darwin-arm64")
  write(join(libvips, "package.json"), JSON.stringify({ name: "@img/sharp-libvips-darwin-arm64", version: "1.3.3" }))
  write(join(libvips, "versions.json"), JSON.stringify(options.versions ?? { png: "1.6.58", vips: "8.18.6" }))
  const readme = options.readme ?? ["libnsgif", "libpng", "libvips"]
  write(join(libvips, "README.md"), `| Library | Used under the terms of |\n|---|---|\n${readme.map((name) => `| ${name} | some license |`).join("\n")}\n`)
  write(
    join(graphicsPackDir, "libvips-sources.txt"),
    "# key  README names  source archive  more license files\npng  libpng  https://src.test/libpng-{v}.tar.gz\nvips  libvips,libnsgif  https://src.test/vips-{v}.tar.gz  libvips/foreign/libnsgif/gif.c\n" +
      (options.extraSources ?? ""),
  )
  for (const [name, text] of Object.entries(options.fallbacks ?? { "bare@2.0.0.txt": "ISC License\n\nCopyright (c) Bare Author\n" })) {
    write(join(graphicsPackDir, "bundled-licenses", name), text)
  }
  return { pack, graphicsPackDir, cacheDir: join(root, "cache") }
}

const ARCHIVES = {
  "https://registry.npmjs.org/@scope/lib/-/lib-1.2.3.tgz": tarball({
    "package/package.json": "{}",
    "package/LICENSE": "MIT License\n\nCopyright (c) Scope Lib Authors\n",
    "package/docs/LICENSE-old": "not the license that applies",
  }),
  "https://registry.npmjs.org/bare/-/bare-2.0.0.tgz": tarball({ "package/package.json": "{}", "package/index.js": "" }),
  "https://registry.npmjs.org/scule/-/scule-1.3.0.tgz": tarball({ "package/LICENSE": "MIT License\n\nCopyright (c) Pooya Parsa\n" }),
  "https://src.test/libpng-1.6.58.tar.gz": tarball({ "libpng-1.6.58/LICENSE": "PNG Reference Library License version 2\n", "libpng-1.6.58/png.c": "" }),
  "https://src.test/vips-8.18.6.tar.gz": tarball({
    "vips-8.18.6/LICENSE": "GNU LESSER GENERAL PUBLIC LICENSE\n",
    "vips-8.18.6/libvips/foreign/libnsgif/gif.c": `${NSGIF_HEADER}\n\n#include <stdint.h>\nint gif(void) { return 0; }\n`,
  }),
}

const SELF_NOTICED = { prettier: "node_modules/prettier/THIRD-PARTY-NOTICES.md" }

test("collects the license of every package a bundle inlines and every library built into libvips, with where each came from", async () => {
  const dirs = makePack()
  const hosts = serve(ARCHIVES)
  const { problems, text } = await thirdPartyNotices({ ...dirs, fetchUrl: hosts.fetchUrl, selfNoticed: SELF_NOTICED })
  expect(problems).toEqual([])

  expect(text).toContain(
    "@scope/lib 1.2.3\ninlined into: node_modules/hyperframes/dist/cli.js, node_modules/hyperframes/dist/worker.js\nsource: https://registry.npmjs.org/@scope/lib/-/lib-1.2.3.tgz",
  )
  expect(text).toContain("MIT License\n\nCopyright (c) Scope Lib Authors")
  expect(text).not.toContain("not the license that applies")
  // a package whose tarball has no license file is covered by the text committed for it
  expect(text).toContain("bare 2.0.0\n")
  expect(text).toContain("Copyright (c) Bare Author")
  // a bundle inside a dependency's own files counts too
  expect(text).toContain("scule 1.3.0\ninlined into: node_modules/citty/dist/_chunks/libs/scule.mjs")
  expect(text).toContain("prettier: node_modules/prettier/THIRD-PARTY-NOTICES.md")

  expect(text).toContain("https://github.com/lovell/sharp-libvips/tree/v1.3.3")
  expect(text).toContain("libpng 1.6.58\nsource: https://src.test/libpng-1.6.58.tar.gz")
  expect(text).toContain("PNG Reference Library License version 2")
  expect(text).toContain("libvips, libnsgif 8.18.6\nsource: https://src.test/vips-8.18.6.tar.gz")
  // for a C file only its opening comment is the notice
  expect(text).toContain(NSGIF_HEADER)
  expect(text).not.toContain("#include <stdint.h>")

  // a second build reuses what it downloaded
  const again = serve(ARCHIVES)
  expect((await thirdPartyNotices({ ...dirs, fetchUrl: again.fetchUrl, selfNoticed: SELF_NOTICED })).text).toBe(text)
  expect(again.urls).toEqual([])
})

test("every download carries a browser-shaped User-Agent, since gitlab.freedesktop.org (fontconfig's source) answers 406 to fetch's bare default", async () => {
  const dirs = makePack()
  const hosts = serve(ARCHIVES)
  const { problems } = await thirdPartyNotices({ ...dirs, fetchUrl: hosts.fetchUrl, selfNoticed: SELF_NOTICED })
  expect(problems).toEqual([])
  expect(hosts.headers.length).toBeGreaterThan(0)
  for (const init of hosts.headers) expect(new Headers(init).get("user-agent")).toMatch(/Mozilla/)
})

// a bundle with no path comments at all, the way hyperframes' own runtime bundles look
const FAKE_MINIFIED_BUNDLE = '"use strict";var oe=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var mod=oe((exports)=>{exports.run=()=>1})\n'

test("flags a hyperframes/dist bundle with no path comments unless MINIFIED_BUNDLES covers it, then takes its packages' licenses from node_modules", async () => {
  const dirs = makePack()
  write(join(dirs.pack, "node_modules/hyperframes/dist/hyperframe-runtime.js"), FAKE_MINIFIED_BUNDLE)
  const hosts = serve(ARCHIVES)

  // not listed anywhere yet: flagged instead of silently skipped, and nothing is downloaded
  const unlisted = await thirdPartyNotices({ ...dirs, fetchUrl: hosts.fetchUrl, selfNoticed: SELF_NOTICED, minifiedBundles: {} })
  expect(unlisted.problems).toEqual([
    "node_modules/hyperframes/dist/hyperframe-runtime.js looks like an esbuild bundle (its __commonJS helper, or a single very long line) with no path comments saying what it inlines; add it to MINIFIED_BUNDLES in graphics-pack/third-party-notices.mts",
  ])
  expect(hosts.urls).toEqual([])

  // covered by MINIFIED_BUNDLES: its packages' licenses come from their own copies in node_modules
  write(join(dirs.pack, "node_modules/tinypkg/package.json"), JSON.stringify({ name: "tinypkg", version: "1.0.0" }))
  write(join(dirs.pack, "node_modules/tinypkg/LICENSE"), "MIT License\n\nCopyright (c) Tiny Pkg Author\n")
  const covered = await thirdPartyNotices({
    ...dirs,
    fetchUrl: hosts.fetchUrl,
    selfNoticed: SELF_NOTICED,
    minifiedBundles: { "node_modules/hyperframes/dist/hyperframe-runtime.js": ["tinypkg"] },
  })
  expect(covered.problems).toEqual([])
  expect(covered.text).toContain("2. Packages inlined into hyperframes' own bundles")
  expect(covered.text).toContain("tinypkg 1.0.0\ninlined into: node_modules/hyperframes/dist/hyperframe-runtime.js")
  expect(covered.text).toContain("MIT License\n\nCopyright (c) Tiny Pkg Author")
  // a local node_modules copy, so no download for it -- unlike the rest of the pack's own packages
  expect(hosts.urls.some((url) => url.includes("tinypkg"))).toBe(false)
})

test("a hyperframes/dist bundle whose path comments say what it inlines is not flagged, and is read as usual", async () => {
  // cli.js carries esbuild's __commonJS helper too
  const dirs = makePack({ extraBundle: FAKE_MINIFIED_BUNDLE })
  const hosts = serve(ARCHIVES)
  const { problems, text } = await thirdPartyNotices({ ...dirs, fetchUrl: hosts.fetchUrl, selfNoticed: SELF_NOTICED, minifiedBundles: {} })
  expect(problems).toEqual([])
  expect(text).toContain("@scope/lib 1.2.3\ninlined into: node_modules/hyperframes/dist/cli.js")
})

test("a bundle outside hyperframes/dist with no path comments is not flagged: MINIFIED_BUNDLES is for hyperframes' own runtime only", async () => {
  const dirs = makePack()
  write(join(dirs.pack, "node_modules/tinypkg/dist/index.js"), FAKE_MINIFIED_BUNDLE)
  const hosts = serve(ARCHIVES)
  const { problems } = await thirdPartyNotices({ ...dirs, fetchUrl: hosts.fetchUrl, selfNoticed: SELF_NOTICED, minifiedBundles: {} })
  expect(problems).toEqual([])
})

test("refuses a MINIFIED_BUNDLES entry whose package is missing from node_modules, or ships no license file", async () => {
  const dirs = makePack()
  write(join(dirs.pack, "node_modules/hyperframes/dist/hyperframe-runtime.js"), FAKE_MINIFIED_BUNDLE)
  write(join(dirs.pack, "node_modules/nolicense/package.json"), JSON.stringify({ name: "nolicense", version: "2.0.0" }))
  const hosts = serve(ARCHIVES)
  const { problems } = await thirdPartyNotices({
    ...dirs,
    fetchUrl: hosts.fetchUrl,
    selfNoticed: SELF_NOTICED,
    minifiedBundles: { "node_modules/hyperframes/dist/hyperframe-runtime.js": ["ghost", "nolicense"] },
  })
  expect(problems).toEqual([
    "MINIFIED_BUNDLES says node_modules/hyperframes/dist/hyperframe-runtime.js inlines ghost, which is not in node_modules; check the package name",
    "MINIFIED_BUNDLES says node_modules/hyperframes/dist/hyperframe-runtime.js inlines nolicense, but node_modules/nolicense ships no license file",
  ])
  expect(hosts.urls).toEqual([])
})

test("refuses a pack when a bundle names a package no license text covers, before downloading anything", async () => {
  const dirs = makePack({
    extraBundle: "// ../../node_modules/.bun/css-select@5.2.2/node_modules/nth-check/lib/index.js",
    versions: { png: "1.6.58", vips: "8.18.6", webp: "1.6.0" },
    readme: ["libnsgif", "libpng", "libvips", "libwebp"],
    fallbacks: { "bare@2.0.0.txt": "ISC", "gone@1.0.0.txt": "ISC" },
  })
  write(join(dirs.pack, "node_modules/newbundler/index.js"), "// node_modules/left-pad/index.js\n")
  const hosts = serve(ARCHIVES)
  const { problems } = await thirdPartyNotices({ ...dirs, fetchUrl: hosts.fetchUrl, selfNoticed: SELF_NOTICED })
  expect(problems).toEqual([
    "node_modules/hyperframes/dist/cli.js inlines node_modules/.bun/css-select@5.2.2/node_modules/nth-check, which names no version of nth-check to take its license from",
    "node_modules/newbundler bundles packages from a plain node_modules (no versions in its paths); check it carries their licenses and add it to SELF_NOTICED in graphics-pack/third-party-notices.mts",
    "graphics-pack/bundled-licenses/gone@1.0.0.txt covers gone@1.0.0, which no bundle inlines any more; delete it",
    "libvips was built with webp 1.6.0, which graphics-pack/libvips-sources.txt has no line for",
    "sharp-libvips' README.md names libwebp, which no line of graphics-pack/libvips-sources.txt claims",
  ])
  expect(hosts.urls).toEqual([])
})

test("refuses a pack when a license cannot be found where it should be", async () => {
  const dirs = makePack({ fallbacks: {} })
  const archives: Record<string, Uint8Array<ArrayBuffer>> = { ...ARCHIVES, "https://src.test/libpng-1.6.58.tar.gz": tarball({ "libpng-1.6.58/png.c": "" }) }
  delete archives["https://src.test/vips-8.18.6.tar.gz"]
  const { problems } = await thirdPartyNotices({ ...dirs, fetchUrl: serve(archives).fetchUrl, selfNoticed: SELF_NOTICED })
  expect(problems).toEqual([
    "bare@2.0.0 ships no license file in https://registry.npmjs.org/bare/-/bare-2.0.0.tgz; write its license text to graphics-pack/bundled-licenses/bare@2.0.0.txt",
    "png 1.6.58: https://src.test/libpng-1.6.58.tar.gz has no license file at its top level",
    "vips 8.18.6: could not download https://src.test/vips-8.18.6.tar.gz: it answered 404",
  ])
})

test("takes the license files of every dependency an archive vendors, and names the ones that have none", async () => {
  const dirs = makePack({
    versions: { png: "1.6.58", vips: "8.18.6", rsvg: "2.62.91" },
    readme: ["libnsgif", "libpng", "librsvg", "libvips"],
    extraSources: "rsvg  librsvg  https://src.test/librsvg-{v}.tar.xz  vendor/*\n",
  })
  const archives = {
    ...ARCHIVES,
    "https://src.test/librsvg-2.62.91.tar.xz": tarball({
      "librsvg-2.62.91/COPYING.LIB": "GNU LIBRARY GENERAL PUBLIC LICENSE\n",
      "librsvg-2.62.91/vendor/cairo-rs/Cargo.toml": "",
      "librsvg-2.62.91/vendor/cairo-rs/LICENSE": "MIT License\n\nCopyright (c) The gtk-rs Project Developers\n",
      "librsvg-2.62.91/vendor/libc/LICENSE-APACHE": "Apache License, Version 2.0 (libc)\n",
      "librsvg-2.62.91/vendor/libc/src/unix/LICENSE-notes": "not a crate's license",
      "librsvg-2.62.91/vendor/unlicensed/Cargo.toml": "",
    }),
  }
  const { problems, text } = await thirdPartyNotices({ ...dirs, fetchUrl: serve(archives).fetchUrl, selfNoticed: SELF_NOTICED })
  expect(problems).toEqual([])
  expect(text).toContain("librsvg 2.62.91\nsource: https://src.test/librsvg-2.62.91.tar.xz\nits archive vendors 3 dependencies")
  expect(text).toContain("vendored with no license file of their own (each one's Cargo.toml in the archive names its license): unlicensed")
  expect(text).toContain("----- COPYING.LIB -----\nGNU LIBRARY GENERAL PUBLIC LICENSE")
  expect(text).toContain("----- vendor/cairo-rs/LICENSE -----\nMIT License\n\nCopyright (c) The gtk-rs Project Developers")
  expect(text).toContain("----- vendor/libc/LICENSE-APACHE -----")
  expect(text).not.toContain("not a crate's license")
})

// ---- librsvg as its release tarball now ships it: no vendor/, only a Cargo.lock naming its Rust crates ----

const CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index"

function lockEntry(name: string, version: string, source?: string): string {
  return ["[[package]]", `name = "${name}"`, `version = "${version}"`, ...(source ? [`source = "${source}"`, 'checksum = "0123abcd"'] : []), "dependencies = [", ' "libc",', "]", ""].join("\n")
}

function librsvgWithLock(...packages: string[]): Uint8Array<ArrayBuffer> {
  return tarball({
    "librsvg-2.62.91/COPYING.LIB": "GNU LIBRARY GENERAL PUBLIC LICENSE\n",
    "librsvg-2.62.91/Cargo.lock": ["# This file is automatically @generated by Cargo.", "version = 4", "", ...packages].join("\n"),
    "librsvg-2.62.91/rsvg/Cargo.toml": '[package]\nname = "rsvg"\n',
  })
}

function crateUrl(name: string, version: string): string {
  return `https://static.crates.io/crates/${name}/${name}-${version}.crate`
}

function manifest(name: string, version: string, license: string): string {
  return `[package]\nedition = "2021"\nname = "${name}"\nversion = "${version}"\n${license}\n\n[dependencies.libc]\nversion = "0.2"\nlicense = "not this table's"\n`
}

const CRATE_ARCHIVES = {
  [crateUrl("cairo-rs", "0.20.12")]: tarball({
    "cairo-rs-0.20.12/Cargo.toml": manifest("cairo-rs", "0.20.12", 'license = "MIT"'),
    "cairo-rs-0.20.12/LICENSE": "MIT License\n\nCopyright (c) The gtk-rs Project Developers\n",
    "cairo-rs-0.20.12/src/LICENSE-notes": "not a crate's license",
  }),
  // a license file that is a symlink to a text elsewhere in the crate
  [crateUrl("libc", "0.2.175")]: tarballWithSymlinks(
    {
      "libc-0.2.175/Cargo.toml": manifest("libc", "0.2.175", 'license = "MIT OR Apache-2.0"'),
      "libc-0.2.175/LICENSE-APACHE": "Apache License, Version 2.0 (libc)\n",
      "libc-0.2.175/licenses/MIT.txt": "MIT License (libc)\n\nCopyright (c) The Rust Project Developers\n",
    },
    { "libc-0.2.175/LICENSE-MIT": "licenses/MIT.txt" },
  ),
  [crateUrl("memchr", "2.7.4")]: tarball({
    "memchr-2.7.4/Cargo.toml": manifest("memchr", "2.7.4", 'license = "Unlicense OR MIT"'),
    "memchr-2.7.4/UNLICENSE": "This is free and unencumbered software released into the public domain.\n",
    "memchr-2.7.4/COPYING": "This project is dual-licensed under the Unlicense and MIT licenses.\n",
  }),
  [crateUrl("unlicensed", "1.0.0")]: tarball({
    "unlicensed-1.0.0/Cargo.toml": manifest("unlicensed", "1.0.0", 'license = "MIT OR Apache-2.0"'),
    "unlicensed-1.0.0/src/lib.rs": "",
  }),
}

// the workspace's own crates, librsvg and rsvg, have no source: they are the archive itself
const RSVG_LOCK_PACKAGES = [
  lockEntry("cairo-rs", "0.20.12", CRATES_IO),
  lockEntry("libc", "0.2.175", CRATES_IO),
  lockEntry("librsvg", "2.62.91"),
  lockEntry("memchr", "2.7.4", CRATES_IO),
  lockEntry("rsvg", "2.62.91"),
  lockEntry("unlicensed", "1.0.0", CRATES_IO),
]

function makeRsvgPack(fallbacks: Record<string, string>) {
  return makePack({
    versions: { png: "1.6.58", vips: "8.18.6", rsvg: "2.62.91" },
    readme: ["libnsgif", "libpng", "librsvg", "libvips"],
    extraSources: "rsvg  librsvg  https://src.test/librsvg-{v}.tar.xz  cargo-lock\n",
    fallbacks: { "bare@2.0.0.txt": "ISC License\n\nCopyright (c) Bare Author\n", ...fallbacks },
  })
}

test("reads every package a Cargo.lock locks, with where Cargo takes it from", () => {
  const lock = ["version = 4", "", lockEntry("adler2", "2.0.1", CRATES_IO), lockEntry("librsvg", "2.62.91"), "[metadata]", '"checksum x" = "y"', ""].join("\n")
  expect(lockedCrates(lock)).toEqual([
    { name: "adler2", version: "2.0.1", source: CRATES_IO },
    { name: "librsvg", version: "2.62.91" },
  ])
})

test("takes the license files of every crate a library's Cargo.lock takes from crates.io, from each crate's own archive, and skips the library's own crates", async () => {
  const dirs = makeRsvgPack({ "unlicensed@1.0.0.txt": "MIT License\n\nCopyright (c) 2020 Unlicensed Author\n" })
  const archives = { ...ARCHIVES, ...CRATE_ARCHIVES, "https://src.test/librsvg-2.62.91.tar.xz": librsvgWithLock(...RSVG_LOCK_PACKAGES) }
  const hosts = serve(archives)
  const { problems, text } = await thirdPartyNotices({ ...dirs, fetchUrl: hosts.fetchUrl, selfNoticed: SELF_NOTICED })
  expect(problems).toEqual([])

  expect(text).toContain("librsvg 2.62.91\nsource: https://src.test/librsvg-2.62.91.tar.xz\nits Cargo.lock takes 4 crates from crates.io")
  expect(text).toContain("----- COPYING.LIB -----\nGNU LIBRARY GENERAL PUBLIC LICENSE")
  expect(text).toContain("5. Rust crates built into libvips' libraries")
  expect(text).toContain(`cairo-rs 0.20.12\nlocked by: librsvg 2.62.91's Cargo.lock\nsource: ${crateUrl("cairo-rs", "0.20.12")}\n`)
  expect(text).toContain("----- LICENSE -----\nMIT License\n\nCopyright (c) The gtk-rs Project Developers")
  expect(text).not.toContain("not a crate's license")
  expect(text).toContain("----- LICENSE-APACHE -----\nApache License, Version 2.0 (libc)")
  // the symlink is followed, and the text filed under its own name
  expect(text).toContain("----- LICENSE-MIT -----\nMIT License (libc)")
  expect(text).toContain("----- UNLICENSE -----\nThis is free and unencumbered software")
  expect(text).toContain("----- COPYING -----\nThis project is dual-licensed")
  // no license file in the crate, but a text committed for it: its Cargo.toml's license is named with it
  expect(text).toContain(`unlicensed 1.0.0\nlocked by: librsvg 2.62.91's Cargo.lock\nsource: ${crateUrl("unlicensed", "1.0.0")}\nits Cargo.toml: license = "MIT OR Apache-2.0"\n`)
  expect(text).toContain("Copyright (c) 2020 Unlicensed Author")

  // the library's own crates are the archive itself, not downloads
  expect(hosts.urls.filter((url) => url.startsWith("https://static.crates.io/")).sort()).toEqual(Object.keys(CRATE_ARCHIVES).sort())
  expect(text).not.toContain("rsvg 2.62.91\nlocked by")

  // a second build reuses the crates it downloaded
  const again = serve(archives)
  expect((await thirdPartyNotices({ ...dirs, fetchUrl: again.fetchUrl, selfNoticed: SELF_NOTICED })).text).toBe(text)
  expect(again.urls).toEqual([])
})

test("refuses a crate with no license file that no committed text covers, and a committed text a crate no longer needs", async () => {
  const dirs = makeRsvgPack({ "memchr@2.7.4.txt": "MIT", "gone@1.0.0.txt": "ISC" })
  const archives: Record<string, Uint8Array<ArrayBuffer>> = {
    ...ARCHIVES,
    ...CRATE_ARCHIVES,
    "https://src.test/librsvg-2.62.91.tar.xz": librsvgWithLock(...RSVG_LOCK_PACKAGES, lockEntry("forked", "0.1.0", "git+https://example.test/forked?rev=abc#abc")),
  }
  delete archives[crateUrl("cairo-rs", "0.20.12")]
  const { problems } = await thirdPartyNotices({ ...dirs, fetchUrl: serve(archives).fetchUrl, selfNoticed: SELF_NOTICED })
  expect(problems).toEqual([
    "rsvg 2.62.91: its Cargo.lock takes forked 0.1.0 from git+https://example.test/forked?rev=abc#abc, and only a crate from crates.io can have its license fetched here",
    `cairo-rs@0.20.12: could not download ${crateUrl("cairo-rs", "0.20.12")}: it answered 404`,
    "graphics-pack/bundled-licenses/memchr@2.7.4.txt covers memchr@2.7.4, whose crate ships its own license now; delete it",
    `unlicensed@1.0.0 ships no license file in ${crateUrl("unlicensed", "1.0.0")} (its Cargo.toml: license = "MIT OR Apache-2.0"); write its license text to graphics-pack/bundled-licenses/unlicensed@1.0.0.txt`,
    "graphics-pack/bundled-licenses/gone@1.0.0.txt covers gone@1.0.0, which no bundle inlines and no Cargo.lock locks any more; delete it",
  ])
})

test("refuses a library marked cargo-lock whose archive has no Cargo.lock, without calling a crate's committed text stale for want of the lock", async () => {
  const dirs = makeRsvgPack({ "unlicensed@1.0.0.txt": "MIT" })
  const archives = { ...ARCHIVES, "https://src.test/librsvg-2.62.91.tar.xz": tarball({ "librsvg-2.62.91/COPYING.LIB": "GNU LIBRARY GENERAL PUBLIC LICENSE\n" }) }
  const { problems } = await thirdPartyNotices({ ...dirs, fetchUrl: serve(archives).fetchUrl, selfNoticed: SELF_NOTICED })
  expect(problems).toEqual(["rsvg 2.62.91: https://src.test/librsvg-2.62.91.tar.xz has no Cargo.lock at its top level"])
})

test("a top-level license entry that is a symlink is followed to the file it names, the way glib's COPYING points into LICENSES/", async () => {
  const dirs = makePack()
  const archives = {
    ...ARCHIVES,
    "https://src.test/vips-8.18.6.tar.gz": tarballWithSymlinks(
      {
        "vips-8.18.6/LICENSES/LGPL-2.1-or-later.txt": "GNU LESSER GENERAL PUBLIC LICENSE\n",
        "vips-8.18.6/libvips/foreign/libnsgif/gif.c": `${NSGIF_HEADER}\n\n#include <stdint.h>\nint gif(void) { return 0; }\n`,
      },
      { "vips-8.18.6/COPYING": "LICENSES/LGPL-2.1-or-later.txt" },
    ),
  }
  const { problems, text } = await thirdPartyNotices({ ...dirs, fetchUrl: serve(archives).fetchUrl, selfNoticed: SELF_NOTICED })
  expect(problems).toEqual([])
  // the notice is filed under the symlink's own name, COPYING, since that's what the top-level scan found
  expect(text).toContain("----- COPYING -----\nGNU LESSER GENERAL PUBLIC LICENSE")
})

test("refuses a symlinked license entry whose target escapes the archive, or names nothing tar listed", async () => {
  const dirs = makePack()
  const archives = {
    ...ARCHIVES,
    "https://src.test/vips-8.18.6.tar.gz": tarballWithSymlinks(
      { "vips-8.18.6/libvips/foreign/libnsgif/gif.c": `${NSGIF_HEADER}\n\n#include <stdint.h>\nint gif(void) { return 0; }\n` },
      { "vips-8.18.6/COPYING": "../../../etc/passwd" },
    ),
  }
  const { problems } = await thirdPartyNotices({ ...dirs, fetchUrl: serve(archives).fetchUrl, selfNoticed: SELF_NOTICED })
  expect(problems).toEqual(['vips 8.18.6: vips-8.18.6/COPYING is a symlink to "../../../etc/passwd", which points outside the archive or names no entry tar listed'])
})

test("refuses a source list or SELF_NOTICED entry the pack no longer matches", async () => {
  const dirs = makePack({ versions: { vips: "8.18.6" }, readme: ["libnsgif", "libvips"] })
  const hosts = serve(ARCHIVES)
  const { problems } = await thirdPartyNotices({
    ...dirs,
    fetchUrl: hosts.fetchUrl,
    selfNoticed: { prettier: "node_modules/prettier/NOTICES.md", "old-bundler": "node_modules/old-bundler/LICENSE" },
  })
  expect(problems).toEqual([
    "SELF_NOTICED says prettier carries its bundled licenses in node_modules/prettier/NOTICES.md, which is not in the pack",
    "SELF_NOTICED lists old-bundler, which no longer bundles from a plain node_modules; remove it",
    "graphics-pack/libvips-sources.txt has a line for png, which libvips was not built with; remove it",
    "graphics-pack/libvips-sources.txt claims libpng for png, which sharp-libvips' README.md does not name",
  ])
  expect(hosts.urls).toEqual([])
})

test("the committed source list covers the libraries sharp-libvips 1.3.3 lists", () => {
  // the list as it stood when the pack was last built (versions.json and README.md of @img/sharp-libvips-darwin-arm64 1.3.3)
  const keys = ["aom", "archive", "cairo", "cgif", "exif", "expat", "ffi", "fontconfig", "freetype", "fribidi", "glib", "harfbuzz", "heif", "highway", "imagequant", "lcms", "mozjpeg", "pango", "pixman", "png", "proxy-libintl", "rsvg", "tiff", "uhdr", "vips", "webp", "xml2", "zlib-ng"]
  const readme = ["aom", "cairo", "cgif", "expat", "fontconfig", "freetype", "fribidi", "glib", "harfbuzz", "highway", "lcms", "libarchive", "libexif", "libffi", "libheif", "libimagequant", "libnsgif", "libpng", "librsvg", "libtiff", "libultrahdr", "libvips", "libwebp", "libxml2", "mozjpeg", "pango", "pixman", "proxy-libintl", "zlib-ng"]
  const lines = parseSourceList(readFileSync(join(import.meta.dirname, "graphics-pack/libvips-sources.txt"), "utf8"))
  expect(lines.map((line) => line.key).sort()).toEqual(keys)
  expect(lines.flatMap((line) => line.names).sort()).toEqual(readme)
  for (const line of lines) expect(expandSourceUrl(line.url, "1.2.3")).toMatch(/^https:\/\/[^{}]+\.(tar\.gz|tar\.xz|tgz)$/)
  // librsvg's release tarball stopped vendoring its Rust crates; only its Cargo.lock says which it builds in
  expect(lines.find((line) => line.key === "rsvg")!.extras).toEqual(["cargo-lock"])
})

test("every license text committed for a bundled package or Rust crate is named for the exact version it covers", () => {
  // a crate's name may hold an underscore (malloc_buf)
  for (const name of readdirSync(join(import.meta.dirname, "graphics-pack/bundled-licenses"))) {
    expect(name).toMatch(/^(@[a-z0-9-]+\+)?[a-z0-9._-]+@\d+\.\d+\.\d+\.txt$/)
  }
})

test("the pack build writes the notices before it renders, and the pack's notice points to them", () => {
  const script = readFileSync(join(import.meta.dirname, "build-graphics-pack.sh"), "utf8")
  const notices = script.indexOf('"$GRAPHICS_PACK_DIR/third-party-notices.mts" "$PACK" "$GRAPHICS_PACK_DIR"')
  expect(notices).toBeGreaterThan(script.indexOf("# 2.5."))
  expect(notices).toBeLessThan(script.indexOf("# 3."))
  const notice = script.slice(script.indexOf("# 5."), script.indexOf("# 6."))
  expect(notice).toContain("THIRD-PARTY-NOTICES.txt")
  expect(notice).toContain("https://github.com/lovell/sharp-libvips/tree/v$LIBVIPS_PACKAGE_VERSION")
})
