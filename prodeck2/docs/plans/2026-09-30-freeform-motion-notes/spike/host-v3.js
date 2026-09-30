/* Spike host: drives every CSS animation and Web Animation on the page by time, so the renderer can draw any
   frame in any order. A fragment may also set window.frame = (t) => { ... } for things it computes per frame. */
;(function () {
  const root = document.getElementById("root")
  const D = Number(root.getAttribute("data-duration"))
  let now = 0
  const draw = (t) => {
    now = Math.max(0, Math.min(D, Number(t) || 0))
    for (const a of document.getAnimations()) {
      try { a.pause(); a.currentTime = now * 1000 } catch (e) { console.warn("host: an animation could not be set: " + e.message) }
    }
    if (typeof window.frame === "function") {
      try { window.frame(now) } catch (e) { report("window.frame threw: " + (e && e.message ? e.message : String(e))) }
    }
  }
  const told = new Set()
  const report = (message) => {
    if (told.has(message)) return
    told.add(message)
    console.error("BOXBLACK motion error: " + message)
  }
  const tl = {
    duration: () => D,
    totalDuration: () => D,
    time: () => now,
    totalTime(t) { if (t === undefined) return now; draw(t); return tl },
    seek(t) { draw(t); return tl },
    progress(p) { if (p === undefined) return D > 0 ? now / D : 0; draw(p * D); return tl },
    pause() { for (const a of document.getAnimations()) a.pause(); return tl },
    play() { return tl },
  }
  const fonts = Promise.all(Array.from(document.fonts, (f) => f.load().catch(() => console.warn("host: font " + f.family + " did not load")))).then(() => document.fonts.ready)
  const pictures = Promise.all(Array.from(document.images, (img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())))
  // an SVG element that has a transform attribute and an animation of its transform: the animation replaces the
  // attribute for as long as it applies, so what the attribute placed jumps to the corner of the drawing
  const naming = (el) => "<" + el.tagName.toLowerCase() + (el.getAttribute("class") ? ' class="' + el.getAttribute("class") + '"' : "") + ">"
  const checkTransforms = () => {
    for (const a of document.getAnimations()) {
      try {
        const el = a.effect && a.effect.target
        if (!el || typeof SVGElement === "undefined" || !(el instanceof SVGElement) || !el.hasAttribute("transform")) continue
        if (a.effect.composite && a.effect.composite !== "replace") continue
        if (a.effect.getKeyframes().some((k) => k.transform !== undefined && k.transform !== null)) {
          report(naming(el) + " has a transform attribute and an animation of its transform: the animation replaces the attribute, so the element jumps to the corner of the drawing. Keep the attribute on an outer <g> and animate an inner <g>")
        }
      } catch (e) { /* an effect that cannot be read is not checked */ }
    }
  }
  const ready = Promise.all([fonts, pictures]).then(() => {
    checkTransforms()
    draw(0)
    window.__timelines = window.__timelines || {}
    window.__timelines["main"] = tl
  })
  window.__hf = window.__hf || {}
  window.__hf.buildReady = window.__hf.buildReady || {}
  window.__hf.buildReady.host = ready
})()
