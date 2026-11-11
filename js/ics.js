// カレンダーへの書き出し（.ics・Googleカレンダー）

import { addDays, isoOf, parseDate, whenText } from "./dates.js";

function utcStamp(date, time, addMinutes = 0) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm + addMinutes)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const compactDate = (date) => date.replace(/-/g, "");

const nextDayCompact = (date) => compactDate(isoOf(addDays(parseDate(date), 1)));

const calTitle = (e, c) => `${e.kind === "event" ? "" : "【締切】"}${c.name} ${e.title}`;

export function googleCalUrl(e, c) {
  const dates = e.time
    ? `${utcStamp(e.date, e.time)}/${utcStamp(e.date, e.time, 30)}`
    : `${compactDate(e.date)}/${nextDayCompact(e.date)}`;
  const q = new URLSearchParams({ action: "TEMPLATE", text: calTitle(e, c), dates, details: whenText(e) });
  return `https://calendar.google.com/calendar/render?${q}`;
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
      `TRIGGER:${e.kind === "event" ? "-PT2H" : "-P1D"}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
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
