"use strict";
// Dropbox 연결 — OAuth PKCE(서버·App secret 없음). 토큰은 기기별로 localStorage에 둔다.
// 앱 폴더 구조:  /texts/<번역>/<책>.json · /texts/xref/<책>.json · /texts/books.json  (본문, 맥에서 복사)
//               /annotations/<책>.json                                        (주석, 앱이 읽고 씀)

const DBX = (() => {
  const CFG = window.BM_CONFIG || {};
  const KEY = "bm.dbx";
  // 앱이 'Full Dropbox' 권한이면 모든 경로를 이 폴더 아래로 모은다(App folder 앱이면 "" 로 둔다).
  const ROOT = CFG.dropboxRoot || "";
  const full = (p) => ROOT + p;
  const redirect = () => CFG.redirectUri || location.origin + location.pathname;
  let tok = null;
  try { tok = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(tok)); } catch (e) {} };

  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const rand = () => b64url(crypto.getRandomValues(new Uint8Array(48)));

  async function login() {
    if (!CFG.dropboxAppKey) { alert("config.js에 Dropbox App key가 없습니다."); return; }
    const verifier = rand();
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    sessionStorage.setItem("bm.pkce", verifier);
    const q = new URLSearchParams({
      client_id: CFG.dropboxAppKey, response_type: "code", code_challenge: challenge, code_challenge_method: "S256",
      token_access_type: "offline", redirect_uri: redirect(),
      // 필요한 권한을 명시한다. 앱 콘솔에서 이 권한이 꺼져 있으면 Dropbox가 승인 화면에서 바로 알려 준다.
      scope: "files.content.read files.content.write",
    });
    location.href = `https://www.dropbox.com/oauth2/authorize?${q}`;
  }

  // 인증 후 돌아온 주소(?code=…)를 토큰으로 바꾸고 주소를 정리한다.
  async function handleRedirect() {
    const p = new URLSearchParams(location.search);
    const code = p.get("code");
    if (!code) return false;
    const verifier = sessionStorage.getItem("bm.pkce");
    history.replaceState(null, "", location.pathname);
    if (!verifier) { lastError = "로그인 확인값이 없습니다(다른 탭에서 돌아왔거나 세션이 지워짐). 다시 연결해 주세요."; return false; }
    const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({ code, grant_type: "authorization_code", client_id: CFG.dropboxAppKey, code_verifier: verifier, redirect_uri: redirect() }),
    });
    if (!r.ok) { lastError = "로그인(토큰 교환) 실패: " + (await r.text()); alert(lastError); return false; }
    const j = await r.json();
    tok = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in - 60) * 1000, scope: j.scope || "" };
    save();
    sessionStorage.removeItem("bm.pkce");
    return true;
  }

  async function access() {
    if (!tok) throw new Error("not-logged-in");
    if (Date.now() < tok.exp) return tok.access;
    const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh, client_id: CFG.dropboxAppKey }),
    });
    if (!r.ok) { tok = null; save(); throw new Error("refresh-failed"); }
    const j = await r.json();
    tok.access = j.access_token; tok.exp = Date.now() + (j.expires_in - 60) * 1000; save();
    return tok.access;
  }

  // Dropbox-API-Arg 헤더는 ASCII만 허용하므로 비ASCII 문자를 \uXXXX로 바꾼다.
  const arg = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

  async function rpc(path, body) {
    const r = await fetch(`https://api.dropboxapi.com/2/${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${await access()}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) { const t = await r.text(); const e = new Error(t); e.status = r.status; throw e; }
    return r.json();
  }
  // 파일 내려받기: { text, rev } 또는 없으면 null
  async function download(path) {
    const r = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST", headers: { Authorization: `Bearer ${await access()}`, "Dropbox-API-Arg": arg({ path: full(path) }) },
    });
    if (r.status === 409) return null;
    if (!r.ok) throw new Error(await r.text());
    const meta = JSON.parse(r.headers.get("Dropbox-API-Result") || "{}");
    return { text: await r.text(), rev: meta.rev };
  }
  // rev를 주면 그 판 위에만 덮어쓴다(다른 기기가 먼저 바꿨으면 409 → 다시 병합).
  async function upload(path, text, rev) {
    const mode = rev ? { ".tag": "update", update: rev } : { ".tag": "overwrite" };
    const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${await access()}`, "Dropbox-API-Arg": arg({ path: full(path), mode, mute: true }), "Content-Type": "application/octet-stream" },
      body: new TextEncoder().encode(text),
    });
    if (r.status === 409) { const e = new Error("conflict"); e.conflict = true; throw e; }
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).rev;
  }
  async function listFolder(path) {
    try {
      let j = await rpc("files/list_folder", { path: full(path) });
      const out = [...j.entries];
      while (j.has_more) { j = await rpc("files/list_folder/continue", { cursor: j.cursor }); out.push(...j.entries); }
      return out;
    } catch (e) { if (e.status === 409) return []; throw e; }
  }

  // Dropbox는 앱이 처음 파일을 쓸 때 앱 폴더를 만든다. 연결 직후 안내 파일을 하나 써서 폴더를 만든다.
  async function ensureFolder() {
    if (!tok || localStorage.getItem("bm.dbxReady")) return;
    try {
      const has = await download("/README.txt");
      if (!has) await upload("/README.txt", "관주 여백 성경 앱 폴더\n\ntexts/        성경 본문·관주 (맥에서 복사)\nannotations/  주석 (앱이 자동 동기화)\n");
      localStorage.setItem("bm.dbxReady", "1");
    } catch (e) { lastError = "앱 폴더 준비 실패: " + (e.message || e); console.warn(lastError); }
  }
  let lastError = null;

  return {
    login, handleRedirect, ensureFolder, download, upload, listFolder,
    loggedIn: () => !!tok,
    logout: () => { tok = null; save(); },
    configured: () => !!CFG.dropboxAppKey,
    error: () => lastError,
    scope: () => (tok && tok.scope) || "(기록 없음)",
  };
})();
