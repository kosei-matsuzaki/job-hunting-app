// 画面: 企業一覧

import { COMPANY_TABS, IN_SELECTION, IND_CLASS, INDUSTRIES, SORTS } from "../config.js";
import { daysUntil, fmtDate, remainText, urgency } from "../dates.js";
import { esc } from "../md.js";
import { byWhen, companyState, nextEvent } from "../model.js";
import { avatar, companyStatusLine, ICONS, stars } from "../parts.js";
import { state, ui } from "../store.js";

function currentTab() {
  if (COMPANY_TABS.some((t) => t.v === ui.ctab)) return ui.ctab;
  return state.companies.some((c) => IN_SELECTION.has(companyState(c)) || companyState(c) === "offer") ? "active" : "plan";
}

export function companyPool() {
  const q = ui.cq.trim().toLowerCase();
  return state.companies.filter(
    (c) =>
      (!ui.industry || c.industry === ui.industry) &&
      (!q || `${c.name} ${c.industry} ${c.programs.map((p) => p.title).join(" ")}`.toLowerCase().includes(q)),
  );
}

export function companyRows() {
  const byName = (a, b) => a.name.localeCompare(b.name, "ja");
  const byDeadline = (a, b) => {
    const na = nextEvent(a);
    const nb = nextEvent(b);
    if (na && nb) return byWhen(na, nb);
    if (na || nb) return na ? -1 : 1;
    return (b.priority || 0) - (a.priority || 0) || byName(a, b);
  };
  const order = {
    deadline: byDeadline,
    // 初任給が分からない企業は後ろに
    salary: (a, b) => (b.salary || 0) - (a.salary || 0) || byDeadline(a, b),
    priority: (a, b) => (b.priority || 0) - (a.priority || 0) || byDeadline(a, b),
  }[ui.sort] || byDeadline;
  const tab = currentTab();
  const test = COMPANY_TABS.find((t) => t.v === tab).test;
  const items = companyPool().filter((c) => test(companyState(c))).sort(order);

  const row = (c) => {
    const nx = nextEvent(c);
    return `
      <li class="co-item">
        <a class="co-row" href="#/c/${esc(c.slug)}">
          ${avatar(c)}
          <span class="co-body">
            <span class="co-top"><span class="co-name">${esc(c.name)}</span>${stars(c)}</span>
            <span class="co-status">${companyStatusLine(c)}</span>
            ${nx ? `<span class="co-next ${urgency(daysUntil(nx.date))}"><span>${esc(fmtDate(nx.date))}</span>${esc(nx.title)}<em>${esc(remainText(daysUntil(nx.date)))}</em></span>` : ""}
            ${ui.sort === "salary" ? `<span class="co-salary">${c.salary ? `初任給 ¥${Number(c.salary).toLocaleString()}` : "初任給 不明"}</span>` : ""}
          </span>
          <span class="co-ind"><i class="ind-dot ${IND_CLASS[c.industry] || "other"}"></i>${esc(c.industry || "")}</span>
        </a>
        ${tab === "watch" ? `<div class="triage">
          <button class="mini primary" data-triage="${esc(c.slug)}:plan">応募予定にする</button>
          <button class="mini" data-triage="${esc(c.slug)}:skip">見送る</button>
        </div>` : ""}
      </li>`;
  };
  const hints = {
    active: "選考が進んでいる企業と内定。",
    plan: "応募すると決めた企業。締切がホームに出ます。",
    watch: "候補の企業。応募するなら「応募予定にする」、しないなら「見送る」。",
    closed: "見送り・辞退・不合格の企業。",
  };
  const empty = {
    active: "選考中の企業はまだありません。応募したら、企業ページの状況を「対応中」にしてください。",
    plan: "応募予定の企業はまだありません。「気になる」タブから選べます。",
    watch: "「気になる」企業はありません。",
    closed: "終了した企業はありません。",
  };
  return `<p class="hint tab-hint">${hints[tab]}</p>` + (items.length ? `<ul class="co-list">${items.map(row).join("")}</ul>` : `<p class="empty">${empty[tab]}</p>`);
}

export function viewCompanies() {
  const counts = {};
  for (const c of state.companies) if (c.industry) counts[c.industry] = (counts[c.industry] || 0) + 1;
  const industries = [...INDUSTRIES.filter((i) => counts[i]), ...Object.keys(counts).filter((i) => !INDUSTRIES.includes(i))];
  const tab = currentTab();
  const pool = companyPool();
  return `
    <header class="page-head row">
      <h1 class="page-title">企業<span class="count">${state.companies.length}社</span></h1>
      <a class="btn" href="#/new">${ICONS.plus}追加</a>
    </header>
    <div class="co-controls">
    <div class="ctabs" role="tablist" aria-label="状況">
      ${COMPANY_TABS.map((t) => `<button role="tab" data-ctab="${t.v}" aria-selected="${t.v === tab}">${t.label}<span>${pool.filter((c) => t.test(companyState(c))).length}</span></button>`).join("")}
    </div>
    <div class="filter-bar">
      <input id="cq" class="search-box" type="search" placeholder="企業名で探す" value="${esc(ui.cq)}" enterkeyhint="search">
      <select id="co-sort" aria-label="並び順">${SORTS.map((o) => `<option value="${o.v}"${o.v === ui.sort ? " selected" : ""}>${o.label}</option>`).join("")}</select>
    </div>
    <div class="chips" role="group" aria-label="業界">
      ${["", ...industries].map((i) => `<button data-filter="${esc(i)}" aria-pressed="${ui.industry === i}">${i ? `<i class="ind-dot ${IND_CLASS[i] || "other"}"></i>${esc(i)}<span>${counts[i]}</span>` : "すべての業界"}</button>`).join("")}
    </div>
    </div>
    <div id="co-results">${companyRows()}</div>`;
}
