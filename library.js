"use strict";
// 서재(참고도서)와 공책. 둘 다 주석 저장소에 book: "_lib"로 저장되어 annotations/_lib.json으로 동기화된다.
//   책:   { type: "lib", title, author, publisher, year, note }
//   공책: { type: "nb", name, color }
// 메모는 src: { lib, page }, quote, nb 로 이 항목들을 가리킨다.

const Lib = (() => {
  const NB_COLORS = ["#c0862a", "#1f5fbf", "#2e7d32", "#9a6b00", "#7b3fa0", "#00838f"];
  const all = (type) => Store.live().filter((a) => a.type === type && a.book === "_lib");
  const books = () => all("lib").sort((a, b) => (a.author || "").localeCompare(b.author || "", "ko") || a.title.localeCompare(b.title, "ko"));
  const notebooks = () => all("nb").sort((a, b) => a.createdAt - b.createdAt);
  const get = (id) => { const a = Store.get(id); return a && !a.deleted ? a : null; };

  // 여백·목록에 쓰는 짧은 출처 표기: "켈러, 『기도』 45"
  function cite(src) {
    if (!src || !src.lib) return "";
    const b = get(src.lib);
    if (!b) return "(지운 책)";
    const au = (b.author || "").split(/[,·&]/)[0].trim();
    const last = /[가-힣]/.test(au) ? au : au.split(/\s+/).pop();
    return `${last ? last + ", " : ""}『${b.title}』${src.page ? " " + src.page : ""}`;
  }
  const nbColor = (id) => (get(id) || {}).color || "";

  // ---- 메모 창의 출처 고르기 ----
  let picked = null; // 고른 책 id
  function renderPicker() {
    const box = $("#srcBox");
    const b = picked && get(picked);
    if (b) {
      box.innerHTML = `<span class="src-chosen">📖 ${esc(b.author ? b.author + ", " : "")}『${esc(b.title)}』</span><button type="button" class="pill ghost sm" data-src="clear">출처 빼기</button>`;
      $("#srcExtra").hidden = false;
      return;
    }
    box.innerHTML = `<input id="srcQ" placeholder="출처 책 검색 (제목·저자) — 비우면 묵상 메모" autocomplete="off"><div id="srcList" class="src-list"></div>`;
    $("#srcExtra").hidden = true;
    $("#srcQ").oninput = listMatches;
  }
  function listMatches() {
    const q = $("#srcQ").value.trim().toLowerCase();
    const list = $("#srcList");
    if (!q) { list.innerHTML = ""; return; }
    const hits = books().filter((b) => (b.title + " " + (b.author || "")).toLowerCase().includes(q)).slice(0, 8);
    list.innerHTML = hits.map((b) => `<button type="button" data-src="pick" data-id="${b.id}">${esc(b.title)} <small>${esc(b.author || "")}</small></button>`).join("")
      + `<button type="button" data-src="new" class="new">＋ 새 책 “${esc($("#srcQ").value.trim())}”</button>`;
  }
  function setupMemo(m) {
    picked = (m.src && m.src.lib) || null;
    $("#memoPage").value = (m.src && m.src.page) || "";
    $("#memoQuote").value = m.quote || "";
    renderPicker();
    const nbOn = state.useNb;
    $("#nbRow").hidden = !nbOn;
    if (nbOn) {
      const nbs = notebooks();
      const cur = m.id ? m.nb || "" : state.lastNb || "";
      $("#memoNb").innerHTML = `<option value="">(공책 없음)</option>` + nbs.map((n) => `<option value="${n.id}" ${n.id === cur ? "selected" : ""}>${esc(n.name)}</option>`).join("");
    }
  }
  // 저장할 값: { src, quote, nb }
  function readMemo() {
    const out = { quote: $("#memoQuote").value.trim(), src: null, nb: undefined };
    if (picked) out.src = { lib: picked, page: $("#memoPage").value.trim() };
    else out.quote = "";
    if (state.useNb) { out.nb = $("#memoNb").value || null; state.lastNb = out.nb; savePrefs(); }
    return out;
  }
  function addBook(fields) {
    return Store.add({ type: "lib", book: "_lib", ch: 0, v: 0, v2: 0, title: fields.title, author: fields.author || "", publisher: fields.publisher || "", year: fields.year || "", note: fields.note || "" });
  }

  // ---- 서재 화면 ----
  let tab = "books", view = null, nbSort = "recent";
  const osisIdx = (o) => (typeof ORDER !== "undefined" ? ORDER.indexOf(o) : 0);
  const bibleOrder = (a, b) => osisIdx(a.book) - osisIdx(b.book) || a.ch - b.ch || a.v - b.v;
  const refLabel = (m) => `${BOOK[m.book] ? BOOK[m.book].abbr : m.book} ${m.ch}:${m.v}${m.v2 !== m.v ? "–" + m.v2 : ""}`;
  const memos = () => Store.live().filter((a) => a.type === "memo");

  function entry(m, showSrc) {
    const first = (s) => esc((s || "").split("\n")[0].slice(0, 90));
    return `<button class="entry" data-go="${m.book}.${m.ch}.${m.v}">
      <span class="eref">${refLabel(m)}</span>
      ${showSrc && m.src ? `<span class="ecite">📖 ${esc(cite(m.src))}</span>` : !showSrc && m.src && m.src.page ? `<span class="ecite">${esc(m.src.page)}</span>` : ""}
      ${m.quote ? `<span class="equote">${first(m.quote)}</span>` : ""}
      ${m.text ? `<span class="etext">${first(m.text)}</span>` : ""}</button>`;
  }

  function render() {
    const body = $("#libBody");
    $("#libTabs").innerHTML = `<button data-tab="books" class="${tab === "books" ? "cur" : ""}">책</button>`
      + (state.useNb ? `<button data-tab="nbs" class="${tab === "nbs" ? "cur" : ""}">공책</button>` : "");
    if (view && view.kind === "book") return renderBook(body, view.id);
    if (view && view.kind === "nb") return renderNb(body, view.id);
    if (tab === "nbs" && state.useNb) {
      const nbs = notebooks();
      body.innerHTML = `<div class="row"><input id="nbName" placeholder="새 공책 이름 (예: 묵상, 조직신학)"><button class="pill" data-lib="addNb">추가</button></div>`
        + (nbs.length ? nbs.map((n) => `<button class="lib-item" data-nb="${n.id}"><span class="dot" style="background:${n.color}"></span>${esc(n.name)} <small>${memos().filter((m) => m.nb === n.id).length}개</small></button>`).join("")
          : `<p class="merged">공책이 없습니다.</p>`);
      return;
    }
    const q = (state.libQ || "").toLowerCase();
    const list = books().filter((b) => !q || (b.title + " " + (b.author || "")).toLowerCase().includes(q));
    const count = (id) => memos().filter((m) => m.src && m.src.lib === id).length;
    body.innerHTML = `<div class="row"><input id="libQ" placeholder="제목·저자 검색" value="${esc(state.libQ || "")}"><button class="pill" data-lib="newBook">＋ 새 책</button></div>`
      + (list.length ? list.map((b) => `<button class="lib-item" data-book-id="${b.id}"><b>${esc(b.title)}</b> <span>${esc(b.author || "")}${b.year ? " · " + esc(b.year) : ""}</span> <small>${count(b.id)}구절</small></button>`).join("")
        : `<p class="merged">${books().length ? "검색 결과가 없습니다." : "서재가 비어 있습니다. 메모 창에서 출처를 고르거나 여기서 책을 추가하세요."}</p>`);
    $("#libQ").oninput = (e) => { state.libQ = e.target.value; const pos = e.target.selectionStart; render(); const i = $("#libQ"); i.focus(); i.setSelectionRange(pos, pos); };
  }

  function renderBook(body, id) {
    const b = id === "new" ? { title: "", author: "", publisher: "", year: "", note: "" } : get(id);
    if (!b) { view = null; return render(); }
    const linked = id === "new" ? [] : memos().filter((m) => m.src && m.src.lib === id).sort(bibleOrder);
    body.innerHTML = `<button class="back" data-lib="back">‹ 서재</button>
      <div class="book-form">
        <input id="bTitle" placeholder="제목 (필수)" value="${esc(b.title)}">
        <input id="bAuthor" placeholder="저자" value="${esc(b.author || "")}">
        <div class="row"><input id="bPub" placeholder="출판사" value="${esc(b.publisher || "")}"><input id="bYear" placeholder="연도" value="${esc(b.year || "")}" class="short"></div>
        <textarea id="bNote" rows="2" placeholder="책 메모 (읽은 때, 한 줄 평 등)">${esc(b.note || "")}</textarea>
        <div class="row"><button class="pill" data-lib="saveBook">저장</button>${id !== "new" ? `<button class="pill ghost" data-lib="delBook">책 지우기</button>` : ""}</div>
      </div>
      ${id !== "new" ? `<h4>연결된 구절 ${linked.length}개 · 성경 순</h4>${linked.map((m) => entry(m, false)).join("") || '<p class="merged">아직 없습니다. 메모 창에서 이 책을 출처로 고르세요.</p>'}` : ""}`;
  }

  function renderNb(body, id) {
    const n = get(id);
    if (!n) { view = null; return render(); }
    const list = memos().filter((m) => m.nb === id).sort(nbSort === "bible" ? bibleOrder : (a, b) => b.updatedAt - a.updatedAt);
    body.innerHTML = `<button class="back" data-lib="back">‹ 공책</button>
      <div class="row nb-head"><span class="dot" style="background:${n.color}"></span><input id="nbRename" value="${esc(n.name)}">
        <button class="pill ghost sm" data-lib="sort">${nbSort === "bible" ? "성경 순" : "최근 순"}</button><button class="pill ghost sm" data-lib="delNb">공책 지우기</button></div>
      ${list.map((m) => entry(m, true)).join("") || '<p class="merged">이 공책에 담긴 메모가 없습니다.</p>'}`;
    $("#nbRename").onchange = (e) => { if (e.target.value.trim()) Store.update(id, { name: e.target.value.trim() }); };
  }

  function act(a, el) {
    if (a === "back") { view = null; }
    else if (a === "newBook") { view = { kind: "book", id: "new" }; }
    else if (a === "saveBook") {
      const f = { title: $("#bTitle").value.trim(), author: $("#bAuthor").value.trim(), publisher: $("#bPub").value.trim(), year: $("#bYear").value.trim(), note: $("#bNote").value.trim() };
      if (!f.title) { $("#bTitle").focus(); return; }
      if (view.id === "new") { const b = addBook(f); view = { kind: "book", id: b.id }; } else Store.update(view.id, f);
    }
    else if (a === "delBook") {
      const n = memos().filter((m) => m.src && m.src.lib === view.id).length;
      if (!confirm(n ? `이 책을 지울까요? 연결된 메모 ${n}개는 남고, 출처는 "(지운 책)"으로 바뀝니다.` : "이 책을 지울까요?")) return;
      Store.remove(view.id); view = null; rerender();
    }
    else if (a === "addNb") {
      const name = $("#nbName").value.trim(); if (!name) return;
      Store.add({ type: "nb", book: "_lib", ch: 0, v: 0, v2: 0, name, color: NB_COLORS[notebooks().length % NB_COLORS.length] });
    }
    else if (a === "sort") { nbSort = nbSort === "bible" ? "recent" : "bible"; }
    else if (a === "delNb") {
      if (!confirm("이 공책을 지울까요? 메모는 남고 공책 표시만 빠집니다.")) return;
      Store.remove(view.id); view = null; rerender();
    }
    render();
  }

  function open(initialTab) {
    closeSheets();
    if (initialTab) tab = initialTab;
    view = null;
    $("#libSheet").hidden = false;
    render();
  }

  function init() {
    $("#libBtn").onclick = () => open();
    $("#libSheet").addEventListener("click", (e) => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.tab) { tab = t.dataset.tab; view = null; render(); }
      else if (t.dataset.lib) act(t.dataset.lib, t);
      else if (t.dataset.bookId) { view = { kind: "book", id: t.dataset.bookId }; render(); }
      else if (t.dataset.nb) { view = { kind: "nb", id: t.dataset.nb }; render(); }
      else if (t.dataset.go) { const [b, c, v] = t.dataset.go.split("."); closeSheets(); go(b, +c, +v); }
    });
    // 메모 창의 출처 고르기
    $("#memoSheet").addEventListener("click", (e) => {
      const t = e.target.closest("[data-src]"); if (!t) return;
      if (t.dataset.src === "pick") { picked = t.dataset.id; renderPicker(); $("#memoPage").focus(); }
      else if (t.dataset.src === "clear") { picked = null; renderPicker(); }
      else if (t.dataset.src === "new") {
        const title = $("#srcQ").value.trim(); if (!title) return;
        const author = prompt(`『${title}』의 저자 (모르면 비워 두세요)`, "") || "";
        picked = addBook({ title, author }).id; renderPicker(); $("#memoPage").focus();
      }
    });
  }

  return { init, open, cite, nbColor, setupMemo, readMemo };
})();
