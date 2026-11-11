// 画面: 素材

import { EPISODES_PATH, EXTRA_DOCS, IN_SELECTION, STATE_RANK, TOPICS } from "../config.js";
import { fmtDate } from "../dates.js";
import { esc, inline, parseMarkdown, plain } from "../md.js";
import { bySlug, companyState, nextEvent } from "../model.js";
import { avatar, ICONS, statePill } from "../parts.js";
import { state } from "../store.js";

export function docName(path) {
  const extra = EXTRA_DOCS.find((d) => d.path === path);
  if (extra) return extra.name;
  const base = path.split("/").pop().replace(/\.md$/, "");
  const company = path.startsWith("notes/") ? bySlug(base) : null;
  if (company) return company.name;
  if (base === "README") return "使い方";
  return base.replace(/^\d+_/, "").replace(/^_/, "");
}

const countChars = (s) => s.replace(/\s/g, "").length;

// ESの文章のかけら
// - profile/回答 などの土台: 見出しごと。ESにそのまま使える長さ（MIN_CHARS 以上）の段落を持つものだけ
// - notes/: 「## ES」の下の「### 設問」ごと。直下の情報の行（種類・字数・状態・ルート・話）を読む
// 情報の行は上の見出しから受け継ぐ（「## A. 課題解決型」の「話: E1」は下の「### 400字版」にも効く）
const MIN_CHARS = 60;
// 「400字版」「1分」のような見出しは、親の見出しと合わせて名前にする
const VERSION = /版$|^\d+(秒|分)$/;
const parsed = new WeakMap();

const pieceState = (s = "") => (s.startsWith("提出") ? "sent" : s.includes("以前") ? "old" : "draft");
const STATE_MARK = { sent: '<span class="sent">提出</span>', old: '<span class="tag">以前の版</span>', draft: '<span class="tag draft">下書き</span>', base: "" };

function pieces(path, doc) {
  if (parsed.has(doc)) return parsed.get(doc);
  const isNote = path.startsWith("notes/");
  const baseTopic = TOPICS.find((t) => t.files.includes(path));
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const found = [];
  const trail = [];
  const metaAt = []; // 見出しの深さごとの情報の行（0 はファイル全体）
  let level = 0;
  let cur = null;
  for (const b of parseMarkdown(doc.text, { dir })) {
    if (b.type === "h") {
      const text = b.text.replace(/（\d+字）$/, "");
      level = b.level;
      trail.length = level;
      trail[level - 1] = text;
      metaAt.length = level;
      cur = level >= 2 ? { head: text, level, trail: trail.slice(1, level - 1).filter(Boolean), inherit: Object.assign({}, ...metaAt.filter(Boolean)), meta: {}, blocks: [] } : null;
      if (cur) found.push(cur);
    } else if (b.type === "meta") {
      metaAt[level] = b.meta;
      if (cur) cur.meta = b.meta;
    } else if (cur) cur.blocks.push(b);
  }
  const list = found
    .filter((x) => (isNote ? x.level === 3 && x.trail[0] === "ES" : !!baseTopic))
    .map((x) => {
      const meta = { ...x.inherit, ...x.meta };
      const parent = x.trail[x.trail.length - 1];
      const isVersion = !isNote && parent && VERSION.test(x.head);
      const text = x.blocks.filter((b) => b.type === "p" || b.type === "code").map((b) => (b.type === "p" ? plain(b.text) : b.text)).join("\n");
      return {
        path,
        title: isVersion ? `${parent}・${x.head}` : x.head,
        topic: isNote ? (TOPICS.find((t) => t.name === meta.種類) || TOPICS.find((t) => t.key === "other")).key : baseTopic.key,
        text,
        chars: countChars(text),
        limit: meta.字数 || "",
        route: meta.ルート || "",
        date: (meta.状態 || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "",
        state: isNote ? pieceState(meta.状態) : "base",
        eps: (meta.話 || "").split(/[・、,\s]+/).filter(Boolean),
        // 本人が書いた文章が正典（2026/11/12 から）
        mine: meta.書いた人 === "本人",
        html: x.blocks.map((b) => b.html).join(""),
      };
    })
    .filter((x) => (isNote ? x.chars > 0 : x.chars >= MIN_CHARS));
  parsed.set(doc, list);
  return list;
}

const noteCompany = (path) => (path.startsWith("notes/") ? bySlug(path.split("/").pop().replace(/\.md$/, "")) : null);
const notePaths = () => state.docs?.find((g) => g.dir === "notes")?.paths || [];
const docLink = (path) => `#/doc/${encodeURIComponent(path)}`;
const coRank = (path) => {
  const c = noteCompany(path);
  return c ? STATE_RANK[companyState(c)] : 99;
};
const loaded = (p) => (state.docCache.has(p) ? pieces(p, state.docCache.get(p)) : []);

// すべての文章（土台＋各社）
function allPieces() {
  return [...new Set(TOPICS.flatMap((t) => t.files))].flatMap(loaded).concat(notePaths().flatMap(loaded));
}

// 企業ページ用: その企業のノートのESの文章。ノートを読み込んでいなければ null
export function companyPieces(slug) {
  const path = `notes/${slug}.md`;
  return state.docCache.has(path) ? pieces(path, state.docCache.get(path)) : null;
}

// エピソード集の「## E1. 長期インターン」と、その中の【要記入】の数
function episodes() {
  const doc = state.docCache.get(EPISODES_PATH);
  if (!doc) return [];
  const list = [];
  let on = false;
  for (const line of doc.text.split("\n")) {
    const m = line.match(/^## (E\d+)\.\s*(.*)$/);
    if (m) list.push({ id: m[1], title: m[2], blanks: 0 });
    else if (line.startsWith("#")) on = line.includes("要記入");
    // 埋めた項目は打ち消し線（~~）で残しているので数えない
    else if (on && list.length && /^\s*([-*]|\d+\.) (?!~~)/.test(line)) list[list.length - 1].blanks++;
  }
  return list.sort((a, b) => a.id.slice(1) - b.id.slice(1));
}

// 【要記入】の見出しの下にある、まだ埋まっていない箇条書きの数
function blanks(text) {
  let on = false;
  let n = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) on = line.includes("要記入");
    else if (on && /^\s*([-*]|\d+\.) (?!~~)/.test(line)) n++;
  }
  return n;
}

