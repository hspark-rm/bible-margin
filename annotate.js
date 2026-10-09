"use strict";
// 하이라이트·밑줄·메모 — 선택 영역을 (절, 글자 위치) 좌표로 바꾸고 주석 도구 막대를 띄운다.

const Annot = (() => {
  let cur = null; // { kind: "sel", rng } | { kind: "ann", id }

  // ---- 선택 영역 → 주석 좌표 ----
  const tEls = () => [...document.querySelectorAll("#text .t")];
  const vOf = (t) => +t.closest(".v").dataset.v;

  function startPoint(node, off) {
    if (node.nodeType === 3 && node.parentElement.matches(".t")) {
      const t = node.parentElement; return { v: vOf(t), o: +t.dataset.o + off };
    }
    // 절 번호·각주 표지 위에서 시작하면, 그 뒤 첫 본문 글자로 옮긴다.
    const r = document.createRange(); r.setStart(node, off);
    const t = tEls().find((t) => r.comparePoint(t, 0) >= 0);
    return t ? { v: vOf(t), o: +t.dataset.o } : null;
  }
  function endPoint(node, off) {
    if (node.nodeType === 3 && node.parentElement.matches(".t")) {
      const t = node.parentElement; return { v: vOf(t), o: +t.dataset.o + off };
    }
    const r = document.createRange(); r.setStart(node, off);
    const t = tEls().reverse().find((t) => r.comparePoint(t, t.childNodes.length) <= 0);
    return t ? { v: vOf(t), o: +t.dataset.o + t.textContent.length } : null;
  }
  function selectionRange() {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    if (!$("#text").contains(r.commonAncestorContainer)) return null;
    const a = startPoint(r.startContainer, r.startOffset), b = endPoint(r.endContainer, r.endOffset);
    if (!a || !b || a.v > b.v || (a.v === b.v && a.o >= b.o)) return null;
    return { v: a.v, s: a.o, v2: b.v, e: b.o, rect: r.getBoundingClientRect() };
  }

  // ---- 도구 막대 ----
  function showTool(rect, kind) {
    const tool = $("#tool");
    tool.dataset.kind = kind;
    tool.hidden = false;
    const w = tool.offsetWidth, h = tool.offsetHeight;
    // 안드로이드는 선택 영역 위쪽에 자체 메뉴를 띄우므로, 막대는 아래쪽에 둔다.
    let top = rect.bottom + 10;
    if (top + h > innerHeight - 8) top = Math.max(8, rect.top - h - 10);
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), innerWidth - w - 8);
    tool.style.top = `${top}px`; tool.style.left = `${left}px`;
  }
  function hideTool() { $("#tool").hidden = true; cur = null; }

  let selTimer;
  function onSelection() {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      if (typeof Ink !== "undefined" && Ink.isOn()) return;  // 펜 모드에서는 글자 선택 도구를 띄우지 않는다
      const rng = selectionRange();
      if (rng) { cur = { kind: "sel", rng }; showTool(rng.rect, "sel"); }
      else if (cur && cur.kind === "sel") hideTool();
    }, 250);
  }

  const before = (v1, o1, v2, o2) => v1 < v2 || (v1 === v2 && o1 <= o2);

  function apply(act, val) {
    if (!cur) return;
    if (cur.kind === "sel") {
      const { v, s, v2, e } = cur.rng;
      const base = { book: state.book, ch: state.ch, v, v2 };
      if (act === "memo") { getSelection().removeAllRanges(); hideTool(); openMemo({ ...base }); return; }
      const type = act === "ul" ? "ul" : "hl";
      // 같은 종류 주석이 새 범위 안에 완전히 들어가면 새 것으로 바꾼다(겹쳐 칠하기 방지).
      for (const a of Store.forChapter(state.book, state.ch)) {
        if (a.type === type && a.trans === state.trans && before(v, s, a.v, a.s) && before(a.v2, a.e, v2, e)) Store.remove(a.id);
      }
      Store.add({ ...base, type, trans: state.trans, s, e, ...(type === "hl" ? { color: +val } : { style: val }) });
      getSelection().removeAllRanges();
    } else {
      const a = Store.get(cur.id);
      if (!a) return hideTool();
      if (act === "del") Store.remove(a.id);
      else if (act === "hl" && a.type === "hl") Store.update(a.id, { color: +val });
      else if (act === "ul" && a.type === "ul") Store.update(a.id, { style: val });
      else if (act === "memo") { hideTool(); openMemo({ book: a.book, ch: a.ch, v: a.v, v2: a.v2 }); return; }
      else if (act === "hl" || act === "ul") {
        // 하이라이트 위에 밑줄(또는 반대)을 같은 범위로 덧붙인다.
        const type = act;
        Store.add({ book: a.book, ch: a.ch, v: a.v, v2: a.v2, type, trans: a.trans, s: a.s, e: a.e, ...(type === "hl" ? { color: +val } : { style: val }) });
      }
    }
    hideTool();
    rerender();
  }

  // ---- 메모 편집 ----
  let editing = null;
  function openMemo(m) {
    closeSheets();
    editing = m;
    const b = BOOK[m.book];
    $("#memoTitle").textContent = `${b.abbr} ${m.ch}:${m.v}${m.v2 !== m.v ? "–" + m.v2 : ""} 메모`;
    $("#memoText").value = m.text || "";
    $("#memoTags").value = (m.tags || []).join(", ");
    Lib.setupMemo(m);
    $("#memoDel").hidden = !m.id;
    $("#memoSheet").hidden = false;
    setTimeout(() => $("#memoText").focus(), 50);
  }
  function saveMemo() {
    if (!editing) return;
    const text = $("#memoText").value.trim();
    const tags = $("#memoTags").value.split(/[,#\s]+/).map((t) => t.trim()).filter(Boolean);
    const { src, quote, nb } = Lib.readMemo();
    const fields = { text, tags, src, quote, ...(nb !== undefined ? { nb } : {}) };
    // 인용문이나 내 생각 중 하나라도 있으면 저장한다.
    if (editing.id) {
      if (text || quote) Store.update(editing.id, fields); else Store.remove(editing.id);
    } else if (text || quote) {
      Store.add({ type: "memo", book: editing.book, ch: editing.ch, v: editing.v, v2: editing.v2, ...fields });
    }
    editing = null; closeSheets(); rerender();
  }

  // ---- 백업 ----
  function exportFile() {
    const blob = new Blob([Store.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bible-margin-주석-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importFile(file) {
    file.text().then((t) => {
      try { const n = Store.importJSON(t); alert(`${n}개 항목을 가져왔습니다.`); rerender(); }
      catch (e) { alert("파일을 읽지 못했습니다: " + e.message); }
    });
  }

  function init() {
    document.addEventListener("selectionchange", onSelection);
    const tool = $("#tool");
    // 막대를 누를 때 선택 영역이 풀리지 않게 한다(태블릿 터치 포함).
    tool.addEventListener("pointerdown", (e) => e.preventDefault());
    tool.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      apply(b.dataset.act, b.dataset.val);
    });
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest("#tool")) return;
      const memo = t.closest(".memo, .memo-dot");
      if (memo) { const m = Store.get(memo.dataset.id); if (m) openMemo({ ...m }); return; }
      const marked = t.closest("#text .t[data-a]");
      if (marked && getSelection().isCollapsed) {
        const id = marked.dataset.a.split(",").pop();
        cur = { kind: "ann", id };
        showTool(marked.getBoundingClientRect(), "ann");
        return;
      }
      if (cur && cur.kind === "ann") hideTool();
    });
    $("#memoSave").onclick = saveMemo;
    $("#memoDel").onclick = () => { if (editing && editing.id) { Store.remove(editing.id); editing = null; closeSheets(); rerender(); } };
    $("#memoText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveMemo(); });
    $("#exportBtn").onclick = exportFile;
    $("#importInput").onchange = (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; };
    window.addEventListener("scroll", () => { if (cur && cur.kind === "ann") hideTool(); }, { passive: true });
  }

  return { init, openMemo, hideTool };
})();
