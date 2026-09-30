import { readFileSync } from "node:fs"
import { join } from "node:path"

/*
 * The fragments the design was tried on, kept as real examples for the tests of the linter, the reader and the page.
 * They are copies of the ones in docs/plans/2026-09-30-freeform-motion-notes/spike (which stay there as history), so
 * that the tests do not reach into docs/. Every one passes `lintFragment`, and the page test builds a page from each.
 *
 * spike-A to spike-F: the first fragments Claude wrote, for moments of draft 0917. A to E were written from the first
 * contract, by separate runs that never saw each other; E came from one real `claude -p` call. F was written under the
 * final contract's word variables (`--w1`, `T`) and colour variables. B builds its dots with createElement and
 * declares a `T` of its own inside a function, which is legal: the page's `T` is a different scope. D sets
 * window.frame; A, C, E and F are CSS only.
 *
 * trial-1 to trial-8: one real `claude -p` call each under the final contract, from eight briefs of different kinds
 * (1 a number counting up with a gauge, 2 two bars compared, 3 a tick list, 4 a capsule along a drawn path, 5 a
 * timeline of three steps, 6 a price struck out, 7 a warning over a pan, 8 a ring filling to 90 %).
 *
 * trial-5 PASSES THE LINTER BUT DRAWS WRONGLY, and is kept for that. In the timeline, three icons sit in the corner of
 * the stage instead of inside their circles: each is an SVG <g> that carries a `transform` attribute and is also
 * animated with CSS `transform`, and the animation replaces the attribute. No rule of the linter can see it; the host
 * finds it at render time. trial-5-repaired is the fragment one repair call returned, given the first brief, those
 * three problems and trial-5; it places with an outer <g> and animates an inner one, and draws right.
 */

/** Every fixture, by name. */
export const FIXTURES = [
  "spike-A",
  "spike-B",
  "spike-C",
  "spike-D",
  "spike-E",
  "spike-F",
  "trial-1",
  "trial-2",
  "trial-3",
  "trial-4",
  "trial-5",
  "trial-5-repaired",
  "trial-6",
  "trial-7",
  "trial-8",
] as const

export type FixtureName = (typeof FIXTURES)[number]

/** The text of one fixture, as it is on disk. */
export function fixture(name: FixtureName): string {
  return readFileSync(join(import.meta.dirname, `${name}.html`), "utf8")
}

/** All the fixtures, in the order above. */
export function allFixtures(): { name: FixtureName; html: string }[] {
  return FIXTURES.map((name) => ({ name, html: fixture(name) }))
}
