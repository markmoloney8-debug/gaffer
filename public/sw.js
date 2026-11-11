// Minimal service worker: makes the site installable. It deliberately caches nothing,
// so players always get the latest deploy and live data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
