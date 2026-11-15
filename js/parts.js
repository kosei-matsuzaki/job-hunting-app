// 画面の部品

import { ENDED, IND_CLASS, KIND_CLASS, KIND_SHORT, PRIORITY_LABEL, STATE_RANK, STATES } from "./config.js";
import { daysUntil, fmtDate, remainText, urgency } from "./dates.js";
import { esc } from "./md.js";
import { flowIndex, isWaiting, nextEvent, pendingResult, resultEvent } from "./model.js";

export const ICONS = {
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
  door: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l4 4-4 4M14 12H4"/></svg>',
  id: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M15 10h3M15 13h3"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  calAdd: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M12 13v5M9.5 15.5h5"/></svg>',
};

export function avatar(c, size = "") {
  const ch = [...c.name.replace(/^株式会社/, "")][0] || "?";
  return `<span class="avatar ${IND_CLASS[c.industry] || "other"} ${size}" aria-hidden="true">${esc(ch)}</span>`;
}

export const kindBadge = (kind, short = false) => `<span class="kind ${KIND_CLASS[kind] || "main"}">${esc(short ? KIND_SHORT[kind] || kind : kind)}</span>`;

export const statePill = (s) => `<span class="pill ${s}">${STATES[s].label}</span>`;

// ルートの状況。選考中でこれからの予定がなければ「結果待ち」を添える
export const progPill = (c, p) => statePill(p.state) + (isWaiting(c, p) ? '<span class="tag wait">結果待ち</span>' : "");

// 結果の連絡の予定日の書き方: 「11/25(水)までに結果」と残り日数（過ぎていたら「予定日を過ぎた」）
export function resultWhen(r) {
  const n = daysUntil(r.date);
  return { text: `${fmtDate(r.date)}までに結果`, left: n < 0 ? "予定日を過ぎた" : remainText(n), cls: n < 0 ? "late" : urgency(n) };
}

// 選考ルートを、選考中・内定 → 応募前 → 終了の順に。同じなら次の予定が近い順
export function sortPrograms(c) {
  const when = (p) => (nextEvent(c, p.id) || resultEvent(c, p.id))?.date || "9999";
  return [...c.programs].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || when(a).localeCompare(when(b)));
}

// 選考ルート1つの状況の行（企業一覧・企業ページで共通）。1行に印は1つだけにする。
// 1行目: 種類｜名前｜いまの段階（選考中は太字の段階、内定は朱の印、応募前は受付状況だけ）
// 2行目: 結果待ちならその旨と連絡日、それ以外は次の予定
export function progRow(c, p, { href = `#/c/${c.slug}/${p.id}`, current = false } = {}) {
  const s = p.state;
  const nx = nextEvent(c, p.id);
  const r = pendingResult(c, p);
  const waiting = isWaiting(c, p);
  let state = "";
  // 開いているルートの状況・段階は、下の中身（状況のボタンと押印欄）に出す
  if (current) state = "";
  else if (s === "todo") state = `<b class="cp-step">${esc(p.step || "選考中")}</b>`;
  else if (s === "offer") state = statePill(s);
  else if (s === "plan") state = p.status === "受付中" ? '<span class="cp-open">受付中</span>' : p.status === "終了" ? '<span class="cp-quiet">受付終了</span>' : "";
  else state = `<span class="cp-quiet">${STATES[s].label}</span>`;
  let when = "";
  // 開いているルートは、下の中身に詳しく出るので2行目を出さない
  if (current) when = "";
  else if (waiting) {
    const w = r && resultWhen(r);
    when = `<span class="cp-when is-wait ${w ? w.cls : ""}"><span class="cp-wait">結果待ち</span>${w ? `<b>${esc(w.text.replace(/結果$/, ""))}</b><em>${esc(w.left)}</em>` : '<span class="cp-quiet">連絡日は未登録</span>'}</span>`;
  } else if (nx && !ENDED.has(s)) {
    const n = daysUntil(nx.date);
    when = `<span class="cp-when ${urgency(n)}"><b>${esc(fmtDate(nx.date))}</b><span class="cp-ev">${esc(nx.title)}</span><em>${esc(remainText(n))}</em></span>`;
  }
  return `<a class="cp-row st-${s}" href="${esc(href)}"${current ? ' aria-current="true"' : ""}>
    <span class="cp-kind ${KIND_CLASS[p.kind] || "main"}">${esc(KIND_SHORT[p.kind] || p.kind)}</span><span class="cp-title">${esc(p.title || p.kind)}</span><span class="cp-state">${state}</span>${when}</a>`;
}

