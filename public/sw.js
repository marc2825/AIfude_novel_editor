/* Only the build-generated public shell/assets are cached. Manuscripts live in IndexedDB. */
importScripts("/sw-assets.js");
const config = self.NOVEL_OFFLINE;
const prefix = "novel-offline-v1-";
const staticPath = (path) => path === "/offline" || path === "/manifest.webmanifest" ||
  /^\/icons\/(?:icon-192|icon-512|apple-touch-icon)\.png$/u.test(path) ||
  /^\/_next\/static\/[a-zA-Z0-9_./%\[\]-]+\.(?:js|css|woff2?|png|svg)$/u.test(path);
if (!config || !/^[a-f0-9]{20}$/u.test(config.version) || !Array.isArray(config.assets) || !config.assets.length ||
  config.assets.length > 2000 || !config.assets.every((path) => typeof path === "string" && staticPath(path) && !path.includes("..")) || !config.assets.includes("/offline")) throw new Error("Invalid public shell manifest");
const cacheName = prefix + config.version;
const allowed = new Set(config.assets);
async function preparePublicCache() {
    const existed = await caches.has(cacheName);
    try {
      const cache = await caches.open(cacheName);
      await cache.addAll(config.assets.map((path) => new Request(new URL(path, self.location.origin), { credentials: "omit", cache: "reload", redirect: "error" })));
    } catch (error) { if (!existed) await caches.delete(cacheName); throw error; }
}
self.addEventListener("install", (event) => {
  // Do not skipWaiting: an update must never replace a live editor or discard a draft.
  event.waitUntil(preparePublicCache());
});
self.addEventListener("message", (event) => {
  if (event.data !== "prepare-public-shell" || !event.ports[0] || !event.source?.url || new URL(event.source.url).origin !== self.location.origin) return;
  event.waitUntil(preparePublicCache().then(() => event.ports[0].postMessage(true), () => event.ports[0].postMessage(false)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search || url.username || url.password) return;
  if (request.mode === "navigate" && (url.pathname === "/" || url.pathname === "/offline")) {
    event.respondWith(fetch(request).catch(async () => {
      const shell = await (await caches.open(cacheName)).match("/offline");
      return shell ?? new Response("オフライン用画面を準備できていません。接続を戻して再度開いてください。原稿の保存領域は変更していません。", { status: 503, headers: { "Content-Type": "text/plain;charset=utf-8" } });
    }));
  } else if (allowed.has(url.pathname)) {
    event.respondWith((async () => (await (await caches.open(cacheName)).match(url.pathname)) ?? fetch(new Request(request, { credentials: "omit" })))());
  }
});
