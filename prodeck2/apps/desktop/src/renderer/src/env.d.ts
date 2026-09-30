/// <reference types="vite/client" />
import type { RendererApi } from "../../shared/api.ts"

declare global {
  interface Window {
    /** Exposed by the preload script. */
    boxblack: RendererApi
  }
}
