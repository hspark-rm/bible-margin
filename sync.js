"use strict";
// 주석 동기화 — Dropbox /annotations/<책>.json. 항목별 updatedAt이 더 큰 쪽을 남긴다(삭제도 표시로 전달).
// 바뀐 책만 올리고, 다른 기기가 바꾼 책(rev가 달라진 파일)만 내려받는다.

const Sync = (() => {
  const K_DIRTY = "bm.dirty", K_REVS = "bm.revs";
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") || d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let dirty = new Set(load(K_DIRTY, []));
  let revs = load(K_REVS, {});
  let busy = false, timer = null, lastOk = null, lastErr = null;

  function markDirty(book) {
    dirty.add(book); put(K_DIRTY, [...dirty]);
    status();
    clearTimeout(timer);
    timer = setTimeout(run, 30000); // 편집 후 30초 동안 변경이 없으면 올린다
  }

  const path = (book) => `/annotations/${book}.json`;
  const payload = (book) => JSON.stringify({ app: "bible-margin", book, items: Store.items(book) });

  async function pull(book, rev) {
    const f = await DBX.download(path(book));
    if (!f) return 0;
    const n = Store.merge(JSON.parse(f.text).items || []);
    revs[book] = f.rev;
    return n;
  }

  async function run() {
    clearTimeout(timer);
    if (busy || !DBX.loggedIn() || !navigator.onLine) { status(); return; }
    busy = true; lastErr = null; status();
    let changed = 0;
    try {
      // 1) 다른 기기가 바꾼 책 내려받기
      const remote = {};
      for (const e of await DBX.listFolder("/annotations")) if (e[".tag"] === "file") remote[e.name.replace(/\.json$/, "")] = e.rev;
      for (const [book, rev] of Object.entries(remote)) {
        if (revs[book] !== rev) changed += await pull(book, rev);
      }
      // 2) 이 기기에서 바꾼 책 올리기(충돌이면 내려받아 합친 뒤 한 번 더)
      for (const book of [...dirty]) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            revs[book] = await DBX.upload(path(book), payload(book), remote[book] ? revs[book] : undefined);
            dirty.delete(book);
            break;
          } catch (e) {
            if (!e.conflict) throw e;
            changed += await pull(book);
            remote[book] = revs[book];
          }
        }
      }
      put(K_DIRTY, [...dirty]); put(K_REVS, revs);
      lastOk = new Date();
      if (changed && typeof rerender === "function") rerender();
    } catch (e) {
      lastErr = e.message || String(e);
      console.warn("동기화 실패", e);
    } finally {
      busy = false; status();
    }
  }

  function status() {
    const el = document.getElementById("syncBtn");
    if (!el) return;
    let icon = "☁", title;
    if (!DBX.configured()) { icon = "☁"; title = "Dropbox 미설정(config.js)"; el.dataset.state = "off"; }
    else if (!DBX.loggedIn()) { title = "Dropbox 연결하기"; el.dataset.state = "off"; }
    else if (busy) { icon = "⟳"; title = "동기화 중…"; el.dataset.state = "busy"; }
    else if (lastErr) { icon = "!"; title = `동기화 오류: ${lastErr}`; el.dataset.state = "err"; }
    else if (dirty.size) { title = `올릴 변경 ${dirty.size}권 (30초 뒤 자동)`; el.dataset.state = "dirty"; }
    else { title = lastOk ? `동기화됨 ${lastOk.toLocaleTimeString()}` : "연결됨"; el.dataset.state = "ok"; }
    el.textContent = icon; el.title = title; el.setAttribute("aria-label", title);
  }

  function init() {
    document.getElementById("syncBtn").onclick = () => {
      if (!DBX.configured()) { alert("Dropbox App key가 아직 설정되지 않았습니다."); return; }
      if (!DBX.loggedIn()) DBX.login(); else run();
    };
    // 탭을 떠날 때·다시 볼 때·온라인이 될 때 바로 동기화한다.
    document.addEventListener("visibilitychange", () => run());
    window.addEventListener("online", () => run());
    setInterval(run, 5 * 60 * 1000);
    status();
    run();
  }

  return { init, run, markDirty, status };
})();
