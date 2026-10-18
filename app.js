import { esc, inline, parseMarkdown, plain, renderMarkdown } from "./md.js";

const DEFAULT_REPO = "kosei-matsuzaki/job-hunting";
const DATA_PATH = "data/companies.json";
const DOC_GROUPS = [
  { dir: "profile", label: "ES・面接の素材" },
  { dir: "notes", label: "企業研究・提出物" },
];
const EXTRA_DOCS = [{ path: "links.md", name: "就活サイト・対策" }];

// 状況（state）と、選考フローの中のいまの段階（step）を分けて持つ
const STATES = {
  todo: { label: "対応中", hint: "自分の番。準備・提出・受験・面接を控えている" },
  waiting: { label: "結果待ち", hint: "相手の番。結果や連絡を待っている" },
  before: { label: "エントリー前", hint: "まだ応募していない・受付開始待ち" },
  offer: { label: "内定", hint: "" },
  declined: { label: "辞退", hint: "" },
  rejected: { label: "不合格", hint: "" },
};
const LIVE_STATES = ["before", "todo", "waiting"];
const ENDED = new Set(["declined", "rejected"]);
const TRACKS = ["本選考", "インターン"];
const DEFAULT_FLOW = ["ES", "Webテスト", "一次面接", "最終面接"];
const PRIORITIES = [
  { v: 3, label: "第一志望群" },
  { v: 2, label: "受けたい" },
  { v: 1, label: "様子見" },
  { v: 0, label: "未設定" },
];
const EVENT_KINDS = [
  { v: "deadline", label: "締切（ES・Webテスト・エントリーなど）" },
  { v: "event", label: "日程（面接・説明会・インターン当日など）" },
];
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

const ui = { industry: store.get("jh.industry") || "", q: "" };

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
    state.offline = e instanceof TypeError && state.loaded;
  } finally {
    state.loading = false;
  }
}

// 変更を当てて保存する。別の端末が先に保存していたら、最新を読み直して同じ変更を当て直す。
// apply は state.companies を slug で引いて書き換える関数（何度呼ばれても同じ結果になるように書く）
async function commit(apply, message) {
  const snapshot = JSON.stringify(state.companies);
  apply();
  render();
  for (let attempt = 0; ; attempt++) {
    try {
      const text = JSON.stringify({ companies: state.companies }, null, 2) + "\n";
      state.sha = await writeFile(DATA_PATH, text, state.sha, message);
      saveCache();
      toast(attempt ? "別の端末の変更と合わせて保存しました" : "保存しました");
      return true;
    } catch (err) {
      let e = err;
      if ((e.status === 409 || e.status === 422) && attempt < 2) {
        try {
          const latest = await readFile(DATA_PATH);
          state.companies = JSON.parse(latest.text).companies || [];
          state.sha = latest.sha;
          apply();
          continue;
        } catch (reloadError) {
          e = reloadError;
        }
      }
      state.companies = JSON.parse(snapshot);
      render();
      toast(`${explain(e)}（変更は保存されていません）`, true);
      return false;
    }
  }
}

// 素材は一度開いたら端末に残し、電波がないときはそれを出す
const DOC_KEY = "jh.doc:";

async function loadDocList() {
  try {
    state.docs = await Promise.all(DOC_GROUPS.map(async (g) => ({ ...g, paths: await listDocs(g.dir) })));
    store.set("jh.doclist", JSON.stringify(state.docs));
  } catch (e) {
    const cached = store.get("jh.doclist");
    if (!cached) throw e;
    state.docs = JSON.parse(cached);
  }
}

