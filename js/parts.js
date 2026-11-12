// 画面の部品

import { IND_CLASS, KIND_CLASS, PRIORITY_LABEL, STATES } from "./config.js";
import { daysUntil, fmtDate, remainText, urgency } from "./dates.js";
import { esc } from "./md.js";
import { companyState, defaultProgram, flowIndex, isWaiting } from "./model.js";

export const ICONS = {
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
  door: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l4 4-4 4M14 12H4"/></svg>',
  id: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M15 10h3M15 13h3"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

export function avatar(c, size = "") {
  const ch = [...c.name.replace(/^株式会社/, "")][0] || "?";
  return `<span class="avatar ${IND_CLASS[c.industry] || "other"} ${size}" aria-hidden="true">${esc(ch)}</span>`;
}

export const kindBadge = (kind) => `<span class="kind ${KIND_CLASS[kind] || "main"}">${esc(kind)}</span>`;

export const statePill = (s) => `<span class="pill ${s}">${STATES[s].label}</span>`;

// ルートの状況。選考中でこれからの予定がなければ「結果待ち」を添える
export const progPill = (c, p) => statePill(p.state) + (isWaiting(c, p) ? '<span class="tag wait">結果待ち</span>' : "");

// マイページを開く・ID と PW をコピーするボタン
export function loginButtons(c) {
  const m = c.mypage;
  return [
    m.url && `<a class="mini" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${ICONS.door}マイページ</a>`,
    m.id && `<button class="mini" data-copy="${esc(m.id)}" data-copy-label="ID">${ICONS.id}ID</button>`,
    m.password && `<button class="mini" data-copy="${esc(m.password)}" data-copy-label="パスワード">${ICONS.key}PW</button>`,
  ].filter(Boolean).join("");
}

export const stars = (c) => (c.priority ? `<span class="stars-mini" title="志望度: ${PRIORITY_LABEL[c.priority]}">${"★".repeat(c.priority)}</span>` : "");

export function eventTitle(e, showProgram = false) {
  return (
    (e.kind === "event" ? '<span class="tag event">日程</span>' : "") +
    (showProgram && e.p && e.c.programs.length > 1 ? `<span class="tag prog">${esc(e.p.kind)}</span>` : "") +
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

// 一覧用の状況: 選考中なら段階つき、それ以外は状況と受付状況
export function companyStatusLine(c) {
  const s = companyState(c);
  const lead = defaultProgram(c);
  if (lead && s === "todo") {
    return `${routeMini(lead)}${lead.step ? `<b class="co-step">${esc(lead.step)}</b>` : ""}${progPill(c, lead)}${c.programs.length > 1 ? kindBadge(lead.kind) : ""}`;
  }
  const open = c.programs.some((p) => p.state === "plan" && p.status === "受付中");
  const kinds = [...new Set(c.programs.filter((p) => p.kind !== "説明会・イベント").map((p) => p.kind))];
  return `${statePill(s)}${open ? '<span class="open-dot">受付中</span>' : ""}<span class="co-kinds">${kinds.map(esc).join("・")}</span>`;
}

// 予定の1行。opts.date で日付も出す
export function eventRow(e, { date = false, tick = true } = {}) {
  const n = daysUntil(e.date);
  const late = n < 0 && !e.done;
  return `
    <li class="ev-row ${e.kind === "event" ? "is-event" : "is-deadline"} ${e.done ? "done" : urgency(n)}">
      <div class="ev-when">
        ${date ? `<span class="ev-date">${esc(fmtDate(e.date))}</span>` : ""}
        <span class="ev-time">${esc(e.time || (e.kind === "event" ? "終日" : "締切"))}</span>
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
