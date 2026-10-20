import { esc, inline, parseMarkdown, plain, renderMarkdown } from "./md.js";

// =====================================================================
// 設定・定数
// =====================================================================

const DEFAULT_REPO = "kosei-matsuzaki/job-hunting";
const DATA_PATH = "data/companies.json";
const DOC_GROUPS = [
  { dir: "profile", label: "ES・面接の素材" },
  { dir: "notes", label: "企業研究・ES下書き" },
];
const EXTRA_DOCS = [{ path: "links.md", name: "就活サイト・対策" }];

// 選考ルートごとの状況。step は選考フローの中のいまの段階
const STATES = {
  todo: { label: "対応中", hint: "自分の番。提出・受験・面接を控えている" },
  waiting: { label: "結果待ち", hint: "相手の番。結果や連絡を待っている" },
  before: { label: "エントリー前", hint: "まだ応募していない" },
  offer: { label: "内定", hint: "" },
  declined: { label: "辞退", hint: "" },
  rejected: { label: "不合格", hint: "" },
};
const LIVE = ["before", "todo", "waiting"];
const ENDED = new Set(["declined", "rejected"]);
const STATE_RANK = { offer: 0, todo: 1, waiting: 2, before: 3, declined: 4, rejected: 5 };

const KINDS = ["本選考", "インターン", "早期選考", "説明会・イベント"];
const KIND_CLASS = { 本選考: "main", インターン: "intern", 早期選考: "early", "説明会・イベント": "info" };
const OPEN_STATUSES = ["受付中", "受付前", "終了", "不明"];
const INDUSTRIES = ["ゲーム", "IT・Web", "AI・R&D", "SIer・通信", "コンサル", "メーカー"];
const IND_CLASS = { ゲーム: "game", "IT・Web": "web", "AI・R&D": "ai", "SIer・通信": "sier", コンサル: "consult", メーカー: "maker" };
const DEFAULT_FLOW = ["ES", "Webテスト", "一次面接", "最終面接"];
const PRIORITY_LABEL = { 3: "第一志望群", 2: "受けたい", 1: "様子見" };
const EVENT_KINDS = [
  { v: "deadline", label: "締切（ES・Webテスト・エントリーなど）" },
  { v: "event", label: "日程（面接・説明会・インターン当日など）" },
];
const WD = "日月火水木金土";
const PAST_DAYS = 14;

const ICONS = {
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
  door: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l4 4-4 4M14 12H4"/></svg>',
  id: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M15 10h3M15 13h3"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

// =====================================================================
// 端末内の保存
// =====================================================================

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できない環境では毎回入力 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
};

const cfg = {
  token: store.get("jh.token"),
  repo: store.get("jh.repo") || DEFAULT_REPO,
};

// 画面の一時的な状態（絞り込みなど）
const ui = {
  industry: store.get("jh.industry") || "",
  kind: store.get("jh.kind") || "",
  cq: "",
  q: "",
};

const state = {
  companies: [],
  sha: null,
  loaded: false,
  loading: false,
  error: null,
  offline: false,
  docs: null,
  docsLoading: false,
  docCache: new Map(),
};

// =====================================================================
// GitHub API
// =====================================================================

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

// =====================================================================
// データ
// =====================================================================

const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// 古い形（会社ごとに状況を1つだけ持つ）のデータも、選考ルートの形にそろえる
function normalize(c) {
  c.events ||= [];
  c.links ||= [];
  c.todo ||= [];
  c.history ||= [];
  c.mypage ||= { url: "", id: "", password: "" };
  if (!Array.isArray(c.programs)) {
    const kind = c.track || "本選考";
    c.programs = [{
      id: "p1", kind, title: kind, url: "", entryUrl: "", period: "",
      flow: c.flow || [], process: "", status: "不明", state: c.state || "before", step: c.step || "",
    }];
    delete c.track;
    delete c.state;
    delete c.step;
    delete c.flow;
  }
  for (const p of c.programs) {
    p.id ||= newId();
    p.flow ||= [];
    p.state = STATES[p.state] ? p.state : "before";
    p.step ||= "";
  }
  return c;
}

