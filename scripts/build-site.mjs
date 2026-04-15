// Assemble the static site into ``_site/`` for GitHub Pages upload.
// Copies ``site/*`` and the compiled transpiler from ``dist/`` so the
// in-browser playground can ``import { transpile } from "./typethon.js"``.

import { cp, mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "_site");

if (existsSync(out)) {
  await rm(out, { recursive: true, force: true });
}
await mkdir(out, { recursive: true });

// Copy the static site verbatim.
for (const entry of await readdir(join(root, "site"))) {
  await cp(join(root, "site", entry), join(out, entry), { recursive: true });
}

// Drop the compiled transpiler in next to ``app.js`` under the name
// ``typethon.js`` -- matches the import in ``site/app.js``.
await copyFile(join(root, "dist", "transpiler.js"), join(out, "typethon.js"));
if (existsSync(join(root, "dist", "transpiler.d.ts"))) {
  await copyFile(join(root, "dist", "transpiler.d.ts"), join(out, "typethon.d.ts"));
}

console.log("site assembled at", out);