// 文章がある字数（50字単位）
const charRuler = (list) =>
  `<span class="ruler" aria-label="ある字数">${[...new Set(list.map((x) => Math.max(50, Math.round(x.chars / 50) * 50)))]
    .sort((a, b) => b - a)
    .slice(0, 5)
    .map((n) => `<b>${n}</b>`)
    .join("")}</span>`;

const loadingNote = () => (state.docsLoading ? "読み込み中…" : "");

export function viewDocs() {
  let html = `<header class="page-head"><h1 class="page-title">素材</h1><p class="page-sub">ESの文章を設問の種類ごとに集めています。土台の文章と、各社に出した文章を字数で比べて使い回せます。</p></header>`;
  if (!state.docs) return html + `<p class="hint">読み込み中…</p>`;
  const all = allPieces();

  html += `<h2 class="sec">設問から探す</h2><ul class="topics">${TOPICS.map((t) => {
    const list = all.filter((x) => x.topic === t.key);
    const base = list.filter((x) => x.state === "base").length;
    const cos = list.length - base;
    const count = list.length ? `${base ? `土台 <b>${base}</b>` : ""}${cos ? `<span>各社 <b>${cos}</b></span>` : ""}` : loadingNote() || "まだありません";
    return `<li><a class="topic" href="#/docs/${t.key}">
      <span class="topic-name">${esc(t.name)}</span>
      <span class="topic-ask">${esc(t.ask)}</span>
      <span class="topic-foot"><span class="topic-n">${count}</span>${list.length ? charRuler(list) : ""}</span>
    </a></li>`;
  }).join("")}</ul>`;

  const eps = episodes();
  if (eps.length) {
    html += `<h2 class="sec">話から探す<a class="sec-link" href="${docLink(EPISODES_PATH)}">エピソード集を開く</a></h2><p class="sec-hint hint">事実はエピソード集が正。同じ話を使った文章を並べて、言っていることがずれていないか確かめる。</p>
      <ul class="eps">${eps
        .map((e) => {
          const n = all.filter((x) => x.eps.includes(e.id)).length;
          return `<li><a href="#/docs/${e.id}"><b class="ep-id">${e.id}</b><span class="ep-title">${esc(e.title)}</span><span class="ep-n">${n ? `文章 <b>${n}</b>` : ""}${e.blanks ? `<span>要記入 <b>${e.blanks}</b></span>` : ""}</span></a></li>`;
        })
        .join("")}</ul>`;
  }

  // 企業ごと: 選考が進んでいる企業から。応募予定・選考中でノートがない企業には作るボタン
  const notes = notePaths()
    .map((path) => ({ path, c: noteCompany(path), doc: state.docCache.get(path) }))
    .sort((a, b) => coRank(a.path) - coRank(b.path) || docName(a.path).localeCompare(docName(b.path), "ja"));
  html += `<h2 class="sec">企業ごとのノート<span class="count">${notes.length}</span></h2><ul class="notes">${notes
    .map(({ path, c, doc }) => {
      const list = doc ? pieces(path, doc) : [];
      const sent = list.filter((x) => x.state === "sent").length;
      const ev = c && nextEvent(c);
      return `<li><a class="note-row" href="${docLink(path)}">
        ${c ? avatar(c) : '<span class="doc-icon" aria-hidden="true"></span>'}
        <span class="note-main"><span class="note-name">${esc(docName(path))}</span>
          <span class="note-meta">${c ? statePill(companyState(c)) : ""}${doc ? `<span>ES <b>${list.length}</b></span>` : ""}${sent ? `<span class="sent">提出 ${sent}</span>` : ""}</span></span>
        ${ev ? `<span class="note-next"><b>${esc(fmtDate(ev.date))}</b><span>${esc(ev.title)}</span></span>` : ""}
      </a></li>`;
    })
    .join("")}</ul>`;
  const missing = state.companies
    .filter((c) => (IN_SELECTION.has(companyState(c)) || companyState(c) === "plan") && !notePaths().includes(`notes/${c.slug}.md`))
    .sort((a, b) => STATE_RANK[companyState(a)] - STATE_RANK[companyState(b)]);
  if (missing.length) {
    html += `<details class="note-missing"><summary>ノートがない応募予定・選考中の企業<span class="count">${missing.length}</span></summary><ul>${missing
      .map((c) => `<li>${avatar(c, "sm")}<span>${esc(c.name)}</span>${statePill(companyState(c))}<button class="mini" data-newnote="${esc(c.slug)}">ノートを作る</button></li>`)
      .join("")}</ul></details>`;
  }

  // 土台と準備: 設問の土台にしていない profile/ のファイルと、そのほか
  const used = new Set(TOPICS.map((t) => t.files[0]));
  const profile = (state.docs.find((g) => g.dir === "profile")?.paths || []).filter((p) => !used.has(p)).sort((a, b) => a.split("/").length - b.split("/").length);
  html += `<h2 class="sec">土台と準備</h2><ul class="doc-list">${[...profile, ...EXTRA_DOCS.map((d) => d.path)]
    .map((p) => {
      const doc = state.docCache.get(p);
      const n = doc ? blanks(doc.text) : 0;
      return `<li><a href="${docLink(p)}"><span class="doc-icon" aria-hidden="true"></span><span class="doc-name">${esc(docName(p))}${p.includes("/保管/") ? '<small class="faint">（保管）</small>' : ""}</span>${n ? `<span class="blank-n" title="【要記入】の項目">要記入 <b>${n}</b></span>` : ""}</a></li>`;
    })
    .join("")}</ul>`;
  return html;
}

