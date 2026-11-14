// 画面: 素材

import { EPISODES_PATH, EXTRA_DOCS, STATE_RANK, TOPICS } from "../config.js";
import { fmtDate, isoToday } from "../dates.js";
import { countChars, finalFile, finalPath, finalPaths, finals, isFinal, parseFinal } from "../finals.js";
import { esc, inline, parseMarkdown, plain, renderMarkdown } from "../md.js";
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
  if (isFinal(path)) return `確定版・${base}`;
  return base.replace(/^\d+_/, "").replace(/^_/, "");
}

// ESの文章のかけら
// - profile/回答 などの土台: 見出しごと。ESにそのまま使える長さ（MIN_CHARS 以上）の段落を持つものだけ
// - notes/: 「## ES」の下の「### 設問」ごと。直下の情報の行（種類・字数・状態・ルート・話）を読む
// 情報の行は上の見出しから受け継ぐ（「## A. 課題解決型」の「話: E1」は下の「### 400字版」にも効く）
const MIN_CHARS = 60;
// 「400字版」「1分」のような見出しは、親の見出しと合わせて名前にする
const VERSION = /版$|^\d+(秒|分)$/;
const parsed = new WeakMap();

const pieceState = (s = "") => (s.startsWith("提出") ? "sent" : s.startsWith("確定") ? "final" : s.includes("以前") ? "old" : "draft");
const STATE_MARK = { sent: '<span class="sent">提出</span>', final: '<span class="sent">確定</span>', old: '<span class="tag">以前の版</span>', draft: '<span class="tag draft">下書き</span>', base: "" };

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
const finalLink = (file, q = "") => `#/docs/final/${encodeURIComponent(file)}${q ? `?${q}` : ""}`;
const coRank = (path) => {
  const c = noteCompany(path);
  return c ? STATE_RANK[companyState(c)] : 99;
};
const loaded = (p) => (state.docCache.has(p) ? pieces(p, state.docCache.get(p)) : []);

// すべての文章（以前の下書き＋各社のES）
function allPieces() {
  return [...new Set(TOPICS.flatMap((t) => t.files))].flatMap(loaded).concat(notePaths().flatMap(loaded));
}

// 企業ページ用: その企業のノートのESの文章。ノートを読み込んでいなければ null
export function companyPieces(slug) {
  const path = `notes/${slug}.md`;
  return state.docCache.has(path) ? pieces(path, state.docCache.get(path)) : null;
}

