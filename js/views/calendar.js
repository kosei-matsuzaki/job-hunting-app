// 画面: カレンダー

import { WD } from "../config.js";
import { addDays, dayLabel, fmtDate, isoOf, isoToday, parseDate } from "../dates.js";
import { esc } from "../md.js";
import { allEvents, byWhen, isEnded, isTracked } from "../model.js";
import { eventRow, ICONS } from "../parts.js";
import { ui } from "../store.js";

export function viewCalendar(sel) {
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(sel || "") ? sel : isoToday();
  const s = parseDate(selected);
  const y = s.getFullYear();
  const m = s.getMonth();
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
  const start = addDays(first, -first.getDay());
  const events = allEvents().filter((e) => !isEnded(e.c) && (ui.calAll || isTracked(e.c)));
  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const prev = isoOf(new Date(y, m - 1, 1));
  const next = isoOf(new Date(y, m + 1, 1));

  let html = `
    <div class="cal-layout"><div class="cal-col">
    <header class="cal-head">
      <a class="icon-btn" href="#/calendar/${prev}" aria-label="前の月">‹</a>
      <h1 class="page-title">${y}年${m + 1}月</h1>
      <a class="icon-btn" href="#/calendar/${next}" aria-label="次の月">›</a>
      <a class="btn small" href="#/calendar/${isoToday()}">今日</a>
    </header>
    <div class="seg small cal-scope" role="group" aria-label="表示する企業">
      <button data-calall="0" aria-pressed="${!ui.calAll}">応募予定・選考中</button>
      <button data-calall="1" aria-pressed="${ui.calAll}">気になる企業も</button>
    </div>
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
      // 広い画面では点の代わりに企業名を出す
      const chips = evs
        .slice(0, 3)
        .map((e) => `<span class="cal-ev ${e.done ? "done" : e.kind === "event" ? "event" : "deadline"}">${esc(e.c.name)}</span>`)
        .join("");
      html += `<a role="gridcell" class="cal-cell ${cls}" href="#/calendar/${iso}" aria-label="${esc(fmtDate(iso, true))} 予定${evs.length}件"${iso === selected ? ' aria-selected="true"' : ""}>
        <span class="cal-d">${day.getDate()}</span><span class="cal-dots">${dots}${evs.length > 3 ? "<b>+</b>" : ""}</span>
        ${evs.length ? `<span class="cal-evs">${chips}${evs.length > 3 ? `<b>ほか${evs.length - 3}件</b>` : ""}</span>` : ""}</a>`;
    }
    html += `</div>`;
  }
  html += `</div>
    <p class="cal-legend"><i class="deadline"></i>締切 <i class="event"></i>日程 <i class="done"></i>済み</p>
    </div><div class="cal-aside">`;

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
  html += `</div></div><div class="fab-space"></div><a class="fab" href="#/add/${selected}" aria-label="予定を追加">${ICONS.plus}</a>`;
  return html;
}
