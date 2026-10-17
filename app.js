import { esc, inline, parseMarkdown, plain, renderMarkdown } from "./md.js";

const DEFAULT_REPO = "kosei-matsuzaki/job-hunting";
const DATA_PATH = "data/companies.json";
const DOC_GROUPS = [
  { dir: "profile", label: "ES・面接の素材" },
  { dir: "notes", label: "企業研究・提出物" },
];
const EXTRA_DOCS = [{ path: "links.md", name: "就活サイト・対策" }];

// 一覧の並び順。ここにないステータスは「準備中」の末尾に入る
const STATUSES = [
  "内定", "最終面接", "二次面接", "一次面接", "面接", "WEBテスト", "書類選考", "ES提出",
  "エントリー", "インターン", "説明会", "情報更新待ち", "エントリー待ち", "辞退", "不合格",
];
const IN_PROGRESS = new Set(["内定", "最終面接", "二次面接", "一次面接", "面接", "WEBテスト", "書類選考", "ES提出"]);
const CLOSED = new Set(["辞退", "不合格"]);
const WD = "日月火水木金土";
const PAST_DAYS = 14;

// ---------- 端末内の保存（トークン・キャッシュ） ----------

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できない環境では毎回入力 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
};

const cfg = {
  token: store.get("jh.token"),
  repo: store.get("jh.repo") || DEFAULT_REPO,
};

const state = {
  companies: [],
  sha: null,
  loaded: false,
  loading: false,
  error: null,
  docs: null,
  docCache: new Map(),
};

// ---------- GitHub API ----------

