// Copies SpessaSynth's AudioWorklet processor into public/ so Vite serves it.
// Runs automatically after npm install; keep it in sync with the npm package.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public", { recursive: true });
copyFileSync(
  "node_modules/spessasynth_lib/dist/spessasynth_processor.min.js",
  "public/spessasynth_processor.min.js"
);
console.log("copied spessasynth_processor.min.js -> public/");
