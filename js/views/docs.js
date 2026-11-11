// 画面: 素材

import { EXTRA_DOCS, IN_SELECTION, STATE_RANK, TOPICS } from "../config.js";
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
  if (base === "README") return "使い方・設問との対応表";
  return base.replace(/^\d+_/, "").replace(/^_/, "");
}

const countChars = (s) => s.replace(/\s/g, "").length;

// 見出しごとの文章。ESにそのまま使える長さの段落を持つ見出しだけ
const MIN_CHARS = 60;
// 「400字版」「1分」のような見出しは、親の見出しと合わせて名前にする
const VERSION = /版$|^\d+(秒|分)$/;
const parsed = new WeakMap();

const topicOf = (head) => TOPICS.find((t) => t.words.some((w) => head.includes(w)))?.key;

function pieces(path, doc) {
  if (parsed.has(doc)) return parsed.get(doc);
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const found = [];
  const trail = [];
  let cur = null;
  for (const b of parseMarkdown(doc.text, { dir })) {
    if (b.type === "h") {
      const text = b.text.replace(/（\d+字）$/, "");
      trail.length = b.level;
      trail[b.level - 1] = text;
      cur = b.level >= 2 ? { path, head: text, trail: trail.slice(1, b.level - 1).filter(Boolean), blocks: [] } : null;
      if (cur) found.push(cur);
    } else if (cur) cur.blocks.push(b);
  }
  const list = found
    .map((x) => {
      const parent = x.trail[x.trail.length - 1];
      const isVersion = parent && VERSION.test(x.head);
      const text = x.blocks.filter((b) => b.type === "p").map((b) => plain(b.text)).join("\n");
      const all = [...x.trail, x.head];
      return {
        path,
        title: isVersion ? `${parent}・${x.head}` : x.head,
        topic: topicOf(isVersion ? parent : x.head),
        text,
        chars: countChars(text),
        html: x.blocks.map((b) => b.html).join(""),
        sent: all.some((t) => /提出済み|提出した/.test(t)),
        old: all.some((t) => t.includes("以前の")),
      };
    })
    .filter((x) => x.chars >= MIN_CHARS);
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

// 1つの設問に集まる文章: profile/ の土台と、各社ノートで振り分けた見出し
function topicPieces(t) {
  const base = t.files.flatMap((p) => (state.docCache.has(p) ? pieces(p, state.docCache.get(p)) : []));
  const notes = notePaths()
    .filter((p) => state.docCache.has(p))
    .flatMap((p) => pieces(p, state.docCache.get(p)).filter((x) => x.topic === t.key));
  return { base, notes };
}

// 土台にある版の字数（50字単位）
const charRuler = (list) =>
  `<span class="ruler" aria-label="土台の字数">${[...new Set(list.map((x) => Math.max(50, Math.round(x.chars / 50) * 50)))]
    .sort((a, b) => b - a)
    .slice(0, 4)
    .map((n) => `<b>${n}</b>`)
    .join("")}</span>`;

// 【要記入】の見出しの下にある箇条書きの数（まだ埋まっていない事実）
function blanks(text) {
  let on = false;
  let n = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) on = line.includes("要記入");
    // 埋めた項目は打ち消し線（~~）で残しているので数えない
    else if (on && /^\s*([-*]|\d+\.) (?!~~)/.test(line)) n++;
  }
  return n;
}

export function viewDocs() {
  let html = `<header class="page-head"><h1 class="page-title">素材</h1><p class="page-sub">設問の種類ごとに、土台の文章と各社で書いた文章をまとめています。</p></header>`;
  if (!state.docs) return html + `<p class="hint">読み込み中…</p>`;

  html += `<h2 class="sec">設問から探す</h2><ul class="topics">${TOPICS.map((t) => {
    const { base, notes } = topicPieces(t);
    const cos = new Set(notes.map((x) => x.path)).size;
    const count = base.length || !state.docsLoading ? `土台 <b>${base.length}</b>${cos ? `<span>各社 <b>${cos}</b></span>` : ""}` : "読み込み中…";
    return `<li><a class="topic" href="#/docs/${t.key}">
      <span class="topic-name">${esc(t.name)}</span>
      <span class="topic-ask">${esc(t.ask)}</span>
      <span class="topic-foot"><span class="topic-n">${count}</span>${base.length ? charRuler(base) : ""}</span>
    </a></li>`;
  }).join("")}</ul>`;

  // 企業ごと: 選考が進んでいる企業から。応募予定・選考中でノートがない企業には作るボタン
  const notes = notePaths()
    .map((path) => ({ path, c: noteCompany(path), doc: state.docCache.get(path) }))
    .sort((a, b) => coRank(a.path) - coRank(b.path) || docName(a.path).localeCompare(docName(b.path), "ja"));
  html += `<h2 class="sec">企業ごとのノート<span class="count">${notes.length}</span></h2><ul class="notes">${notes
    .map(({ path, c, doc }) => {
      const list = doc ? pieces(path, doc) : [];
      const sent = list.filter((x) => x.sent).length;
      const ev = c && nextEvent(c);
      return `<li><a class="note-row" href="${docLink(path)}">
        ${c ? avatar(c) : '<span class="doc-icon" aria-hidden="true"></span>'}
        <span class="note-main"><span class="note-name">${esc(docName(path))}</span>
          <span class="note-meta">${c ? statePill(companyState(c)) : ""}${doc ? `<span>文章 <b>${list.length}</b></span>` : ""}${sent ? `<span class="sent">提出 ${sent}</span>` : ""}</span></span>
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

  // 土台と準備: 設問に振り分けていない profile/ のファイルと、そのほか
  // 設問の主なファイルは索引から開けるので除く（基本情報のように参照で使うものは残す）
  const used = new Set(TOPICS.map((t) => t.files[0]));
  const profile = (state.docs.find((g) => g.dir === "profile")?.paths || []).filter((p) => !used.has(p));
  html += `<h2 class="sec">土台と準備</h2><ul class="doc-list">${[...profile, ...EXTRA_DOCS.map((d) => d.path)]
    .map((p) => {
      const doc = state.docCache.get(p);
      const n = doc ? blanks(doc.text) : 0;
      return `<li><a href="${docLink(p)}"><span class="doc-icon" aria-hidden="true"></span><span class="doc-name">${esc(docName(p))}</span>${n ? `<span class="blank-n" title="【要記入】の項目">要記入 <b>${n}</b></span>` : ""}</a></li>`;
    })
    .join("")}</ul>`;
  return html;
}

