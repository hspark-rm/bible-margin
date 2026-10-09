"use strict";
// 관주 여백 성경 — P1: 읽기 화면 + 여백 관주 + 다른 번역 열람

const DATA = "data/out";
const TRANS = { rnksv: "새번역", krv: "개역개정", ctb: "공동번역", esv: "ESV" };
const state = {
  trans: "rnksv", book: "Gen", ch: 1,
  fontSize: 20, obCount: 4, showTsk: true, maxRefs: 10, useNb: false,
};
let BOOKS = [], BOOK = {}, ORDER = [];
const cache = new Map();

const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 위치·설정은 기기별 편의 정보라 localStorage에 둔다(실패해도 기본값으로 동작).
function loadPrefs() {
  try { Object.assign(state, JSON.parse(localStorage.getItem("bm.prefs") || "{}")); } catch (e) {}
}
function savePrefs() {
  try { localStorage.setItem("bm.prefs", JSON.stringify(state)); } catch (e) {}
}

// 본문 읽기 순서: 기기 캐시 → 같은 서버의 data/out(맥 개발용) → Dropbox /texts.
// 공개 주소(GitHub Pages)에는 본문이 없으므로, 그곳에서는 Dropbox에서 받아 기기에 캐시한다.
const TEXT_CACHE = "bm-texts-v1";
async function loadText(path) {
  const key = new Request(`${location.origin}/__bm_texts__/${path}`);
  try {
    const c = await caches.open(TEXT_CACHE);
    const hit = await c.match(key);
    if (hit) return hit.json();
  } catch (e) {}
  try {
    const r = await fetch(`${DATA}/${path}`);
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) return r.json();
  } catch (e) {}
  if (!DBX.loggedIn()) return null;
  const f = await DBX.download(`/texts/${path}`);
  if (!f) return null;
  try { (await caches.open(TEXT_CACHE)).put(key, new Response(f.text, { headers: { "content-type": "application/json" } })); } catch (e) {}
  return JSON.parse(f.text);
}
async function getJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const p = loadText(path).catch((e) => { console.warn(path, e); return null; });
  cache.set(path, p);
  p.then((v) => { if (v === null) cache.delete(path); });
  return p;
}

// 오프라인용: 모든 책·번역·관주를 기기에 미리 받는다.
async function downloadAll(onProgress) {
  const trs = ["rnksv", "krv", "ctb", "esv", "xref"];
  const jobs = [];
  for (const t of trs) for (const b of BOOKS) if (!(b.deutero && t !== "ctb")) jobs.push(`${t}/${b.id}.json`);
  for (const t of trs.slice(0, 4)) jobs.push(`${t}/meta.json`);
  let done = 0;
  for (const j of jobs) { await getJSON(j); onProgress(++done, jobs.length); }
}
const getBook = (tr, id) => getJSON(`${tr}/${id}.json`);
const getXref = (id) => getJSON(`xref/${id}.json`);

