// カレンダーへの書き出し（.ics・Googleカレンダー）

import { addDays, isoOf, parseDate, whenText } from "./dates.js";

function utcStamp(date, time, addMinutes = 0) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm + addMinutes)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const compactDate = (date) => date.replace(/-/g, "");

const nextDayCompact = (date) => compactDate(isoOf(addDays(parseDate(date), 1)));

const calTitle = (e, c) => `${{ event: "", result: "【結果】" }[e.kind] ?? "【締切】"}${c.name} ${e.title}`;

// 通知: 締切は前日、日程は2時間前、結果の連絡は当日の朝9時（終日）か時刻ちょうど
const trigger = (e) => (e.kind === "event" ? "-PT2H" : e.kind === "result" ? (e.time ? "PT0M" : "PT9H") : "-P1D");

export function googleCalUrl(e, c) {
  const dates = e.time
    ? `${utcStamp(e.date, e.time)}/${utcStamp(e.date, e.time, 30)}`
    : `${compactDate(e.date)}/${nextDayCompact(e.date)}`;
  const q = new URLSearchParams({ action: "TEMPLATE", text: calTitle(e, c), dates, details: whenText(e) });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// 1行は75バイトまで（RFC 5545）。長い行は続きの行（先頭に空白）に折り返す。日本語は文字の途中で切らない
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function icsText(items) {
  const escT = (t) => String(t).replace(/\\/g, "\\\\").replace(/[;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//shukatsu-board//JA", "CALSCALE:GREGORIAN"];
  for (const { e, c } of items) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${c.slug}-${e.date}-${(e.time || "").replace(":", "")}-${encodeURIComponent(e.title).slice(0, 40)}@shukatsu-board`,
      `DTSTAMP:${now}`,
      `SUMMARY:${escT(calTitle(e, c))}`,
      `DESCRIPTION:${escT(whenText(e))}`,
      ...(e.time
        ? [`DTSTART:${utcStamp(e.date, e.time)}`, `DTEND:${utcStamp(e.date, e.time, 30)}`]
        : [`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${nextDayCompact(e.date)}`]),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escT(calTitle(e, c))}`,
      `TRIGGER:${trigger(e)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadIcs(name, items) {
  const url = URL.createObjectURL(new Blob([icsText(items)], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
