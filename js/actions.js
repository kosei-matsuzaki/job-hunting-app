// 保存を伴う操作（元に戻せる）

import { ENDED, STATES } from "./config.js";
import { commit, MERGED } from "./data.js";
import { isoToday } from "./dates.js";
import { bySlug, flowIndex, programOf, stepOf } from "./model.js";
import { render } from "./render.js";
import { toast } from "./toast.js";

export const undoable = (message, undo, result = true) =>
  toast(result === MERGED ? "別の端末の変更と合わせて保存しました" : message, false, { label: "元に戻す", run: undo });

export async function markDone(key, done = true, { undo = true } = {}) {
  const [slug, i] = key.split(":");
  const c = bySlug(slug);
  const target = c?.events?.[Number(i)];
  if (!target) return;
  const { title, date } = target;
  const ok = await commit(() => {
    // 別の端末で予定が増減しても同じ予定を指すよう、内容と日付で探す
    const e = bySlug(slug)?.events?.find((x) => x.title === title && x.date === date);
    if (!e) return;
    if (done) e.done = true;
    else delete e.done;
  }, `${c.name}: ${title} を${done ? "済み" : "未完了"}に`, { quiet: undo });
  render();
  if (ok && undo) undoable(done ? "済みにしました" : "未完了に戻しました", () => markDone(key, !done, { undo: false }), ok);
}

// その段階の、まだ済んでいない予定（締切・日程）を「内容 @ 日付」で。通過・受けたら済みにする
const stepKeys = (c, pid, step) => {
  const p = programOf(c, pid);
  const i = p ? p.flow.indexOf(step) : -1;
  const mine = (e) => e.program === pid || (!e.program && c.programs.length === 1);
  return i < 0 ? [] : c.events.filter((e) => mine(e) && !e.done && e.kind !== "result" && stepOf(c, e) === i).map((e) => `${e.title} @ ${e.date}`);
};

async function updateProgram(slug, pid, patch, note, { closeStep } = {}) {
  const c = bySlug(slug);
  const p = programOf(c, pid);
  if (!p) return;
  const label = c.programs.length > 1 ? `${p.title || p.kind}: ` : "";
  const text = label + note;
  // 段階・状況が変わったら「受けて結果待ち」は終わり
  patch = { ...patch, waiting: undefined, waitingSince: undefined };
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, p[k]]));
  const lastAction = c.lastAction;
  // 段階や状況が変わったら、待っていた結果の連絡は来たということなので済みにする
  const closing = [
    ...c.events.filter((e) => e.program === pid && e.kind === "result" && !e.done).map((e) => `${e.title} @ ${e.date}`),
    ...(closeStep ? stepKeys(c, pid, closeStep) : []),
  ];
  const isClosing = (e) => (e.program === pid || (!e.program && c.programs.length === 1)) && closing.includes(`${e.title} @ ${e.date}`);
  const ok = await commit(() => {
    const x = bySlug(slug);
    const q = programOf(x, pid);
    if (!q) return;
    Object.assign(q, patch);
    for (const e of x.events) if (isClosing(e)) e.done = true;
    x.lastAction = isoToday();
    if (x.history?.[0]?.text !== text || x.history[0].date !== isoToday()) x.history = [{ date: isoToday(), text }, ...(x.history || [])];
  }, `${c.name}: ${text}`, { quiet: true });
  render();
  if (!ok) return;
  undoable(note, async () => {
    await commit(() => {
      const x = bySlug(slug);
      const q = programOf(x, pid);
      if (!q) return;
      Object.assign(q, before);
      for (const e of x.events) if (isClosing(e)) delete e.done;
      x.lastAction = lastAction;
      const i = (x.history || []).findIndex((h) => h.text === text);
      if (i >= 0) x.history.splice(i, 1);
    }, `${c.name}: 取り消し（${text}）`);
    render();
  }, ok);
}

export function statusClick(t) {
  document.getElementById("status-sheet")?.close();
  if (t.dataset.state) {
    const [slug, pid, next] = t.dataset.state.split(":");
    const p = programOf(bySlug(slug), pid);
    if (!p || p.state === next) return;
    if (ENDED.has(next) && !confirm(`「${STATES[next].label}」にします。`)) return;
    const note = next === "todo" && ENDED.has(p.state) ? "選考中に戻した" : `「${STATES[next].label}」にした`;
    return updateProgram(slug, pid, { state: next }, note);
  }
  if (t.dataset.step) {
    const [slug, pid, i] = t.dataset.step.split(":");
    const p = programOf(bySlug(slug), pid);
    const step = p.flow[Number(i)];
    if (p.step === step) return;
    const patch = { step };
    if (p.state !== "todo") patch.state = "todo";
    return updateProgram(slug, pid, patch, `段階を「${step}」にした`);
  }
  if (t.dataset.pass) {
    const [slug, pid] = t.dataset.pass.split(":");
    const p = programOf(bySlug(slug), pid);
    const idx = flowIndex(p);
    if (p.state !== "todo" || idx < 0) {
      return updateProgram(slug, pid, { step: p.flow[0] || "", state: "todo" }, `応募した${p.flow[0] ? `（${p.flow[0]}）` : ""}`);
    }
    if (idx + 1 < p.flow.length) return updateProgram(slug, pid, { step: p.flow[idx + 1], state: "todo" }, `${p.flow[idx]}を通過した`, { closeStep: p.flow[idx] });
    return updateProgram(slug, pid, { state: "offer" }, `${p.flow[idx]}を通過して内定`, { closeStep: p.flow[idx] });
  }
}

