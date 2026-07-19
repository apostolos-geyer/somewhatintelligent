import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    // The site ships no astro:assets images — passthrough keeps the deploy
    // binding inventory to the two read-only service bindings (INV-SITE-1).
    imageService: "passthrough",
  }),
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
});
