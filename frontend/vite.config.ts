import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Vendored copy of the BlueSky Vue component library
      // (../packages/bluesky-vue/src) — aliased under its real package
      // name so app code imports it exactly the way it would from a
      // published npm package (`import { Button } from
      // "@applivery/bluesky-vue"`), even though today it resolves straight
      // to source rather than a built dist/. Swap this alias for a real
      // npm dependency once the package is published to the private
      // registry declared in its own package.json.
      "@applivery/bluesky-vue": fileURLToPath(
        new URL("../packages/bluesky-vue/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
