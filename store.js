"use strict";
// 주석 저장소 — IndexedDB. 삭제는 표시만 한다(deleted). P4 Dropbox 병합이 항목별 updatedAt으로 판정하기 때문이다.
//
// 주석 항목:
//   { id, type: "hl" | "ul" | "memo", book, ch, v, v2,
//     trans, s, e,        // hl·ul만: 번역별 본문, 시작 절의 s번째 글자 ~ 끝 절의 e번째 글자
//     color | style,      // hl: 1–5, ul: "solid" | "wavy"
//     text, tags,         // memo만: 번역과 무관하게 절 범위에 붙는다
//     createdAt, updatedAt, deleted }

const Store = (() => {
  const DB = "bible-margin", OS = "ann";
  let db = null;
  const mem = new Map();

  function open() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(OS, { keyPath: "id" });
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  function tx(mode) { return db.transaction(OS, mode).objectStore(OS); }

  async function init() {
    try {
      db = await open();
      const all = await new Promise((res, rej) => { const r = tx("readonly").getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      all.forEach((a) => mem.set(a.id, a));
    } catch (e) {
      // 비공개 창 등에서 IndexedDB가 막히면 메모리에만 둔다(새로고침하면 사라진다).
      console.warn("IndexedDB 사용 불가 — 주석이 저장되지 않습니다.", e);
      db = null;
    }
  }
  function persist(a) {
    if (!db) return;
    try { tx("readwrite").put(a); } catch (e) { console.warn(e); }
  }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  const touched = (book) => { if (typeof Sync !== "undefined") Sync.markDirty(book); };

  function add(a) {
    const now = Date.now();
    const x = { ...a, id: uid(), createdAt: now, updatedAt: now, deleted: false };
    mem.set(x.id, x); persist(x); touched(x.book);
    return x;
  }
  function update(id, patch) {
    const a = mem.get(id); if (!a) return null;
    Object.assign(a, patch, { updatedAt: Date.now() });
    persist(a); touched(a.book);
    return a;
  }
  // 동기화용: 한 책의 모든 항목(삭제 표시 포함)
  const items = (book) => [...mem.values()].filter((a) => a.book === book);
  // 다른 기기 항목 합치기 — 더 최근에 바뀐 쪽을 남긴다. 반환: 바뀐 개수
  function merge(list) {
    let n = 0;
    for (const a of list) {
      const cur = mem.get(a.id);
      if (!cur || (a.updatedAt || 0) > (cur.updatedAt || 0)) { mem.set(a.id, a); persist(a); n++; }
    }
    return n;
  }
  const remove = (id) => update(id, { deleted: true });
  const get = (id) => mem.get(id);
  const live = () => [...mem.values()].filter((a) => !a.deleted);
  const forChapter = (book, ch) => live().filter((a) => a.book === book && a.ch === ch);

  function exportJSON() {
    return JSON.stringify({ app: "bible-margin", version: 1, exportedAt: new Date().toISOString(), items: [...mem.values()] });
  }
  // 가져오기도 항목별 최신 시각 우선으로 합친다(P4 동기화와 같은 규칙).
  function importJSON(text) {
    const d = JSON.parse(text);
    let n = 0;
    for (const a of d.items || []) {
      const cur = mem.get(a.id);
      if (!cur || (a.updatedAt || 0) > (cur.updatedAt || 0)) { mem.set(a.id, a); persist(a); touched(a.book); n++; }
    }
    return n;
  }

  return { init, add, update, remove, get, live, forChapter, exportJSON, importJSON, items, merge };
})();
