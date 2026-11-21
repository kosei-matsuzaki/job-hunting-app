// 画面: 企業一覧

import { CHECK_DAYS, COMPANY_TABS, ENDED, IND_CLASS, INDUSTRIES, SORTS } from "../config.js";
import { daysUntil, fmtDate, remainText, urgency } from "../dates.js";
import { esc } from "../md.js";
import { byWhen, companyStatus, hasLogin, isDropped, isEnded, nextEvent, sinceChecked } from "../model.js";
import { avatar, ICONS, loginButtons, progRow, sortPrograms, stars } from "../parts.js";
import { state, ui } from "../store.js";

export function currentTab() {
  if (COMPANY_TABS.some((t) => t.v === ui.ctab)) return ui.ctab;
  // いちばん志望度の高い、企業があるタブ
  return (COMPANY_TABS.find((t) => t.v !== "dropped" && state.companies.some(t.test)) || { v: "p0" }).v;
}

export const searching = () => !!ui.cq.trim();

export function companyPool() {
  const q = ui.cq.trim().toLowerCase();
  return state.companies.filter(
    (c) =>
      (!ui.industry || c.industry === ui.industry) &&
      (!q || `${c.name} ${c.industry} ${c.programs.map((p) => p.title).join(" ")}`.toLowerCase().includes(q)),
  );
}

// 行の状況のラベル
export const statusTag = (c) => {
  const st = companyStatus(c);
  return `<span class="co-status st-${st.k}">${esc(st.label)}</span>`;
};

// 志望の企業で選考がないとき: いつ確かめたかと「確認した」ボタン
export function checkLine(c) {
  if (companyStatus(c).k !== "check") return "";
  const n = sinceChecked(c);
  const stale = n == null || n >= CHECK_DAYS;
  return `<p class="co-check${stale ? " stale" : ""}"><span>${n == null ? "まだ確認していない" : n === 0 ? "今日確認した" : `${n}日前に確認`}</span>
    <span class="cc-hint">次の募集・早期選考の案内がないか</span><button class="mini" data-checked="${esc(c.slug)}">${ICONS.check}確認した</button></p>`;
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
  // 名前で探しているときは、タブに関係なく全部の企業から出す（ログイン情報を引くため）
  // 締切が近い順（いつもの並び）のときは、同じタブの中を 内定・選考中 → 要確認 → 応募前 → 予定なし → 終了 の順に分ける。
  // 初任給・志望度で並べるときは、その順だけ
  const grouped = !ui.sort || ui.sort === "deadline";
  const items = companyPool().filter((c) => searching() || test(c)).sort((a, b) => (grouped ? companyStatus(a).rank - companyStatus(b).rank : 0) || order(a, b));

  // 企業の下に、選考ルート（本選考・インターン・説明会など）を1行ずつ。
  // 進んでいる企業では、終わったルートはまとめて件数だけ出す
  const row = (c) => {
    const progs = sortPrograms(c);
    const shown = isEnded(c) ? progs : progs.filter((p) => !ENDED.has(p.state));
    const hidden = progs.length - shown.length;
    // どのルートにも属さない予定
    const loose = c.events.filter((e) => !e.program || !c.programs.some((p) => p.id === e.program));
    const nx = nextEvent({ events: loose });
    return `
      <li class="co-item${isDropped(c) ? " is-dropped" : ""}">
        <a class="co-row" href="#/c/${esc(c.slug)}">
          ${avatar(c)}
          <span class="co-body">
            <span class="co-top"><span class="co-name">${esc(c.name)}</span>${stars(c)}${statusTag(c)}</span>
            ${ui.sort === "salary" ? `<span class="co-salary">${c.salary ? `初任給 ¥${Number(c.salary).toLocaleString()}` : "初任給 不明"}</span>` : ""}
          </span>
        </a>
        ${hasLogin(c) ? `<div class="co-login">${loginButtons(c)}</div>` : ""}
        ${shown.length || hidden ? `<ul class="cp-list">${shown.map((p) => `<li>${progRow(c, p)}</li>`).join("")}${hidden ? `<li class="cp-more">ほかに終了 ${hidden}件</li>` : ""}</ul>` : ""}
        ${checkLine(c)}
        ${nx ? `<p class="co-next ${urgency(daysUntil(nx.date))}"><span>${esc(fmtDate(nx.date))}</span>${esc(nx.title)}<em>${esc(remainText(daysUntil(nx.date)))}</em></p>` : ""}
      </li>`;
  };
  const hints = {
    p3: "いちばん行きたい企業。選考がなくなっても、落ちても、ここに残ります。",
    p2: "受けたい企業。",
    p1: "様子を見ている企業。",
    p0: "志望度を決めていない企業。企業ページの★で志望度を付けると、上のタブに移ります。",
    dropped: "行かないと決めた企業。ホームと予定には出ません。企業ページの「見送りをやめる」で元のタブに戻ります。",
  };
  const empty = {
    p3: "第一志望群の企業はまだありません。企業ページの★を3つにすると、ここに出ます。",
    p2: "受けたい企業はまだありません。企業ページの★を2つにすると、ここに出ます。",
    p1: "様子見の企業はまだありません。企業ページの★を1つにすると、ここに出ます。",
    p0: "志望度を決めていない企業はありません。",
    dropped: "見送りにした企業はありません。行かないと決めた企業は、企業ページのいちばん下の「この企業を見送る」で、ここに移せます。",
  };
  if (searching()) return items.length ? `<ul class="co-list">${items.map(row).join("")}</ul>` : `<p class="empty">見つかりません。</p>`;
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
    <div class="ctabs" role="tablist" aria-label="志望度">
      ${COMPANY_TABS.map((t) => `<button role="tab" data-ctab="${t.v}" aria-selected="${!searching() && t.v === tab}">${t.label}<span>${pool.filter(t.test).length}</span></button>`).join("")}
    </div>
    <div class="filter-bar">
      <input id="cq" class="search-box" type="search" placeholder="企業名で探す" title="名前で探すと、タブに関係なく全部の企業から出ます（ログイン情報もここから）" value="${esc(ui.cq)}" enterkeyhint="search">
      <select id="co-sort" aria-label="並び順">${SORTS.map((o) => `<option value="${o.v}"${o.v === ui.sort ? " selected" : ""}>${o.label}</option>`).join("")}</select>
    </div>
    <div class="chips" role="group" aria-label="業界">
      ${["", ...industries].map((i) => `<button data-filter="${esc(i)}" aria-pressed="${ui.industry === i}">${i ? `<i class="ind-dot ${IND_CLASS[i] || "other"}"></i>${esc(i)}<span>${counts[i]}</span>` : "すべての業界"}</button>`).join("")}
    </div>
    </div>
    <div id="co-results">${companyRows()}</div>`;
}
