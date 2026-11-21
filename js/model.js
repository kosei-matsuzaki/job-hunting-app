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

// 企業として見送った（行かないと決めた）。dropped にその日を持つ。選考ルートの状況はそのまま残す
export const isDropped = (c) => !!c.dropped;

// 終わった企業: 企業として見送ったか、どのルートも見送り・辞退・不合格。予定はホーム・カレンダーに出さない
export const isEnded = (c) => isDropped(c) || ENDED.has(companyState(c));

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
    // ルートが1つだけなら、ルートを指定していない予定もそのルートのもの
    .filter((e) => !e.done && !isResult(e) && daysUntil(e.date) >= 0 && (!pid || e.program === pid || (!e.program && c.programs?.length === 1)))
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
  if (r && p.waiting) return r;
  const nx = nextEvent(c, p.id);
  return r && (!nx || r.date <= nx.date) ? r : null;
}

// 結果待ち（相手の番）: 選考中で、いまの段階を受け終えた印（waiting）があるか、結果の連絡を先に待っている。
// これからの予定がないだけなら結果待ちにはしない（アンケート・WEBテストのように、日付のない自分の番もあるので）
export const isWaiting = (c, p) => p.state === "todo" && (!!p.waiting || !!pendingResult(c, p));

export const hasLogin = (c) => !!(c.mypage.url || c.mypage.id || c.mypage.password);

// 予定がルートのどの段階のものか（flow の番号。分からなければ -1）。
// step を持っていればそれ。なければ題名から推す: 段階の名前（「・」などで区切った語）が題名の先のほうに出てくる段階。
// それもなく「応募・エントリー・申込」の締切なら最初の段階。結果の連絡は段階に付けない（結果待ちの欄で出す）
const normText = (s) => String(s || "").toLowerCase().replace(/[\s（）()「」【】]/g, "");
// ルートが1つだけなら、ルートを指定していない予定もそのルートのものとみなす
const routeOfEvent = (c, e) => programOf(c, e.program) || (!e.program && c.programs.length === 1 ? c.programs[0] : null);
export function stepOf(c, e) {
  const p = routeOfEvent(c, e);
  if (!p?.flow.length || e.kind === "result") return -1;
  if (e.step) return p.flow.indexOf(e.step);
  const t = normText(e.title);
  let best = -1;
  let at = Infinity;
  p.flow.forEach((name, i) => {
    for (const w of String(name).split(/[・、,／/]/).map(normText).filter((x) => x.length >= 2)) {
      const k = t.indexOf(w);
      if (k >= 0 && k < at) { at = k; best = i; }
    }
  });
  if (best >= 0) return best;
  if ((e.kind || "deadline") === "deadline" && /応募|エントリー|申込|申し込み/.test(e.title) && !/開始|解禁|オープン|公開/.test(e.title)) return 0;
  return -1;
}

// その段階のまだ済んでいない予定（締切・日程）。日付の順
export const stepEvents = (c, p, i) =>
  c.events.map((e, k) => ({ ...e, i: k })).filter((e) => routeOfEvent(c, e)?.id === p.id && !e.done && stepOf(c, e) === i).sort(byWhen);

// 企業の状況のラベル（一覧の行・ホーム）。
// 内定 → 選考中 → 応募前（これからの予定がある）→ 選考なし（予定がない・全部終わった）。
// 志望度が付いた企業で選考がなければ「要確認」にして、次の募集を確かめるよう促す
export function companyStatus(c) {
  if (isDropped(c)) return { k: "dropped", label: "見送り", rank: 6 };
  const s = companyState(c);
  if (s === "offer") return { k: "offer", label: "内定", rank: 0 };
  if (s === "todo") return { k: "todo", label: "選考中", rank: 1 };
  const ended = ENDED.has(s);
  if (!ended && nextEvent(c)) return { k: "plan", label: "応募前", rank: 3 };
  if (c.priority) return { k: "check", label: ended ? "終了・次を確認" : "選考なし・要確認", rank: 2 };
  return ended ? { k: "ended", label: "終了", rank: 5 } : { k: "none", label: "予定なし", rank: 4 };
}

// 最後に募集を確かめた日（確認した日、なければ最後に動かした日）から何日たったか
export const sinceChecked = (c) => {
  const d = c.checked || c.lastAction;
  return d ? -daysUntil(d) : null;
};