function pieceItem(x) {
  const c = noteCompany(x.path);
  const src = c ? `${avatar(c, "sm")}<a href="${docLink(x.path)}">${esc(c.name)}</a>` : `<a class="base-src" href="${docLink(x.path)}">土台・${esc(docName(x.path))}</a>`;
  const preview = x.text.replace(/\s+/g, " ").slice(0, 80);
  const sub = [x.route && esc(x.route), x.date && esc(fmtDate(x.date))].filter(Boolean).join(" ");
  return `<li class="piece is-${x.state}${x.mine ? " is-mine" : ""}">
    <div class="piece-top"><span class="piece-src">${src}${x.mine ? '<span class="mine">本人</span>' : ""}${STATE_MARK[x.state]}${sub ? `<small>${sub}</small>` : ""}</span>
      <span class="chars">${x.chars}字${x.limit ? `<small>／${esc(x.limit)}</small>` : ""}</span><button class="mini" data-copy="${esc(x.text)}">コピー</button></div>
    <details><summary><b class="piece-title">${esc(x.title)}</b><span class="piece-pre">${esc(preview)}</span></summary><div class="md">${x.html}</div></details>
    ${x.eps.length ? `<p class="piece-eps">${x.eps.map((e) => `<a href="#/docs/${esc(e)}">${esc(e)}</a>`).join("")}</p>` : ""}
  </li>`;
}