// エピソード集の「## E1. 長期インターン」と、その中身・【要記入】の数
function episodes() {
  const doc = state.docCache.get(EPISODES_PATH);
  if (!doc) return [];
  const list = [];
  let on = false;
  for (const line of doc.text.split("\n")) {
    const m = line.match(/^## (E\d+)\.\s*(.*)$/);
    if (m) list.push({ id: m[1], title: m[2], blanks: 0, lines: [] });
    else if (/^## /.test(line)) list.push({ id: null, lines: [] });
    else if (list.length) {
      list[list.length - 1].lines.push(line);
      if (line.startsWith("#")) on = line.includes("要記入");
      // 埋めた項目は打ち消し線（~~）で残しているので数えない
      else if (on && /^\s*([-*]|\d+\.) (?!~~)/.test(line)) list[list.length - 1].blanks++;
    }
  }
  return list.filter((e) => e.id);
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

const loadingNote = () => (state.docsLoading ? "読み込み中…" : "");

// 確定版のテーマの札。版ごとの字数を並べる。まだ版がなければ「これから書く」
function themeCard(t) {
  return `<li><a class="theme${t.versions.length ? "" : " is-empty"}" href="${finalLink(t.file)}">
    <span class="theme-name">${esc(t.name)}</span>
    <span class="theme-kinds">${esc(t.kinds.join("・"))}</span>
    <span class="theme-vers">${t.versions.length ? t.versions.map((v) => `<b>${v.chars}<small>字</small></b>`).join("") : '<span class="theme-none">これから書く</span>'}</span>
  </a></li>`;
}

export function viewDocs() {
  let html = `<header class="page-head"><h1 class="page-title">素材</h1><p class="page-sub">ESに使う自分の文章。テーマごとに自分で書いた<b>確定版</b>を持ち、各社のESはそこから字数を合わせて作る。</p></header>`;
  if (!state.docs) return html + `<p class="hint">読み込み中…</p>`;
  const themes = finals();
  const done = themes.filter((t) => t.versions.length).length;

  html += `<h2 class="sec">確定版<span class="count">${done}/${themes.length}</span><button class="sec-link mini" data-newtheme>テーマを足す</button></h2>
    <p class="sec-hint hint">テーマを開くと、確定版がいちばん上に、書くときの参考（エピソードの事実・過去のES）がその下に出ます。</p>
    <ul class="themes">${themes.map(themeCard).join("") || `<li class="hint">${loadingNote() || "まだありません。"}</li>`}</ul>`;

  // 設問の種類から: 確定版と、過去のES・下書き
  const all = allPieces();
  html += `<h2 class="sec">設問の種類から探す</h2><ul class="topics">${TOPICS.map((t) => {
    const fin = themes.filter((x) => x.topics.includes(t.key) && x.versions.length).length;
    const ref = all.filter((x) => x.topic === t.key).length;
    return `<li><a class="topic" href="#/docs/${t.key}">
      <span class="topic-name">${esc(t.name)}</span>
      <span class="topic-ask">${esc(t.ask)}</span>
      <span class="topic-foot"><span class="topic-n">${fin ? `確定版 <b>${fin}</b>` : '<span class="faint">確定版なし</span>'}${ref ? `<span>参考 <b>${ref}</b></span>` : ""}</span></span>
    </a></li>`;
  }).join("")}</ul>`;

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
    .filter((c) => companyState(c) === "todo" && !notePaths().includes(`notes/${c.slug}.md`))
    .sort((a, b) => STATE_RANK[companyState(a)] - STATE_RANK[companyState(b)]);
  if (missing.length) {
    html += `<details class="note-missing"><summary>ノートがない応募予定・選考中の企業<span class="count">${missing.length}</span></summary><ul>${missing
      .map((c) => `<li>${avatar(c, "sm")}<span>${esc(c.name)}</span>${statePill(companyState(c))}<button class="mini" data-newnote="${esc(c.slug)}">ノートを作る</button></li>`)
      .join("")}</ul></details>`;
  }

  // そのほか: 事実の元帳・面接・ルール、以前の下書き（AI）
  const profile = (state.docs.find((g) => g.dir === "profile")?.paths || []).filter((p) => !isFinal(p));
  const drafts = profile.filter((p) => p.includes("/回答/"));
  const rest = profile.filter((p) => !drafts.includes(p)).sort((a, b) => (a === EPISODES_PATH ? -1 : b === EPISODES_PATH ? 1 : a.split("/").length - b.split("/").length));
  const row = (p) => {
    const doc = state.docCache.get(p);
    const n = doc ? blanks(doc.text) : 0;
    return `<li><a href="${docLink(p)}"><span class="doc-icon" aria-hidden="true"></span><span class="doc-name">${esc(p === EPISODES_PATH ? "エピソード集（事実の元帳）" : docName(p))}${p.includes("/保管/") ? '<small class="faint">（保管）</small>' : ""}</span>${n ? `<span class="blank-n" title="【要記入】の項目">要記入 <b>${n}</b></span>` : ""}</a></li>`;
  };
  html += `<h2 class="sec">事実と準備</h2><ul class="doc-list">${[...rest, ...EXTRA_DOCS.map((d) => d.path)].map(row).join("")}</ul>
    <details class="note-missing"><summary>以前の下書き（AIが書いた文）<span class="count">${drafts.length}</span></summary><ul class="doc-list">${drafts.map(row).join("")}</ul></details>`;
  return html;
}

function pieceItem(x) {
  const c = noteCompany(x.path);
  const src = c ? `${avatar(c, "sm")}<a href="${docLink(x.path)}">${esc(c.name)}</a>` : `<a class="base-src" href="${docLink(x.path)}">以前の下書き・${esc(docName(x.path))}</a>`;
  const preview = x.text.replace(/\s+/g, " ").slice(0, 80);
  const sub = [x.route && esc(x.route), x.date && esc(fmtDate(x.date))].filter(Boolean).join(" ");
  return `<li class="piece is-${x.state}${x.mine ? " is-mine" : ""}">
    <div class="piece-top"><span class="piece-src">${src}${x.mine ? '<span class="mine">本人</span>' : '<span class="tag ai" title="AIが書いた文。内容（事実）の確認に使う">AI</span>'}${STATE_MARK[x.state]}${sub ? `<small>${sub}</small>` : ""}</span>
      <span class="chars">${x.chars}字${x.limit ? `<small>／${esc(x.limit)}</small>` : ""}</span><button class="mini" data-copy="${esc(x.text)}">コピー</button></div>
    <details><summary><b class="piece-title">${esc(x.title)}</b><span class="piece-pre">${esc(preview)}</span></summary><div class="md">${x.html}</div></details>
    ${x.eps.length ? `<p class="piece-eps">${x.eps.map((e) => `<span>${esc(e)}</span>`).join("")}</p>` : ""}
  </li>`;
}

// 並び: 本人が書いたもの → 提出したもの → 以前の下書き → 下書き → 以前の版。同じなら選考が進んでいる企業から
const ORDER = { sent: 0, final: 0, base: 1, draft: 2, old: 3 };
const byUse = (a, b) => b.mine - a.mine || ORDER[a.state] - ORDER[b.state] || coRank(a.path) - coRank(b.path);

// 確定版の1つの版。本文はたたまずに出す
function versionItem(t, v, { edit = true } = {}) {
  return `<article class="version">
    <div class="version-top"><h3>${esc(v.head)}</h3><span class="chars">${v.chars}字</span>
      <button class="mini primary" data-copy="${esc(v.text)}">コピー</button>${edit ? `<a class="mini" href="${finalLink(t.file, `edit=${encodeURIComponent(v.head)}`)}">直す</a>` : ""}</div>
    <div class="version-body">${renderMarkdown(v.body)}</div>
    ${v.memo ? `<p class="version-memo">${esc(v.memo)}</p>` : ""}
  </article>`;
}

const LENGTHS = [100, 200, 300, 400, 500];

export function viewTopic(key, query) {
  const t = TOPICS.find((x) => x.key === key);
  if (!t) return `<a class="back" href="#/docs">素材</a><p class="error">見つかりません。</p>`;
  const len = Number(query.get("len")) || 0;
  const mine = query.get("by") === "me";
  const themes = finals().filter((x) => x.topics.includes(key));
  const pool = allPieces().filter((x) => x.topic === key);
  let list = pool.filter((x) => !mine || x.mine);
  // 字数を選ぶと、近い順に1列で並べる（多少長さが違っても、近いものから直して使う）
  list = len ? list.sort((a, b) => Math.abs(a.chars - len) - Math.abs(b.chars - len)) : list.sort(byUse);
  const link = (l, m = mine) => {
    const q = new URLSearchParams();
    if (l) q.set("len", l);
    if (m) q.set("by", "me");
    return `#/docs/${key}${q.toString() ? `?${q}` : ""}`;
  };
  const chip = (href, on, label) => `<a class="chip" href="${href}"${on ? ' aria-current="true"' : ""}>${label}</a>`;
  return `<a class="back" href="#/docs">素材</a>
    <header class="page-head"><h1 class="page-title">${esc(t.name)}</h1><p class="page-sub">${esc(t.ask)}</p></header>
    <nav class="topic-tabs" aria-label="設問の種類">${TOPICS.map((x) => `<a href="#/docs/${x.key}"${x.key === key ? ' aria-current="page"' : ""}>${esc(x.name)}</a>`).join("")}</nav>
    <h2 class="sec">確定版</h2>
    ${themes.length
      ? themes.map((th) => `<section class="theme-block"><h3 class="theme-block-head"><a href="${finalLink(th.file)}">${esc(th.name)}</a></h3>${th.versions.length ? th.versions.map((v) => versionItem(th, v, { edit: false })).join("") : `<p class="hint">まだ書いていません。<a href="${finalLink(th.file, "new=1")}">書く</a></p>`}</section>`).join("")
      : `<p class="hint">${loadingNote() || "この種類のテーマはまだありません。"}</p>`}
    <h2 class="sec">参考: 過去のESと下書き<span class="count">${pool.length}</span></h2>
    <p class="sec-hint hint">「本人」の印がないものは AI が書いた文。内容（事実）の確認に使い、文章は確定版に書く。</p>
    <div class="filters">
      <div class="chips" aria-label="字数"><span class="chips-label">字数</span>${chip(link(0), !len, "すべて")}${LENGTHS.map((n) => chip(link(n), len === n, `${n}字`)).join("")}</div>
      <div class="chips" aria-label="書いた人"><span class="chips-label">書き手</span>${chip(link(len, false), !mine, "すべて")}${chip(link(len, true), mine, "本人")}</div>
    </div>
    ${len ? `<p class="sec-hint hint">${len}字に近い順。</p>` : ""}
    <ul class="pieces">${list.map(pieceItem).join("") || `<li class="hint">${loadingNote() || "まだありません。"}</li>`}</ul>`;
}

// テーマの参考にする文章: 種類が合っていて、テーマに話があるなら同じ話を使ったもの
// （E1 を使っていても志望動機のESはインターンのテーマには出さない）
function themeRefs(t) {
  return allPieces()
    .filter((x) => t.topics.includes(x.topic) && (!t.eps.length || x.eps.some((e) => t.eps.includes(e))))
    .sort(byUse);
}

function finalForm(t, v, isNew) {
  const head = v?.head || "";
  return `<form id="finalform" class="final-form" data-path="${esc(t.path)}" data-file="${esc(t.file)}" data-old="${esc(head)}">
    <h3>${isNew ? "新しい版を書く" : `${esc(head)} を直す`}</h3>
    <label>見出し（字数が分かる名前に）<input name="head" value="${esc(head)}" placeholder="400字版" required></label>
    <label>本文<textarea name="body" class="final-text" rows="12" required>${esc(v?.body || "")}</textarea></label>
    <p class="final-count" id="final-count" aria-live="polite"></p>
    <label>メモ（いつ・どのESで確定したか など）<input name="memo" value="${esc(v ? v.memo : `${isoToday()} 確定`)}"></label>
    <div class="final-actions"><button class="btn primary" type="submit">保存する</button><a class="btn" href="${finalLink(t.file)}">やめる</a>
      ${isNew ? "" : '<button class="btn danger" type="button" data-delversion>この版を消す</button>'}</div>
  </form>`;
}

export function viewFinal(file, query) {
  const path = finalPath(file);
  const doc = state.docCache.get(path);
  if (!doc) return `<a class="back" href="#/docs">素材</a><p class="hint">${state.docs && !finalPaths().includes(path) ? "見つかりません。" : "読み込み中…"}</p>`;
  const t = parseFinal(path, doc);
  const editing = query.get("edit");
  const isNew = query.has("new");
  const target = editing && t.versions.find((v) => v.head === editing);
  const eps = episodes();
  const refs = themeRefs(t);
  const sent = refs.filter((x) => !x.path.startsWith("profile/"));
  const drafts = refs.filter((x) => x.path.startsWith("profile/"));
  let html = `<a class="back" href="#/docs">素材</a>
    <header class="page-head"><h1 class="page-title">${esc(t.name)}</h1>${t.desc ? `<p class="page-sub">${inline(t.desc)}</p>` : ""}
      <p class="theme-meta">${t.kinds.map((k) => {
        const tp = TOPICS.find((x) => x.name === k);
        return tp ? `<a class="chip" href="#/docs/${tp.key}">${esc(k)}</a>` : "";
      }).join("")}${t.eps.map((e) => `<span class="ep-id" title="${esc(eps.find((x) => x.id === e)?.title || "")}">${esc(e)}</span>`).join("")}
      <a class="theme-file" href="${docLink(path)}/edit">話・種類・説明を直す</a></p></header>
    <div class="theme-layout"><div class="theme-main"><h2 class="sec">確定版<span class="count">${t.versions.length}</span>${isNew || target ? "" : `<a class="sec-link" href="${finalLink(t.file, "new=1")}">新しい版を書く</a>`}</h2>`;
  if (isNew) html += finalForm(t, null, true);
  html += t.versions.map((v) => (v === target ? finalForm(t, v, false) : versionItem(t, v))).join("");
  if (!t.versions.length && !isNew) {
    html += `<div class="final-empty"><p><b>まだ確定版がありません。</b></p><p class="hint">参考でエピソードの事実と過去の文章を確かめてから、自分の言葉で書いてください。</p><a class="btn primary" href="${finalLink(t.file, "new=1")}">書く</a></div>`;
  }

  html += `</div><aside class="theme-refs"><h2 class="sec">書くときの参考</h2><p class="sec-hint hint">事実はエピソード集が正。「本人」の印がない文章は AI が書いたもの（言葉は借りず、事実の確認に使う）。</p>`;
  for (const id of t.eps) {
    const e = eps.find((x) => x.id === id);
    if (e) html += `<details class="ref"><summary><span class="ep-id">${esc(id)}</span>${esc(e.title)} の事実${e.blanks ? `<small>要記入 ${e.blanks}</small>` : ""}</summary><div class="md">${renderMarkdown(e.lines.join("\n"), { dir: "profile" })}</div></details>`;
  }
  html += `<details class="ref"${t.versions.length ? "" : " open"}><summary>各社に出したES<span class="count">${sent.length}</span></summary><ul class="pieces">${sent.map(pieceItem).join("") || `<li class="hint">${loadingNote() || "ありません。"}</li>`}</ul></details>
    <details class="ref"><summary>以前の下書き（AI）<span class="count">${drafts.length}</span></summary><ul class="pieces">${drafts.map(pieceItem).join("") || `<li class="hint">${loadingNote() || "ありません。"}</li>`}</ul></details></aside></div>`;
  return html;
}

// 版の本文の字数。見出しに「400字」とあれば、それと比べる
export function bindFinalCounter() {
  const form = document.getElementById("finalform");
  if (!form) return;
  const out = document.getElementById("final-count");
  const update = () => {
    const n = countChars(form.body.value);
    const limit = Number(form.head.value.match(/(\d+)字/)?.[1]) || 0;
    out.innerHTML = `<b>${n}</b>字${limit ? `<span>／${limit}字${n > limit ? `<em>（${n - limit}字オーバー）</em>` : `（あと${limit - n}字）`}</span>` : ""}`;
  };
  form.addEventListener("input", update);
  update();
  requestAnimationFrame(() => {
    form.scrollIntoView({ block: "start" });
    form.body.focus({ preventScroll: true });
  });
}

// 素材の見出しごとの区切り（行の範囲）。コードの中の # は見出しにしない
export function rawSections(text) {
  const lines = text.split("\n");
  const starts = [];
  let code = false;
  lines.forEach((l, i) => {
    if (l.trim().startsWith("```")) code = !code;
    else if (!code && /^#{2,6}\s/.test(l)) starts.push(i);
  });
  return starts.map((s, k) => ({ head: lines[s], from: s, to: k + 1 < starts.length ? starts[k + 1] : lines.length }));
}

// k 番目の見出しの節を差し替える。見出しの文が変わっていたら同じ見出しを探す
export function replaceSection(text, k, head, body) {
  const secs = rawSections(text);
  const s = secs[k]?.head === head ? secs[k] : secs.find((x) => x.head === head);
  if (!s) throw new Error("直している見出しが見つかりません（別の端末で変わったかもしれません）");
  const lines = text.split("\n");
  lines.splice(s.from, s.to - s.from, ...body.replace(/\s+$/, "").split("\n"), "");
  return lines.join("\n");
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
    ${isFinal(path) ? `<a class="back" href="#/docs/final/${encodeURIComponent(finalFile(path))}">${esc(parseFinal(path, doc).name)}</a>` : '<a class="back" href="#/docs">素材</a>'}
    ${c ? `<a class="doc-co" href="#/c/${esc(c.slug)}">${avatar(c)}<span class="doc-co-name">${esc(c.name)}</span>${statePill(companyState(c))}<span class="doc-co-go">企業ページ</span></a>` : ""}
    <div class="doc-head"><span class="doc-path">${esc(path)}${doc.offline ? "（端末の控え）" : ""}</span><a class="icon-btn" href="#/doc/${encodeURIComponent(path)}/edit" aria-label="編集">${ICONS.edit}</a></div>
    <div class="doc-layout${toc ? " has-toc" : ""}">
    ${toc}
    <article class="md">`;
  sections.forEach((s, i) => {
    const text = s.blocks.filter((b) => b.type === "p" || b.type === "code").map((b) => (b.type === "p" ? plain(b.text) : b.text)).join("\n");
    if (s.head) {
      const title = s.head.text.replace(/（\d+字）$/, "");
      const lv = s.head.level + 1;
      const id = ` id="${heads.includes(s) ? `h-${heads.indexOf(s)}` : `s-${i - 1}`}" data-sec="${i - 1}"`;
      // 見出しごとに、その節だけを直せる
      const fix = `<a class="mini sec-fix" href="#/doc/${encodeURIComponent(path)}/edit?sec=${i - 1}">直す</a>`;
      // 文字数とコピーは、ESにそのまま使う長さの文章がある見出しと、情報の行があるESの設問に出す
      const isAnswer = s.blocks.some((b) => b.type === "meta") && countChars(text) > 0;
      if (countChars(text) >= MIN_CHARS || isAnswer) {
        html += `<div class="sec-head"${id}><h${lv}>${inline(title, { dir })}</h${lv}>
          <span class="chars">${countChars(text)}字</span>
          <button class="mini" data-copy="${esc(text)}">コピー</button>${fix}</div>`;
      } else {
        html += `<div class="sec-head plain"${id}><h${lv}>${inline(title, { dir })}</h${lv}>${fix}</div>`;
      }
    }
    html += s.blocks.map((b) => b.html).join("");
  });
  return html + `</article></div>`;
}

export function viewDocEdit(path, doc, query) {
  // ?sec=k なら、k 番目の見出しの節だけを直す
  const k = query?.has("sec") ? Number(query.get("sec")) : -1;
  const sec = k >= 0 ? rawSections(doc.text)[k] : null;
  const back = isFinal(path) && !sec ? `#/docs/final/${encodeURIComponent(finalFile(path))}` : `#/doc/${encodeURIComponent(path)}`;
  const text = sec ? doc.text.split("\n").slice(sec.from, sec.to).join("\n").replace(/\s+$/, "") : doc.text;
  return `
    <a class="back" href="${back}">${esc(docName(path))}</a>
    <form id="docedit" data-path="${esc(path)}"${sec ? ` data-sec="${k}" data-head="${esc(sec.head)}"` : ""}>
      <div class="doc-head"><span class="doc-path">${sec ? `<b>${esc(sec.head.replace(/^#+\s*/, ""))}</b> だけを直す・<a href="#/doc/${encodeURIComponent(path)}/edit">ファイル全体を直す</a>` : esc(path)}</span><span class="chars" id="doc-count"></span></div>
      <textarea name="text" class="doc-text${sec ? " is-section" : ""}" spellcheck="false">${esc(text)}</textarea>
      <p class="hint">文字を選択すると、選択した部分の文字数（空白・改行を除く）が上に出ます。</p>
      <div class="final-actions"><button class="btn primary" type="submit">保存する</button><a class="btn" href="${back}">やめる</a></div>
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
