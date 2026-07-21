// v1: install/activate only — no offline caching. Audio streams from the
// blob store and every page needs the auth cookie, so caching the shell
// would serve stale/gated content. Offline lineup caching is a noted
// future enhancement in the spec.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