// withSource: 企業ノートなら企業名、土台ならファイル名（土台が1ファイルだけなら出さない）
function pieceItem(x, withSource) {
  const c = noteCompany(x.path);
  const src = c ? `${avatar(c, "sm")}<a href="${docLink(x.path)}">${esc(c.name)}</a>` : withSource ? `<a href="${docLink(x.path)}">${esc(docName(x.path))}</a>` : "";
  const preview = x.text.replace(/\s+/g, " ").slice(0, 80);
  return `<li class="piece${x.old ? " old" : ""}">
    <div class="piece-top"><span class="piece-src">${src}${x.sent ? '<span class="sent">提出</span>' : ""}${x.old ? '<span class="tag">以前の版</span>' : ""}</span>
      <span class="chars">${x.chars}字</span><button class="mini" data-copy="${esc(x.text)}">コピー</button></div>
    <details><summary><b class="piece-title">${esc(x.title)}</b><span class="piece-pre">${esc(preview)}</span></summary><div class="md">${x.html}</div></details>
  </li>`;
}

export function viewTopic(key) {
  const t = TOPICS.find((x) => x.key === key);
  if (!t) return `<a class="back" href="#/docs">素材</a><p class="error">見つかりません。</p>`;
  const { base, notes } = topicPieces(t);
  // 各社の文章は、提出したもの → 選考が進んでいる企業の順。以前の版は後ろ
  const rank = (x) => (x.sent ? 0 : 200) + (x.old ? 100 : 0) + coRank(x.path);
  notes.sort((a, b) => rank(a) - rank(b));
  const empty = `<li class="hint">${state.docsLoading ? "読み込み中…" : "まだありません"}</li>`;
  return `<a class="back" href="#/docs">素材</a>
    <header class="page-head"><h1 class="page-title">${esc(t.name)}</h1><p class="page-sub">${esc(t.ask)}</p></header>
    <nav class="topic-tabs" aria-label="設問の種類">${TOPICS.map((x) => `<a href="#/docs/${x.key}"${x.key === key ? ' aria-current="page"' : ""}>${esc(x.name)}</a>`).join("")}</nav>
    <div class="topic-cols">
      <section><h2 class="sec">土台の文章<span class="count">${base.length}</span></h2>
        <p class="sec-hint hint">字数が近い版を選び、会社に合わせて直す。${t.files.map((p) => `<a href="${docLink(p)}">${esc(docName(p))}</a>`).join("・")}</p>
        <ul class="pieces">${base.map((x) => pieceItem(x, t.files.length > 1)).join("") || empty}</ul></section>
      <section><h2 class="sec">各社で書いた文章<span class="count">${notes.length}</span></h2>
        <p class="sec-hint hint">出したものは面接で聞かれるので見返しておく。</p>
        <ul class="pieces">${notes.map((x) => pieceItem(x, true)).join("") || empty}</ul></section>
    </div>`;
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
    const paras = s.blocks.filter((b) => b.type === "p");
    if (s.head) {
      const title = s.head.text.replace(/（\d+字）$/, "");
      const lv = s.head.level + 1;
      const id = heads.includes(s) ? ` id="h-${heads.indexOf(s)}"` : "";
      const text = paras.map((p) => plain(p.text)).join("\n");
      // 文字数とコピーは、ESにそのまま使う長さの文章がある見出しだけに出す
      if (countChars(text) >= MIN_CHARS) {
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