// 並び: 本人が書いたもの → 提出したもの → 土台 → 下書き → 以前の版。同じなら選考が進んでいる企業から
const ORDER = { sent: 0, base: 1, draft: 2, old: 3 };
const byUse = (a, b) => b.mine - a.mine || ORDER[a.state] - ORDER[b.state] || coRank(a.path) - coRank(b.path);

const LENGTHS = [100, 200, 300, 400, 500];

export function viewTopic(key, query) {
  const t = TOPICS.find((x) => x.key === key);
  if (!t) return `<a class="back" href="#/docs">素材</a><p class="error">見つかりません。</p>`;
  const len = Number(query.get("len")) || 0;
  const ep = query.get("ep") || "";
  const mine = query.get("by") === "me";
  const pool = allPieces().filter((x) => x.topic === key);
  const eps = [...new Set(pool.flatMap((x) => x.eps))].sort((a, b) => a.slice(1) - b.slice(1));
  let list = pool.filter((x) => (!ep || x.eps.includes(ep)) && (!mine || x.mine));
  // 字数を選ぶと、近い順に1列で並べる（多少長さが違っても、近いものから直して使う）
  list = len ? list.sort((a, b) => Math.abs(a.chars - len) - Math.abs(b.chars - len)) : list.sort(byUse);
  const link = (l, e, m = mine) => {
    const q = new URLSearchParams();
    if (l) q.set("len", l);
    if (e) q.set("ep", e);
    if (m) q.set("by", "me");
    return `#/docs/${key}${q.toString() ? `?${q}` : ""}`;
  };
  const eplist = episodes();
  const chip = (href, on, label, title = "") => `<a class="chip" href="${href}"${on ? ' aria-current="true"' : ""}${title ? ` title="${esc(title)}"` : ""}>${label}</a>`;
  return `<a class="back" href="#/docs">素材</a>
    <header class="page-head"><h1 class="page-title">${esc(t.name)}<span class="count">${pool.length}</span></h1><p class="page-sub">${esc(t.ask)}</p></header>
    <nav class="topic-tabs" aria-label="設問の種類">${TOPICS.map((x) => `<a href="#/docs/${x.key}"${x.key === key ? ' aria-current="page"' : ""}>${esc(x.name)}</a>`).join("")}</nav>
    <div class="filters">
      <div class="chips" aria-label="字数"><span class="chips-label">字数</span>${chip(link(0, ep), !len, "すべて")}${LENGTHS.map((n) => chip(link(n, ep), len === n, `${n}字`)).join("")}</div>
      <div class="chips" aria-label="書いた人"><span class="chips-label">書き手</span>${chip(link(len, ep, false), !mine, "すべて")}${chip(link(len, ep, true), mine, "本人の文章（正典）")}</div>
      ${eps.length ? `<div class="chips" aria-label="話"><span class="chips-label">話</span>${chip(link(len, ""), !ep, "すべて")}${eps.map((e) => chip(link(len, e), ep === e, e, eplist.find((x) => x.id === e)?.title)).join("")}</div>` : ""}
    </div>
    ${len ? `<p class="sec-hint hint">${len}字に近い順。長いものは削り、短いものは足して使う。</p>` : `<p class="sec-hint hint">本人の文章 → 提出したもの → 土台 → 下書きの順。${t.files.map((p) => `<a href="${docLink(p)}">${esc(docName(p))}</a>`).join("・")}</p>`}
    <ul class="pieces">${list.map(pieceItem).join("") || `<li class="hint">${loadingNote() || "まだありません。"}</li>`}</ul>`;
}

