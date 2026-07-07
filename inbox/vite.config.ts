// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Build-time app version, rendered subtly in the UI (see app/lib/version.ts).
// Falls back safely when package.json is unreadable or git is unavailable
// (e.g. a source archive with no .git directory).
function readAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(`${__dirname}/package.json`, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
    __APP_COMMIT__: JSON.stringify(readGitSha()),
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
