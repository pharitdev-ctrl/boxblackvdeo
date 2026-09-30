import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"

export default defineConfig({
  main: {
    // workspace package ships TypeScript source, so it has to be bundled, not required at runtime
    build: { externalizeDeps: { exclude: ["@boxblack/core"] } },
    // fixed into the build; scripts/check-release.ts refuses release builds without real values
    define: {
      __LICENSE_SERVER__: JSON.stringify(process.env.BOXBLACK_LICENSE_SERVER ?? "http://localhost:3100"),
      __UPDATE_URL__: JSON.stringify(process.env.BOXBLACK_UPDATE_URL ?? ""),
    },
  },
  preload: {
    // sandboxed preload scripts cannot be ES modules
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    plugins: [react()],
  },
})
