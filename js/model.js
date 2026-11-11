// 企業・選考ルートの問い合わせ

import { ENDED, STATE_RANK, TRACKED } from "./config.js";
import { daysUntil } from "./dates.js";
import { state } from "./store.js";

export const bySlug = (slug) => state.companies.find((c) => c.slug === slug);

export const programOf = (c, pid) => c?.programs.find((p) => p.id === pid);

export const flowIndex = (p) => p.flow.indexOf(p.step);

export function companyState(c) {
  if (!c.programs.length) return "watch";
  return c.programs.map((p) => p.state).sort((a, b) => STATE_RANK[a] - STATE_RANK[b])[0];
}

export const isEnded = (c) => ENDED.has(companyState(c));

const evKey = (e) => e.date + (e.time || "99:99");

export const byWhen = (a, b) => evKey(a).localeCompare(evKey(b));

export function allEvents() {
  return state.companies.flatMap((c) => c.events.map((e, i) => ({ ...e, c, i, p: programOf(c, e.program) })));
}

export const liveEvents = () => allEvents().filter((e) => !e.done && !isEnded(e.c));

export function nextEvent(c, pid) {
  return c.events
    .filter((e) => !e.done && daysUntil(e.date) >= 0 && (!pid || e.program === pid))
    .sort(byWhen)[0];
}

export function defaultProgram(c) {
  return [...c.programs].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state])[0];
}

export const isTracked = (c) => TRACKED.has(companyState(c));
