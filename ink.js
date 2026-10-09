"use strict";
// S Pen 필기 상자 — 절에 붙는 여백 필기. 번역과 무관하다(메모와 같은 규칙).
//
// 필기 항목: { type: "ink", book, ch, v, v2, h, strokes: [{ c, w, p: [[x, y, pressure], …] }] }
// 좌표는 상자 너비를 1로 둔 값이다. 여백 너비가 기기마다 달라도 같은 모양으로 보인다.

const Ink = (() => {
  const COLORS = { k: "#2a2620", r: "#b3261e", b: "#1f5fbf", g: "#2e7d32" };
  const pen = { on: false, color: "k", width: 1, eraser: false };
  let drawing = null; // { id, stroke, canvas }

  const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
  const colorOf = (c) => (c === "k" && isDark() ? "#e8e2d6" : COLORS[c] || COLORS.k);

  // ---- 그리기 ----
  function sizeCanvas(cv, a) {
    const w = cv.parentElement.clientWidth || 200;
    const h = Math.round(w * (a.h || 0.35));
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    return { w, h, dpr };
  }
  function drawStroke(ctx, s, w) {
    const p = s.p;
    ctx.strokeStyle = colorOf(s.c);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (p.length === 1) {
      ctx.beginPath(); ctx.arc(p[0][0] * w, p[0][1] * w, (s.w * 1.2 * (0.4 + p[0][2])) / 2, 0, 7);
      ctx.fillStyle = ctx.strokeStyle; ctx.fill(); return;
    }
    // 필압을 선 굵기에 반영하려고 구간마다 따로 긋는다.
    for (let i = 1; i < p.length; i++) {
      ctx.lineWidth = s.w * 1.2 * (0.4 + (p[i - 1][2] + p[i][2]) / 2);
      ctx.beginPath(); ctx.moveTo(p[i - 1][0] * w, p[i - 1][1] * w); ctx.lineTo(p[i][0] * w, p[i][1] * w); ctx.stroke();
    }
  }
  function paint(cv, a) {
    const { w, h, dpr } = sizeCanvas(cv, a);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const s of a.strokes || []) drawStroke(ctx, s, w);
  }
  function repaintId(id) {
    const a = Store.get(id); if (!a) return;
    document.querySelectorAll(`.ink[data-id="${id}"] canvas`).forEach((cv) => paint(cv, a));
  }

  // ---- 입력 ----
  // 펜(또는 펜 모드의 마우스)만 그린다. 손가락은 스크롤에 남겨 둔다.
  const canDraw = (e) => pen.on && (e.pointerType === "pen" || e.pointerType === "mouse");
  function pt(e, cv) {
    const r = cv.getBoundingClientRect();
    const pr = e.pointerType === "pen" ? (e.pressure || 0.5) : 0.5;
    return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.width).toFixed(4), +pr.toFixed(2)];
  }
  // S Pen 측면 버튼(buttons & 2)이나 지우개 끝(buttons & 32)을 누른 채 그으면 지운다.
  const erasing = (e) => pen.eraser || (e.buttons & 2) || (e.buttons & 32);

  function eraseAt(a, q) {
    const R = 0.03;
    const before = a.strokes.length;
    a.strokes = a.strokes.filter((s) => !s.p.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < R));
    return a.strokes.length !== before;
  }

  function onDown(e) {
    const cv = e.target.closest(".ink canvas");
    if (!cv || !canDraw(e)) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 합성 이벤트 등 포인터가 없을 때 */ }
    const id = cv.closest(".ink").dataset.id;
    const a = Store.get(id); if (!a) return;
    a.strokes = a.strokes || [];
    if (erasing(e)) { drawing = { id, erase: true, canvas: cv }; if (eraseAt(a, pt(e, cv))) repaintId(id); return; }
    const stroke = { c: pen.color, w: pen.width * 2.2, p: [pt(e, cv)] };
    a.strokes.push(stroke);
    drawing = { id, stroke, canvas: cv };
    paint(cv, a);
  }
  function onMove(e) {
    if (!drawing) return;
    e.preventDefault();
    const a = Store.get(drawing.id), cv = drawing.canvas;
    // 펜은 이벤트를 묶어서 보내므로 합쳐진 이벤트까지 모두 쓴다(필기가 각지지 않게).
    const co = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const evs = co.length ? co : [e];
    if (drawing.erase) { if (evs.some((x) => eraseAt(a, pt(x, cv)))) repaintId(drawing.id); return; }
    const w = cv.clientWidth, ctx = cv.getContext("2d");
    for (const x of evs) {
      const q = pt(x, cv), last = drawing.stroke.p[drawing.stroke.p.length - 1];
      if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.002) continue;
      drawing.stroke.p.push(q);
      drawStroke(ctx, { ...drawing.stroke, p: [last, q] }, w);
    }
  }
  function onUp() {
    if (!drawing) return;
    const a = Store.get(drawing.id);
    Store.update(drawing.id, { strokes: a.strokes });
    repaintId(drawing.id);
    drawing = null;
  }

  // ---- 상자 관리 ----
  function create(n) {
    const a = Store.add({ type: "ink", book: state.book, ch: state.ch, v: n, v2: n, h: 0.35, strokes: [] });
    rerender().then(() => {
      const el = document.querySelector(`.margin .ink[data-id="${a.id}"]`) || document.querySelector(`.ink[data-id="${a.id}"]`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
  function boxAction(act, id) {
    const a = Store.get(id); if (!a) return;
    if (act === "undo") { (a.strokes || []).pop(); Store.update(id, { strokes: a.strokes }); repaintId(id); }
    else if (act === "taller") { Store.update(id, { h: Math.min(2, (a.h || 0.35) + 0.15) }); rerender(); }
    else if (act === "shorter") { Store.update(id, { h: Math.max(0.15, (a.h || 0.35) - 0.15) }); rerender(); }
    else if (act === "del") { if ((a.strokes || []).length === 0 || confirm("이 필기 상자를 지울까요?")) { Store.remove(id); rerender(); } }
  }

  // 여백·본문에 넣을 HTML(<p> 안에 들어가므로 span만 쓴다).
  function html(inks) {
    return inks.map((a) => `<span class="ink" data-id="${a.id}"><canvas></canvas>`
      + `<span class="inkbar"><button data-ink="undo" title="되돌리기">↶</button><button data-ink="shorter" title="낮게">−</button>`
      + `<button data-ink="taller" title="높게">＋</button><button data-ink="del" title="상자 지우기">🗑</button></span></span>`).join("");
  }
  function mountAll() {
    document.querySelectorAll(".ink").forEach((el) => {
      const a = Store.get(el.dataset.id);
      const cv = el.querySelector("canvas");
      if (a && cv && el.offsetParent) paint(cv, a);
    });
  }

  // 펜 모드에서 여백이나 본문을 펜으로 누르면, 그 높이의 절에 필기 상자를 만든다.
  function verseAtY(y) {
    let best = null;
    for (const v of document.querySelectorAll("#text .v[id]")) {
      const top = v.getClientRects()[0]?.top;
      if (top !== undefined && top <= y + 4) best = +v.dataset.v;
    }
    return best;
  }
  function onTapCreate(e) {
    if (!canDraw(e) || e.target.closest(".ink, button, .ref, .memo, .more, .sheet, .tool, .bar")) return;
    if (!e.target.closest("#margin, #text")) return;
    const n = verseAtY(e.clientY);
    if (!n) return;
    const has = Store.forChapter(state.book, state.ch).some((a) => a.type === "ink" && a.v === n);
    if (!has) { e.preventDefault(); create(n); }
  }

  function setPen(on) {
    pen.on = on;
    document.body.classList.toggle("pen-on", on);
    $("#penBtn").classList.toggle("on", on);
    $("#penbar").hidden = !on;
    if (on) getSelection().removeAllRanges();
  }

  function init() {
    document.addEventListener("pointerdown", onDown, { passive: false });
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.addEventListener("pointerdown", onTapCreate);
    // 펜이 화면에 닿으면 펜 모드를 자동으로 켠다(갤럭시탭). 손가락 입력은 바꾸지 않는다.
    document.addEventListener("pointerdown", (e) => { if (e.pointerType === "pen" && !pen.on) setPen(true); }, { capture: true });
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ink]");
      if (b) { boxAction(b.dataset.ink, b.closest(".ink").dataset.id); return; }
      const c = e.target.closest("#penbar [data-color]");
      if (c) { pen.color = c.dataset.color; pen.eraser = false; syncBar(); return; }
      if (e.target.closest("#penbar [data-eraser]")) { pen.eraser = !pen.eraser; syncBar(); return; }
      const wbtn = e.target.closest("#penbar [data-width]");
      if (wbtn) { pen.width = +wbtn.dataset.width; syncBar(); }
    });
    $("#penBtn").onclick = () => setPen(!pen.on);
    window.addEventListener("resize", () => setTimeout(mountAll, 150));
    syncBar();
  }
  function syncBar() {
    document.querySelectorAll("#penbar [data-color]").forEach((b) => b.classList.toggle("cur", !pen.eraser && b.dataset.color === pen.color));
    document.querySelectorAll("#penbar [data-width]").forEach((b) => b.classList.toggle("cur", +b.dataset.width === pen.width));
    $("#penbar [data-eraser]").classList.toggle("cur", pen.eraser);
  }

  return { init, html, mountAll, create, isOn: () => pen.on };
})();
