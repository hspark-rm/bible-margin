// 앱 화면 파일을 캐시해 오프라인에서도 열리게 한다. 성경 본문·주석은 앱이 따로 캐시한다(Dropbox 요청은 건드리지 않음).
const VER = "bm-shell-v2";
const SHELL = ["./", "index.html", "style.css", "config.js", "store.js", "annotate.js", "ink.js", "dropbox.js", "sync.js", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("bm-shell-") && k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 같은 출처의 앱 파일만: 네트워크를 먼저 쓰고, 실패하면 캐시(수정본이 바로 반영되도록).
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/data/")) return;
  e.respondWith(
    fetch(e.request).then((r) => { const cp = r.clone(); caches.open(VER).then((c) => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
