/*
 * BOXBLACK motion host: gives HyperFrames a timeline it can seek for a graphic Claude wrote as CSS animations, Web
 * Animations, or a window.frame function. Any time can be drawn in any order: every animation on the page
 * (document.getAnimations(): the CSS animations and the ones el.animate() made) is paused and set to that time, and
 * window.frame(t) is called if the fragment set one. It uses no animation library.
 *
 * What HyperFrames 0.8.65 asks of window.__timelines["main"], read from the runtime it injects into the page. An
 * upgrade can change this.
 * - The render waits for window.__timelines[<the root's data-composition-id>] to exist before it captures
 *   anything: 20 s, since the app renders with --player-ready-timeout 20000. The runtime binds that entry once
 *   every promise in window.__hf.buildReady has settled; a lone registered entry with play() and pause() is its
 *   fallback.
 * - duration() is the composition's length in seconds. It must be longer than a frame, and one half a second or
 *   more shorter than data-duration gets padded through to(), which this timeline leaves out on purpose.
 * - pause() comes before every seek; without it the runtime reports timeline_missing_pause. play() is called in
 *   the preview, where the runtime's own clock still drives time through seeks.
 * - totalTime(t, suppressEvents) draws frame t (t, then t + 0.001, then t again), clamped to totalDuration();
 *   seek(t) stands in when there is no totalTime.
 * - progress(p) and timeScale(rate) are called when it binds if they exist, and time() feeds the player's clock.
 *   getChildren() is used only for nested compositions and GSAP's own repairs, so this timeline has none.
 *
 * The length is data-duration on the page's root. The timeline is registered, drawn at time 0, only once the
 * fonts are loaded and the pictures decoded, so that the first frame is not drawn in a fallback font; those 20 s
 * are what that wait has.
 *
 * An error thrown by window.frame is caught and reported once per distinct message through console.error with the
 * prefix "BOXBLACK motion error: ", so that the renderer's output carries it and the timeline still registers.
 * Before the first draw the host reports, the same way, each SVG element that has a transform attribute and an
 * animation of its transform, since the animation replaces the attribute and the element jumps to the corner of
 * the drawing. It reports too each element with two animations of one property where the later one, in the order
 * the page composites them, starts later and fills backwards (its fill is backwards or both), and that fill changes
 * what shows: until it starts its first frame shows over the earlier one, which never shows, so an exit that fills
 * both ways hides the entrance and the element is there from time 0. The keyframes cannot tell that exit from one
 * whose first frame is the value underneath, which hides nothing (Chrome lists a first keyframe for it all the
 * same), so it is measured: every animation is set to two times while the earlier one runs and before the later one
 * starts, a tenth of the way in and halfway, and at each the computed style is read with the later one's fill as it
 * is and set to forwards; a pair that reads differently at either is reported. The fill and the times are put back
 * before the first draw. A later animation that adds to what is there hides nothing. A report
 * names the element by its tag and class, and an animation by its name (one el.animate() made by its id, when it
 * has one). Elements with the same tag and class share one report. An effect or a style that cannot be read is not
 * checked.
 *
 * HyperFrames drops any inline script that names its runtime's file or globals, taking this whole host with it, so
 * this file must never mention them (graphics-host.test.ts checks it).
 */
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
  // two animations of one property on one element (or one pseudo-element of it), where the later one in the order
  // document.getAnimations() lists them, which is the order they are composited in, starts later and fills
  // backwards: until it starts, its first frame can cover the earlier one, so that an exit that fills both ways shows
  // the element from time 0 and its entrance never shows. The keyframes say which pairs can (the delay getTiming()
  // gives is the one worked out, calc() and all, and one that adds to what is there covers nothing), but not whether
  // the later one has a first frame of its own: Chrome lists one for an animation that starts from the value
  // underneath, which covers nothing. So each such pair is measured, and reported by the property that reads
  // differently when the later one's fill is forwards.
  const notAnimated = new Set(["offset", "computedOffset", "easing", "composite"])
  const called = (a) => (typeof a.animationName === "string" ? a.animationName : a.id ? a.id : "an el.animate() animation")
  // every animation set to two times while the earlier one runs, before the later one starts: a tenth of the way
  // and halfway from the earlier one's start to whichever comes first of its end and the later one's start. The
  // first catches an entrance that is done by halfway, the second one that starts where the later one does, like a
  // pulse. At each the shared properties are read with the later one's fill as it is and then forwards, and its fill
  // is put back whatever happens. More times can only find more that the fill really changes, never less.
  const covered = (animations, earlier, later, shared) => {
    const until = Math.min(earlier.end, later.delay)
    const read = () => {
      const style = getComputedStyle(later.target, later.pseudo || null)
      return shared.map((p) => String(p.startsWith("--") ? style.getPropertyValue(p) : style[p]))
    }
    for (const part of [10, 2]) {
      const at = earlier.delay + (until - earlier.delay) / part
      if (!Number.isFinite(at)) return undefined
      for (const a of animations) {
        try { a.pause(); a.currentTime = at } catch (e) { /* the draw warns of an animation that refuses a time */ }
      }
      const shown = read()
      let forwards
      try {
        later.effect.updateTiming({ fill: "forwards" })
        forwards = read()
      } finally {
        later.effect.updateTiming({ fill: later.fill })
      }
      const differs = shared.find((p, i) => shown[i] !== forwards[i])
      if (differs !== undefined) return differs
    }
    return undefined
  }
  const checkFills = () => {
    const animations = Array.from(document.getAnimations())
    const byElement = new Map()
    for (const a of animations) {
      try {
        const el = a.effect && a.effect.target
        if (!el) continue
        const timing = a.effect.getTiming()
        const delay = Number(timing.delay) || 0
        const animates = []
        for (const k of a.effect.getKeyframes()) {
          for (const p of Object.keys(k)) if (!notAnimated.has(p) && k[p] !== undefined && k[p] !== null && !animates.includes(p)) animates.push(p)
        }
        const one = { effect: a.effect, target: el, pseudo: a.effect.pseudoElement || "", delay, end: delay + Number(a.effect.getComputedTiming().activeDuration), fill: timing.fill, adds: Boolean(a.effect.composite && a.effect.composite !== "replace"), animates, name: called(a), css: typeof a.animationName === "string" }
        if (!byElement.has(el)) byElement.set(el, { naming: naming(el), list: [] })
        byElement.get(el).list.push(one)
      } catch (e) { /* an effect that cannot be read is not checked */ }
    }
    // the later animations that can cover an earlier one, each with the earlier ones it can cover, element by element
    const candidates = []
    for (const { naming: named, list } of byElement.values()) {
      list.forEach((later, j) => {
        if (later.adds || (later.fill !== "backwards" && later.fill !== "both")) return
        const pairs = []
        for (const earlier of list.slice(0, j)) {
          if (earlier.pseudo !== later.pseudo || !(later.delay > earlier.delay)) continue
          const shared = later.animates.filter((p) => earlier.animates.includes(p))
          if (shared.length > 0) pairs.push({ earlier, shared })
        }
        if (pairs.length > 0) candidates.push({ named, later, pairs })
      })
    }
    if (candidates.length === 0) return
    const times = animations.map((a) => { try { return a.currentTime } catch (e) { return null } })
    try {
      for (const { named, later, pairs } of candidates) {
        for (const { earlier, shared } of pairs) {
          let differs
          try { differs = covered(animations, earlier, later, shared) } catch (e) { /* a style that cannot be read is not checked */ }
          if (differs === undefined) continue
          report(named + later.pseudo + " has two animations of " + differs + ", and the later one (" + later.name + ") fills backwards: before it starts, its first frame shows and hides the earlier one (" + earlier.name + "). Give the later one " + (later.css ? "animation-fill-mode forwards" : 'fill: "forwards"') + ", or put it on a wrapping element")
          break
        }
      }
    } finally {
      animations.forEach((a, i) => {
        try { a.currentTime = times[i] } catch (e) { /* the first draw sets every time anyway */ }
      })
    }
  }
  const ready = Promise.all([fonts, pictures]).then(() => {
    checkTransforms()
    checkFills()
    draw(0)
    window.__timelines = window.__timelines || {}
    window.__timelines["main"] = tl
  })
  window.__hf = window.__hf || {}
  window.__hf.buildReady = window.__hf.buildReady || {}
  window.__hf.buildReady.host = ready
})()
