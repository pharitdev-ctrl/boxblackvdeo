import type { Appearance } from "../../shared/api.ts"

/**
 * Pins the page to an appearance, or lets the system decide. The stylesheet reads `data-theme`;
 * with nothing set it follows `prefers-color-scheme`.
 */
export function applyAppearance(appearance: Appearance, root: HTMLElement = document.documentElement): void {
  if (appearance === "system") root.removeAttribute("data-theme")
  else root.dataset.theme = appearance
}
