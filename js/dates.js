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

const otherYear = (s) => parseDate(s).getFullYear() !== today().getFullYear();

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