class ApiError extends Error {
  constructor(status, body) {
    super(`GitHub API ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

function b64decode(s) {
  const bin = atob(s.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function b64encode(text) {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function readFile(path) {
  const r = await api(`contents/${encPath(path)}`);
  return { text: b64decode(r.content), sha: r.sha };
}

async function writeFile(path, text, sha, message) {
  const r = await api(`contents/${encPath(path)}`, {
    method: "PUT",
    body: { message, content: b64encode(text), ...(sha ? { sha } : {}) },
  });
  return r.content.sha;
}

async function listDocs(dir) {
  try {
    const files = await api(`contents/${encPath(dir)}`);
    return files.filter((f) => f.type === "file" && f.name.endsWith(".md")).map((f) => f.path);
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

function explain(e) {
  if (e.status === 401) return "トークンが無効か、期限が切れています。設定から新しいトークンを入れてください。";
  if (e.status === 403) return "このトークンには権限がありません。Contents の Read and write を付けたトークンにしてください。";
  if (e.status === 404) return `${cfg.repo} にファイルが見つかりません。リポジトリ名とトークンの対象リポジトリを確認してください。`;
  if (e instanceof TypeError) return "GitHub に接続できません。電波の状況を確認してください。";
  return `読み込みに失敗しました（${e.message}）`;
}

// ---------- データの読み書き ----------

function loadCache() {
  try {
    const c = JSON.parse(store.get("jh.cache") || "null");
    if (c?.repo === cfg.repo) {
      state.companies = c.companies;
      state.sha = c.sha;
      state.loaded = true;
    }
  } catch { /* キャッシュが壊れていたら無視 */ }
}

function saveCache() {
  store.set("jh.cache", JSON.stringify({ repo: cfg.repo, companies: state.companies, sha: state.sha }));
}

async function loadCompanies() {
  state.loading = true;
  renderChrome();
  try {
    const { text, sha } = await readFile(DATA_PATH);
    state.companies = JSON.parse(text).companies || [];
    state.sha = sha;
    state.loaded = true;
    state.error = null;
    saveCache();
  } catch (e) {
    state.error = explain(e);
  } finally {
    state.loading = false;
  }
}

async function saveCompanies(message) {
  const text = JSON.stringify({ companies: state.companies }, null, 2) + "\n";
  try {
    state.sha = await writeFile(DATA_PATH, text, state.sha, message);
    saveCache();
    toast("保存しました");
    return true;
  } catch (e) {
    if (e.status === 409 || e.status === 422) {
      await loadCompanies();
      render();
      toast("別の端末で更新されていたため、最新の内容を読み込み直しました。もう一度操作してください。", true);
    } else {
      toast(explain(e), true);
    }
    return false;
  }
}

async function loadDocList() {
  const groups = await Promise.all(DOC_GROUPS.map(async (g) => ({ ...g, paths: await listDocs(g.dir) })));
  state.docs = groups;
}

async function getDoc(path, fresh = false) {
  if (!fresh && state.docCache.has(path)) return state.docCache.get(path);
  const doc = await readFile(path);
  state.docCache.set(path, doc);
  return doc;
}

// ---------- 日付 ----------

function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isoToday() {
  const d = today();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const daysUntil = (s) => Math.round((parseDate(s) - today()) / 86400000);

function fmtDate(s, withYear = false) {
  const d = parseDate(s);
  const base = `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  return withYear ? `${d.getFullYear()}/${base}` : base;
}

const otherYear = (s) => parseDate(s).getFullYear() !== today().getFullYear();

function whenText(e) {
  let s = fmtDate(e.date, otherYear(e.date)) + (e.time ? ` ${e.time}` : "");
  if (e.start) s = `${fmtDate(e.start, otherYear(e.start))}${e.startTime ? ` ${e.startTime}` : ""} 〜 ${s}`;
  return s;
}

function remainText(n) {
  if (n === 0) return "今日";
  if (n === 1) return "明日";
  if (n < 0) return `${-n}日前`;
  return `あと${n}日`;
}

const urgency = (n) => (n <= 3 ? "urgent" : n <= 7 ? "soon" : "");
const eventTitle = (e) => esc(e.title) + (e.tentative ? '<span class="tentative">目安</span>' : "");

// ---------- 企業 ----------

const bySlug = (slug) => state.companies.find((c) => c.slug === slug);

function statusRank(c) {
  const i = STATUSES.indexOf(c.status);
  return i < 0 ? STATUSES.indexOf("エントリー待ち") : i;
}

function flowIndex(c) {
  const f = c.flow || [];
  const s = c.status || "";
  const exact = f.indexOf(s);
  if (exact >= 0) return exact;
  return f.findIndex((x) => s.includes(x) || (s.length >= 2 && x.includes(s)));
}

function allEvents() {
  return state.companies.flatMap((c) => (c.events || []).map((e, i) => ({ ...e, c, i })));
}

const evKey = (e) => e.date + (e.time || "99:99");

function nextEvent(c) {
  return (c.events || [])
    .filter((e) => !e.done && daysUntil(e.date) >= 0)
    .sort((a, b) => evKey(a).localeCompare(evKey(b)))[0];
}

function routeMini(c) {
  const f = c.flow || [];
  if (!f.length) return "";
  const idx = flowIndex(c);
  const dots = f.map((_, i) => `<span class="st${i < idx ? " past" : i === idx ? " now" : ""}"></span>`).join("");
  return `<span class="route-mini" aria-hidden="true">${dots}</span>`;
}

// ---------- 画面 ----------

const $view = () => document.getElementById("view");

function viewSchedule() {
  const live = allEvents().filter((e) => !e.done && !CLOSED.has(e.c.status));
  const upcoming = live.filter((e) => daysUntil(e.date) >= 0).sort((a, b) => evKey(a).localeCompare(evKey(b)));
  const past = live
    .filter((e) => daysUntil(e.date) < 0 && daysUntil(e.date) >= -PAST_DAYS)
    .sort((a, b) => evKey(b).localeCompare(evKey(a)));
  const todos = state.companies.filter((c) => c.todo?.length && !CLOSED.has(c.status));

  let html = "";
  const [head, ...rest] = upcoming;
  if (head) {
    const n = daysUntil(head.date);
    const count = n <= 1
      ? `<span class="next-num word">${n === 0 ? "今日" : "明日"}</span>`
      : `<span class="next-num">${n}</span><span class="next-unit">日</span>`;
    html += `
      <section class="next ${urgency(n)}">
        <p class="next-label">次の締切まで</p>
        <div class="next-main">
          <div class="next-count">${count}</div>
          <div class="next-body">
            <a class="next-company" href="#/c/${esc(head.c.slug)}">${esc(head.c.name)}</a>
            <p class="next-title">${eventTitle(head)}</p>
            <p class="next-when">${esc(whenText(head))}</p>
          </div>
        </div>
        <button class="next-done" data-done="${esc(head.c.slug)}:${head.i}">済みにする</button>
      </section>`;
  } else {
    html += `<section class="empty">登録されている予定はありません。企業ページの「編集」から締切を追加してください。</section>`;
  }

  if (rest.length) {
    html += `<h2 class="sec">この先の予定</h2><ol class="timetable">`;
    let month = head ? parseDate(head.date).getMonth() : -1;
    for (const e of rest) {
      const d = parseDate(e.date);
      if (d.getMonth() !== month) {
        month = d.getMonth();
        html += `<li class="month">${d.getFullYear() !== today().getFullYear() ? `${d.getFullYear()}年` : ""}${month + 1}月</li>`;
      }
      const n = daysUntil(e.date);
      html += `
        <li class="tt-row ${urgency(n)}">
          <div class="tt-when">
            <span class="tt-date">${esc(fmtDate(e.date))}</span>
            <span class="tt-time">${esc(e.time || "")}</span>
          </div>
          <div class="tt-what">
            <a href="#/c/${esc(e.c.slug)}">${esc(e.c.name)}</a>
            <span>${eventTitle(e)}</span>
            ${e.start && daysUntil(e.start) > 0 ? `<span class="tt-start">${esc(fmtDate(e.start))}${e.startTime ? ` ${esc(e.startTime)}` : ""} から</span>` : ""}
          </div>
          <div class="tt-left">${esc(remainText(n))}</div>
          <button class="tick" data-done="${esc(e.c.slug)}:${e.i}" aria-label="${esc(e.c.name)} ${esc(e.title)} を済みにする"></button>
        </li>`;
    }
    html += `</ol>`;
  }

  if (past.length) {
    html += `<h2 class="sec">期限が過ぎた予定</h2>
      <p class="hint">終わっていたら ✓ を押すと一覧から消えます。</p><ol class="timetable past">`;
    for (const e of past) {
      html += `
        <li class="tt-row">
          <div class="tt-when"><span class="tt-date">${esc(fmtDate(e.date))}</span><span class="tt-time">${esc(e.time || "")}</span></div>
          <div class="tt-what"><a href="#/c/${esc(e.c.slug)}">${esc(e.c.name)}</a><span>${eventTitle(e)}</span></div>
          <div class="tt-left">${esc(remainText(daysUntil(e.date)))}</div>
          <button class="tick" data-done="${esc(e.c.slug)}:${e.i}" aria-label="${esc(e.c.name)} ${esc(e.title)} を済みにする"></button>
        </li>`;
    }
    html += `</ol>`;
  }

  if (todos.length) {
    const total = todos.reduce((n, c) => n + c.todo.length, 0);
    html += `<details class="todos"><summary>調べること・転記すること（${total}件）</summary><ul>`;
    for (const c of todos) {
      html += `<li><a href="#/c/${esc(c.slug)}">${esc(c.name)}</a><ul>${c.todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></li>`;
    }
    html += `</ul></details>`;
  }
  return html;
}

function viewCompanies() {
  const sorted = [...state.companies].sort((a, b) => statusRank(a) - statusRank(b) || a.name.localeCompare(b.name, "ja"));
  const groups = [
    { label: "選考中", items: sorted.filter((c) => IN_PROGRESS.has(c.status) || (!CLOSED.has(c.status) && flowIndex(c) >= 0)) },
    { label: "準備中", items: sorted.filter((c) => !IN_PROGRESS.has(c.status) && !CLOSED.has(c.status) && flowIndex(c) < 0) },
    { label: "終了", items: sorted.filter((c) => CLOSED.has(c.status)) },
  ];
  let html = `<div class="list-head"><h1 class="page-title">企業</h1><a class="btn" href="#/new">企業を追加</a></div>`;
  for (const g of groups) {
    if (!g.items.length) continue;
    html += `<h2 class="sec">${g.label}<span class="count">${g.items.length}</span></h2><ul class="companies">`;
    for (const c of g.items) {
      const nx = nextEvent(c);
      html += `
        <li><a class="co" href="#/c/${esc(c.slug)}">
          <span class="co-name">${esc(c.name)}</span>
          <span class="co-ind">${esc(c.industry || "")}</span>
          <span class="co-status">${routeMini(c)}<span>${esc(c.status || "未設定")}</span></span>
          ${nx ? `<span class="co-next ${urgency(daysUntil(nx.date))}">${esc(fmtDate(nx.date, otherYear(nx.date)))} ${esc(nx.title)}</span>` : ""}
        </a></li>`;
    }
    html += `</ul>`;
  }
  return html;
}

function copyRow(label, value, secret = false) {
  if (!value) return "";
  const shown = secret ? "•".repeat(Math.min(value.length, 10)) : esc(value);
  return `
    <div class="cred">
      <span class="cred-label">${label}</span>
      <code class="cred-value${secret ? " secret" : ""}" data-value="${esc(value)}">${shown}</code>
      ${secret ? `<button class="mini" data-reveal>表示</button>` : ""}
      <button class="mini" data-copy="${esc(value)}">コピー</button>
    </div>`;
}

function mypageBlock(c) {
  const m = c.mypage || {};
  if (!m.url && !m.id && !m.password) return "";
  return `
    ${m.url ? `<a class="btn wide" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">マイページを開く</a>` : `<p class="hint">マイページのURLが未登録です</p>`}
    ${copyRow("ID", m.id)}
    ${copyRow("パスワード", m.password, true)}`;
}

function viewCompany(slug) {
  const c = bySlug(slug);
  if (!c) return `<p class="empty">この企業は見つかりません。<a href="#/companies">企業一覧に戻る</a></p>`;
  const f = c.flow || [];
  const idx = flowIndex(c);
  const meta = [
    c.industry,
    c.salary ? `初任給 ¥${Number(c.salary).toLocaleString()}` : "",
    c.lastAction ? `最終アクション ${fmtDate(c.lastAction, true)}` : "",
  ].filter(Boolean);
  const options = [...new Set([...STATUSES, c.status].filter(Boolean))]
    .map((s) => `<option${s === c.status ? " selected" : ""}>${esc(s)}</option>`)
    .join("");
  const notePath = `notes/${c.slug}.md`;
  const hasNote = state.docs?.find((g) => g.dir === "notes")?.paths.includes(notePath);

  let html = `
    <a class="back" href="#/companies">企業一覧</a>
    <div class="detail-head">
      <h1 class="page-title">${esc(c.name)}</h1>
      <a class="btn" href="#/c/${esc(c.slug)}/edit">編集</a>
    </div>
    <p class="meta">${meta.map(esc).join("　")}</p>
    <label class="status-pick">ステータス
      <select data-status="${esc(c.slug)}">${options}</select>
    </label>`;

  if (f.length) {
    html += `<h2 class="sec">選考フロー</h2><ol class="route">`;
    f.forEach((s, i) => {
      const cls = i < idx ? "past" : i === idx ? "now" : "";
      html += `<li class="${cls}"><span class="st"></span><span class="route-name">${esc(s)}</span>${i === idx ? '<span class="here">いまここ</span>' : ""}</li>`;
    });
    html += `</ol>`;
  }

  const mp = mypageBlock(c);
  if (mp) html += `<h2 class="sec">マイページ</h2><div class="creds">${mp}</div>`;

  const events = (c.events || []).map((e, i) => ({ ...e, i })).sort((a, b) => evKey(a).localeCompare(evKey(b)));
  html += `<h2 class="sec">予定</h2>`;
  if (events.length) {
    html += `<ul class="checklist">`;
    for (const e of events) {
      const n = daysUntil(e.date);
      const tail = e.done ? "" : n < 0 ? `<span class="late">期限切れ</span>` : `<span class="${urgency(n)}">${esc(remainText(n))}</span>`;
      html += `
        <li class="${e.done ? "done" : ""}">
          <label><input type="checkbox" data-toggle="${esc(c.slug)}:${e.i}"${e.done ? " checked" : ""}>
          <span><span class="ck-when">${esc(whenText(e))}</span><span class="ck-title">${eventTitle(e)}</span></span></label>
          ${tail}
        </li>`;
    }
    html += `</ul>`;
  } else {
    html += `<p class="hint">予定はまだありません。「編集」から追加できます。</p>`;
  }

  if (c.todo?.length) {
    html += `<h2 class="sec">調べること・転記すること</h2><ul class="plain-list">${c.todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  }
  if (c.links?.length) {
    html += `<h2 class="sec">リンク</h2><ul class="plain-list">${c.links
      .map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a></li>`)
      .join("")}</ul>`;
  }
  if (c.memo?.trim()) {
    html += `<h2 class="sec">メモ</h2><div class="md">${renderMarkdown(c.memo)}</div>`;
  }
  html += `<h2 class="sec">企業研究・提出したES</h2>`;
  html += hasNote
    ? `<a class="btn wide ghost" href="#/doc/${encodeURIComponent(notePath)}">ノートを開く</a>`
    : state.docs
      ? `<button class="btn wide ghost" data-newnote="${esc(c.slug)}">ノートを作る</button>`
      : `<p class="hint">読み込み中…</p>`;
  return html;
}

function eventRow(e = {}) {
  return `
    <fieldset class="ev">
      <input class="ev-title" name="title" placeholder="内容（例: ES提出締切）" value="${esc(e.title || "")}">
      <label>日付（締切・当日）<input type="date" name="date" value="${esc(e.date || "")}"></label>
      <label>時刻<input type="time" name="time" value="${esc(e.time || "")}"></label>
      <label>開始日（期間のときだけ）<input type="date" name="start" value="${esc(e.start || "")}"></label>
      <label>開始時刻<input type="time" name="startTime" value="${esc(e.startTime || "")}"></label>
      <label class="check"><input type="checkbox" name="tentative"${e.tentative ? " checked" : ""}>日付は目安</label>
      <label class="check"><input type="checkbox" name="done"${e.done ? " checked" : ""}>済み</label>
      <button type="button" class="mini danger" data-remove-ev>この予定を削除</button>
    </fieldset>`;
}

function viewEdit(slug) {
  const isNew = !slug;
  const c = isNew ? { flow: [], events: [], mypage: {}, links: [], todo: [] } : bySlug(slug);
  if (!c) return `<p class="empty">この企業は見つかりません。</p>`;
  const m = c.mypage || {};
  return `
    <a class="back" href="${isNew ? "#/companies" : `#/c/${esc(c.slug)}`}">${isNew ? "企業一覧" : esc(c.name)}</a>
    <h1 class="page-title">${isNew ? "企業を追加" : "編集"}</h1>
    <form id="edit" data-slug="${esc(c.slug || "")}">
      <label>会社名<input name="name" required value="${esc(c.name || "")}"></label>
      ${isNew ? `<label>英字の識別名（ノートのファイル名になる。例: capcom）<input name="slug" required pattern="[a-z0-9-]+" autocapitalize="off"></label>` : ""}
      <label>業界・職種<input name="industry" value="${esc(c.industry || "")}"></label>
      <label>ステータス<input name="status" list="statuses" value="${esc(c.status || "エントリー待ち")}"></label>
      <datalist id="statuses">${STATUSES.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
      <label>最終アクション<input type="date" name="lastAction" value="${esc(c.lastAction || "")}"></label>
      <label>初任給（円）<input type="number" name="salary" inputmode="numeric" value="${esc(c.salary || "")}"></label>
      <label>選考フロー（「、」区切り）<input name="flow" value="${esc((c.flow || []).join("、"))}" placeholder="ES、WEBテスト、一次面接、最終面接"></label>

      <h2 class="sec">マイページ</h2>
      <label>URL<input type="url" name="mpUrl" value="${esc(m.url || "")}" autocapitalize="off"></label>
      <label>ID<input name="mpId" value="${esc(m.id || "")}" autocapitalize="off" autocomplete="off"></label>
      <label>パスワード<input name="mpPassword" value="${esc(m.password || "")}" autocapitalize="off" autocomplete="off"></label>

      <h2 class="sec">予定</h2>
      <div id="events">${(c.events || []).map(eventRow).join("")}</div>
      <button type="button" class="btn ghost wide" data-add-ev>予定を追加</button>

      <h2 class="sec">その他</h2>
      <label>リンク（1行に「表示名 | URL」）<textarea name="links" rows="3">${esc((c.links || []).map((l) => `${l.label} | ${l.url}`).join("\n"))}</textarea></label>
      <label>調べること・転記すること（1行に1つ）<textarea name="todo" rows="3">${esc((c.todo || []).join("\n"))}</textarea></label>
      <label>メモ（Markdown）<textarea name="memo" rows="8">${esc(c.memo || "")}</textarea></label>

      <div class="form-actions">
        <button class="btn primary wide" type="submit">保存する</button>
        ${isNew ? "" : `<button type="button" class="btn danger wide" data-delete="${esc(c.slug)}">この企業を削除</button>`}
      </div>
    </form>`;
}

function readForm(form) {
  const fd = new FormData(form);
  const get = (k) => String(fd.get(k) ?? "").trim();
  const lines = (k) => get(k).split("\n").map((s) => s.trim()).filter(Boolean);
  const events = [...form.querySelectorAll("fieldset.ev")]
    .map((fs) => {
      const v = (n) => fs.querySelector(`[name="${n}"]`);
      const e = { title: v("title").value.trim(), date: v("date").value };
      if (v("time").value) e.time = v("time").value;
      if (v("start").value) e.start = v("start").value;
      if (v("startTime").value) e.startTime = v("startTime").value;
      if (v("tentative").checked) e.tentative = true;
      if (v("done").checked) e.done = true;
      return e;
    })
    .filter((e) => e.title || e.date);
  return {
    name: get("name"),
    slug: get("slug"),
    industry: get("industry"),
    status: get("status"),
    lastAction: get("lastAction"),
    salary: get("salary") ? Number(get("salary")) : null,
    flow: get("flow").split(/[、,，→]/).map((s) => s.trim()).filter(Boolean),
    mypage: { url: get("mpUrl"), id: get("mpId"), password: get("mpPassword") },
    events,
    links: lines("links").map((l) => {
      const [label, ...rest] = l.split("|");
      const url = rest.join("|").trim() || label.trim();
      return { label: rest.length ? label.trim() : url, url };
    }),
    todo: lines("todo"),
    memo: get("memo"),
  };
}

function viewLogins() {
  const list = [...state.companies]
    .filter((c) => c.mypage && (c.mypage.url || c.mypage.id || c.mypage.password))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  let html = `<h1 class="page-title">ログイン</h1><p class="hint">パスワードは「表示」を押すまで伏せています。コピーは伏せたままでもできます。</p><ul class="logins">`;
  for (const c of list) {
    html += `<li><a class="login-name" href="#/c/${esc(c.slug)}">${esc(c.name)}</a><div class="creds">${mypageBlock(c)}</div></li>`;
  }
  return html + `</ul>`;
}

function docName(path) {
  const extra = EXTRA_DOCS.find((d) => d.path === path);
  if (extra) return extra.name;
  const base = path.split("/").pop().replace(/\.md$/, "");
  const company = path.startsWith("notes/") ? bySlug(base) : null;
  if (company) return company.name;
  if (base === "README") return "使い方・設問との対応表";
  return base.replace(/^\d+_/, "").replace(/^_/, "");
}

function viewDocs() {
  if (!state.docs) return `<p class="hint">読み込み中…</p>`;
  let html = `<h1 class="page-title">素材</h1>`;
  for (const g of state.docs) {
    html += `<h2 class="sec">${esc(g.label)}</h2><ul class="doclist">`;
    html += g.paths.map((p) => `<li><a href="#/doc/${encodeURIComponent(p)}">${esc(docName(p))}</a></li>`).join("");
    if (!g.paths.length) html += `<li class="hint">まだありません</li>`;
    html += `</ul>`;
  }
  html += `<h2 class="sec">そのほか</h2><ul class="doclist">${EXTRA_DOCS.map((d) => `<li><a href="#/doc/${encodeURIComponent(d.path)}">${esc(d.name)}</a></li>`).join("")}</ul>`;
  return html;
}

const countChars = (s) => s.replace(/\s/g, "").length;

function viewDoc(path, doc) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const blocks = parseMarkdown(doc.text, { dir });
  // 見出しごとに区切り、段落があれば文字数とコピーボタンを付ける
  const sections = [{ head: null, blocks: [] }];
  for (const b of blocks) {
    if (b.type === "h" && b.level >= 2) sections.push({ head: b, blocks: [] });
    else sections[sections.length - 1].blocks.push(b);
  }
  let html = `
    <a class="back" href="#/docs">素材</a>
    <div class="detail-head"><span class="doc-path">${esc(path)}</span><a class="btn" href="#/doc/${encodeURIComponent(path)}/edit">編集</a></div>
    <article class="md">`;
  for (const s of sections) {
    const paras = s.blocks.filter((b) => b.type === "p");
    if (s.head) {
      const title = s.head.text.replace(/（\d+字）$/, "");
      const lv = s.head.level + 1;
      if (paras.length) {
        const text = paras.map((p) => plain(p.text)).join("\n");
        html += `<div class="sec-head"><h${lv}>${inline(title, { dir })}</h${lv}>
          <span class="chars">${countChars(text)}字</span>
          <button class="mini" data-copy="${esc(text)}">コピー</button></div>`;
      } else {
        html += `<h${lv}>${inline(title, { dir })}</h${lv}>`;
      }
    }
    html += s.blocks.map((b) => b.html).join("");
  }
  return html + `</article>`;
}

function viewDocEdit(path, doc) {
  return `
    <a class="back" href="#/doc/${encodeURIComponent(path)}">${esc(docName(path))}</a>
    <form id="docedit" data-path="${esc(path)}">
      <div class="detail-head"><span class="doc-path">${esc(path)}</span><span class="chars" id="doc-count"></span></div>
      <textarea name="text" class="doc-text" spellcheck="false">${esc(doc.text)}</textarea>
      <p class="hint">文字を選択すると、選択した部分の文字数（空白・改行を除く）が上に出ます。</p>
      <button class="btn primary wide" type="submit">保存する</button>
    </form>`;
}

function viewSettings() {
  return `
    <h1 class="page-title">設定</h1>
    <form id="settings">
      <label>データのリポジトリ<input name="repo" value="${esc(cfg.repo)}" autocapitalize="off"></label>
      <label>GitHub トークン（変更するときだけ入力）<input name="token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <button class="btn primary wide" type="submit">保存して読み込み直す</button>
    </form>
    <h2 class="sec">この端末から消す</h2>
    <p class="hint">トークンと、端末に残っている企業データのコピーを削除します。スマホを手放すときや、共用のPCで使ったあとに。</p>
    <button class="btn danger wide" data-logout>この端末からログアウト</button>`;
}

function viewLogin(message = "") {
  return `
    <div class="login">
      <h1 class="login-title">就活ボード</h1>
      <p>データは非公開リポジトリ <code>${esc(cfg.repo)}</code> に置いてあります。読むために、この端末で一度だけ GitHub のトークンを入れてください。</p>
      <ol class="steps">
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">トークンの作成ページ</a>を開く</li>
        <li>Repository access で「Only select repositories」→ <code>job-hunting</code> だけを選ぶ</li>
        <li>Permissions の Contents を「Read and write」にして作成</li>
        <li>表示された <code>github_pat_…</code> を下に貼る</li>
      </ol>
      ${message ? `<p class="error">${esc(message)}</p>` : ""}
      <form id="login">
        <label>GitHub トークン<input name="token" type="password" required autocomplete="off" placeholder="github_pat_…"></label>
        <details><summary>リポジトリを変える</summary><label>リポジトリ<input name="repo" value="${esc(cfg.repo)}" autocapitalize="off"></label></details>
        <button class="btn primary wide" type="submit">接続する</button>
      </form>
    </div>`;
}

// ---------- 描画とルーティング ----------

function route() {
  const parts = (location.hash.replace(/^#\/?/, "") || "schedule").split("/");
  return parts.map(decodeURIComponent);
}

function renderChrome() {
  const [name] = route();
  const tab = { c: "companies", new: "companies", doc: "docs" }[name] || name;
  document.querySelectorAll(".tabs a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.tab === tab));
  const d = today();
  document.getElementById("today").textContent = `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  document.getElementById("reload").classList.toggle("spinning", state.loading);
  document.body.classList.toggle("signed-out", !cfg.token);
}

async function render() {
  renderChrome();
  const view = $view();
  if (!cfg.token) {
    view.innerHTML = viewLogin();
    return;
  }
  if (!state.loaded) {
    view.innerHTML = state.error ? `<p class="error">${esc(state.error)}</p>` : `<p class="hint">読み込み中…</p>`;
    return;
  }
  const [name, arg, sub] = route();
  let html;
  try {
    if (name === "companies") html = viewCompanies();
    else if (name === "c" && sub === "edit") html = viewEdit(arg);
    else if (name === "c") html = viewCompany(arg);
    else if (name === "new") html = viewEdit(null);
    else if (name === "logins") html = viewLogins();
    else if (name === "docs") html = viewDocs();
    else if (name === "settings") html = viewSettings();
    else if (name === "doc") {
      view.innerHTML = `<p class="hint">読み込み中…</p>`;
      const doc = await getDoc(arg);
      if (route()[1] !== arg) return; // 読み込み中に別の画面へ移動した
      html = sub === "edit" ? viewDocEdit(arg, doc) : viewDoc(arg, doc);
    } else html = viewSchedule();
  } catch (e) {
    html = `<p class="error">${esc(explain(e))}</p>`;
  }
  if (state.error) html = `<p class="error">${esc(state.error)}</p>` + html;
  view.innerHTML = html;
  if (name === "doc" && sub === "edit") bindDocCounter();
}

function bindDocCounter() {
  const ta = document.querySelector(".doc-text");
  const out = document.getElementById("doc-count");
  const update = () => {
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    out.textContent = sel ? `選択 ${countChars(sel)}字` : `全体 ${countChars(ta.value)}字`;
  };
  ["input", "select", "keyup", "mouseup", "touchend"].forEach((ev) => ta.addEventListener(ev, update));
  document.addEventListener("selectionchange", update);
  update();
}

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), isError ? 6000 : 2200);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("コピーしました");
}

