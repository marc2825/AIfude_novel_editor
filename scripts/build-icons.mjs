// Reproducible code-native artwork. Run with the installed Playwright Chromium.
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
const svg = await readFile("public/icons/source.svg", "utf8");
const browser = await chromium.launch();
try {
  for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["apple-touch-icon", 180]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>body{margin:0}svg{width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path: `public/icons/${name}.png` }); await page.close();
  }
} finally { await browser.close(); }
