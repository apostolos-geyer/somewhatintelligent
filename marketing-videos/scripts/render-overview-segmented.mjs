// Renders SproutOverview in short segments and concatenates them with ffmpeg.
//
// Why: in memory/IO-constrained environments (e.g. CI containers) a single
// long render can intermittently stall a font load on a late frame. Rendering
// in spotlight-sized chunks (each its own process, with retries) is reliable,
// and `npx remotion ffmpeg -f concat -c copy` stitches them losslessly.
//
// Normal environments can just use `npm run render:overview`.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";

const TOTAL = 950; // SproutOverview durationInFrames (see src/compositions/SproutOverview.tsx)
const SEG = 250;
const OUT = "out";
const SEG_DIR = `${OUT}/seg`;
const FINAL = `${OUT}/sprout-overview.mp4`;

const run = (args) => execFileSync("npx", args, { stdio: "inherit" });

mkdirSync(SEG_DIR, { recursive: true });

const segments = [];
for (let start = 0, i = 1; start < TOTAL; start += SEG, i++) {
  const end = Math.min(start + SEG - 1, TOTAL - 1);
  const file = `${SEG_DIR}/s${i}.mp4`;
  segments.push(`s${i}.mp4`);
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    rmSync(file, { force: true });
    try {
      run([
        "remotion",
        "render",
        "SproutOverview",
        file,
        "--scale=1",
        `--frames=${start}-${end}`,
        "--timeout=120000",
      ]);
      ok = existsSync(file);
    } catch {
      console.warn(`segment s${i} (${start}-${end}) attempt ${attempt} failed, retrying…`);
    }
  }
  if (!ok) {
    console.error(`segment s${i} (${start}-${end}) failed after 3 attempts`);
    process.exit(1);
  }
}

writeFileSync(`${SEG_DIR}/list.txt`, segments.map((s) => `file '${s}'`).join("\n") + "\n");
rmSync(FINAL, { force: true });
execFileSync(
  "npx",
  [
    "remotion",
    "ffmpeg",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "list.txt",
    "-c",
    "copy",
    "../sprout-overview.mp4",
  ],
  {
    cwd: SEG_DIR,
    stdio: "inherit",
  },
);
console.log(`\n✓ ${FINAL}`);