// ---------- 操作 ----------

async function markDone(key, done = true) {
  const [slug, i] = key.split(":");
  const c = bySlug(slug);
  const e = c?.events?.[Number(i)];
  if (!e) return;
  e.done = done;
  if (!done) delete e.done;
  render();
  await saveCompanies(`${c.name}: ${e.title} を${done ? "済み" : "未完了"}に`);
  render();
}

document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("button, [data-copy]");
  if (!t) return;
  if (t.dataset.copy !== undefined) return copy(t.dataset.copy);
  if (t.dataset.done) return markDone(t.dataset.done);
  if (t.hasAttribute("data-reveal")) {
    const code = t.parentElement.querySelector(".cred-value");
    const hidden = code.classList.toggle("secret");
    code.textContent = hidden ? "•".repeat(Math.min(code.dataset.value.length, 10)) : code.dataset.value;
    t.textContent = hidden ? "表示" : "隠す";
    return;
  }
  if (t.hasAttribute("data-add-ev")) {
    document.getElementById("events").insertAdjacentHTML("beforeend", eventRow());
    document.querySelector("#events fieldset:last-child .ev-title").focus();
    return;
  }
  if (t.hasAttribute("data-remove-ev")) return t.closest("fieldset").remove();
  if (t.dataset.delete) {
    const c = bySlug(t.dataset.delete);
    if (!confirm(`${c.name} を削除します。予定・ログイン情報・メモも消えます。`)) return;
    state.companies = state.companies.filter((x) => x !== c);
    if (await saveCompanies(`${c.name} を削除`)) location.hash = "#/companies";
    return;
  }
  if (t.dataset.newnote) {
    const c = bySlug(t.dataset.newnote);
    const path = `notes/${c.slug}.md`;
    const text = `# ${c.name}\n\n## 企業研究\n\n- \n\n## 提出したES\n\n## 面接で聞かれたこと\n`;
    t.disabled = true;
    try {
      const sha = await writeFile(path, text, null, `${c.name} のノートを作成`);
      state.docCache.set(path, { text, sha });
      state.docs.find((g) => g.dir === "notes").paths.push(path);
      location.hash = `#/doc/${encodeURIComponent(path)}/edit`;
    } catch (e) {
      toast(explain(e), true);
      t.disabled = false;
    }
    return;
  }
  if (t.id === "reload") {
    state.docCache.clear();
    await Promise.all([loadCompanies(), loadDocList().catch(() => {})]);
    render();
    if (!state.error) toast("最新の内容にしました");
    return;
  }
  if (t.hasAttribute("data-logout")) {
    if (!confirm("この端末からトークンとデータのコピーを削除します。")) return;
    ["jh.token", "jh.cache", "jh.repo"].forEach((k) => store.del(k));
    location.hash = "";
    location.reload();
  }
});