// いまの段階を受け終えて、結果を待つ（段階は進めない）。日付が分かればその日に結果の予定を入れる
export async function markWaiting(slug, pid) {
  const c = bySlug(slug);
  const p = programOf(c, pid);
  if (!p) return;
  const day = isoToday();
  const label = c.programs.length > 1 ? `${p.title || p.kind}: ` : "";
  const text = `${label}${p.step || p.flow[0] || "選考"}を受けた（結果待ち）`;
  const lastAction = c.lastAction;
  // 受けた段階の締切・日程は済み
  const closing = stepKeys(c, pid, p.step);
  const isClosing = (e) => (e.program === pid || (!e.program && c.programs.length === 1)) && closing.includes(`${e.title} @ ${e.date}`);
  const ok = await commit(() => {
    const x = bySlug(slug);
    const q = programOf(x, pid);
    if (!q) return;
    q.waiting = true;
    q.waitingSince = day;
    for (const e of x.events) if (isClosing(e)) e.done = true;
    x.lastAction = day;
    if (x.history?.[0]?.text !== text || x.history[0].date !== day) x.history = [{ date: day, text }, ...(x.history || [])];
  }, `${c.name}: ${text}`, { quiet: true });
  render();
  if (!ok) return;
  undoable("結果待ちにしました", async () => {
    await commit(() => {
      const x = bySlug(slug);
      const q = programOf(x, pid);
      if (!q) return;
      delete q.waiting;
      delete q.waitingSince;
      for (const e of x.events) if (isClosing(e)) delete e.done;
      x.lastAction = lastAction;
      const i = (x.history || []).findIndex((h) => h.text === text && h.date === day);
      if (i >= 0) x.history.splice(i, 1);
    }, `${c.name}: 取り消し（${text}）`);
    render();
  }, ok);
}

// 結果の連絡の予定日を入れる（そのルートのまだ来ていない結果の予定は1つにまとめる）
export async function setResultDate(slug, pid, date) {
  const c = bySlug(slug);
  const p = programOf(c, pid);
  if (!p || !date) return;
  const title = `${p.step || p.flow[0] || "選考"}の結果`;
  await commit(() => {
    const x = bySlug(slug);
    if (!programOf(x, pid)) return;
    x.events = [...x.events.filter((e) => !(e.program === pid && e.kind === "result" && !e.done)), { title, date, program: pid, kind: "result" }];
  }, `${c.name}: ${title}の連絡予定を${date}に`);
  render();
}

// 企業ページで直接書き換えるもの: マイページ・やること・記録
export async function saveMypage(slug, mypage) {
  const c = bySlug(slug);
  if (!c) return;
  await commit(() => {
    const x = bySlug(slug);
    if (x) x.mypage = { ...mypage };
  }, `${c.name}: マイページを登録`);
  render();
}

// 企業として見送る（on）・やめる（off）。何度呼ばれても同じ結果になるように、日付は先に決める
export async function dropCompany(slug, on) {
  const c = bySlug(slug);
  if (!c) return;
  const day = isoToday();
  const old = c.dropped;
  const apply = (x, value, note) => {
    if (!x) return;
    if (value) x.dropped = value;
    else delete x.dropped;
    if (!x.history.some((h) => h.date === day && h.text === note)) x.history = [{ date: day, text: note }, ...x.history];
    x.lastAction = day;
  };
  const ok = await commit(() => apply(bySlug(slug), on ? day : null, on ? "企業として見送った（行かないと決めた）" : "企業の見送りをやめた"),
    `${c.name}: ${on ? "企業として見送り" : "見送りをやめる"}`, { quiet: on });
  render();
  if (ok && on) {
    undoable("見送りにしました", async () => {
      await commit(() => {
        const x = bySlug(slug);
        if (!x) return;
        if (old) x.dropped = old;
        else delete x.dropped;
        x.history = x.history.filter((h) => !(h.date === day && h.text === "企業として見送った（行かないと決めた）"));
      }, `${c.name}: 見送りの取り消し`);
      render();
    }, ok);
  }
}

export async function addTodo(slug, text) {
  const c = bySlug(slug);
  if (!c || !text) return;
  await commit(() => {
    const x = bySlug(slug);
    if (x && !x.todo.includes(text)) x.todo = [...x.todo, text];
  }, `${c.name}: やること「${text}」を追加`, { quiet: true });
  render();
}

export async function finishTodo(slug, text, { undo = true } = {}) {
  const c = bySlug(slug);
  if (!c) return;
  const at = c.todo.indexOf(text);
  const ok = await commit(() => {
    const x = bySlug(slug);
    if (x) x.todo = x.todo.filter((t) => t !== text);
  }, `${c.name}: やること「${text}」を済みに`, { quiet: undo });
  render();
  if (ok && undo) {
    undoable("済みにしました", async () => {
      await commit(() => {
        const x = bySlug(slug);
        if (x && !x.todo.includes(text)) x.todo.splice(Math.max(0, Math.min(at, x.todo.length)), 0, text);
      }, `${c.name}: やること「${text}」を戻す`);
      render();
    }, ok);
  }
}

export async function addRecord(slug, text, date = isoToday()) {
  const c = bySlug(slug);
  if (!c || !text) return;
  await commit(() => {
    const x = bySlug(slug);
    if (!x || x.history.some((h) => h.date === date && h.text === text)) return;
    // 新しい順に。過去の日付で書いたものは、その日の位置に入れる
    x.history = [{ date, text }, ...x.history].sort((a, b) => b.date.localeCompare(a.date));
    if (!x.lastAction || date > x.lastAction) x.lastAction = date;
  }, `${c.name}: ${text}`);
  render();
}
