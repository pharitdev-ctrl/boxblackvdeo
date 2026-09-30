import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "core", environment: "node", include: ["packages/*/src/**/*.test.ts"] },
      },
      {
        test: { name: "desktop-main", environment: "node", include: ["apps/desktop/src/main/**/*.test.ts", "apps/desktop/scripts/**/*.test.ts"] },
      },
      {
        test: { name: "server", environment: "node", include: ["apps/server/src/**/*.test.ts"] },
      },
      {
        plugins: [react()],
        test: {
          name: "desktop-renderer",
          environment: "jsdom",
          include: ["apps/desktop/src/renderer/**/*.test.{ts,tsx}"],
          setupFiles: ["apps/desktop/src/renderer/test/setup.ts"],
          // longer than the five seconds a `findBy` or `waitFor` may wait (the setup file), so a wait that runs out says what it waited for
          testTimeout: 20_000,
        },
      },
    ],
  },
})
