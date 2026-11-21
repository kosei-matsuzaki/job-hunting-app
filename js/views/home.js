// 画面: ホーム

import { PAST_DAYS, WD } from "../config.js";
import { addDays, dayLabel, daysUntil, fmtDate, isoOf, remainText, today, urgency, whenText } from "../dates.js";
import { esc } from "../md.js";
import { byWhen, companyStatus, isEnded, isResult, isWaiting, liveEvents, nextEvent, pendingResult, resultEvent, sinceChecked } from "../model.js";
import { checkLine, statusTag } from "./companies.js";
import { avatar, eventRow, groupByDay, ICONS, kindBadge, resultWhen, routeMini } from "../parts.js";
import { state, ui } from "../store.js";

export function viewHome() {
  const t = today();
  // 終了した企業（見送り・辞退・不合格）の予定は出さない
  const live = liveEvents();
  // 自分の番（締切・日程）と相手の番（結果の連絡）を分ける。ホームの予定の一覧は自分の番だけ
  const upcoming = live.filter((e) => daysUntil(e.date) >= 0 && !isResult(e)).sort(byWhen);
  const week = upcoming.filter((e) => daysUntil(e.date) <= 6);
  const weekResults = live.filter((e) => isResult(e) && daysUntil(e.date) >= 0 && daysUntil(e.date) <= 6);
  const overdue = live.filter((e) => daysUntil(e.date) < 0 && daysUntil(e.date) >= -PAST_DAYS && !isResult(e)).sort(byWhen);
  const routes = state.companies.flatMap((c) => c.programs.filter((p) => p.state === "todo").map((p) => ({ c, p })));
  // 選考中で自分の番: 次の締切・日程が近い順、未登録は最後
  const myTurn = routes
    .filter(({ c, p }) => !isWaiting(c, p))
    .map((x) => ({ ...x, nx: nextEvent(x.c, x.p.id) }))
    .sort((a, b) => !a.nx - !b.nx || byWhen(a.nx || { date: "9999" }, b.nx || { date: "9999" }));
  // 結果待ち（相手の番）: 連絡の予定日が近い順（過ぎたものが先）、未登録は最後
  const waits = routes
    .filter(({ c, p }) => isWaiting(c, p))
    .map((x) => ({ ...x, r: pendingResult(x.c, x.p) || resultEvent(x.c, x.p.id) }))
    .sort((a, b) => !a.r - !b.r || byWhen(a.r || { date: "9999" }, b.r || { date: "9999" }));
  const byStatus = (...ks) => state.companies.filter((c) => ks.includes(companyStatus(c).k));
  // 志望の企業で選考がないもの（次の募集を確かめる）。長く確かめていないものから
  const checks = byStatus("check").sort((a, b) => (sinceChecked(b) ?? 9999) - (sinceChecked(a) ?? 9999) || (b.priority || 0) - (a.priority || 0));

  let html = `
    <header class="page-head">
      <h1 class="page-title">${t.getMonth() + 1}月${t.getDate()}日<span class="wd">${WD[t.getDay()]}曜日</span></h1>
    </header>
    <nav class="tally" aria-label="選考の状況">
      ${myTurn.length ? `<button class="tally-item turn-mine" data-jump="mine-card"><b>${myTurn.length}</b>自分の番</button>` : `<span class="tally-item"><b>0</b>自分の番</span>`}
      ${waits.length ? `<button class="tally-item turn-wait" data-jump="wait-card"><b>${waits.length}</b>結果待ち</button>` : `<span class="tally-item"><b>0</b>結果待ち</span>`}
      ${checks.length ? `<button class="tally-item${checks.length ? " warn" : ""}" data-jump="check-card"><b>${checks.length}</b>要確認</button>` : `<span class="tally-item"><b>0</b>要確認</span>`}
    </nav>
    <div class="dash"><div class="dash-main">`;

  // 説明会より、応募（本選考・インターン）の締切を先に出す
  // 結果の連絡は相手の番なので、日めくりには出さない
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
    html += `<section class="empty-panel">これからの締切はありません。<br><a href="#/companies" data-goto-tab="plan">応募前の企業を見る</a></section>`;
  }

  // 過ぎた予定は、済んだか確かめるまで残るので、次の締切のすぐ下に出す（下に埋もれないように）
  if (overdue.length) {
    html += `<section class="card overdue-card" id="overdue-card"><h2 class="sec">期限が過ぎた予定<span class="count">${overdue.length}</span></h2>
      <p class="hint">終わっていたら ✓ を押すと消えます。応募しないなら、企業ページでルートを「見送り」に。</p>
      <ul class="ev-list plain">${overdue.map((e) => eventRow(e, { date: true })).join("")}</ul></section>`;
  }

  // 1週間の帯
  // 帯の数は自分の予定だけ。結果の連絡がある日は、破線の印を添える
  html += `<section class="card week-card"><h2 class="card-title"><span class="turn-tag mine">自分の番</span>この1週間<a class="act" href="#/calendar">${ICONS.cal}カレンダー</a></h2><ol class="week-strip" aria-label="今週">`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(t, i);
    const iso = isoOf(d);
    const dayEvents = week.filter((e) => e.date === iso);
    const dayResults = weekResults.filter((e) => e.date === iso);
    const mark = dayEvents.some((e) => !e.kind || e.kind === "deadline") ? "deadline" : "event";
    const label = `${fmtDate(iso)} 予定${dayEvents.length}件${dayResults.length ? `・結果の連絡${dayResults.length}件` : ""}`;
    html += `
      <li><a href="#/calendar/${iso}" class="${i === 0 ? "today" : ""} ${dayEvents.length ? "has" : ""}" aria-label="${esc(label)}">
        <span class="ws-wd ${d.getDay() === 0 ? "sun" : d.getDay() === 6 ? "sat" : ""}">${WD[d.getDay()]}</span>
        <span class="ws-d">${d.getDate()}</span>
        <span class="ws-n">${dayEvents.length ? `<i class="${mark}"></i>${dayEvents.length > 1 ? dayEvents.length : ""}` : ""}${dayResults.length ? '<i class="result"></i>' : ""}</span>
      </a></li>`;
  }
  html += `</ol>`;

  // 上の「次の締切」に大きく出した予定は、下の一覧には重ねて出さない（帯の件数には数える）
  const weekRest = week.filter((e) => e !== next);
  if (weekRest.length) {
    html += `<section class="sheet agenda">`;
    for (const [iso, evs] of groupByDay(weekRest)) {
      html += `<h2 class="day-head ${urgency(daysUntil(iso))}">${esc(dayLabel(iso))}</h2><ul class="ev-list">${evs.map((e) => eventRow(e)).join("")}</ul>`;
    }
    html += `</section>`;
  } else {
    html += `<p class="hint week-empty">この1週間に${week.length ? "ほかの" : ""}予定はありません。</p>`;
  }
  html += `</section>`;
  // カレンダーへの入口は「この1週間」の見出しに1つだけ置く
  const later = upcoming.filter((e) => daysUntil(e.date) > 6 && e !== next).slice(0, 5);
  if (later.length) {
    html += `<section class="card"><h2 class="sec">その先の予定</h2><ul class="ev-list plain">${later.map((e) => eventRow(e, { date: true })).join("")}</ul></section>`;
  }
  html += `</div><div class="dash-side">`;

  // 選考中のルートを、自分の番（締切・日程に向けて動く）と結果待ち（相手の番・確認だけ）に分ける
  if (myTurn.length) {
    html += `<section class="card turn-card is-mine" id="mine-card"><h2 class="sec"><span class="turn-tag mine">自分の番</span>選考中で次は自分<span class="count">${myTurn.length}</span></h2><ul class="active-list">`;
    for (const { c, p, nx } of myTurn) {
      html += `
        <li><a class="active-row" href="#/c/${esc(c.slug)}/${esc(p.id)}">
          ${avatar(c)}
          <span class="ar-body">
            <span class="ar-name">${esc(c.name)}</span>
            <span class="ar-prog">${routeMini(p)}<b>${esc(p.step || "")}</b>${c.programs.length > 1 ? kindBadge(p.kind, true) : ""}</span>
            ${nx ? `<span class="ar-next ${urgency(daysUntil(nx.date))}">${esc(fmtDate(nx.date))} ${esc(nx.title)}<em>${esc(remainText(daysUntil(nx.date)))}</em></span>` : `<span class="ar-next unset" title="企業ページで締切を入れるか、受けたなら「受けた・結果待ち」を押す">次の締切・日程が未登録</span>`}
          </span>
        </a></li>`;
    }
    html += `</ul></section>`;
  }

  if (waits.length) {
    html += `<section class="card turn-card is-wait" id="wait-card"><h2 class="sec"><span class="turn-tag wait">相手の番</span>結果待ち<span class="count">${waits.length}</span></h2>
      <p class="hint">確認するだけ。連絡が来たら、企業ページで通過・不合格を押します。</p><ul class="active-list">`;
    for (const { c, p, r } of waits) {
      const w = r && resultWhen(r);
      html += `
        <li><a class="active-row" href="#/c/${esc(c.slug)}/${esc(p.id)}">
          ${avatar(c)}
          <span class="ar-body">
            <span class="ar-name">${esc(c.name)}</span>
            <span class="ar-prog">${routeMini(p)}<b>${esc(p.step || "")}</b>${c.programs.length > 1 ? kindBadge(p.kind, true) : ""}</span>
            ${w ? `<span class="ar-next is-result ${w.cls}">${esc(w.text)}<em>${esc(w.cls === "late" ? "予定日を過ぎた・メールを確認" : w.left)}</em></span>` : `<span class="ar-next faint">結果の連絡日は未登録</span>`}
          </span>
        </a></li>`;
    }
    html += `</ul></section>`;
  }

  if (checks.length) {
    html += `<section class="card" id="check-card"><h2 class="sec">志望で選考がない企業<span class="count">${checks.length}</span></h2>
      <p class="hint">次の募集や早期選考の案内が出ていないか確かめて、「確認した」を押してください。</p>
      <ul class="check-list">${checks.map((c) => `<li><a class="check-co" href="#/c/${esc(c.slug)}">${avatar(c)}<span class="co-name">${esc(c.name)}</span>${statusTag(c)}</a>${checkLine(c)}</li>`).join("")}</ul></section>`;
  }

  const todos = state.companies.filter((c) => c.todo.length && !isEnded(c));
  if (todos.length) {
    const total = todos.reduce((n, c) => n + c.todo.length, 0);
    // 企業ページに行かなくても、ここで済みにできる
    html += `<details class="todos card"${ui.todosOpen ? " open" : ""}><summary>やること<span class="count">${total}</span></summary><ul class="todo-groups">`;
    for (const c of todos) {
      html += `<li><a class="todo-co" href="#/c/${esc(c.slug)}">${avatar(c)}${esc(c.name)}</a><ul class="checklist todo-list">${c.todo
        .map((t) => `<li><label><input type="checkbox" data-todo-done="${esc(c.slug)}" value="${esc(t)}"><span class="ck-body"><span class="ck-title">${esc(t)}</span></span></label></li>`)
        .join("")}</ul></li>`;
    }
    html += `</ul></details>`;
  }
  return html + `</div></div>`;
}
