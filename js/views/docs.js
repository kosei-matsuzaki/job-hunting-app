// 画面: 素材

import { EXTRA_DOCS } from "../config.js";
import { esc, inline, parseMarkdown, plain } from "../md.js";
import { bySlug } from "../model.js";
import { avatar, ICONS } from "../parts.js";
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

export function viewDocs() {
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
  let html = `
    <a class="back" href="#/docs">素材</a>
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