// ---- 참조 문자열 ----
// TSK: "Prov.8.22-24", OpenBible: "Isa.40.28" 또는 "Isa.40.28~Isa.40.31"
function parseRef(s) {
  const [a, b] = s.split("~");
  const m = a.match(/^(\w+)\.(\d+)\.(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const r = { book: m[1], ch: +m[2], v1: +m[3], v2: m[4] ? +m[4] : +m[3] };
  if (b) {
    const n = b.match(/^(\w+)\.(\d+)\.(\d+)$/);
    if (n && n[1] === r.book && +n[2] === r.ch) r.v2 = +n[3];
    else if (n) r.toCh = +n[2], r.toV = +n[3];
  }
  return r;
}
function fmtRef(r, withBook = true) {
  const bk = BOOK[r.book] ? BOOK[r.book].abbr : r.book;
  let s = `${withBook ? bk + " " : ""}${r.ch}:${r.v1}`;
  if (r.toCh) s += `–${r.toCh}:${r.toV}`;
  else if (r.v2 !== r.v1) s += `–${r.v2}`;
  return s;
}
const refKey = (r) => `${r.book}.${r.ch}.${r.v1}`;

// ---- 렌더링 ----
// 주석을 바꾼 뒤에는 읽던 위치를 유지한 채 다시 그린다.
async function rerender() {
  const y = window.scrollY;
  await render(null, true);
  window.scrollTo(0, y);
}

async function render(scrollToVerse, keepScroll) {
  const [doc, xref] = await Promise.all([getBook(state.trans, state.book), getXref(state.book)]);
  const text = $("#text"), margin = $("#margin");
  const b = BOOK[state.book];
  $("#loc").textContent = `${b.name} ${state.ch}${state.book === "Ps" ? "편" : "장"}`;
  $("#trans").value = state.trans;
  document.title = `${b.abbr} ${state.ch} · 관주 여백 성경`;

  if (!doc || !doc.ch[state.ch - 1]) {
    text.innerHTML = `<h2>${esc(b.name)} ${state.ch}장</h2><p class="merged">${TRANS[state.trans]}에는 이 장이 없습니다.</p>`;
    margin.innerHTML = "";
    return;
  }
  const verses = doc.ch[state.ch - 1];
  const anns = Store.forChapter(state.book, state.ch);
  // 이 번역의 절 체계가 KJV(관주 기준)와 다른 장은 관주를 붙이지 않는다.
  const ctbDiff = (await diffSet(state.trans)).has(`${state.book}.${state.ch}`);
  let html = `<h2>${esc(b.name)}${doc.ownName && doc.ownName !== b.name ? ` <small class="merged">(${esc(doc.ownName)})</small>` : ""} ${state.ch}${state.book === "Ps" ? "편" : "장"}</h2><p>`;
  let mhtml = "";
  verses.forEach((v, i) => {
    const n = i + 1;
    const heads = v.h || [];
    const notes = v.n || [];
    // 절 앞 소제목은 문단을 끊고, 절 중간 소제목은 그 자리에서 끊는다.
    let body = "";
    const cuts = [...heads.map((h) => ({ at: h.at, kind: "h", h })), ...notes.filter((x) => !x.head).map((x) => ({ at: x.at, kind: "n", x }))]
      .sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === "h" ? -1 : 1));
    let pos = 0, open = false, started = false;
    // 절 span은 소제목(문단 경계)을 가로지를 수 없으므로, 소제목마다 닫고 다시 연다.
    const openSpan = () => { if (!open) { body += started ? `<span class="v" data-v="${n}">` : `<span class="v" id="v${n}" data-v="${n}"><span class="vn" data-v="${n}">${n}</span>`; open = started = true; } };
    for (const c of cuts) {
      if (c.at > pos) { openSpan(); body += textHTML(n, v, pos, c.at, anns); pos = c.at; }
      if (c.kind === "h") {
        const hn = notes.filter((x) => x.head).map((x) => `<span class="fn" data-v="${n}" data-m="${x.m}">${x.m}</span>`).join("");
        body += `${open ? "</span>" : ""}</p><h3${c.h.sup ? ' class="sup"' : ""}>${esc(c.h.t)}${c.h.sup ? "" : hn}</h3><p>`;
        open = false;
      } else {
        openSpan();
        body += `<span class="fn" data-v="${n}" data-m="${c.x.m}">${c.x.m}</span>`;
      }
    }
    openSpan();
    const memos = anns.filter((a) => a.type === "memo" && a.v === n);
    const inks = anns.filter((a) => a.type === "ink" && a.v === n);
    body += (v.merged ? `<span class="merged">${v.omitted ? "(이 번역 본문에 없음 — 각주 참고)" : "(앞 절에 포함)"}</span>` : textHTML(n, v, pos, v.t.length, anns))
      + (v.fix ? `<span class="fixmark" title="원본 결함 교정(${esc(v.fix)}) — 대한성서공회 새번역 본문으로 바꿈">*</span>` : "")
      + (memos.length ? `<span class="memo-dot" data-id="${memos[0].id}" title="메모">✎</span>` : "") + " </span>";
    const mi = marginItem(n, v, xref, ctbDiff, memos, inks);
    html += `${body}${mi ? `<span class="inline-m">${mi}</span>` : ""}`;
    if (mi) mhtml += `<div class="mitem" data-v="${n}">${mi}</div>`;
  });
  html += "</p>";
  text.innerHTML = html.replace(/<p>\s*<\/p>/g, "");
  text.lang = state.trans === "esv" ? "en" : "ko";
  margin.innerHTML = mhtml;
  Ink.mountAll();  // 필기 상자 높이가 정해져야 여백 배치를 계산할 수 있다
  layoutMargin();
  if (scrollToVerse) {
    const el = document.getElementById(`v${scrollToVerse}`);
    if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600); }
  } else if (!keepScroll) window.scrollTo(0, 0);
  savePrefs();
}