export function viewEpisode(id) {
  const e = episodes().find((x) => x.id === id);
  const list = allPieces().filter((x) => x.eps.includes(id)).sort(byUse);
  let html = `<a class="back" href="#/docs">素材</a>
    <header class="page-head"><h1 class="page-title"><span class="ep-id">${esc(id)}</span>${esc(e?.title || "")}</h1>
    <p class="page-sub">この話を使った文章。数字や期間が食い違っていないか、ここで見比べる。${e?.blanks ? `　要記入 <b>${e.blanks}</b>` : ""}</p></header>
    <a class="btn ghost wide" href="${docLink(EPISODES_PATH)}">エピソード集で事実を見る</a>`;
  for (const t of TOPICS) {
    const sub = list.filter((x) => x.topic === t.key);
    if (sub.length) html += `<h2 class="sec">${esc(t.name)}<span class="count">${sub.length}</span></h2><ul class="pieces">${sub.map(pieceItem).join("")}</ul>`;
  }
  if (!list.length) html += `<p class="hint">${loadingNote() || "この話を使った文章はまだありません。"}</p>`;
  return html;
}

export function viewDoc(path, doc) {
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
  const c = noteCompany(path);
  let html = `
    <a class="back" href="#/docs">素材</a>
    ${c ? `<a class="doc-co" href="#/c/${esc(c.slug)}">${avatar(c)}<span class="doc-co-name">${esc(c.name)}</span>${statePill(companyState(c))}<span class="doc-co-go">企業ページ</span></a>` : ""}
    <div class="doc-head"><span class="doc-path">${esc(path)}${doc.offline ? "（端末の控え）" : ""}</span><a class="icon-btn" href="#/doc/${encodeURIComponent(path)}/edit" aria-label="編集">${ICONS.edit}</a></div>
    <div class="doc-layout${toc ? " has-toc" : ""}">
    ${toc}
    <article class="md">`;
  for (const s of sections) {
    const text = s.blocks.filter((b) => b.type === "p" || b.type === "code").map((b) => (b.type === "p" ? plain(b.text) : b.text)).join("\n");
    if (s.head) {
      const title = s.head.text.replace(/（\d+字）$/, "");
      const lv = s.head.level + 1;
      const id = heads.includes(s) ? ` id="h-${heads.indexOf(s)}"` : "";
      // 文字数とコピーは、ESにそのまま使う長さの文章がある見出しと、情報の行があるESの設問に出す
      const isAnswer = s.blocks.some((b) => b.type === "meta") && countChars(text) > 0;
      if (countChars(text) >= MIN_CHARS || isAnswer) {
        html += `<div class="sec-head"${id}><h${lv}>${inline(title, { dir })}</h${lv}>
          <span class="chars">${countChars(text)}字</span>
          <button class="mini" data-copy="${esc(text)}">コピー</button></div>`;
      } else {
        html += `<h${lv}${id}>${inline(title, { dir })}</h${lv}>`;
      }
    }
    html += s.blocks.map((b) => b.html).join("");
  }
  return html + `</article></div>`;
}

export function viewDocEdit(path, doc) {
  return `
    <a class="back" href="#/doc/${encodeURIComponent(path)}">${esc(docName(path))}</a>
    <form id="docedit" data-path="${esc(path)}">
      <div class="doc-head"><span class="doc-path">${esc(path)}</span><span class="chars" id="doc-count"></span></div>
      <textarea name="text" class="doc-text" spellcheck="false">${esc(doc.text)}</textarea>
      <p class="hint">文字を選択すると、選択した部分の文字数（空白・改行を除く）が上に出ます。</p>
      <button class="btn primary wide" type="submit">保存する</button>
    </form>`;
}

export function bindDocCounter() {
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