document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.dataset.toggle) return markDone(t.dataset.toggle, t.checked);
  if (t.dataset.status) {
    const c = bySlug(t.dataset.status);
    c.status = t.value;
    c.lastAction = isoToday();
    await saveCompanies(`${c.name}: ステータスを「${c.status}」に`);
    render();
  }
});

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const button = form.querySelector('[type="submit"]');

  if (form.id === "login" || form.id === "settings") {
    const fd = new FormData(form);
    const token = String(fd.get("token") || "").trim();
    const repo = String(fd.get("repo") || cfg.repo).trim();
    if (token) cfg.token = token;
    cfg.repo = repo;
    button.disabled = true;
    state.error = null;
    await loadCompanies();
    button.disabled = false;
    if (state.error) {
      if (form.id === "login") {
        cfg.token = null;
        renderChrome();
        $view().innerHTML = viewLogin(state.error);
        state.error = null;
      } else {
        toast(state.error, true);
      }
      return;
    }
    store.set("jh.token", cfg.token);
    store.set("jh.repo", cfg.repo);
    loadDocList().then(render).catch(() => {});
    location.hash = "#/schedule";
    render();
    return;
  }

  if (form.id === "edit") {
    const data = readForm(form);
    if (data.events.some((e) => !e.date || !e.title)) return toast("予定には内容と日付の両方を入れてください", true);
    const slug = form.dataset.slug;
    let c;
    if (slug) {
      c = bySlug(slug);
    } else {
      if (bySlug(data.slug)) return toast(`識別名「${data.slug}」はもう使われています`, true);
      c = { slug: data.slug };
      state.companies.push(c);
    }
    delete data.slug;
    Object.assign(c, data);
    if (!c.salary) delete c.salary;
    button.disabled = true;
    if (await saveCompanies(`${c.name} を${slug ? "更新" : "追加"}`)) location.hash = `#/c/${c.slug}`;
    button.disabled = false;
    return;
  }

  if (form.id === "docedit") {
    const path = form.dataset.path;
    const text = form.querySelector("textarea").value;
    const doc = state.docCache.get(path);
    button.disabled = true;
    try {
      const sha = await writeFile(path, text, doc?.sha, `${docName(path)} を更新`);
      state.docCache.set(path, { text, sha });
      toast("保存しました");
      location.hash = `#/doc/${encodeURIComponent(path)}`;
    } catch (e) {
      if (e.status === 409) {
        state.docCache.delete(path);
        toast("別の端末で更新されていました。編集内容をコピーしてから、読み込み直してください。", true);
      } else toast(explain(e), true);
      button.disabled = false;
    }
  }
});

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});

// ---------- 起動 ----------

(async function start() {
  if (!cfg.token) return render();
  loadCache();
  render();
  await Promise.all([loadCompanies(), loadDocList().catch(() => {})]);
  render();
})();
