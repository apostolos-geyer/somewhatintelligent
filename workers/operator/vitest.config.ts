import { defineConfig } from "vitest/config";

// Plain node environment: operator's suites are pure JWT/config logic, so they
// don't need the workerd pool that bouncer/roadie wire through cloudflareTest.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", ".wrangler/**"],
  },
});