async function getDoc(path, fresh = false) {
  if (!fresh && state.docCache.has(path)) return state.docCache.get(path);
  try {
    const doc = await readFile(path);
    state.docCache.set(path, doc);
    store.set(DOC_KEY + path, JSON.stringify(doc));
    return doc;
  } catch (e) {
    const cached = store.get(DOC_KEY + path);
    if (e.status || !cached) throw e;
    const doc = { ...JSON.parse(cached), offline: true };
    state.docCache.set(path, doc);
    return doc;
  }
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
const eventTitle = (e) =>
  (e.kind === "event" ? '<span class="kind">日程</span>' : "") + esc(e.title) + (e.tentative ? '<span class="tentative">目安</span>' : "");

// ---------- カレンダー ----------

// JST の日時を UTC の iCalendar 形式（20261030T010000Z）にする
function utcStamp(date, time, addMinutes = 0) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm + addMinutes)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function nextDay(date) {
  const d = parseDate(date);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

const calTitle = (e, c) => `${e.kind === "event" ? "" : "【締切】"}${c.name} ${e.title}`;

function googleCalUrl(e, c) {
  const dates = e.time
    ? `${utcStamp(e.date, e.time)}/${utcStamp(e.date, e.time, 30)}`
    : `${e.date.replace(/-/g, "")}/${nextDay(e.date)}`;
  const q = new URLSearchParams({ action: "TEMPLATE", text: calTitle(e, c), dates, details: whenText(e) });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function icsText(items) {
  const escT = (t) => String(t).replace(/\\/g, "\\\\").replace(/[;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//shukatsu-board//JA", "CALSCALE:GREGORIAN"];
  for (const { e, c } of items) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${c.slug}-${e.date}-${(e.time || "").replace(":", "")}-${encodeURIComponent(e.title).slice(0, 40)}@shukatsu-board`,
      `DTSTAMP:${now}`,
      `SUMMARY:${escT(calTitle(e, c))}`,
      `DESCRIPTION:${escT(whenText(e))}`,
      ...(e.time
        ? [`DTSTART:${utcStamp(e.date, e.time)}`, `DTEND:${utcStamp(e.date, e.time, 30)}`]
        : [`DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`]),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escT(calTitle(e, c))}`,
      `TRIGGER:${e.kind === "event" ? "-PT2H" : "-P1D"}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function downloadIcs(name, items) {
  const url = URL.createObjectURL(new Blob([icsText(items)], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- 企業 ----------

const bySlug = (slug) => state.companies.find((c) => c.slug === slug);

const priorityMark = (c) =>
  c.priority ? `<span class="prio" title="志望度: ${PRIORITIES.find((p) => p.v === c.priority)?.label}">${"★".repeat(c.priority)}</span>` : "";

const stateOf = (c) => (STATES[c.state] ? c.state : "before");
const flowIndex = (c) => (c.flow || []).indexOf(c.step);

function statusPill(c) {
  const s = stateOf(c);
  if (s === "before") return ""; // 一覧の見出しと同じなので出さない
  const step = flowIndex(c) >= 0 && LIVE_STATES.includes(s) ? `<span class="step-name">${esc(c.step)}</span>` : "";
  return `${step}<span class="pill ${s}">${STATES[s].label}</span>`;
}

// 状況を変えて、記録を残して保存する
async function updateStatus(c, patch, note) {
  const { slug, name } = c;
  await commit(() => {
    const x = bySlug(slug);
    if (!x) return;
    Object.assign(x, patch);
    x.lastAction = isoToday();
    x.history = [{ date: isoToday(), text: note }, ...(x.history || [])];
  }, `${name}: ${note}`);
  render();
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
  const live = allEvents().filter((e) => !e.done && !ENDED.has(e.c.state));
  const upcoming = live.filter((e) => daysUntil(e.date) >= 0).sort((a, b) => evKey(a).localeCompare(evKey(b)));
  const past = live
    .filter((e) => daysUntil(e.date) < 0 && daysUntil(e.date) >= -PAST_DAYS)
    .sort((a, b) => evKey(b).localeCompare(evKey(a)));
  const todos = state.companies.filter((c) => c.todo?.length && !ENDED.has(c.state));

  let html = "";
  const [head, ...rest] = upcoming;
  if (head) {
    const n = daysUntil(head.date);
    const count = n <= 1
      ? `<span class="next-num word">${n === 0 ? "今日" : "明日"}</span>`
      : `<span class="next-num">${n}</span><span class="next-unit">日</span>`;
    html += `
      <section class="next ${urgency(n)}">
        <p class="next-label">${head.kind === "event" ? "次の予定まで" : "次の締切まで"}</p>
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

  const tally = ["todo", "waiting", "before", "offer"]
    .map((s) => ({ s, n: state.companies.filter((c) => stateOf(c) === s).length }))
    .filter((t) => t.n);
  html += `<a class="tally" href="#/companies">${tally
    .map((t) => `<span class="tally-item ${t.s}"><span class="tally-n">${t.n}</span>${STATES[t.s].label}</span>`)
    .join("")}</a>
    <a class="btn ghost wide" href="#/add">予定を追加</a>`;

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
  // 締切が近い順。予定のない企業は志望度の高い順、同じなら名前順
  const order = (a, b) => {
    const na = nextEvent(a);
    const nb = nextEvent(b);
    if (na && nb) return evKey(na).localeCompare(evKey(nb));
    if (na || nb) return na ? -1 : 1;
    return (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, "ja");
  };
  const counts = {};
  for (const c of state.companies) if (c.industry) counts[c.industry] = (counts[c.industry] || 0) + 1;
  const industries = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const filter = industries.includes(ui.industry) ? ui.industry : "";
  const pool = state.companies.filter((c) => !filter || c.industry === filter);
  const groups = [
    { s: "todo", label: "対応中" },
    { s: "waiting", label: "結果待ち" },
    { s: "offer", label: "内定" },
    { s: "before", label: "エントリー前" },
  ].map((g) => ({ ...g, items: pool.filter((c) => stateOf(c) === g.s).sort(order) }));
  const ended = pool.filter((c) => ENDED.has(stateOf(c)));

  const row = (c) => {
    const nx = nextEvent(c);
    return `
      <li><a class="co" href="#/c/${esc(c.slug)}">
        <span class="co-name">${esc(c.name)}${priorityMark(c)}${c.track === "インターン" ? '<span class="track">インターン</span>' : ""}</span>
        <span class="co-ind">${esc(c.industry || "")}</span>
        <span class="co-status">${routeMini(c)}${statusPill(c)}</span>
        ${nx ? `<span class="co-next ${urgency(daysUntil(nx.date))}">${esc(fmtDate(nx.date, otherYear(nx.date)))} ${esc(nx.title)}</span>` : ""}
      </a></li>`;
  };

  let html = `<div class="list-head"><h1 class="page-title">企業<span class="count">${pool.length}社</span></h1><a class="btn" href="#/new">企業を追加</a></div>
    <div class="chips" role="group" aria-label="業界で絞り込む">
      ${["", ...industries].map((i) => `<button data-filter="${esc(i)}" aria-pressed="${i === filter}">${i ? `${esc(i)}<span>${counts[i]}</span>` : "すべて"}</button>`).join("")}
    </div>`;
  for (const g of groups) {
    if (!g.items.length) continue;
    html += `<h2 class="sec">${g.label}<span class="count">${g.items.length}社</span></h2><ul class="companies">${g.items.map(row).join("")}</ul>`;
  }
  if (ended.length) {
    html += `<details class="ended"><summary>終了した企業（${ended.length}社）</summary><ul class="companies">${ended.map(row).join("")}</ul></details>`;
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
  const s = stateOf(c);
  const notePath = `notes/${c.slug}.md`;
  const hasNote = state.docs?.find((g) => g.dir === "notes")?.paths.includes(notePath);
  const slug_ = esc(c.slug);

  let html = `
    <a class="back" href="#/companies">企業一覧</a>
    <div class="detail-head">
      <h1 class="page-title">${esc(c.name)}${c.track === "インターン" ? '<span class="track">インターン</span>' : ""}</h1>
      <a class="btn" href="#/c/${slug_}/edit">編集</a>
    </div>
    <p class="meta">${meta.map(esc).join("　")}</p>
    <section class="state-panel ${s}">`;

  if (ENDED.has(s) || s === "offer") {
    html += `
      <p class="state-final"><span class="pill ${s}">${STATES[s].label}</span>${c.step ? `${esc(c.step)}まで進みました` : ""}</p>
      <button class="mini" data-state="${slug_}:todo">選考中に戻す</button>`;
  } else {
    html += `<div class="seg" role="group" aria-label="いまの状況">${LIVE_STATES.map(
      (k) => `<button data-state="${slug_}:${k}" aria-pressed="${k === s}">${STATES[k].label}</button>`,
    ).join("")}</div>
      <p class="hint">${esc(STATES[s].hint)}</p>`;
  }

  if (f.length) {
    html += `<ol class="route${ENDED.has(s) ? " dim" : ""}">`;
    f.forEach((name, i) => {
      const cls = s === "offer" || i < idx ? "past" : i === idx ? "now" : "";
      const tag = i === idx && LIVE_STATES.includes(s) && s !== "before" ? `<span class="here ${s}">${STATES[s].label}</span>` : "";
      html += `<li class="${cls}"><button class="station" data-step="${slug_}:${i}" aria-label="段階を「${esc(name)}」にする">
        <span class="st"></span><span class="route-name">${esc(name)}</span>${tag}</button></li>`;
    });
    html += `</ol><p class="hint">駅をタップすると、いまの段階を変えられます。</p>`;
  } else {
    html += `<p class="hint">選考フローが未設定です。「編集」で入れると、ここに路線図が出ます。</p>`;
  }

  if (LIVE_STATES.includes(s)) {
    const next = idx >= 0 ? f[idx + 1] : f[0];
    const passLabel = idx < 0 ? (f[0] ? `選考を始める（${f[0]}から）` : "") : next ? `${f[idx]}を通過した（次は${next}）` : `${f[idx]}を通過した（内定）`;
    html += `<div class="outcomes">
      ${passLabel ? `<button class="btn primary wide" data-pass="${slug_}">${esc(passLabel)}</button>` : ""}
      ${s === "before" ? "" : `<div class="outcome-row">
        <button class="mini" data-state="${slug_}:offer">内定</button>
        <button class="mini" data-state="${slug_}:declined">辞退した</button>
        <button class="mini danger" data-state="${slug_}:rejected">不合格だった</button>
      </div>`}
    </div>`;
  }
  if (s === "todo" && /面接/.test(c.step || "")) {
    html += `<a class="btn ghost wide" href="#/doc/${encodeURIComponent("profile/08_面接想定問答.md")}">面接の想定問答を開く</a>`;
  } else if (s === "todo" && /ES|書類|エントリー/.test(c.step || "")) {
    html += `<a class="btn ghost wide" href="#/doc/${encodeURIComponent("profile/README.md")}">ESの素材を開く</a>`;
  }
  html += `</section>`;

  const mp = mypageBlock(c);
  html += `<h2 class="sec">マイページ</h2>`;
  html += mp
    ? `<div class="creds">${mp}</div>`
    : `<p class="hint">まだ登録していません。登録したら URL・ID・パスワードを入れておくと、ログイン画面からすぐ開けます。</p>
       <a class="btn ghost wide" href="#/c/${slug_}/edit">マイページ情報を入れる</a>`;

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
          <span><span class="ck-when">${esc(whenText(e))}</span><span class="ck-title">${eventTitle(e)}</span>
          ${e.done ? "" : `<span class="cal-links"><button class="linkish" data-ics="${esc(c.slug)}:${e.i}">カレンダーに追加</button><a href="${esc(googleCalUrl(e, c))}" target="_blank" rel="noopener noreferrer">Googleカレンダー</a></span>`}</span></label>
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
  if (c.history?.length) {
    html += `<h2 class="sec">これまでの記録</h2><ol class="history">${c.history
      .slice(0, 20)
      .map((h) => `<li><span class="h-date">${esc(fmtDate(h.date, otherYear(h.date)))}</span>${esc(h.text)}</li>`)
      .join("")}</ol>`;
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

function eventRow(e = {}, removable = true) {
  return `
    <fieldset class="ev">
      <input class="ev-title" name="title" placeholder="内容（例: ES提出締切）" value="${esc(e.title || "")}">
      <label class="ev-kind">種類<select name="kind">${EVENT_KINDS.map((k) => `<option value="${k.v}"${k.v === (e.kind || "deadline") ? " selected" : ""}>${k.label}</option>`).join("")}</select></label>
      <label>日付（締切・当日）<input type="date" name="date" value="${esc(e.date || "")}"></label>
      <label>時刻<input type="time" name="time" value="${esc(e.time || "")}"></label>
      <label>開始日（期間のときだけ）<input type="date" name="start" value="${esc(e.start || "")}"></label>
      <label>開始時刻<input type="time" name="startTime" value="${esc(e.startTime || "")}"></label>
      <label class="check"><input type="checkbox" name="tentative"${e.tentative ? " checked" : ""}>日付は目安</label>
      <label class="check"><input type="checkbox" name="done"${e.done ? " checked" : ""}>済み</label>
      ${removable ? `<button type="button" class="mini danger" data-remove-ev>この予定を削除</button>` : ""}
    </fieldset>`;
}

function viewEdit(slug) {
  const isNew = !slug;
  const c = isNew ? { flow: DEFAULT_FLOW, events: [], mypage: {}, links: [], todo: [] } : bySlug(slug);
  if (!c) return `<p class="empty">この企業は見つかりません。</p>`;
  const m = c.mypage || {};
  return `
    <a class="back" href="${isNew ? "#/companies" : `#/c/${esc(c.slug)}`}">${isNew ? "企業一覧" : esc(c.name)}</a>
    <h1 class="page-title">${isNew ? "企業を追加" : "編集"}</h1>
    <form id="edit" data-slug="${esc(c.slug || "")}">
      <label>会社名<input name="name" required value="${esc(c.name || "")}"></label>
      ${isNew ? `<label>英字の識別名（ノートのファイル名になる。例: capcom）<input name="slug" required pattern="[a-z0-9-]+" autocapitalize="off"></label>` : ""}
      <label>業界・職種<input name="industry" value="${esc(c.industry || "")}"></label>
      <label>志望度<select name="priority">${PRIORITIES.map((p) => `<option value="${p.v}"${p.v === (c.priority || 0) ? " selected" : ""}>${p.label}</option>`).join("")}</select></label>
      <label>選考の種類<select name="track">${TRACKS.map((t) => `<option${t === (c.track || "本選考") ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>最終アクション<input type="date" name="lastAction" value="${esc(c.lastAction || "")}"></label>
      <label>初任給（円）<input type="number" name="salary" inputmode="numeric" value="${esc(c.salary || "")}"></label>
      <label>選考フロー（「、」区切り。路線図の駅になる）<input name="flow" value="${esc((c.flow || DEFAULT_FLOW).join("、"))}"></label>

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
      if (v("kind").value === "event") e.kind = "event";
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
    track: get("track"),
    priority: Number(get("priority")) || 0,
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

function viewAddEvent() {
  const options = [...state.companies]
    .filter((c) => !ENDED.has(stateOf(c)))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    .map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`)
    .join("");
  return `
    <a class="back" href="#/schedule">予定</a>
    <h1 class="page-title">予定を追加</h1>
    <form id="addev">
      <label>企業<select name="company" required><option value="">選んでください</option>${options}</select></label>
      ${eventRow({}, false)}
      <button class="btn primary wide" type="submit">追加する</button>
      <p class="hint">ここにない企業は、先に「企業」タブの「企業を追加」から登録してください。</p>
    </form>`;
}

function viewLogins() {
  const list = [...state.companies]
    .filter((c) => c.mypage && (c.mypage.url || c.mypage.id || c.mypage.password))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  let html = `<h1 class="page-title">ログイン</h1><p class="hint">パスワードは「表示」を押すまで伏せています。コピーは伏せたままでもできます。</p><ul class="logins">`;
  for (const c of list) {
    html += `<li><a class="login-name" href="#/c/${esc(c.slug)}">${esc(c.name)}</a><div class="creds">${mypageBlock(c)}</div></li>`;
  }
  html += `</ul>`;
  const missing = state.companies
    .filter((c) => !list.includes(c) && !ENDED.has(stateOf(c)))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, "ja"));
  if (missing.length) {
    html += `<h2 class="sec">マイページ未登録<span class="count">${missing.length}社</span></h2>
      <p class="hint">登録したら「入力する」から URL・ID・パスワードを入れてください。</p>
      <ul class="unregistered">${missing
        .map((c) => `<li><a href="#/c/${esc(c.slug)}">${esc(c.name)}</a>${priorityMark(c)}<span class="co-ind">${esc(c.industry || "")}</span><a class="mini" href="#/c/${esc(c.slug)}/edit">入力する</a></li>`)
        .join("")}</ul>`;
  }
  return html;
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

// ---------- 検索 ----------

function highlight(text, terms) {
  let html = esc(text);
  for (const t of terms) {
    const re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    html = html.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return html;
}

function snippet(text, term, width = 40) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text.slice(0, width * 2);
  const from = Math.max(0, i - width);
  return (from > 0 ? "…" : "") + text.slice(from, i + term.length + width).replace(/\s+/g, " ") + (i + term.length + width < text.length ? "…" : "");
}

function searchResults(q) {
  const terms = q.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return `<p class="hint">企業名・業界・メモ・予定・ESの文章をまとめて探せます。スペースで区切ると、すべてを含むものだけに絞ります。</p>`;
  const hit = (text) => terms.every((t) => text.toLowerCase().includes(t.toLowerCase()));

  const companies = state.companies.filter((c) =>
    hit([c.name, c.industry, c.step, STATES[stateOf(c)].label, c.memo, ...(c.todo || []), ...(c.flow || [])].join("\n")),
  );
  const events = allEvents().filter((e) => hit(`${e.c.name} ${e.title}`)).sort((a, b) => evKey(a).localeCompare(evKey(b)));
  const docs = [];
  for (const [path, doc] of state.docCache) {
    const lines = doc.text.split("\n").filter((l) => l.trim() && hit(l));
    if (lines.length || hit(docName(path))) docs.push({ path, lines });
  }

  let html = "";
  if (companies.length) {
    html += `<h2 class="sec">企業<span class="count">${companies.length}</span></h2><ul class="results">`;
    html += companies
      .map((c) => {
        const where = [c.memo, ...(c.todo || [])].find((t) => t && terms.some((x) => t.toLowerCase().includes(x.toLowerCase())));
        return `<li><a href="#/c/${esc(c.slug)}">${highlight(c.name, terms)}</a><span class="co-ind">${esc(c.industry || "")}</span>${where ? `<p>${highlight(snippet(where, terms[0]), terms)}</p>` : ""}</li>`;
      })
      .join("");
    html += `</ul>`;
  }
  if (events.length) {
    html += `<h2 class="sec">予定<span class="count">${events.length}</span></h2><ul class="results">`;
    html += events
      .map((e) => `<li><a href="#/c/${esc(e.c.slug)}">${esc(e.c.name)}</a><p>${esc(fmtDate(e.date, otherYear(e.date)))} ${highlight(e.title, terms)}${e.done ? "（済み）" : ""}</p></li>`)
      .join("");
    html += `</ul>`;
  }
  if (docs.length) {
    html += `<h2 class="sec">素材・ノート<span class="count">${docs.length}</span></h2><ul class="results">`;
    html += docs
      .map((d) => `<li><a href="#/doc/${encodeURIComponent(d.path)}">${highlight(docName(d.path), terms)}</a>${d.lines
        .slice(0, 3)
        .map((l) => `<p>${highlight(snippet(l.replace(/^[#>\-*\s|]+/, ""), terms[0]), terms)}</p>`)
        .join("")}</li>`)
      .join("");
    html += `</ul>`;
  }
  if (!html) html = `<p class="empty">「${esc(q)}」に当てはまるものはありません。</p>`;
  if (state.docsLoading) html += `<p class="hint">素材を読み込み中…</p>`;
  return html;
}

function viewSearch() {
  return `
    <h1 class="page-title">検索</h1>
    <input id="q" class="search-box" type="search" enterkeyhint="search" placeholder="例: 面接　/　Go　/　締切" value="${esc(ui.q)}">
    <div id="results">${searchResults(ui.q)}</div>`;
}

// 検索のために、まだ開いていない素材もまとめて読み込む
async function loadAllDocs() {
  if (state.docsLoading || !state.docs) return;
  const paths = [...state.docs.flatMap((g) => g.paths), ...EXTRA_DOCS.map((d) => d.path)].filter((p) => !state.docCache.has(p));
  if (!paths.length) return;
  state.docsLoading = true;
  await Promise.all(paths.map((p) => getDoc(p).catch(() => null)));
  state.docsLoading = false;
  const box = document.getElementById("results");
  if (box) box.innerHTML = searchResults(ui.q);
}

function viewSettings() {
  return `
    <h1 class="page-title">設定</h1>
    <form id="settings">
      <label>データのリポジトリ<input name="repo" value="${esc(cfg.repo)}" autocapitalize="off"></label>
      <label>GitHub トークン（変更するときだけ入力）<input name="token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <button class="btn primary wide" type="submit">保存して読み込み直す</button>
    </form>
    <h2 class="sec">カレンダーに書き出す</h2>
    <p class="hint">これからの予定（済みを除く）を .ics ファイルにまとめます。iPhone は開くとカレンダーに追加でき、Googleカレンダーは PC の「設定 → インポート」から取り込めます。締切は前日、日程は2時間前に通知が出ます。</p>
    <button class="btn wide" data-ics-all>まとめて書き出す</button>
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
  const tab = { c: "companies", new: "companies", doc: "docs", add: "schedule" }[name] || name;
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
    else if (name === "add") html = viewAddEvent();
    else if (name === "search") html = viewSearch();
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
  if (state.error) {
    html = state.offline
      ? `<p class="offline">電波がないため、前回読み込んだ内容を表示しています。変更は保存できません。</p>` + html
      : `<p class="error">${esc(state.error)}</p>` + html;
  }
  view.innerHTML = html;
  if (name === "doc" && sub === "edit") bindDocCounter();
  if (name === "search") {
    const box = document.getElementById("q");
    box.addEventListener("input", () => {
      ui.q = box.value;
      document.getElementById("results").innerHTML = searchResults(ui.q);
    });
    if (!ui.q) box.focus();
    loadAllDocs();
  }
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
  const target = c?.events?.[Number(i)];
  if (!target) return;
  const { title, date } = target;
  await commit(() => {
    // 別の端末で予定が増減しても同じ予定を指すよう、内容と日付で探す
    const e = bySlug(slug)?.events?.find((x) => x.title === title && x.date === date);
    if (!e) return;
    if (done) e.done = true;
    else delete e.done;
  }, `${c.name}: ${title} を${done ? "済み" : "未完了"}に`);
  render();
}

document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("button, [data-copy]");
  if (!t) return;
  if (t.dataset.copy !== undefined) return copy(t.dataset.copy);
  if (t.dataset.done) return markDone(t.dataset.done);
  if (t.dataset.state || t.dataset.step || t.dataset.pass) return statusClick(t);
  if (t.dataset.filter !== undefined) {
    ui.industry = t.dataset.filter;
    store.set("jh.industry", ui.industry);
    return render();
  }
  if (t.dataset.ics) {
    const [slug, i] = t.dataset.ics.split(":");
    const c = bySlug(slug);
    const e = c.events[Number(i)];
    return downloadIcs(`${c.slug}-${e.date}.ics`, [{ e, c }]);
  }
  if (t.hasAttribute("data-ics-all")) {
    const items = allEvents().filter((e) => !e.done && daysUntil(e.date) >= 0 && !ENDED.has(e.c.state)).map((e) => ({ e, c: e.c }));
    if (!items.length) return toast("書き出す予定がありません", true);
    downloadIcs(`shukatsu-${isoToday()}.ics`, items);
    return toast(`${items.length}件の予定を書き出しました`);
  }
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
    const slug = c.slug;
    if (await commit(() => { state.companies = state.companies.filter((x) => x.slug !== slug); }, `${c.name} を削除`)) {
      location.hash = "#/companies";
    }
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
    ["jh.token", "jh.cache", "jh.repo", "jh.doclist", "jh.industry"].forEach((k) => store.del(k));
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(DOC_KEY)).forEach((k) => store.del(k));
    } catch { /* noop */ }
    location.hash = "";
    location.reload();
  }
});

document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.dataset.toggle) return markDone(t.dataset.toggle, t.checked);
});

function statusClick(t) {
  if (t.dataset.state) {
    const [slug, next] = t.dataset.state.split(":");
    const c = bySlug(slug);
    if (stateOf(c) === next) return;
    if (ENDED.has(next) && !confirm(`${c.name} を「${STATES[next].label}」にします。`)) return;
    const note = next === "todo" && !LIVE_STATES.includes(stateOf(c)) ? "選考中に戻した" : `「${STATES[next].label}」にした`;
    return updateStatus(c, { state: next }, note);
  }
  if (t.dataset.step) {
    const [slug, i] = t.dataset.step.split(":");
    const c = bySlug(slug);
    const step = c.flow[Number(i)];
    if (c.step === step) return;
    const patch = { step };
    if (!LIVE_STATES.includes(stateOf(c)) || stateOf(c) === "before") patch.state = "todo";
    return updateStatus(c, patch, `段階を「${step}」にした`);
  }
  if (t.dataset.pass) {
    const c = bySlug(t.dataset.pass);
    const f = c.flow || [];
    const idx = flowIndex(c);
    if (idx < 0) return updateStatus(c, { step: f[0], state: "todo" }, `選考を始めた（${f[0]}）`);
    if (idx + 1 < f.length) return updateStatus(c, { step: f[idx + 1], state: "todo" }, `${f[idx]}を通過した`);
    return updateStatus(c, { state: "offer" }, `${f[idx]}を通過して内定`);
  }
}

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
    const slug = form.dataset.slug || data.slug;
    const isNew = !form.dataset.slug;
    if (isNew && bySlug(slug)) return toast(`識別名「${slug}」はもう使われています`, true);
    delete data.slug;
    button.disabled = true;
    const saved = await commit(() => {
      let c = bySlug(slug);
      if (!c) {
        c = { slug, state: "before", history: [{ date: isoToday(), text: "追加した" }] };
        state.companies.push(c);
      }
      Object.assign(c, structuredClone(data));
      if (!c.salary) delete c.salary;
    }, `${data.name} を${isNew ? "追加" : "更新"}`);
    if (saved) location.hash = `#/c/${slug}`;
    button.disabled = false;
    return;
  }

  if (form.id === "addev") {
    const c = bySlug(form.company.value);
    const [e] = readForm(form).events;
    if (!c) return toast("企業を選んでください", true);
    if (!e?.title || !e?.date) return toast("内容と日付の両方を入れてください", true);
    const slug = c.slug;
    button.disabled = true;
    const saved = await commit(() => {
      const x = bySlug(slug);
      if (x && !x.events?.some((y) => y.title === e.title && y.date === e.date)) x.events = [...(x.events || []), { ...e }];
    }, `${c.name}: 予定「${e.title}」を追加`);
    if (saved) location.hash = "#/schedule";
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

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* なくても動く */ });
}
window.addEventListener("online", async () => {
  if (!state.offline) return;
  await loadCompanies();
  render();
});

(async function start() {
  if (!cfg.token) return render();
  loadCache();
  render();
  await Promise.all([loadCompanies(), loadDocList().catch(() => {})]);
  render();
})();
