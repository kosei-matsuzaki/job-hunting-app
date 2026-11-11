// 画面: ホーム

import { COMPANY_TABS, IN_SELECTION, PAST_DAYS, STATE_RANK, WD } from "../config.js";
import { addDays, dayLabel, daysUntil, fmtDate, isoOf, today, urgency, whenText } from "../dates.js";
import { esc } from "../md.js";
import { byWhen, companyState, isTracked, liveEvents, nextEvent } from "../model.js";
import { avatar, eventRow, groupByDay, kindBadge, routeMini, statePill } from "../parts.js";
import { state } from "../store.js";

export function viewHome() {
  const t = today();
  // ホームには「応募予定・選考中・内定」の企業だけを出す。気になる企業は件数だけ
  const all = liveEvents();
  const live = all.filter((e) => isTracked(e.c));
  const upcoming = live.filter((e) => daysUntil(e.date) >= 0).sort(byWhen);
  const week = upcoming.filter((e) => daysUntil(e.date) <= 6);
  const overdue = live.filter((e) => daysUntil(e.date) < 0 && daysUntil(e.date) >= -PAST_DAYS).sort(byWhen);
  const watchSoon = all.filter((e) => companyState(e.c) === "watch" && daysUntil(e.date) >= 0 && daysUntil(e.date) <= 14 && e.kind !== "event");
  const watchSoonCompanies = new Set(watchSoon.map((e) => e.c.slug)).size;
  const active = state.companies
    .flatMap((c) => c.programs.filter((p) => IN_SELECTION.has(p.state)).map((p) => ({ c, p, nx: nextEvent(c, p.id) })))
    .sort((a, b) => STATE_RANK[a.p.state] - STATE_RANK[b.p.state] || (a.nx && b.nx ? byWhen(a.nx, b.nx) : a.nx ? -1 : b.nx ? 1 : 0));
  const count = (tab) => state.companies.filter((c) => COMPANY_TABS.find((x) => x.v === tab).test(companyState(c))).length;

  let html = `
    <header class="page-head">
      <h1 class="page-title">${t.getMonth() + 1}月${t.getDate()}日<span class="wd">${WD[t.getDay()]}曜日</span></h1>
    </header>
    <nav class="tally" aria-label="企業の状況">
      ${["active", "plan", "watch"].map((v) => `<a href="#/companies" data-goto-tab="${v}" class="tally-item ${v}"><b>${count(v)}</b>${COMPANY_TABS.find((x) => x.v === v).label}</a>`).join("")}
    </nav>
    <div class="dash"><div class="dash-main">`;

  // 説明会より、応募（本選考・インターン）の締切を先に出す
  const next = upcoming.find((e) => e.p?.kind !== "説明会・イベント") || upcoming[0];
  if (next) {
    const n = daysUntil(next.date);
    const m = next.c.mypage;
    html += `
      <section class="next ${urgency(n)}" aria-label="次の${next.kind === "event" ? "予定" : "締切"}">
        <p class="next-strip"><span>次の${next.kind === "event" ? "予定" : "締切"}${next.p ? `　${esc(next.p.kind)}` : ""}</span><span class="next-when">${esc(whenText(next))}</span></p>
        <div class="next-count">${n <= 1 ? `<span class="next-word">${n === 0 ? "今日" : "明日"}</span>` : `<span class="next-num">${n}</span><span class="next-unit">日後</span>`}</div>
        <div class="next-body">
          <a class="next-co" href="#/c/${esc(next.c.slug)}${next.p ? `/${esc(next.p.id)}` : ""}">${esc(next.c.name)}</a>
          <p class="next-title">${esc(next.title)}${next.tentative ? "（目安）" : ""}</p>
        </div>
        <div class="next-actions">
          ${m.url ? `<a class="btn" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">マイページ</a>` : ""}
          <button class="btn primary" data-done="${esc(next.c.slug)}:${next.i}">済みにする</button>
        </div>
      </section>`;
  } else {
    html += `<section class="empty-panel">応募予定・選考中の企業に、これからの締切はありません。<br><a href="#/companies" data-goto-tab="watch">「気になる」から応募する企業を選ぶ</a></section>`;
  }

  // 1週間の帯
  html += `<section class="card week-card"><h2 class="card-title">この1週間<a class="sec-link" href="#/calendar">カレンダー</a></h2><ol class="week-strip" aria-label="今週">`;
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

  if (week.length) {
    html += `<section class="sheet agenda">`;
    for (const [iso, evs] of groupByDay(week)) {
      html += `<h2 class="day-head ${urgency(daysUntil(iso))}">${esc(dayLabel(iso))}</h2><ul class="ev-list">${evs.map((e) => eventRow(e)).join("")}</ul>`;
    }
    html += `</section>`;
  } else {
    html += `<p class="hint week-empty">この1週間に予定はありません。</p>`;
  }
  html += `</section>`;
  const later = upcoming.filter((e) => daysUntil(e.date) > 6).slice(0, 5);
  if (later.length) {
    html += `<section class="card"><h2 class="sec">その先の予定<a class="sec-link" href="#/calendar">カレンダー</a></h2><ul class="ev-list plain">${later.map((e) => eventRow(e, { date: true })).join("")}</ul></section>`;
  }
  if (watchSoon.length) {
    html += `<a class="notice-link" href="#/companies" data-goto-tab="watch">「気になる」企業に、2週間以内の締切が${watchSoon.length}件（${watchSoonCompanies}社）あります<span>見る</span></a>`;
  }
  html += `</div><div class="dash-side">`;

  if (active.length) {
    html += `<section class="card"><h2 class="sec">選考中<span class="count">${active.length}</span></h2><ul class="active-list">`;
    for (const { c, p, nx } of active) {
      html += `
        <li><a class="active-row" href="#/c/${esc(c.slug)}/${esc(p.id)}">
          ${avatar(c)}
          <span class="ar-body">
            <span class="ar-name">${esc(c.name)}</span>
            <span class="ar-prog">${routeMini(p)}<b>${esc(p.step || "")}</b>${statePill(p.state)}${c.programs.length > 1 ? kindBadge(p.kind) : ""}</span>
            ${nx ? `<span class="ar-next ${urgency(daysUntil(nx.date))}">${esc(fmtDate(nx.date))} ${esc(nx.title)}</span>` : ""}
          </span>
        </a></li>`;
    }
    html += `</ul></section>`;
  }

  if (overdue.length) {
    html += `<section class="card"><h2 class="sec">期限が過ぎた予定<span class="count">${overdue.length}</span></h2>
      <p class="hint">終わっていたら ✓ を押すと消えます。</p>
      <ul class="ev-list plain">${overdue.map((e) => eventRow(e, { date: true })).join("")}</ul></section>`;
  }

  const todos = state.companies.filter((c) => c.todo.length && isTracked(c));
  if (todos.length) {
    const total = todos.reduce((n, c) => n + c.todo.length, 0);
    html += `<details class="todos card"><summary>調べること・転記すること<span class="count">${total}</span></summary><ul>`;
    for (const c of todos) {
      html += `<li><a href="#/c/${esc(c.slug)}">${esc(c.name)}</a><ul>${c.todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></li>`;
    }
    html += `</ul></details>`;
  }
  return html + `</div></div>`;
}