function loadCache() {
  try {
    const c = JSON.parse(store.get("jh.cache") || "null");
    if (c?.repo === cfg.repo) {
      state.companies = c.companies.map(normalize);
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
    state.companies = (JSON.parse(text).companies || []).map(normalize);
    state.sha = sha;
    state.loaded = true;
    state.loadedAt = Date.now();
    state.error = null;
    state.offline = false;
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
async function commit(apply, message, { quiet = false } = {}) {
  const snapshot = JSON.stringify(state.companies);
  apply();
  render();
  for (let attempt = 0; ; attempt++) {
    try {
      const text = JSON.stringify({ companies: state.companies }, null, 2) + "\n";
      state.sha = await writeFile(DATA_PATH, text, state.sha, message);
      saveCache();
      if (!quiet || attempt) toast(attempt ? "別の端末の変更と合わせて保存しました" : "保存しました");
      return attempt ? MERGED : true;
    } catch (err) {
      let e = err;
      if ((e.status === 409 || e.status === 422) && attempt < 2) {
        try {
          const latest = await readFile(DATA_PATH);
          state.companies = (JSON.parse(latest.text).companies || []).map(normalize);
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

const hasNote = (slug) => state.docs?.find((g) => g.dir === "notes")?.paths.includes(`notes/${slug}.md`);

// =====================================================================
// 日付
// =====================================================================

function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isoToday = () => isoOf(today());

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const daysUntil = (s) => Math.round((parseDate(s) - today()) / 86400000);
const otherYear = (s) => parseDate(s).getFullYear() !== today().getFullYear();

function fmtDate(s, withYear = otherYear(s)) {
  const d = parseDate(s);
  const base = `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  return withYear ? `${d.getFullYear()}/${base}` : base;
}

function whenText(e) {
  let s = fmtDate(e.date) + (e.time ? ` ${e.time}` : "");
  if (e.start) s = `${fmtDate(e.start)}${e.startTime ? ` ${e.startTime}` : ""} 〜 ${s}`;
  return s;
}

function remainText(n) {
  if (n === 0) return "今日";
  if (n === 1) return "明日";
  if (n < 0) return `${-n}日前`;
  return `あと${n}日`;
}

function dayLabel(iso) {
  const n = daysUntil(iso);
  if (n === 0) return `今日 ${fmtDate(iso)}`;
  if (n === 1) return `明日 ${fmtDate(iso)}`;
  return fmtDate(iso);
}

const urgency = (n) => (n <= 3 ? "urgent" : n <= 7 ? "soon" : "");

// =====================================================================
// 企業・選考ルート
// =====================================================================

const bySlug = (slug) => state.companies.find((c) => c.slug === slug);
const programOf = (c, pid) => c?.programs.find((p) => p.id === pid);
const flowIndex = (p) => p.flow.indexOf(p.step);

function companyState(c) {
  if (!c.programs.length) return "before";
  return c.programs.map((p) => p.state).sort((a, b) => STATE_RANK[a] - STATE_RANK[b])[0];
}

const isEnded = (c) => ENDED.has(companyState(c));
const evKey = (e) => e.date + (e.time || "99:99");
const byWhen = (a, b) => evKey(a).localeCompare(evKey(b));

function allEvents() {
  return state.companies.flatMap((c) => c.events.map((e, i) => ({ ...e, c, i, p: programOf(c, e.program) })));
}

const liveEvents = () => allEvents().filter((e) => !e.done && !isEnded(e.c));

function nextEvent(c, pid) {
  return c.events
    .filter((e) => !e.done && daysUntil(e.date) >= 0 && (!pid || e.program === pid))
    .sort(byWhen)[0];
}

function defaultProgram(c) {
  return [...c.programs].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state])[0];
}

// =====================================================================
// 部品
// =====================================================================

function avatar(c, size = "") {
  const ch = [...c.name.replace(/^株式会社/, "")][0] || "?";
  return `<span class="avatar ${IND_CLASS[c.industry] || "other"} ${size}" aria-hidden="true">${esc(ch)}</span>`;
}

const kindBadge = (kind) => `<span class="kind ${KIND_CLASS[kind] || "main"}">${esc(kind)}</span>`;
const statePill = (s) => `<span class="pill ${s}">${STATES[s].label}</span>`;
const stars = (c) => (c.priority ? `<span class="stars-mini" title="志望度: ${PRIORITY_LABEL[c.priority]}">${"★".repeat(c.priority)}</span>` : "");

function eventTitle(e, showProgram = false) {
  return (
    (e.kind === "event" ? '<span class="tag event">日程</span>' : "") +
    (showProgram && e.p && e.c.programs.length > 1 ? `<span class="tag prog">${esc(e.p.kind)}</span>` : "") +
    esc(e.title) +
    (e.tentative ? '<span class="tag tentative">目安</span>' : "")
  );
}

function routeMini(p) {
  if (!p.flow.length) return "";
  const idx = p.state === "offer" ? p.flow.length : flowIndex(p);
  return `<span class="route-mini" aria-hidden="true">${p.flow
    .map((_, i) => `<span class="st${i < idx ? " past" : i === idx ? " now" : ""}"></span>`)
    .join("")}</span>`;
}

// 一覧用: 進んでいるルートは状況つき、まだのルートは種類だけをまとめて出す
function progChips(progs) {
  const active = progs.filter((p) => p.state !== "before");
  const waitingKinds = {};
  for (const p of progs.filter((q) => q.state === "before")) waitingKinds[p.kind] = (waitingKinds[p.kind] || 0) + 1;
  const open = progs.some((p) => p.state === "before" && p.status === "受付中");
  return (
    active.map(progChip).join("") +
    (open ? '<span class="open-dot">受付中</span>' : "") +
    Object.entries(waitingKinds)
      .map(([k, n]) => `<span class="prog-chip before">${kindBadge(k)}${n > 1 ? `<span>×${n}</span>` : ""}</span>`)
      .join("")
  );
}

function progChip(p) {
  const s = p.state;
  const step = LIVE.includes(s) && s !== "before" && p.step ? `${esc(p.step)} ` : "";
  return `<span class="prog-chip ${s}">${kindBadge(p.kind)}<span>${step}${STATES[s].label}</span></span>`;
}

// 予定の1行。opts.date で日付も出す
function eventRow(e, { date = false, tick = true } = {}) {
  const n = daysUntil(e.date);
  const late = n < 0 && !e.done;
  return `
    <li class="ev-row ${e.kind === "event" ? "is-event" : "is-deadline"} ${e.done ? "done" : urgency(n)}">
      <div class="ev-when">
        ${date ? `<span class="ev-date">${esc(fmtDate(e.date))}</span>` : ""}
        <span class="ev-time">${esc(e.time || (e.kind === "event" ? "終日" : "締切"))}</span>
      </div>
      <div class="ev-main">
        <a class="ev-co" href="#/c/${esc(e.c.slug)}${e.p ? `/${esc(e.p.id)}` : ""}">${esc(e.c.name)}</a>
        <span class="ev-title">${eventTitle(e, true)}</span>
        ${e.start && daysUntil(e.start) > 0 ? `<span class="ev-sub">${esc(fmtDate(e.start))}${e.startTime ? ` ${esc(e.startTime)}` : ""} から受付</span>` : ""}
      </div>
      <span class="ev-left">${e.done ? "済み" : late ? `${-n}日前` : date ? esc(remainText(n)) : ""}</span>
      ${tick && !e.done ? `<button class="tick" data-done="${esc(e.c.slug)}:${e.i}" aria-label="${esc(e.c.name)} ${esc(e.title)} を済みにする">${ICONS.check}</button>` : ""}
    </li>`;
}

function groupByDay(events) {
  const groups = new Map();
  for (const e of events) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  }
  return [...groups.entries()];
}

// =====================================================================
// カレンダー（.ics・Googleカレンダー）
// =====================================================================

function utcStamp(date, time, addMinutes = 0) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm + addMinutes)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const compactDate = (date) => date.replace(/-/g, "");
const nextDayCompact = (date) => compactDate(isoOf(addDays(parseDate(date), 1)));
const calTitle = (e, c) => `${e.kind === "event" ? "" : "【締切】"}${c.name} ${e.title}`;

function googleCalUrl(e, c) {
  const dates = e.time
    ? `${utcStamp(e.date, e.time)}/${utcStamp(e.date, e.time, 30)}`
    : `${compactDate(e.date)}/${nextDayCompact(e.date)}`;
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
        : [`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${nextDayCompact(e.date)}`]),
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

// =====================================================================
// 画面: ホーム
// =====================================================================

const $ = (sel) => document.querySelector(sel);
const $view = () => document.getElementById("view");

function viewHome() {
  const t = today();
  const live = liveEvents();
  const upcoming = live.filter((e) => daysUntil(e.date) >= 0).sort(byWhen);
  const week = upcoming.filter((e) => daysUntil(e.date) <= 6);
  const overdue = live.filter((e) => daysUntil(e.date) < 0 && daysUntil(e.date) >= -PAST_DAYS).sort(byWhen);
  const active = state.companies
    .flatMap((c) => c.programs.filter((p) => p.state === "todo" || p.state === "waiting").map((p) => ({ c, p, nx: nextEvent(c, p.id) })))
    .sort((a, b) => STATE_RANK[a.p.state] - STATE_RANK[b.p.state] || (a.nx && b.nx ? byWhen(a.nx, b.nx) : a.nx ? -1 : b.nx ? 1 : 0));

  let html = `
    <header class="page-head">
      <h1 class="page-title">${t.getMonth() + 1}月${t.getDate()}日<span class="wd">${WD[t.getDay()]}曜日</span></h1>
      <p class="page-sub">今週の予定 ${week.length}件 ・ 選考中 ${active.length}件</p>
    </header>`;

  // 説明会より、応募（本選考・インターン）の締切を先に出す
  const next = upcoming.find((e) => e.p?.kind !== "説明会・イベント") || upcoming[0];
  if (next) {
    const n = daysUntil(next.date);
    const m = next.c.mypage;
    html += `
      <section class="next ${urgency(n)}" aria-label="次の${next.kind === "event" ? "予定" : "締切"}">
        <div class="next-count">${n <= 1 ? `<span class="next-word">${n === 0 ? "今日" : "明日"}</span>` : `<span class="next-num">${n}</span><span class="next-unit">日後</span>`}</div>
        <div class="next-body">
          <p class="next-label">次の${next.kind === "event" ? "予定" : "締切"}${next.p ? ` ・ ${esc(next.p.kind)}` : ""}</p>
          <a class="next-co" href="#/c/${esc(next.c.slug)}${next.p ? `/${esc(next.p.id)}` : ""}">${esc(next.c.name)}</a>
          <p class="next-title">${esc(next.title)}${next.tentative ? "（目安）" : ""}</p>
          <p class="next-when">${esc(whenText(next))}</p>
        </div>
        <div class="next-actions">
          ${m.url ? `<a class="btn on-dark" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">マイページ</a>` : ""}
          <button class="btn on-dark ghost" data-done="${esc(next.c.slug)}:${next.i}">済みにする</button>
        </div>
      </section>`;
  } else {
    html += `<section class="empty-panel">登録されている予定はありません。<a href="#/add">予定を追加</a></section>`;
  }

  // 1週間の帯
  html += `<ol class="week-strip" aria-label="今週">`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(t, i);
    const iso = isoOf(d);
    const dayEvents = week.filter((e) => e.date === iso);
    const hasDeadline = dayEvents.some((e) => e.kind !== "event");
    html += `
      <li><a href="#/calendar/${iso}" class="${i === 0 ? "today" : ""} ${dayEvents.length ? "has" : ""}" aria-label="${esc(fmtDate(iso))} 予定${dayEvents.length}件">
        <span class="ws-wd ${d.getDay() === 0 ? "sun" : d.getDay() === 6 ? "sat" : ""}">${WD[d.getDay()]}</span>
        <span class="ws-d">${d.getDate()}</span>
        <span class="ws-n">${dayEvents.length ? `<i class="${hasDeadline ? "deadline" : "event"}"></i>${dayEvents.length > 1 ? dayEvents.length : ""}` : ""}</span>
      </a></li>`;
  }
  html += `</ol>`;

  if (!week.length) {
    html += `<p class="hint week-empty">今週の予定はありません。</p>`;
  } else {
    html += `<section class="sheet agenda">`;
    for (const [iso, evs] of groupByDay(week)) {
      html += `<h2 class="day-head ${urgency(daysUntil(iso))}">${esc(dayLabel(iso))}</h2><ul class="ev-list">${evs.map((e) => eventRow(e)).join("")}</ul>`;
    }
    html += `</section>`;
  }
  const later = upcoming.filter((e) => daysUntil(e.date) > 6).slice(0, 5);
  if (later.length) {
    html += `<h2 class="sec">その先の予定<a class="sec-link" href="#/calendar">カレンダー</a></h2><ul class="ev-list plain">${later.map((e) => eventRow(e, { date: true })).join("")}</ul>`;
  }

  if (active.length) {
    html += `<h2 class="sec">選考中</h2><ul class="active-list">`;
    for (const { c, p, nx } of active) {
      html += `
        <li><a class="active-row" href="#/c/${esc(c.slug)}/${esc(p.id)}">
          ${avatar(c)}
          <span class="ar-body">
            <span class="ar-name">${esc(c.name)}</span>
            <span class="ar-prog">${kindBadge(p.kind)}${routeMini(p)}<b>${esc(p.step || "")}</b>${statePill(p.state)}</span>
            ${nx ? `<span class="ar-next ${urgency(daysUntil(nx.date))}">${esc(fmtDate(nx.date))} ${esc(nx.title)}</span>` : ""}
          </span>
        </a></li>`;
    }
    html += `</ul>`;
  }

  if (overdue.length) {
    html += `<h2 class="sec">期限が過ぎた予定<span class="count">${overdue.length}</span></h2>
      <p class="hint">終わっていたら ✓ を押すと消えます。</p>
      <ul class="ev-list plain">${overdue.map((e) => eventRow(e, { date: true })).join("")}</ul>`;
  }

  const todos = state.companies.filter((c) => c.todo.length && !isEnded(c));
  if (todos.length) {
    const total = todos.reduce((n, c) => n + c.todo.length, 0);
    html += `<details class="todos"><summary>調べること・転記すること<span class="count">${total}</span></summary><ul>`;
    for (const c of todos) {
      html += `<li><a href="#/c/${esc(c.slug)}">${esc(c.name)}</a><ul>${c.todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></li>`;
    }
    html += `</ul></details>`;
  }
  return html;
}

// =====================================================================
// 画面: カレンダー
// =====================================================================

function viewCalendar(sel) {
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(sel || "") ? sel : isoToday();
  const s = parseDate(selected);
  const y = s.getFullYear();
  const m = s.getMonth();
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
  const start = addDays(first, -first.getDay());
  const events = allEvents().filter((e) => !isEnded(e.c));
  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const prev = isoOf(new Date(y, m - 1, 1));
  const next = isoOf(new Date(y, m + 1, 1));

  let html = `
    <header class="cal-head">
      <a class="icon-btn" href="#/calendar/${prev}" aria-label="前の月">‹</a>
      <h1 class="page-title">${y}年${m + 1}月</h1>
      <a class="icon-btn" href="#/calendar/${next}" aria-label="次の月">›</a>
      <a class="btn small" href="#/calendar/${isoToday()}">今日</a>
    </header>
    <div class="cal" role="grid" aria-label="${y}年${m + 1}月">
      <div class="cal-row cal-wd" role="row">${[...WD].map((w, i) => `<span role="columnheader" class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</span>`).join("")}</div>`;
  for (let w = 0; w < weeks; w++) {
    html += `<div class="cal-row" role="row">`;
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      const iso = isoOf(day);
      const evs = byDate.get(iso) || [];
      const cls = [
        day.getMonth() !== m ? "out" : "",
        iso === isoToday() ? "today" : "",
        iso === selected ? "selected" : "",
        d === 0 ? "sun" : d === 6 ? "sat" : "",
      ].join(" ");
      const dots = evs
        .slice(0, 3)
        .map((e) => `<i class="${e.done ? "done" : e.kind === "event" ? "event" : "deadline"}"></i>`)
        .join("");
      html += `<a role="gridcell" class="cal-cell ${cls}" href="#/calendar/${iso}" aria-label="${esc(fmtDate(iso, true))} 予定${evs.length}件"${iso === selected ? ' aria-selected="true"' : ""}>
        <span class="cal-d">${day.getDate()}</span><span class="cal-dots">${dots}${evs.length > 3 ? "<b>+</b>" : ""}</span></a>`;
    }
    html += `</div>`;
  }
  html += `</div>
    <p class="cal-legend"><i class="deadline"></i>締切 <i class="event"></i>日程 <i class="done"></i>済み</p>`;

  const dayEvents = (byDate.get(selected) || []).sort(byWhen);
  html += `<section class="sheet day-sheet">
    <h2 class="day-head">${esc(dayLabel(selected))}</h2>
    ${dayEvents.length ? `<ul class="ev-list">${dayEvents.map((e) => eventRow(e)).join("")}</ul>` : `<p class="hint">この日の予定はありません。</p>`}
    <a class="btn ghost wide" href="#/add/${selected}">${ICONS.plus}この日に予定を追加</a>
  </section>`;

  const monthEvents = events.filter((e) => e.date.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`)).sort(byWhen);
  if (monthEvents.length) {
    html += `<h2 class="sec">${m + 1}月の予定<span class="count">${monthEvents.length}</span></h2><ul class="ev-list plain">${monthEvents
      .map((e) => eventRow(e, { date: true }))
      .join("")}</ul>`;
  }
  html += `<div class="fab-space"></div><a class="fab" href="#/add/${selected}" aria-label="予定を追加">${ICONS.plus}</a>`;
  return html;
}

// =====================================================================
// 画面: 企業一覧
// =====================================================================

function companyRows() {
  const order = (a, b) => {
    const na = nextEvent(a);
    const nb = nextEvent(b);
    if (na && nb) return byWhen(na, nb);
    if (na || nb) return na ? -1 : 1;
    return (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, "ja");
  };
  const q = ui.cq.trim().toLowerCase();
  const pool = state.companies.filter(
    (c) =>
      (!ui.industry || c.industry === ui.industry) &&
      (!ui.kind || c.programs.some((p) => p.kind === ui.kind)) &&
      (!q || `${c.name} ${c.industry} ${c.programs.map((p) => p.title).join(" ")}`.toLowerCase().includes(q)),
  );
  const row = (c) => {
    const nx = nextEvent(c);
    const progs = ui.kind ? c.programs.filter((p) => p.kind === ui.kind) : c.programs;
    return `
      <li><a class="co-row" href="#/c/${esc(c.slug)}">
        ${avatar(c)}
        <span class="co-body">
          <span class="co-top"><span class="co-name">${esc(c.name)}</span>${stars(c)}<span class="co-ind">${esc(c.industry || "")}</span></span>
          <span class="co-progs">${progChips(progs) || '<span class="hint">選考ルート未登録</span>'}</span>
          ${nx ? `<span class="co-next ${urgency(daysUntil(nx.date))}">${esc(fmtDate(nx.date))} ${esc(nx.title)}<span>${esc(remainText(daysUntil(nx.date)))}</span></span>` : ""}
        </span>
      </a></li>`;
  };
  const canApply = (c) => c.programs.some((p) => p.state === "before" && p.status === "受付中");
  const groups = [
    { label: "対応中", hint: "", test: (c) => companyState(c) === "todo" },
    { label: "結果待ち", hint: "", test: (c) => companyState(c) === "waiting" },
    { label: "内定", hint: "", test: (c) => companyState(c) === "offer" },
    { label: "応募できる", hint: "受付中のルートがあり、まだ応募していない企業", test: (c) => companyState(c) === "before" && canApply(c) },
    { label: "まだ受付前", hint: "", test: (c) => companyState(c) === "before" && !canApply(c) },
  ];
  let html = "";
  for (const g of groups) {
    const items = pool.filter(g.test).sort(order);
    if (items.length) {
      html += `<h2 class="sec">${g.label}<span class="count">${items.length}</span></h2>${g.hint ? `<p class="hint sec-hint">${g.hint}</p>` : ""}<ul class="co-list">${items.map(row).join("")}</ul>`;
    }
  }
  const ended = pool.filter(isEnded);
  if (ended.length) html += `<details class="ended"><summary>終了した企業<span class="count">${ended.length}</span></summary><ul class="co-list">${ended.map(row).join("")}</ul></details>`;
  return html || `<p class="empty">当てはまる企業はありません。</p>`;
}

function viewCompanies() {
  const counts = {};
  for (const c of state.companies) if (c.industry) counts[c.industry] = (counts[c.industry] || 0) + 1;
  const industries = [...INDUSTRIES.filter((i) => counts[i]), ...Object.keys(counts).filter((i) => !INDUSTRIES.includes(i))];
  return `
    <header class="page-head row">
      <h1 class="page-title">企業<span class="count">${state.companies.length}社</span></h1>
      <a class="btn" href="#/new">${ICONS.plus}追加</a>
    </header>
    <input id="cq" class="search-box" type="search" placeholder="企業名で探す" value="${esc(ui.cq)}" enterkeyhint="search">
    <div class="seg small" role="group" aria-label="選考の種類">
      ${["", "本選考", "インターン"].map((k) => `<button data-kind="${k}" aria-pressed="${ui.kind === k}">${k || "すべて"}</button>`).join("")}
    </div>
    <div class="chips" role="group" aria-label="業界">
      ${["", ...industries].map((i) => `<button data-filter="${esc(i)}" aria-pressed="${ui.industry === i}">${i ? `<i class="ind-dot ${IND_CLASS[i] || "other"}"></i>${esc(i)}<span>${counts[i]}</span>` : "すべて"}</button>`).join("")}
    </div>
    <div id="co-results">${companyRows()}</div>`;
}

// =====================================================================
// 画面: 企業ページ
// =====================================================================

function programPanel(c, p) {
  const s = p.state;
  const idx = flowIndex(p);
  const slug = esc(c.slug);
  const key = `${slug}:${esc(p.id)}`;
  let html = `
    <section class="prog-panel ${KIND_CLASS[p.kind] || "main"}">
      <div class="prog-head">
        ${kindBadge(p.kind)}
        <h2 class="prog-title">${esc(p.title || p.kind)}</h2>
        ${p.status && p.status !== "不明" ? `<span class="open ${p.status === "受付中" ? "on" : ""}">${esc(p.status)}</span>` : ""}
      </div>
      ${p.period ? `<p class="prog-period">受付・時期: ${esc(p.period)}</p>` : ""}`;
  const nx = nextEvent(c, p.id);
  if (nx) {
    const n = daysUntil(nx.date);
    html += `<p class="prog-next ${urgency(n)}"><b>次の予定</b>${esc(fmtDate(nx.date))}${nx.time ? ` ${esc(nx.time)}` : ""} ${esc(nx.title)}<span>${esc(remainText(n))}</span></p>`;
  }

  if (ENDED.has(s) || s === "offer") {
    html += `<div class="state-final">${statePill(s)}<span>${p.step ? `${esc(p.step)}まで進みました` : ""}</span>
      <button class="mini" data-state="${key}:todo">選考中に戻す</button></div>`;
  } else {
    html += `<div class="seg" role="group" aria-label="いまの状況">${LIVE.map(
      (k) => `<button data-state="${key}:${k}" aria-pressed="${k === s}">${STATES[k].label}</button>`,
    ).join("")}</div>
      <p class="hint">${esc(STATES[s].hint)}</p>`;
  }

  if (p.flow.length) {
    html += `<ol class="route${ENDED.has(s) ? " dim" : ""}">`;
    p.flow.forEach((name, i) => {
      const cls = s === "offer" || i < idx ? "past" : i === idx ? "now" : "";
      const tag = i === idx && (s === "todo" || s === "waiting") ? `<span class="here ${s}">${STATES[s].label}</span>` : "";
      html += `<li class="${cls}"><button class="station" data-step="${key}:${i}" aria-label="段階を「${esc(name)}」にする">
        <span class="st"></span><span class="route-name">${esc(name)}</span>${tag}</button></li>`;
    });
    html += `</ol>`;
  }

  if (LIVE.includes(s)) {
    const nextStep = idx >= 0 ? p.flow[idx + 1] : p.flow[0];
    const label = !p.flow.length
      ? ""
      : idx < 0
        ? `選考を始める（${p.flow[0]}から）`
        : nextStep
          ? `${p.flow[idx]}を通過した（次は${nextStep}）`
          : `${p.flow[idx]}を通過した（内定）`;
    if (label) html += `<button class="btn primary wide" data-pass="${key}">${esc(label)}</button>`;
    if (s !== "before") {
      html += `<div class="outcome-row">
        <button class="mini" data-state="${key}:offer">内定</button>
        <button class="mini" data-state="${key}:declined">辞退した</button>
        <button class="mini danger" data-state="${key}:rejected">不合格だった</button>
      </div>`;
    }
    if (s === "todo" && /面接/.test(p.step)) {
      html += `<a class="btn ghost wide" href="#/doc/${encodeURIComponent("profile/08_面接想定問答.md")}">面接の想定問答を開く</a>`;
    } else if (s === "todo" && /ES|書類|エントリー/.test(p.step)) {
      html += `<a class="btn ghost wide" href="#/doc/${encodeURIComponent(hasNote(c.slug) ? `notes/${c.slug}.md` : "profile/README.md")}">ESの${hasNote(c.slug) ? "下書き" : "素材"}を開く</a>`;
    }
  }

  if (p.process) html += `<h3 class="sub">選考プロセス</h3><div class="md prog-process">${renderMarkdown(p.process)}</div>`;
  const links = [
    p.url && `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">募集ページ</a>`,
    p.entryUrl && `<a href="${esc(p.entryUrl)}" target="_blank" rel="noopener noreferrer">エントリー</a>`,
    p.source && p.source !== p.url && `<a class="faint" href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">出典</a>`,
  ].filter(Boolean);
  if (links.length) html += `<p class="prog-links">${links.join("")}</p>`;
  return html + `</section>`;
}

function viewCompany(slug, pid) {
  const c = bySlug(slug);
  if (!c) return `<p class="empty">この企業は見つかりません。<a href="#/companies">企業一覧に戻る</a></p>`;
  const p = programOf(c, pid) || defaultProgram(c);
  const m = c.mypage;
  const meta = [c.industry, c.salary ? `初任給 ¥${Number(c.salary).toLocaleString()}` : "", c.lastAction ? `最終更新 ${fmtDate(c.lastAction, true)}` : ""].filter(Boolean);

  let html = `
    <a class="back" href="#/companies">企業</a>
    <header class="co-hero">
      ${avatar(c, "lg")}
      <div class="co-hero-body">
        <h1 class="page-title">${esc(c.name)}</h1>
        <p class="meta">${meta.map(esc).join("　")}</p>
        <div class="stars" role="group" aria-label="志望度">
          ${[1, 2, 3].map((n) => `<button data-prio="${esc(c.slug)}:${n}" aria-pressed="${n <= (c.priority || 0)}" aria-label="志望度 ${n}">★</button>`).join("")}
          <span class="stars-label">${esc(PRIORITY_LABEL[c.priority] || "志望度")}</span>
        </div>
      </div>
      <a class="icon-btn" href="#/c/${esc(c.slug)}/edit" aria-label="編集">${ICONS.edit}</a>
    </header>
    <nav class="quick" aria-label="よく使うリンク">
      ${c.recruitUrl ? `<a class="qa" href="${esc(c.recruitUrl)}" target="_blank" rel="noopener noreferrer">${ICONS.globe}<span>採用ページ</span></a>` : `<a class="qa muted" href="#/c/${esc(c.slug)}/edit">${ICONS.globe}<span>採用ページ未登録</span></a>`}
      ${m.url ? `<a class="qa" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${ICONS.door}<span>マイページ</span></a>` : `<a class="qa muted" href="#/c/${esc(c.slug)}/edit">${ICONS.door}<span>マイページ未登録</span></a>`}
      ${m.id ? `<button class="qa" data-copy="${esc(m.id)}" data-copy-label="ID">${ICONS.id}<span>IDをコピー</span></button>` : ""}
      ${m.password ? `<button class="qa" data-copy="${esc(m.password)}" data-copy-label="パスワード">${ICONS.key}<span>PWをコピー</span></button>` : ""}
    </nav>`;

  if (c.programs.length > 1) {
    html += `<div class="prog-tabs" role="tablist">${c.programs
      .map((q) => `<a role="tab" href="#/c/${esc(c.slug)}/${esc(q.id)}" aria-selected="${q.id === p.id}">
        ${kindBadge(q.kind)}<span class="pt-title">${esc(q.title || q.kind)}</span><span class="pt-state">${STATES[q.state].label}</span></a>`)
      .join("")}</div>`;
  }
  html += p
    ? programPanel(c, p)
    : `<section class="empty-panel">選考ルート（本選考・インターンなど）が登録されていません。<a href="#/c/${esc(c.slug)}/edit">編集から追加</a></section>`;

  const events = c.events.map((e, i) => ({ ...e, c, i, p: programOf(c, e.program) })).sort(byWhen);
  html += `<h2 class="sec">予定<a class="sec-link" href="#/add?c=${esc(c.slug)}">追加</a></h2>`;
  if (events.length) {
    html += `<ul class="checklist">`;
    for (const e of events) {
      const n = daysUntil(e.date);
      const tail = e.done ? "" : n < 0 ? `<span class="late">期限切れ</span>` : `<span class="${urgency(n)}">${esc(remainText(n))}</span>`;
      html += `
        <li class="${e.done ? "done" : ""}">
          <label><input type="checkbox" data-toggle="${esc(c.slug)}:${e.i}"${e.done ? " checked" : ""}>
          <span class="ck-body"><span class="ck-when">${esc(whenText(e))}</span><span class="ck-title">${eventTitle(e, true)}</span>
          ${e.done ? "" : `<span class="cal-links"><button class="linkish" data-ics="${esc(c.slug)}:${e.i}">カレンダーに追加</button><a href="${esc(googleCalUrl(e, c))}" target="_blank" rel="noopener noreferrer">Googleカレンダー</a></span>`}</span></label>
          ${tail}
        </li>`;
    }
    html += `</ul>`;
  } else {
    html += `<p class="hint">予定はまだありません。</p>`;
  }

  if (c.todo.length) html += `<h2 class="sec">調べること・転記すること</h2><ul class="plain-list">${c.todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  if (c.links.length) {
    html += `<h2 class="sec">リンク</h2><ul class="plain-list">${c.links
      .map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a></li>`)
      .join("")}</ul>`;
  }
  html += `<h2 class="sec">企業研究・ES下書き</h2>`;
  html += hasNote(c.slug)
    ? `<a class="btn ghost wide" href="#/doc/${encodeURIComponent(`notes/${c.slug}.md`)}">ノートを開く</a>`
    : state.docs
      ? `<button class="btn ghost wide" data-newnote="${esc(c.slug)}">ノートを作る</button>`
      : `<p class="hint">読み込み中…</p>`;
  if (c.memo?.trim()) html += `<h2 class="sec">メモ</h2><div class="md">${renderMarkdown(c.memo)}</div>`;
  if (c.history.length) {
    html += `<h2 class="sec">これまでの記録</h2><ol class="history">${c.history
      .slice(0, 30)
      .map((h) => `<li><span class="h-date">${esc(fmtDate(h.date))}</span>${esc(h.text)}</li>`)
      .join("")}</ol>`;
  }
  return html;
}

// =====================================================================
// 画面: 編集
// =====================================================================

function programFieldset(p = {}) {
  return `
    <fieldset class="pf" data-pid="${esc(p.id || "")}">
      <div class="pf-row">
        <label>種類<select name="kind">${KINDS.map((k) => `<option${k === (p.kind || "本選考") ? " selected" : ""}>${k}</option>`).join("")}</select></label>
        <label>受付状況<select name="status">${OPEN_STATUSES.map((k) => `<option${k === (p.status || "不明") ? " selected" : ""}>${k}</option>`).join("")}</select></label>
      </div>
      <label>名前<input name="title" value="${esc(p.title || "")}" placeholder="例: エンジニア職 本選考 / 冬季インターン"></label>
      <label>受付期間・時期<input name="period" value="${esc(p.period || "")}" placeholder="例: 2026/10/1〜通年"></label>
      <label>選考フロー（「、」区切り。路線図の駅になる）<input name="flow" value="${esc((p.flow?.length ? p.flow : DEFAULT_FLOW).join("、"))}"></label>
      <label>選考プロセスの説明<textarea name="process" rows="3">${esc(p.process || "")}</textarea></label>
      <label>募集ページURL<input type="url" name="url" value="${esc(p.url || "")}" autocapitalize="off"></label>
      <label>エントリーURL<input type="url" name="entryUrl" value="${esc(p.entryUrl || "")}" autocapitalize="off"></label>
      <button type="button" class="mini danger" data-remove-fs>この選考ルートを削除</button>
    </fieldset>`;
}

function eventFieldset(e = {}, programs = [], removable = true) {
  return `
    <fieldset class="ev">
      <input class="ev-title-in" name="title" placeholder="内容（例: ES提出締切）" value="${esc(e.title || "")}">
      <label>種類<select name="kind">${EVENT_KINDS.map((k) => `<option value="${k.v}"${k.v === (e.kind || "deadline") ? " selected" : ""}>${k.label}</option>`).join("")}</select></label>
      <label>選考ルート<select name="program"><option value="">指定なし</option>${programs
        .map((p) => `<option value="${esc(p.id)}"${p.id === e.program ? " selected" : ""}>${esc(p.kind)}：${esc(p.title || p.kind)}</option>`)
        .join("")}</select></label>
      <label>日付（締切・当日）<input type="date" name="date" value="${esc(e.date || "")}"></label>
      <label>時刻<input type="time" name="time" value="${esc(e.time || "")}"></label>
      <label>開始日（期間のときだけ）<input type="date" name="start" value="${esc(e.start || "")}"></label>
      <label>開始時刻<input type="time" name="startTime" value="${esc(e.startTime || "")}"></label>
      <label class="check"><input type="checkbox" name="tentative"${e.tentative ? " checked" : ""}>日付は目安</label>
      <label class="check"><input type="checkbox" name="done"${e.done ? " checked" : ""}>済み</label>
      ${removable ? `<button type="button" class="mini danger" data-remove-fs>この予定を削除</button>` : ""}
    </fieldset>`;
}

function viewEdit(slug) {
  const isNew = !slug;
  const c = isNew ? normalize({ name: "", programs: [{ id: newId(), kind: "本選考", title: "本選考", flow: DEFAULT_FLOW, status: "不明" }] }) : bySlug(slug);
  if (!c) return `<p class="empty">この企業は見つかりません。</p>`;
  const m = c.mypage;
  return `
    <a class="back" href="${isNew ? "#/companies" : `#/c/${esc(c.slug)}`}">${isNew ? "企業" : esc(c.name)}</a>
    <h1 class="page-title">${isNew ? "企業を追加" : "編集"}</h1>
    <form id="edit" data-slug="${esc(c.slug || "")}">
      <section class="sheet form-sheet">
        <label>会社名<input name="name" required value="${esc(c.name || "")}"></label>
        ${isNew ? `<label>英字の識別名（ノートのファイル名になる。例: capcom）<input name="slug" required pattern="[a-z0-9-]+" autocapitalize="off"></label>` : ""}
        <div class="pf-row">
          <label>業界<input name="industry" list="industries" value="${esc(c.industry || "")}"></label>
          <label>志望度<select name="priority">${[3, 2, 1, 0].map((v) => `<option value="${v}"${v === (c.priority || 0) ? " selected" : ""}>${PRIORITY_LABEL[v] || "未設定"}</option>`).join("")}</select></label>
        </div>
        <datalist id="industries">${INDUSTRIES.map((i) => `<option value="${i}">`).join("")}</datalist>
        <label>新卒採用ページURL<input type="url" name="recruitUrl" value="${esc(c.recruitUrl || "")}" autocapitalize="off"></label>
        <label>初任給（円）<input type="number" name="salary" inputmode="numeric" value="${esc(c.salary || "")}"></label>
      </section>

      <h2 class="sec">マイページ</h2>
      <section class="sheet form-sheet">
        <label>URL<input type="url" name="mpUrl" value="${esc(m.url || "")}" autocapitalize="off"></label>
        <label>ID<input name="mpId" value="${esc(m.id || "")}" autocapitalize="off" autocomplete="off"></label>
        <label>パスワード<input name="mpPassword" value="${esc(m.password || "")}" autocapitalize="off" autocomplete="off"></label>
      </section>

      <h2 class="sec">選考ルート</h2>
      <p class="hint">本選考とインターンなど、選考が別れているものはルートを分けます。状況と段階は企業ページで変えます。</p>
      <div id="programs">${c.programs.map(programFieldset).join("")}</div>
      <button type="button" class="btn ghost wide" data-add-prog>${ICONS.plus}選考ルートを追加</button>

      <h2 class="sec">予定</h2>
      <div id="events">${c.events.map((e) => eventFieldset(e, c.programs)).join("")}</div>
      <button type="button" class="btn ghost wide" data-add-ev>${ICONS.plus}予定を追加</button>

      <h2 class="sec">そのほか</h2>
      <section class="sheet form-sheet">
        <label>リンク（1行に「表示名 | URL」）<textarea name="links" rows="3">${esc(c.links.map((l) => `${l.label} | ${l.url}`).join("\n"))}</textarea></label>
        <label>調べること・転記すること（1行に1つ）<textarea name="todo" rows="3">${esc(c.todo.join("\n"))}</textarea></label>
        <label>メモ（Markdown）<textarea name="memo" rows="8">${esc(c.memo || "")}</textarea></label>
      </section>

      <div class="form-actions">
        <button class="btn primary wide" type="submit">保存する</button>
        ${isNew ? "" : `<button type="button" class="btn danger wide" data-delete="${esc(c.slug)}">この企業を削除</button>`}
      </div>
    </form>`;
}

function readEvent(fs) {
  const v = (n) => fs.querySelector(`[name="${n}"]`);
  const e = { title: v("title").value.trim(), date: v("date").value };
  if (v("kind")?.value === "event") e.kind = "event";
  if (v("program")?.value) e.program = v("program").value;
  if (v("time").value) e.time = v("time").value;
  if (v("start").value) e.start = v("start").value;
  if (v("startTime").value) e.startTime = v("startTime").value;
  if (v("tentative").checked) e.tentative = true;
  if (v("done").checked) e.done = true;
  return e;
}

function readForm(form) {
  const fd = new FormData(form);
  const get = (k) => String(fd.get(k) ?? "").trim();
  const lines = (k) => get(k).split("\n").map((s) => s.trim()).filter(Boolean);
  const programs = [...form.querySelectorAll("fieldset.pf")].map((fs) => {
    const v = (n) => fs.querySelector(`[name="${n}"]`).value.trim();
    return {
      id: fs.dataset.pid || newId(),
      kind: v("kind"),
      title: v("title") || v("kind"),
      status: v("status"),
      period: v("period"),
      flow: v("flow").split(/[、,，→]/).map((s) => s.trim()).filter(Boolean),
      process: v("process"),
      url: v("url"),
      entryUrl: v("entryUrl"),
    };
  });
  return {
    name: get("name"),
    slug: get("slug"),
    industry: get("industry"),
    priority: Number(get("priority")) || 0,
    recruitUrl: get("recruitUrl"),
    salary: get("salary") ? Number(get("salary")) : null,
    mypage: { url: get("mpUrl"), id: get("mpId"), password: get("mpPassword") },
    programs,
    events: [...form.querySelectorAll("fieldset.ev")].map(readEvent).filter((e) => e.title || e.date),
    links: lines("links").map((l) => {
      const [label, ...rest] = l.split("|");
      const url = rest.join("|").trim() || label.trim();
      return { label: rest.length ? label.trim() : url, url };
    }),
    todo: lines("todo"),
    memo: get("memo"),
  };
}

function viewAddEvent(date, slug) {
  const options = [...state.companies]
    .filter((c) => !isEnded(c))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    .map((c) => `<option value="${esc(c.slug)}"${c.slug === slug ? " selected" : ""}>${esc(c.name)}</option>`)
    .join("");
  const c = bySlug(slug);
  return `
    <a class="back" href="#/calendar${date ? `/${esc(date)}` : ""}">予定</a>
    <h1 class="page-title">予定を追加</h1>
    <form id="addev">
      <label>企業<select name="company" required><option value="">選んでください</option>${options}</select></label>
      ${eventFieldset({ date: date || "" }, c?.programs || [], false)}
      <button class="btn primary wide" type="submit">追加する</button>
      <p class="hint">ここにない企業は、先に「企業」タブで追加してください。</p>
    </form>`;
}

// =====================================================================
// 画面: ログイン・素材・検索・設定
// =====================================================================

function viewLogins() {
  const withLogin = state.companies
    .filter((c) => c.mypage.url || c.mypage.id || c.mypage.password)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  let html = `
    <header class="page-head"><h1 class="page-title">ログイン</h1>
    <p class="page-sub">パスワードは伏せたままコピーできます。押すと表示します。</p></header>
    <input id="lq" class="search-box" type="search" placeholder="企業名で探す" enterkeyhint="search">
    <ul class="login-list">`;
  for (const c of withLogin) {
    const m = c.mypage;
    html += `
      <li class="login-row">
        ${avatar(c, "sm")}
        <div class="lr-body">
          <a class="lr-name" href="#/c/${esc(c.slug)}">${esc(c.name)}</a>
          <span class="lr-cred">${m.id ? `<code>${esc(m.id)}</code>` : '<span class="hint">ID未登録</span>'}${m.password ? `<button class="pw-mask" data-reveal="${esc(m.password)}" aria-label="パスワードを表示">••••••</button>` : ""}</span>
        </div>
        <div class="lr-actions">
          ${m.url ? `<a class="mini" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">開く</a>` : `<a class="mini muted" href="#/c/${esc(c.slug)}/edit">URL</a>`}
          ${m.id ? `<button class="mini" data-copy="${esc(m.id)}" data-copy-label="ID">ID</button>` : ""}
          ${m.password ? `<button class="mini" data-copy="${esc(m.password)}" data-copy-label="パスワード">PW</button>` : ""}
        </div>
      </li>`;
  }
  html += `</ul>`;
  const missing = state.companies
    .filter((c) => !withLogin.includes(c) && !isEnded(c))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, "ja"));
  if (missing.length) {
    html += `<h2 class="sec">マイページ未登録<span class="count">${missing.length}</span></h2>
      <ul class="login-list unregistered">${missing
        .map((c) => `<li class="login-row">${avatar(c, "sm")}<div class="lr-body"><a class="lr-name" href="#/c/${esc(c.slug)}">${esc(c.name)}</a>${stars(c)}</div>
          <div class="lr-actions">${c.recruitUrl ? `<a class="mini" href="${esc(c.recruitUrl)}" target="_blank" rel="noopener noreferrer">採用</a>` : ""}<a class="mini" href="#/c/${esc(c.slug)}/edit">入力</a></div></li>`)
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
  let html = `<header class="page-head"><h1 class="page-title">素材</h1><p class="page-sub">見出しごとに文字数とコピーボタンが出ます。</p></header>`;
  for (const g of state.docs) {
    html += `<h2 class="sec">${esc(g.label)}<span class="count">${g.paths.length}</span></h2><ul class="doc-list">`;
    html += g.paths
      .map((p) => {
        const co = p.startsWith("notes/") ? bySlug(p.split("/").pop().replace(/\.md$/, "")) : null;
        return `<li><a href="#/doc/${encodeURIComponent(p)}">${co ? avatar(co, "sm") : '<span class="doc-icon" aria-hidden="true"></span>'}<span>${esc(docName(p))}</span></a></li>`;
      })
      .join("");
    if (!g.paths.length) html += `<li class="hint">まだありません</li>`;
    html += `</ul>`;
  }
  html += `<h2 class="sec">そのほか</h2><ul class="doc-list">${EXTRA_DOCS.map((d) => `<li><a href="#/doc/${encodeURIComponent(d.path)}"><span class="doc-icon" aria-hidden="true"></span><span>${esc(d.name)}</span></a></li>`).join("")}</ul>`;
  return html;
}

const countChars = (s) => s.replace(/\s/g, "").length;

function viewDoc(path, doc) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const blocks = parseMarkdown(doc.text, { dir });
  const sections = [{ head: null, blocks: [] }];
  for (const b of blocks) {
    if (b.type === "h" && b.level >= 2) sections.push({ head: b, blocks: [] });
    else sections[sections.length - 1].blocks.push(b);
  }
  // 目次: 見出しが多い素材だけ。押すとその見出しまで移動する
  // 大見出し（##）が3つ以上あれば大見出しだけ、なければ小見出し（###）まで
  const top = sections.filter((s) => s.head && s.head.level === 2);
  const heads = top.length >= 3 ? top : sections.filter((s) => s.head && s.head.level <= 3);
  const toc = heads.length >= 3
    ? `<nav class="toc" aria-label="目次">${heads
        .map((s, i) => `<button class="${s.head.level === 3 ? "sub" : ""}" data-jump="h-${i}">${esc(s.head.text.replace(/（\d+字）$/, ""))}</button>`)
        .join("")}</nav>`
    : "";
  let html = `
    <a class="back" href="#/docs">素材</a>
    <div class="doc-head"><span class="doc-path">${esc(path)}${doc.offline ? "（端末の控え）" : ""}</span><a class="icon-btn" href="#/doc/${encodeURIComponent(path)}/edit" aria-label="編集">${ICONS.edit}</a></div>
    ${toc}
    <article class="md">`;
  for (const s of sections) {
    const paras = s.blocks.filter((b) => b.type === "p");
    if (s.head) {
      const title = s.head.text.replace(/（\d+字）$/, "");
      const lv = s.head.level + 1;
      const id = heads.includes(s) ? ` id="h-${heads.indexOf(s)}"` : "";
      const text = paras.map((p) => plain(p.text)).join("\n");
      // 文字数とコピーは、ESにそのまま使う長さの文章がある見出しだけに出す
      if (countChars(text) >= 60) {
        html += `<div class="sec-head"${id}><h${lv}>${inline(title, { dir })}</h${lv}>
          <span class="chars">${countChars(text)}字</span>
          <button class="mini" data-copy="${esc(text)}">コピー</button></div>`;
      } else {
        html += `<h${lv}${id}>${inline(title, { dir })}</h${lv}>`;
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
      <div class="doc-head"><span class="doc-path">${esc(path)}</span><span class="chars" id="doc-count"></span></div>
      <textarea name="text" class="doc-text" spellcheck="false">${esc(doc.text)}</textarea>
      <p class="hint">文字を選択すると、選択した部分の文字数（空白・改行を除く）が上に出ます。</p>
      <button class="btn primary wide" type="submit">保存する</button>
    </form>`;
}

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
  if (!terms.length) return `<p class="hint">企業名・選考ルート・メモ・予定・ESの文章をまとめて探せます。スペースで区切ると、すべてを含むものに絞ります。</p>`;
  const hit = (text) => terms.every((t) => text.toLowerCase().includes(t.toLowerCase()));
  const companies = state.companies.filter((c) =>
    hit([c.name, c.industry, c.memo, ...c.todo, ...c.programs.flatMap((p) => [p.kind, p.title, p.process, p.step, STATES[p.state].label, ...p.flow])].join("\n")),
  );
  const events = allEvents().filter((e) => hit(`${e.c.name} ${e.title}`)).sort(byWhen);
  const docs = [];
  for (const [path, doc] of state.docCache) {
    const lines = doc.text.split("\n").filter((l) => l.trim() && hit(l));
    if (lines.length || hit(docName(path))) docs.push({ path, lines });
  }
  let html = "";
  if (companies.length) {
    html += `<h2 class="sec">企業<span class="count">${companies.length}</span></h2><ul class="results">${companies
      .map((c) => {
        const where = [c.memo, ...c.todo, ...c.programs.map((p) => p.process)].find((t) => t && terms.some((x) => t.toLowerCase().includes(x.toLowerCase())));
        return `<li><a href="#/c/${esc(c.slug)}">${highlight(c.name, terms)}</a><span class="co-ind">${esc(c.industry || "")}</span>${where ? `<p>${highlight(snippet(where, terms[0]), terms)}</p>` : ""}</li>`;
      })
      .join("")}</ul>`;
  }
  if (events.length) {
    html += `<h2 class="sec">予定<span class="count">${events.length}</span></h2><ul class="results">${events
      .map((e) => `<li><a href="#/c/${esc(e.c.slug)}">${esc(e.c.name)}</a><p>${esc(fmtDate(e.date))} ${highlight(e.title, terms)}${e.done ? "（済み）" : ""}</p></li>`)
      .join("")}</ul>`;
  }
  if (docs.length) {
    html += `<h2 class="sec">素材・ノート<span class="count">${docs.length}</span></h2><ul class="results">${docs
      .map((d) => `<li><a href="#/doc/${encodeURIComponent(d.path)}">${highlight(docName(d.path), terms)}</a>${d.lines
        .slice(0, 3)
        .map((l) => `<p>${highlight(snippet(l.replace(/^[#>\-*\s|]+/, ""), terms[0]), terms)}</p>`)
        .join("")}</li>`)
      .join("")}</ul>`;
  }
  if (!html) html = `<p class="empty">「${esc(q)}」に当てはまるものはありません。</p>`;
  if (state.docsLoading) html += `<p class="hint">素材を読み込み中…</p>`;
  return html;
}

function viewSearch() {
  return `
    <header class="page-head"><h1 class="page-title">検索</h1></header>
    <input id="q" class="search-box" type="search" enterkeyhint="search" placeholder="例: 面接　/　Go　/　締切" value="${esc(ui.q)}">
    <div id="results">${searchResults(ui.q)}</div>`;
}

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
    <header class="page-head"><h1 class="page-title">設定</h1></header>
    <form id="settings" class="sheet form-sheet">
      <label>データのリポジトリ<input name="repo" value="${esc(cfg.repo)}" autocapitalize="off"></label>
      <label>GitHub トークン（変更するときだけ入力）<input name="token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <button class="btn primary wide" type="submit">保存して読み込み直す</button>
    </form>
    <h2 class="sec">カレンダーに書き出す</h2>
    <p class="hint">これからの予定（済みを除く）を .ics ファイルにまとめます。iPhone は開くとカレンダーに追加でき、Googleカレンダーは PC の「設定 → インポート」から取り込めます。締切は前日、日程は2時間前に通知が出ます。</p>
    <button class="btn wide" data-ics-all>まとめて書き出す</button>
    <h2 class="sec">この端末から消す</h2>
    <p class="hint">トークンと、端末に残っている企業データ・素材の控えを削除します。</p>
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

// =====================================================================
// 描画とルーティング
// =====================================================================

function route() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  return { parts: (path || "home").split("/").map(decodeURIComponent), query: new URLSearchParams(query) };
}

function renderChrome() {
  const [name] = route().parts;
  const tab = { c: "companies", new: "companies", doc: "docs", add: "calendar", schedule: "home" }[name] || name;
  document.querySelectorAll(".tabs a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.tab === tab));
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
    view.innerHTML = state.error
      ? `<div class="error-panel"><p class="error">${esc(state.error)}</p><button class="btn primary wide" data-retry>もう一度読み込む</button></div>`
      : `<div class="skeleton" aria-label="読み込み中"><i></i><i></i><i></i><i></i></div>`;
    return;
  }
  const { parts, query } = route();
  const [name, arg, sub] = parts;
  let html;
  try {
    if (name === "calendar") html = viewCalendar(arg);
    else if (name === "companies") html = viewCompanies();
    else if (name === "c" && arg && sub === "edit") html = viewEdit(arg);
    else if (name === "c" && arg) html = viewCompany(arg, sub);
    else if (name === "new") html = viewEdit(null);
    else if (name === "add") html = viewAddEvent(arg, query.get("c"));
    else if (name === "logins") html = viewLogins();
    else if (name === "docs") html = viewDocs();
    else if (name === "search") html = viewSearch();
    else if (name === "settings") html = viewSettings();
    else if (name === "doc") {
      view.innerHTML = `<p class="hint loading">読み込み中…</p>`;
      const doc = await getDoc(arg);
      if (route().parts[1] !== arg) return; // 読み込み中に別の画面へ移動した
      html = sub === "edit" ? viewDocEdit(arg, doc) : viewDoc(arg, doc);
    } else html = viewHome();
  } catch (e) {
    html = `<p class="error">${esc(e.status ? explain(e) : `表示できませんでした（${e.message}）`)}</p>`;
  }
  if (state.error) {
    html = (state.offline
      ? `<p class="offline">電波がないため、前回読み込んだ内容を表示しています。変更は保存できません。</p>`
      : `<p class="error">${esc(state.error)}</p>`) + html;
  }
  view.innerHTML = html;
  afterRender(name, sub);
}

function afterRender(name, sub) {
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
  if (name === "logins") {
    const box = document.getElementById("lq");
    box.addEventListener("input", () => {
      const q = box.value.trim().toLowerCase();
      document.querySelectorAll(".login-row").forEach((li) => {
        li.hidden = !!q && !li.querySelector(".lr-name").textContent.toLowerCase().includes(q);
      });
    });
  }
  if (name === "companies") {
    const box = document.getElementById("cq");
    box.addEventListener("input", () => {
      ui.cq = box.value;
      document.getElementById("co-results").innerHTML = companyRows();
    });
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
let toastAction = null;
// action を渡すと「元に戻す」ボタン付きで少し長めに出す
function toast(message, isError = false, action = null) {
  const el = document.getElementById("toast");
  toastAction = action;
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="toast-btn" data-toast-action>${esc(action.label)}</button>` : ""}`;
  el.classList.toggle("error", isError);
  el.classList.toggle("actionable", !!action);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    toastAction = null;
  }, isError ? 6000 : action ? 6000 : 2200);
}

// commit が別の端末の変更と合わせて保存したときの戻り値（真として扱える）
const MERGED = 2;
const undoable = (message, undo, result = true) =>
  toast(result === MERGED ? "別の端末の変更と合わせて保存しました" : message, false, { label: "元に戻す", run: undo });

async function copy(text, label = "") {
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
  toast(label ? `${label}をコピーしました` : "コピーしました");
}

// =====================================================================
// 操作
// =====================================================================

async function markDone(key, done = true, { undo = true } = {}) {
  const [slug, i] = key.split(":");
  const c = bySlug(slug);
  const target = c?.events?.[Number(i)];
  if (!target) return;
  const { title, date } = target;
  const ok = await commit(() => {
    // 別の端末で予定が増減しても同じ予定を指すよう、内容と日付で探す
    const e = bySlug(slug)?.events?.find((x) => x.title === title && x.date === date);
    if (!e) return;
    if (done) e.done = true;
    else delete e.done;
  }, `${c.name}: ${title} を${done ? "済み" : "未完了"}に`, { quiet: undo });
  render();
  if (ok && undo) undoable(done ? "済みにしました" : "未完了に戻しました", () => markDone(key, !done, { undo: false }), ok);
}

async function updateProgram(slug, pid, patch, note) {
  const c = bySlug(slug);
  const p = programOf(c, pid);
  if (!p) return;
  const label = c.programs.length > 1 ? `${p.title || p.kind}: ` : "";
  const text = label + note;
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, p[k]]));
  const lastAction = c.lastAction;
  const ok = await commit(() => {
    const x = bySlug(slug);
    const q = programOf(x, pid);
    if (!q) return;
    Object.assign(q, patch);
    x.lastAction = isoToday();
    x.history = [{ date: isoToday(), text }, ...(x.history || [])];
  }, `${c.name}: ${text}`, { quiet: true });
  render();
  if (!ok) return;
  undoable(note, async () => {
    await commit(() => {
      const x = bySlug(slug);
      const q = programOf(x, pid);
      if (!q) return;
      Object.assign(q, before);
      x.lastAction = lastAction;
      const i = (x.history || []).findIndex((h) => h.text === text);
      if (i >= 0) x.history.splice(i, 1);
    }, `${c.name}: 取り消し（${text}）`);
    render();
  }, ok);
}

function statusClick(t) {
  if (t.dataset.state) {
    const [slug, pid, next] = t.dataset.state.split(":");
    const p = programOf(bySlug(slug), pid);
    if (!p || p.state === next) return;
    if (ENDED.has(next) && !confirm(`「${STATES[next].label}」にします。`)) return;
    const note = next === "todo" && !LIVE.includes(p.state) ? "選考中に戻した" : `「${STATES[next].label}」にした`;
    return updateProgram(slug, pid, { state: next }, note);
  }
  if (t.dataset.step) {
    const [slug, pid, i] = t.dataset.step.split(":");
    const p = programOf(bySlug(slug), pid);
    const step = p.flow[Number(i)];
    if (p.step === step) return;
    const patch = { step };
    if (!LIVE.includes(p.state) || p.state === "before") patch.state = "todo";
    return updateProgram(slug, pid, patch, `段階を「${step}」にした`);
  }
  if (t.dataset.pass) {
    const [slug, pid] = t.dataset.pass.split(":");
    const p = programOf(bySlug(slug), pid);
    const idx = flowIndex(p);
    if (idx < 0) return updateProgram(slug, pid, { step: p.flow[0], state: "todo" }, `選考を始めた（${p.flow[0]}）`);
    if (idx + 1 < p.flow.length) return updateProgram(slug, pid, { step: p.flow[idx + 1], state: "todo" }, `${p.flow[idx]}を通過した`);
    return updateProgram(slug, pid, { state: "offer" }, `${p.flow[idx]}を通過して内定`);
  }
}

document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("button, [data-copy]");
  if (!t) return;
  if (t.hasAttribute("data-toast-action")) {
    const action = toastAction;
    toastAction = null;
    document.getElementById("toast").classList.remove("show");
    if (action) await action.run();
    return;
  }
  if (t.hasAttribute("data-retry")) {
    state.error = null;
    await Promise.all([loadCompanies(), loadDocList().catch(() => {})]);
    return render();
  }
  if (t.dataset.jump) {
    document.getElementById(t.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (t.dataset.copy !== undefined) return copy(t.dataset.copy, t.dataset.copyLabel);
  if (t.dataset.done) return markDone(t.dataset.done);
  if (t.dataset.state || t.dataset.step || t.dataset.pass) return statusClick(t);
  if (t.dataset.prio) {
    const [slug, n] = t.dataset.prio.split(":");
    const c = bySlug(slug);
    const v = c.priority === Number(n) ? 0 : Number(n);
    const old = c.priority || 0;
    const ok = await commit(() => { const x = bySlug(slug); if (x) x.priority = v; }, `${c.name}: 志望度を${PRIORITY_LABEL[v] || "未設定"}に`, { quiet: true });
    if (ok) undoable(`志望度を「${PRIORITY_LABEL[v] || "未設定"}」にしました`, () => commit(() => { const x = bySlug(slug); if (x) x.priority = old; }, `${c.name}: 志望度を戻す`), ok);
    return;
  }
  if (t.dataset.filter !== undefined) {
    ui.industry = t.dataset.filter;
    store.set("jh.industry", ui.industry);
    return render();
  }
  if (t.dataset.kind !== undefined && t.closest(".seg")) {
    ui.kind = t.dataset.kind;
    store.set("jh.kind", ui.kind);
    return render();
  }
  if (t.dataset.reveal !== undefined) {
    const shown = t.textContent !== "••••••";
    t.textContent = shown ? "••••••" : t.dataset.reveal;
    t.classList.toggle("shown", !shown);
    return;
  }
  if (t.dataset.ics) {
    const [slug, i] = t.dataset.ics.split(":");
    const c = bySlug(slug);
    const e = c.events[Number(i)];
    return downloadIcs(`${c.slug}-${e.date}.ics`, [{ e, c }]);
  }
  if (t.hasAttribute("data-ics-all")) {
    const items = liveEvents().filter((e) => daysUntil(e.date) >= 0).map((e) => ({ e, c: e.c }));
    if (!items.length) return toast("書き出す予定がありません", true);
    downloadIcs(`shukatsu-${isoToday()}.ics`, items);
    return toast(`${items.length}件の予定を書き出しました`);
  }
  if (t.hasAttribute("data-add-ev")) {
    const form = t.closest("form");
    const c = bySlug(form.dataset.slug);
    document.getElementById("events").insertAdjacentHTML("beforeend", eventFieldset({}, c?.programs || []));
    document.querySelector("#events fieldset:last-child .ev-title-in").focus();
    return;
  }
  if (t.hasAttribute("data-add-prog")) {
    document.getElementById("programs").insertAdjacentHTML("beforeend", programFieldset({ id: newId(), kind: "インターン", title: "", flow: DEFAULT_FLOW }));
    return;
  }
  if (t.hasAttribute("data-remove-fs")) return t.closest("fieldset").remove();
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
    if (!confirm("この端末からトークンとデータの控えを削除します。")) return;
    ["jh.token", "jh.cache", "jh.repo", "jh.doclist", "jh.industry", "jh.kind"].forEach((k) => store.del(k));
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(DOC_KEY)).forEach((k) => store.del(k));
    } catch { /* noop */ }
    location.hash = "";
    location.reload();
  }
});

document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.dataset.toggle) return markDone(t.dataset.toggle, t.checked);
  // 予定の追加: 企業を選んだら、その企業の選考ルートを選べるようにする
  if (t.name === "company" && t.closest("#addev")) {
    const c = bySlug(t.value);
    const sel = t.closest("form").querySelector('[name="program"]');
    sel.innerHTML = `<option value="">指定なし</option>${(c?.programs || [])
      .map((p) => `<option value="${esc(p.id)}">${esc(p.kind)}：${esc(p.title || p.kind)}</option>`)
      .join("")}`;
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
    location.hash = "#/home";
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
        c = normalize({ slug, name: data.name, programs: [], history: [{ date: isoToday(), text: "追加した" }] });
        state.companies.push(c);
      }
      // 状況と段階はフォームにないので、同じ id の選考ルートから引き継ぐ
      const programs = data.programs.map((p) => {
        const old = programOf(c, p.id);
        return { ...p, state: old?.state || "before", step: old?.step || "" };
      });
      Object.assign(c, structuredClone({ ...data, programs }));
      if (!c.salary) delete c.salary;
      if (!c.priority) delete c.priority;
    }, `${data.name} を${isNew ? "追加" : "更新"}`);
    if (saved) location.hash = `#/c/${slug}`;
    button.disabled = false;
    return;
  }

  if (form.id === "addev") {
    const c = bySlug(form.company.value);
    const e = readEvent(form.querySelector("fieldset.ev"));
    if (!c) return toast("企業を選んでください", true);
    if (!e.title || !e.date) return toast("内容と日付の両方を入れてください", true);
    const slug = c.slug;
    button.disabled = true;
    const saved = await commit(() => {
      const x = bySlug(slug);
      if (x && !x.events.some((y) => y.title === e.title && y.date === e.date)) x.events = [...x.events, { ...e }];
    }, `${c.name}: 予定「${e.title}」を追加`);
    if (saved) location.hash = `#/calendar/${e.date}`;
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
      store.set(DOC_KEY + path, JSON.stringify({ text, sha }));
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

// =====================================================================
// 起動
// =====================================================================

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* なくても動く */ });
}
// アプリに戻ってきたとき、前の読み込みから2分以上たっていれば最新にする（編集中は除く）
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !cfg.token || !state.loaded) return;
  if (Date.now() - (state.loadedAt || 0) < 120000) return;
  const { parts } = route();
  if (["new", "add"].includes(parts[0]) || parts.includes("edit")) return;
  const y = window.scrollY;
  await loadCompanies();
  render();
  window.scrollTo(0, y);
});

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