const _diff = {};
async function diffSet(tr) {
  if (!_diff[tr]) { const m = await getJSON(`${tr}/meta.json`); _diff[tr] = new Set((m && m.versificationDiff) || []); }
  return _diff[tr];
}

// 본문 [from, to) 구간을 하이라이트·밑줄 경계에서 잘라 span으로 만든다.
// data-o는 절 안 글자 위치라서, 선택 영역을 주석 좌표로 바꿀 때 쓴다.
function textHTML(n, v, from, to, anns) {
  const marks = [];
  for (const a of anns) {
    if ((a.type !== "hl" && a.type !== "ul") || a.trans !== state.trans || n < a.v || n > a.v2) continue;
    const s = a.v === n ? a.s : 0, e = a.v2 === n ? a.e : v.t.length;
    if (e > from && s < to) marks.push({ s: Math.max(s, from), e: Math.min(e, to), a });
  }
  const cuts = [...new Set([from, to, ...marks.flatMap((m) => [m.s, m.e])])].sort((x, y) => x - y);
  let out = "";
  for (let i = 0; i < cuts.length - 1; i++) {
    const x = cuts[i], y = cuts[i + 1];
    if (y <= x) continue;
    const on = marks.filter((m) => m.s <= x && m.e >= y).map((m) => m.a);
    const hl = on.filter((a) => a.type === "hl").pop(), ul = on.filter((a) => a.type === "ul").pop();
    const cls = ["t", hl ? `hl c${hl.color}` : "", ul ? `ul ${ul.style}` : ""].join(" ").trim();
    const ids = on.map((a) => a.id).join(",");
    out += `<span class="${cls}" data-o="${x}"${ids ? ` data-a="${ids}"` : ""}>${esc(v.t.slice(x, y))}</span>`;
  }
  return out;
}