// マイページを開く・ID と PW をコピーするボタン
export function loginButtons(c) {
  const m = c.mypage;
  return [
    m.url && `<a class="lg-btn" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer" title="マイページを開く" aria-label="${esc(c.name)} のマイページを開く">${ICONS.door}</a>`,
    m.id && `<button class="lg-btn" data-copy="${esc(m.id)}" data-copy-label="ID" title="IDをコピー" aria-label="${esc(c.name)} のIDをコピー">${ICONS.id}</button>`,
    m.password && `<button class="lg-btn" data-copy="${esc(m.password)}" data-copy-label="パスワード" title="パスワードをコピー" aria-label="${esc(c.name)} のパスワードをコピー">${ICONS.key}</button>`,
  ].filter(Boolean).join("");
}

export const stars = (c) => (c.priority ? `<span class="stars-mini" title="志望度: ${PRIORITY_LABEL[c.priority]}">${"★".repeat(c.priority)}</span>` : "");

export function eventTitle(e, showProgram = false) {
  return (
    (e.kind === "event" ? '<span class="tag event">日程</span>' : e.kind === "result" ? '<span class="tag result">結果</span>' : "") +
    (showProgram && e.p && e.c.programs.length > 1 ? `<span class="tag prog">${esc(KIND_SHORT[e.p.kind] || e.p.kind)}</span>` : "") +
    esc(e.title) +
    (e.tentative ? '<span class="tag tentative">目安</span>' : "")
  );
}

export function routeMini(p) {
  if (!p.flow.length) return "";
  const idx = p.state === "offer" ? p.flow.length : flowIndex(p);
  return `<span class="route-mini" aria-hidden="true">${p.flow
    .map((_, i) => `<span class="st${i < idx ? " past" : i === idx ? " now" : ""}"></span>`)
    .join("")}</span>`;
}

// 予定の種類（色分けの class）: deadline / event / result
export const evClass = (e) => (e.kind === "event" || e.kind === "result" ? e.kind : "deadline");

// 予定の1行。opts.date で日付も出す
export function eventRow(e, { date = false, tick = true } = {}) {
  const n = daysUntil(e.date);
  const late = n < 0 && !e.done;
  return `
    <li class="ev-row is-${evClass(e)} ${e.done ? "done" : urgency(n)}">
      <div class="ev-when">
        ${date ? `<span class="ev-date">${esc(fmtDate(e.date))}</span>` : ""}
        <span class="ev-time">${esc(e.time || { event: "終日", result: "連絡" }[e.kind] || "締切")}</span>
      </div>
      <div class="ev-main">
        <a class="ev-co" href="#/c/${esc(e.c.slug)}${e.p ? `/${esc(e.p.id)}` : ""}">${esc(e.c.name)}</a>
        <span class="ev-title">${eventTitle(e, true)}</span>
        ${e.start && daysUntil(e.start) > 0 ? `<span class="ev-sub">${esc(fmtDate(e.start))}${e.startTime ? ` ${esc(e.startTime)}` : ""} から受付</span>` : ""}
      </div>
      <span class="ev-left">${e.done ? "済み" : late ? `${-n}日前` : date ? esc(remainText(n)) : ""}</span>
      ${tick && !e.done ? `<button class="tick" data-done="${esc(e.c.slug)}:${e.i}" aria-label="${esc(e.c.name)} ${esc(e.title)} を済みにする">${ICONS.check}</button>` : ""}
    </li>`;
}

export function groupByDay(events) {
  const groups = new Map();
  for (const e of events) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  }
  return [...groups.entries()];
}
