// 保存を伴う操作（元に戻せる）

import { ENDED, IN_SELECTION, STATES } from "./config.js";
import { commit, MERGED } from "./data.js";
import { isoToday } from "./dates.js";
import { bySlug, flowIndex, programOf } from "./model.js";
import { render } from "./render.js";
import { toast } from "./toast.js";

// 一覧から「応募予定にする」「見送る」: 気になる状態のルートをまとめて変える
export async function triage(slug, to) {
  const c = bySlug(slug);
  if (!c) return;
  const targets = c.programs.filter((p) => p.state === "watch").map((p) => p.id);
  const ids = targets.length ? targets : c.programs.map((p) => p.id);
  const note = to === "plan" ? "応募予定にした" : "見送りにした";
  const ok = await commit(() => {
    const x = bySlug(slug);
    if (!x) return;
    for (const p of x.programs) if (ids.includes(p.id)) p.state = to;
    x.lastAction = isoToday();
    x.history = [{ date: isoToday(), text: note }, ...(x.history || [])];
  }, `${c.name}: ${note}`, { quiet: true });
  render();
  if (!ok) return;
  undoable(`${c.name}を${to === "plan" ? "応募予定" : "見送り"}にしました`, async () => {
    await commit(() => {
      const x = bySlug(slug);
      if (!x) return;
      for (const p of x.programs) if (ids.includes(p.id)) p.state = "watch";
      const i = (x.history || []).findIndex((h) => h.text === note);
      if (i >= 0) x.history.splice(i, 1);
    }, `${c.name}: 取り消し（${note}）`);
    render();
  }, ok);
}

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

async function updateProgram(slug, pid, patch, note) {
  const c = bySlug(slug);
  const p = programOf(c, pid);
  if (!p) return;
  const label = c.programs.length > 1 ? `${p.title || p.kind}: ` : "";
  const text = label + note;
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, p[k]]));
  const lastAction = c.lastAction;
  const ok = await commit(() => {
    const x = bySlug(slug);
    const q = programOf(x, pid);
    if (!q) return;
    Object.assign(q, patch);
    x.lastAction = isoToday();
    x.history = [{ date: isoToday(), text }, ...(x.history || [])];
  }, `${c.name}: ${text}`, { quiet: true });
  render();
  if (!ok) return;
  undoable(note, async () => {
    await commit(() => {
      const x = bySlug(slug);
      const q = programOf(x, pid);
      if (!q) return;
      Object.assign(q, before);
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
    const note = IN_SELECTION.has(next) && ENDED.has(p.state) ? "選考中に戻した" : `「${STATES[next].label}」にした`;
    return updateProgram(slug, pid, { state: next }, note);
  }
  if (t.dataset.step) {
    const [slug, pid, i] = t.dataset.step.split(":");
    const p = programOf(bySlug(slug), pid);
    const step = p.flow[Number(i)];
    if (p.step === step) return;
    const patch = { step };
    if (!IN_SELECTION.has(p.state)) patch.state = "todo";
    return updateProgram(slug, pid, patch, `段階を「${step}」にした`);
  }
  if (t.dataset.pass) {
    const [slug, pid] = t.dataset.pass.split(":");
    const p = programOf(bySlug(slug), pid);
    const idx = flowIndex(p);
    if (!IN_SELECTION.has(p.state) || idx < 0) {
      return updateProgram(slug, pid, { step: p.flow[0] || "", state: "todo" }, `応募した${p.flow[0] ? `（${p.flow[0]}）` : ""}`);
    }
    if (idx + 1 < p.flow.length) return updateProgram(slug, pid, { step: p.flow[idx + 1], state: "todo" }, `${p.flow[idx]}を通過した`);
    return updateProgram(slug, pid, { state: "offer" }, `${p.flow[idx]}を通過して内定`);
  }
}
