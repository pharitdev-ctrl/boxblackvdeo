// node mk.mjs <fragment.html> <outDir> <width> <height> <seconds> [fps]
// Wraps a fragment (style + markup + optional script) into one composition the renderer can seek.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
const here = dirname(fileURLToPath(import.meta.url))
const [frag, out, w, h, seconds, fps = "30", times = "[]"] = process.argv.slice(2)
const T = JSON.parse(times)
const vars = T.map((t, i) => `--w${i + 1}: ${t};`).join(" ")
mkdirSync(out, { recursive: true })
copyFileSync(join(process.env.HOME_REAL, "Movies/CapCut/BOXBLACK/fonts/Kanit-ExtraBold.ttf"), join(out, "Kanit-ExtraBold.ttf"))
const host = readFileSync(join(here, "host.js"), "utf8")
const body = readFileSync(frag, "utf8")
writeFileSync(join(out, "index.html"), `<!doctype html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data: 'self'; img-src data: 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'">
    <style>
      @font-face { font-family: "Kanit"; src: url("Kanit-ExtraBold.ttf") format("truetype"); }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: transparent; }
      #stage { ${vars} --ink: #1F2227; --paper: #FFFFFF; --accent: #FFD447; --alt: #6EC1FF; --bar: #FFFFFF; --text: #1F2227; color: var(--text); }
      #root, #stage { position: relative; width: ${w}px; height: ${h}px; font-family: "Kanit", sans-serif; font-synthesis: none; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${seconds}" data-width="${w}" data-height="${h}" data-fps="${fps}">
      <div id="stage" class="clip" data-start="0" data-duration="${seconds}" data-track-index="0">
<script>const T = ${JSON.stringify(T)}</script>
${body}
      </div>
    </div>
    <script>
${host}
    </script>
  </body>
</html>
`)
console.log("wrote", join(out, "index.html"))
