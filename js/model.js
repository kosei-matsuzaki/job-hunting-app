// 企業・選考ルートの問い合わせ

import { ENDED, STATE_RANK } from "./config.js";
import { daysUntil } from "./dates.js";
import { state } from "./store.js";

export const bySlug = (slug) => state.companies.find((c) => c.slug === slug);

export const programOf = (c, pid) => c?.programs.find((p) => p.id === pid);

export const flowIndex = (p) => p.flow.indexOf(p.step);

export function companyState(c) {
  if (!c.programs.length) return "plan";
  return c.programs.map((p) => p.state).sort((a, b) => STATE_RANK[a] - STATE_RANK[b])[0];
}

export const isEnded = (c) => ENDED.has(companyState(c));

const evKey = (e) => e.date + (e.time || "99:99");

export const byWhen = (a, b) => evKey(a).localeCompare(evKey(b));

export function allEvents() {
  return state.companies.flatMap((c) => c.events.map((e, i) => ({ ...e, c, i, p: programOf(c, e.program) })));
}

export const liveEvents = () => allEvents().filter((e) => !e.done && !isEnded(e.c));

// 結果の連絡の予定（相手の番なので、自分の次の予定には数えない）
export const isResult = (e) => e.kind === "result";

// これからの自分の予定（締切・日程）。結果の連絡は除く
export function nextEvent(c, pid) {
  return c.events
    .filter((e) => !e.done && !isResult(e) && daysUntil(e.date) >= 0 && (!pid || e.program === pid))
    .sort(byWhen)[0];
}

// まだ来ていない結果の連絡（日付を過ぎていても、済みにするまでは残す）
export function resultEvent(c, pid) {
  return c.events.filter((e) => !e.done && isResult(e) && e.program === pid).sort(byWhen)[0];
}

export function defaultProgram(c) {
  return [...c.programs].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state])[0];
}

// 選考中のルートで、いま待っている結果の連絡。自分の次の予定より先に来るものだけ
// （例: 11/25 までに書類の結果 → 通れば 12/5 に当日。いまは結果待ち）
export function pendingResult(c, p) {
  if (p.state !== "todo") return null;
  const r = resultEvent(c, p.id);
  const nx = nextEvent(c, p.id);
  return r && (!nx || r.date <= nx.date) ? r : null;
}

// 選考中で、そのルートにこれからの予定がないか、結果の連絡を先に待っている（相手の番）
export const isWaiting = (c, p) => p.state === "todo" && (!nextEvent(c, p.id) || !!pendingResult(c, p));

export const hasLogin = (c) => !!(c.mypage.url || c.mypage.id || c.mypage.password);