function marginItem(n, v, xref, ctbDiff, memos = [], inks = []) {
  // <p> 안에 들어가므로 div 대신 span만 쓴다(div가 들어가면 브라우저가 문단을 끊는다).
  const parts = [];
  for (const m of memos) {
    const rng = m.v2 !== m.v ? `<b>${m.v}–${m.v2}</b>` : "";
    const tags = (m.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join(" ");
    const src = m.src ? `<span class="mcite">📖 ${esc(Lib.cite(m.src))}</span>` : "";
    const quote = m.quote ? `<span class="mquote">${esc(m.quote.split("\n")[0])}</span>` : "";
    const text = m.text ? esc(m.text).replace(/\n/g, "<br>") : "";
    // 공책을 쓰면 메모 왼쪽 띠를 공책 색으로 칠한다.
    const col = state.useNb && m.nb ? Lib.nbColor(m.nb) : "";
    parts.push(`<span class="memo" data-id="${m.id}"${col ? ` style="border-left-color:${col}"` : ""}>${src}${quote}${rng}${text}${tags ? " " + tags : ""}</span>`);
  }
  for (const x of v.n || []) parts.push(`<span class="note"><b>${x.m}</b>${esc(x.t)}</span>`);
  const x = !ctbDiff && xref && xref[`${state.ch}.${n}`];
  if (x) {
    const all = collectRefs(x);
    const shown = all.slice(0, state.maxRefs);
    if (shown.length) {
      let s = refLinks(shown.filter((r) => !r.ob), "") ;
      const ob = shown.filter((r) => r.ob);
      if (ob.length) s += `${s ? " " : ""}<span class="src">OB</span>${refLinks(ob, "ob")}`;
      if (all.length > shown.length) s += ` <span class="more" data-v="${n}">+${all.length - shown.length}</span>`;
      parts.push(`<span class="refs">${s}</span>`);
    }
  }
  if (inks.length) parts.push(Ink.html(inks));
  if (!parts.length) return "";
  return `<span class="mv">${n}</span>${parts.join("")}`;
}

// TSK를 먼저, 그다음 OpenBible(표 많은 순, TSK와 중복 제외)을 한 줄로 모은다.
function collectRefs(x) {
  const seen = new Set(), out = [];
  if (state.showTsk && x.tsk) for (const g of x.tsk) for (const s of g.r) {
    const r = parseRef(s); if (r && !seen.has(refKey(r))) { seen.add(refKey(r)); out.push(r); }
  }
  const obs = [];
  if (state.obCount > 0 && x.ob) for (const [s] of x.ob) {
    const r = parseRef(s); if (r && !seen.has(refKey(r))) { seen.add(refKey(r)); r.ob = true; obs.push(r); }
    if (obs.length >= state.obCount) break;
  }
  // 여백이 짧을 때도 OpenBible 상위 표가 보이도록, 잘리는 경우 TSK 앞부분과 OB를 섞어 배치한다.
  const keepTsk = Math.max(0, state.maxRefs - Math.min(obs.length, Math.ceil(state.maxRefs / 3)));
  return out.length > keepTsk ? [...out.slice(0, keepTsk), ...obs, ...out.slice(keepTsk)] : [...out, ...obs];
}

async function peekAllRefs(n) {
  const xref = await getXref(state.book);
  const x = xref && xref[`${state.ch}.${n}`];
  if (!x) return;
  const rows = [];
  if (x.tsk) {
    rows.push(`<div class="tr">TSK (영어 KJV 기준 어구별)</div>`);
    for (const g of x.tsk) rows.push(`<p class="pv"><span class="src">${esc(g.a)}</span>${refLinks(g.r.map(parseRef).filter(Boolean), "")}</p>`);
  }
  if (x.ob) {
    rows.push(`<div class="tr">OpenBible (표 많은 순)</div>`);
    rows.push(`<p class="pv">${refLinks(x.ob.map(([s]) => parseRef(s)).filter(Boolean), "ob")}</p>`);
  }
  peekTarget = null;
  openPeek(`${BOOK[state.book].abbr} ${state.ch}:${n} 관주 전체`, rows.join(""), false);
}

function refLinks(refs, cls) {
  // 같은 책 같은 장이 이어지면 책·장 이름을 생략해 여백을 아낀다.
  let prev = null;
  return refs.map((r) => {
    const showBook = !prev || prev.book !== r.book;
    const label = showBook ? fmtRef(r) : prev.ch === r.ch && !r.toCh ? fmtRef(r, false).replace(/^\d+:/, "") : fmtRef(r, false);
    prev = r;
    return `<span class="ref ${cls}" data-ref="${r.book}.${r.ch}.${r.v1}${r.v2 !== r.v1 ? "-" + r.v2 : ""}${r.toCh ? "~" + r.book + "." + r.toCh + "." + r.toV : ""}">${label}</span>`;
  }).join("; ");
}

// 여백 항목을 해당 절의 높이에 맞추고, 겹치면 아래로 민다.
function layoutMargin() {
  const margin = $("#margin");
  if (getComputedStyle(margin).display === "none") return;
  const base = margin.getBoundingClientRect().top;
  let bottom = 0;
  for (const it of margin.querySelectorAll(".mitem")) {
    const v = document.getElementById(`v${it.dataset.v}`);
    const top = v.getClientRects()[0].top - base;
    const y = Math.max(top, bottom);
    it.style.top = `${y}px`;
    bottom = y + it.offsetHeight + 6;
  }
  margin.style.minHeight = `${bottom}px`;
}

// ---- 미리보기 시트 ----
let peekTarget = null;
async function peekRef(refStr) {
  const r = parseRef(refStr);
  if (!r) return;
  const doc = await getBook(state.trans, r.book);
  const lines = [];
  const pushRange = (ch, a, b) => {
    const vs = doc && doc.ch[ch - 1];
    if (!vs) return;
    for (let i = a; i <= Math.min(b, vs.length); i++) lines.push(verseHTML(vs[i - 1], i, r.toCh ? ch : null));
  };
  if (r.toCh) { pushRange(r.ch, r.v1, 999); for (let c = r.ch + 1; c < r.toCh; c++) pushRange(c, 1, 999); pushRange(r.toCh, 1, r.toV); }
  else pushRange(r.ch, r.v1, r.v2);
  peekTarget = { book: r.book, ch: r.ch, v: r.v1 };
  openPeek(`${BOOK[r.book].name} ${fmtRef(r, false)} · ${TRANS[state.trans]}`, lines.join("") || `<p class="warn">${TRANS[state.trans]}에 이 구절이 없습니다.</p>`, true);
}
function verseHTML(v, n, ch) {
  return `<p class="pv"><span class="vn">${ch ? ch + ":" : ""}${n}</span>${v.merged ? `<span class="merged">${v.omitted ? "(본문에 없음)" : "(앞 절에 포함)"}</span>` : esc(v.t)}</p>`;
}

// 절 번호를 누르면 같은 절의 다른 번역을 보여 준다.
async function peekParallel(n) {
  const others = Object.keys(TRANS).filter((t) => t !== state.trans);
  const diff = await diffSet("ctb");
  const out = [];
  for (const t of others) {
    const doc = await getBook(t, state.book);
    const v = doc && doc.ch[state.ch - 1] && doc.ch[state.ch - 1][n - 1];
    out.push(`<div class="tr">${TRANS[t]}</div>`);
    if (t === "ctb" && diff.has(`${state.book}.${state.ch}`)) out.push(`<div class="warn">이 장은 공동번역 절 번호가 달라 같은 번호의 절이 다른 내용일 수 있습니다.</div>`);
    out.push(v ? verseHTML(v, n) : `<p class="merged">없음</p>`);
  }
  out.push(`<p class="row"><button class="pill" data-memo-v="${n}">이 절에 메모</button><button class="pill ghost" data-ink-v="${n}">이 절에 필기</button></p>`);
  peekTarget = null;
  openPeek(`${BOOK[state.book].abbr} ${state.ch}:${n} 다른 번역`, out.join(""), false);
}
function openPeek(title, body, canGo) {
  closeSheets();
  $("#peekTitle").textContent = title;
  $("#peekBody").innerHTML = body;
  $("#peekGo").hidden = !canGo;
  $("#peek").hidden = false;
}

// ---- 책·장 선택 ----
function openPicker() {
  closeSheets();
  $("#pickerTitle").textContent = "책 선택";
  const sec = (title, list) => `<h4>${title}</h4><div class="grid">${list.map((b) => `<button data-book="${b.id}" class="${b.id === state.book ? "cur" : ""}">${b.name}</button>`).join("")}</div>`;
  $("#pickerBody").innerHTML = sec("구약", BOOKS.slice(0, 39)) + sec("신약", BOOKS.slice(39, 66)) + sec("제2경전 (공동번역)", BOOKS.slice(66));
  $("#picker").hidden = false;
}
function openChapters(id) {
  const b = BOOK[id];
  $("#pickerTitle").textContent = `${b.name} — 장 선택`;
  $("#pickerBody").innerHTML = `<div class="grid ch">${Array.from({ length: b.chapters }, (_, i) => `<button data-ch="${i + 1}" data-book="${id}" class="${id === state.book && i + 1 === state.ch ? "cur" : ""}">${i + 1}</button>`).join("")}</div>`;
}
function closeSheets() { document.querySelectorAll(".sheet").forEach((s) => (s.hidden = true)); if (typeof Annot !== "undefined") Annot.hideTool(); }

function go(book, ch, v) {
  // 제2경전은 공동번역에만 있으므로 잠시 바꿨다가, 나오면 원래 번역으로 돌린다.
  if (BOOK[book].deutero && state.trans !== "ctb") { state.prevTrans = state.trans; state.trans = "ctb"; }
  else if (!BOOK[book].deutero && state.prevTrans) { state.trans = state.prevTrans; state.prevTrans = null; }
  state.book = book; state.ch = ch;
  render(v);
}
function step(d) {
  let i = ORDER.indexOf(state.book), ch = state.ch + d;
  if (ch < 1) { if (i === 0) return; i--; ch = BOOKS[i].chapters; }
  else if (ch > BOOKS[i].chapters) { if (i === BOOKS.length - 1) return; i++; ch = 1; }
  go(ORDER[i], ch);
}

function applyPrefs() {
  document.documentElement.style.setProperty("--fs", `${state.fontSize}px`);
  $("#fontSize").value = state.fontSize;
  $("#obCount").value = state.obCount;
  $("#showTsk").checked = state.showTsk;
  $("#maxRefs").value = state.maxRefs;
  $("#useNb").checked = state.useNb;
}

async function init() {
  loadPrefs();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  await DBX.handleRedirect();
  await DBX.ensureFolder();
  await Store.init();  // 동기화가 기기 저장소를 덮어쓰지 않도록 먼저 읽는다
  Sync.init();
  BOOKS = await getJSON("books.json");
  if (!BOOKS) {
    const err = (DBX.error() ? `<p class="warn">오류: ${esc(DBX.error())}</p>` : "")
      + `<p class="merged">앱 버전 v8 · 이 기기 연결 권한: ${esc(DBX.scope())}</p>`;
    $("#text").innerHTML = DBX.configured() && DBX.loggedIn()
      ? `<h2>Dropbox에 연결됨</h2><p>성경 본문 파일을 Dropbox 앱 폴더에서 찾지 못했습니다(texts/books.json). 맥에서 본문을 복사한 뒤 새로고침하세요.</p>${err}<p><button class="pill ghost" onclick="DBX.logout(); localStorage.removeItem('bm.dbxReady'); DBX.login()">연결 끊고 다시 연결</button></p>`
      : DBX.configured()
      ? `<h2>Dropbox 연결이 필요합니다</h2><p>성경 본문은 Dropbox 앱 폴더에 있습니다. 이 기기에서 한 번 연결하면 이후에는 기기에 저장되어 오프라인에서도 열립니다.</p>${err}<p><button class="pill" onclick="DBX.login()">Dropbox 연결</button></p>`
      : "<p>데이터를 불러오지 못했습니다. data/out 폴더 또는 config.js를 확인하세요.</p>";
    // 본문이 없어도 설정 창(연결 끊기 등)은 열리게 한다.
    $("#settingsBtn").onclick = () => { closeSheets(); $("#settings").hidden = false; };
    $("#dbxOut").onclick = () => { if (confirm("이 기기의 Dropbox 연결을 끊을까요?")) { DBX.logout(); location.reload(); } };
    document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeSheets));
    return;
  }
  BOOKS.forEach((b) => (BOOK[b.id] = b));
  ORDER = BOOKS.map((b) => b.id);
  if (!BOOK[state.book]) state.book = "Gen";
  applyPrefs();
  Annot.init();
  Ink.init();
  Lib.init();

  $("#prev").onclick = () => step(-1);
  $("#next").onclick = () => step(1);
  $("#loc").onclick = openPicker;
  $("#settingsBtn").onclick = () => { closeSheets(); $("#settings").hidden = false; };
  $("#trans").onchange = (e) => {
    if (BOOK[state.book].deutero && e.target.value !== "ctb") { e.target.value = "ctb"; return; }
    state.trans = e.target.value; render();
  };
  $("#peekGo").onclick = () => { if (peekTarget) { closeSheets(); go(peekTarget.book, peekTarget.ch, peekTarget.v); } };
  $("#fontSize").oninput = (e) => { state.fontSize = +e.target.value; applyPrefs(); layoutMargin(); savePrefs(); };
  $("#obCount").onchange = (e) => { state.obCount = Math.max(0, +e.target.value || 0); render(); };
  $("#dlAll").onclick = async (e) => {
    const b = e.target; b.disabled = true;
    try { await downloadAll((d, n) => (b.textContent = `받는 중 ${d}/${n}`)); b.textContent = "오프라인 준비 완료"; }
    catch (err) { b.textContent = "실패 — 다시 시도"; b.disabled = false; }
  };
  $("#dbxOut").onclick = () => { if (confirm("이 기기의 Dropbox 연결을 끊을까요? (주석과 받은 본문은 기기에 남습니다)")) { DBX.logout(); Sync.status(); } };
  $("#useNb").onchange = (e) => { state.useNb = e.target.checked; savePrefs(); render(null, true); };
  $("#maxRefs").onchange = (e) => { state.maxRefs = Math.max(1, +e.target.value || 10); render(); };
  $("#showTsk").onchange = (e) => { state.showTsk = e.target.checked; render(); };
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeSheets));

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.matches(".ref")) peekRef(t.dataset.ref);
    else if (t.matches(".more")) peekAllRefs(+t.dataset.v);
    else if (t.matches("[data-ink-v]")) { closeSheets(); Ink.create(+t.dataset.inkV); }
    else if (t.matches("[data-memo-v]")) { const n = +t.dataset.memoV; Annot.openMemo({ book: state.book, ch: state.ch, v: n, v2: n }); }
    else if (t.matches(".text .vn")) peekParallel(+t.dataset.v);
    else if (t.matches(".fn")) {
      const it = document.querySelector(`.mitem[data-v="${t.dataset.v}"]`);
      if (it && getComputedStyle($("#margin")).display !== "none") { it.animate([{ background: "var(--rule)" }, { background: "transparent" }], 1200); }
    } else if (t.matches("#pickerBody button[data-ch]")) { closeSheets(); go(t.dataset.book, +t.dataset.ch); }
    else if (t.matches("#pickerBody button[data-book]")) openChapters(t.dataset.book);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "Escape") closeSheets();
  });
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { Ink.mountAll(); layoutMargin(); }, 120); });
  document.fonts && document.fonts.ready.then(layoutMargin);
  render();
}
init();
