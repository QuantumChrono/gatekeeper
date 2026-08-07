import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Vitest does not read tsconfig `paths`, and the codebase imports through the
// `@/` alias everywhere. Mapping it here is cheaper than a plugin dependency and
// keeps the modules under test importing the same way in tests as in the app.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
})
