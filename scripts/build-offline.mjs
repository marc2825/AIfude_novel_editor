import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

async function assetsAt(directory, relative = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await assetsAt(join(directory, entry.name), path));
    else if (/\.(?:js|css|woff2?|png|svg)$/u.test(entry.name)) result.push(`/_next/static${path}`);
  }
  return result;
}
const html = await readFile(".next/server/app/offline.html", "utf8");
const buildId = await readFile(".next/BUILD_ID", "utf8");
const version = createHash("sha256").update(buildId).update(html).digest("hex").slice(0, 20);
const assets = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", ...await assetsAt(".next/static")].sort();
await writeFile("public/sw-assets.js", `self.NOVEL_OFFLINE = ${JSON.stringify({ version, assets })};\n`);
console.log(`Offline shell: ${assets.length} public static assets, version ${version}`);
