// 日付

import { WD } from "./config.js";

export function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const isoToday = () => isoOf(today());

export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export const daysUntil = (s) => Math.round((parseDate(s) - today()) / 86400000);

// 年は、年をまたいでも前後が分かる範囲（3か月前〜10か月先）なら省く
const otherYear = (s) => { const n = daysUntil(s); return n < -90 || n > 300; };

export function fmtDate(s, withYear = otherYear(s)) {
  const d = parseDate(s);
  const base = `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  return withYear ? `${d.getFullYear()}/${base}` : base;
}

export function whenText(e) {
  let s = fmtDate(e.date) + (e.time ? ` ${e.time}` : "");
  if (e.start) s = `${fmtDate(e.start)}${e.startTime ? ` ${e.startTime}` : ""} 〜 ${s}`;
  return s;
}

// 予定の日付の言い方: 締切は「〜締切」、期間の日程は「〜」でつなぐ、結果は「〜までに連絡」。
// sub は、まだ受付が始まっていない締切の受付開始
export function evWhen(e) {
  const at = (d, t) => fmtDate(d) + (t ? ` ${t}` : "");
  if (e.kind === "result") return { main: `${fmtDate(e.date)}までに連絡`, sub: "" };
  if (e.kind === "event") return { main: e.start ? `${at(e.start, e.startTime)} 〜 ${at(e.date, e.time)}` : at(e.date, e.time), sub: "" };
  if (opensOnly(e)) return { main: at(e.date, e.time), sub: "" };
  return { main: `${at(e.date, e.time)} 締切`, sub: e.start && daysUntil(e.start) > 0 ? `受付は ${at(e.start, e.startTime)} から` : "" };
}

// 「エントリー開始」のような始まりの日は、種類が締切でも「締切」と書かない
const opensOnly = (e) => !e.start && /開始|解禁|オープン|公開/.test(e.title || "");

// 残りの言い方。日程は始まる日まで数え、期間の途中なら「期間中」
export function evRemain(e) {
  const end = daysUntil(e.date);
  if (e.kind === "event" && e.start) {
    const st = daysUntil(e.start);
    if (st <= 0 && end >= 0) return { text: "期間中", cls: "urgent" };
    if (st > 0) return { text: remainText(st), cls: urgency(st) };
  }
  if (end < 0) return { text: e.kind === "event" || opensOnly(e) ? "日付を過ぎた" : e.kind === "result" ? "予定日を過ぎた" : "期限切れ", cls: "late" };
  return { text: remainText(end), cls: urgency(end) };
}

export function remainText(n) {
  if (n === 0) return "今日";
  if (n === 1) return "明日";
  if (n < 0) return `${-n}日前`;
  return `あと${n}日`;
}

export function dayLabel(iso) {
  const n = daysUntil(iso);
  if (n === 0) return `今日 ${fmtDate(iso)}`;
  if (n === 1) return `明日 ${fmtDate(iso)}`;
  return fmtDate(iso);
}

export const urgency = (n) => (n <= 3 ? "urgent" : n <= 7 ? "soon" : "");
