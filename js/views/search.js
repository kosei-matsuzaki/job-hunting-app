// 画面: 検索

import { EXTRA_DOCS, STATES } from "../config.js";
import { getDoc } from "../data.js";
import { fmtDate } from "../dates.js";
import { esc } from "../md.js";
import { allEvents, byWhen } from "../model.js";
import { state, ui } from "../store.js";
import { docName } from "./docs.js";

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

export function searchResults(q) {
  const terms = q.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return `<p class="hint">企業名・選考ルート・メモ・予定・ESの文章をまとめて探せます。スペースで区切ると、すべてを含むものに絞ります。</p>`;
  const hit = (text) => terms.every((t) => text.toLowerCase().includes(t.toLowerCase()));
  const companies = state.companies.filter((c) =>
    hit([c.name, c.industry, c.memo, c.avgSalary || "", ...c.todo, ...c.programs.flatMap((p) => [p.kind, p.title, p.process, p.step, STATES[p.state].label, ...p.flow])].join("\n")),
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

export function viewSearch() {
  return `
    <header class="page-head"><h1 class="page-title">検索</h1></header>
    <input id="q" class="search-box" type="search" enterkeyhint="search" placeholder="例: 面接　/　Go　/　締切" value="${esc(ui.q)}">
    <div id="results">${searchResults(ui.q)}</div>`;
}

export async function loadAllDocs() {
  if (state.docsLoading || !state.docs) return;
  const paths = [...state.docs.flatMap((g) => g.paths), ...EXTRA_DOCS.map((d) => d.path)].filter((p) => !state.docCache.has(p));
  if (!paths.length) return;
  state.docsLoading = true;
  await Promise.all(paths.map((p) => getDoc(p).catch(() => null)));
  state.docsLoading = false;
  const box = document.getElementById("results");
  if (box) box.innerHTML = searchResults(ui.q);
}
