// 企業ページの編集・追加のモーダル。どれも「その箇所だけ」を書き換える
// ボタンの data-modal="<種類>:<slug>[:<対象>]" で開き、form[data-m] の送信で保存する。
// 保存の apply は slug で企業を引いて書き換える（別の端末と競合しても当て直せるように）

import { INDUSTRIES, PRIORITY_LABEL } from "../config.js";
import { commit, newId } from "../data.js";
import { addDays, isoOf, isoToday, today } from "../dates.js";
import { esc } from "../md.js";
import { bySlug, programOf, resultEvent } from "../model.js";
import { render } from "../render.js";
import { toast } from "../toast.js";
import { eventFieldset, programFieldset, readEvent } from "./edit.js";

function dialog() {
  let dlg = document.getElementById("modal");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "modal";
    dlg.className = "sheet-dialog modal";
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg || ev.target.closest("[data-close-modal]")) dlg.close();
    });
    document.body.append(dlg);
  }
  return dlg;
}

export const closeModal = () => document.getElementById("modal")?.close();

const shell = (title, sub, body, { submit = "保存する", extra = "" } = {}) => `
  <div class="sheet-inner">
    <div class="modal-head"><p class="sheet-title">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</p>
      <button type="button" class="modal-x" data-close-modal aria-label="閉じる">×</button></div>
    ${body.replace("</form>", `<div class="modal-actions"><button type="button" class="btn" data-close-modal>やめる</button><button class="btn primary" type="submit">${submit}</button></div>${extra}</form>`)}
  </div>`;

// 予定のフィールドは入力を必須にする（空のまま閉じないように）
const requiredEvent = (html) => html.replace('name="title"', 'name="title" required').replace('name="date"', 'name="date" required');

const builders = {
  basic(c) {
    return shell("基本情報", c.name, `<form data-m="basic" data-slug="${esc(c.slug)}">
      <label>会社名<input name="name" required value="${esc(c.name)}"></label>
      <div class="pf-row">
        <label>業界<input name="industry" list="m-industries" value="${esc(c.industry || "")}"></label>
        <label>志望度<select name="priority">${[3, 2, 1, 0].map((v) => `<option value="${v}"${v === (c.priority || 0) ? " selected" : ""}>${PRIORITY_LABEL[v] || "未設定"}</option>`).join("")}</select></label>
      </div>
      <datalist id="m-industries">${INDUSTRIES.map((i) => `<option value="${i}">`).join("")}</datalist>
      <label>新卒採用ページURL<input type="url" name="recruitUrl" value="${esc(c.recruitUrl || "")}" autocapitalize="off"></label>
      <label>初任給（修士・月額、円）<input type="number" name="salary" inputmode="numeric" value="${esc(c.salary || "")}"></label>
      <label>平均年収など（有価証券報告書の値と年度）<input name="avgSalary" value="${esc(c.avgSalary || "")}"></label>
    </form>`, { extra: `<button type="button" class="btn danger wide modal-del" data-delete="${esc(c.slug)}">この企業を削除</button>` });
  },
  login(c) {
    const m = c.mypage;
    return shell("マイページのログイン", c.name, `<form class="mp-form" data-mypage="${esc(c.slug)}">
      <label>マイページのURL<input type="url" name="url" value="${esc(m.url)}" autocapitalize="off"></label>
      <label>ID<input name="id" value="${esc(m.id)}" autocapitalize="off" autocomplete="off"></label>
      <label>パスワード<input name="password" value="${esc(m.password)}" autocapitalize="off" autocomplete="off"></label>
    </form>`);
  },
  prog(c, pid) {
    const p = programOf(c, pid);
    const fs = programFieldset(p || { id: newId(), kind: "インターン", title: "" })
      .replace(/<button type="button" class="mini danger" data-remove-fs>[^<]*<\/button>/, "");
    return shell(p ? "選考ルートを編集" : "選考ルートを追加", c.name, `<form data-m="prog" data-slug="${esc(c.slug)}" data-pid="${esc(p?.id || "")}">${fs}</form>`,
      { submit: p ? "保存する" : "追加する", extra: p && c.programs.length > 1 ? `<button type="button" class="btn danger wide modal-del" data-del-prog="${esc(c.slug)}:${esc(p.id)}">この選考ルートを削除</button>` : "" });
  },
  ev(c, arg) {
    // arg: 予定の番号、または new~<ルートの id>~<段階の番号>（段階の締切を入れるとき）
    const isNew = String(arg).startsWith("new");
    let e;
    if (isNew) {
      const [, pid = "", si = ""] = String(arg).split("~");
      const step = programOf(c, pid)?.flow[Number(si)];
      e = { program: pid, ...(si !== "" && step ? { step, title: `${step} 締切` } : {}) };
    } else e = c.events[Number(arg)];
    if (!e) return "";
    const fs = requiredEvent(eventFieldset(e, c.programs, false));
    return shell(isNew ? "予定を追加" : "予定を編集", c.name,
      `<form data-m="ev" data-slug="${esc(c.slug)}"${isNew ? "" : ` data-title="${esc(e.title)}" data-date="${esc(e.date)}"`}>${fs}</form>`,
      { submit: isNew ? "追加する" : "保存する", extra: isNew ? "" : `<button type="button" class="btn danger wide modal-del" data-del-ev="${esc(c.slug)}:${esc(arg)}">この予定を削除</button>` });
  },
  result(c, pid) {
    const p = programOf(c, pid);
    if (!p) return "";
    const r = resultEvent(c, pid);
    return shell("結果の連絡の予定日", `${c.name}　${p.step || p.title || ""}`, `<form class="result-form-m" data-result="${esc(c.slug)}:${esc(pid)}">
      <p class="hint">案内に「○日までに連絡」とあれば、その日を入れるとカレンダーに出ます。</p>
      <label>予定日<input type="date" name="date" required min="${isoOf(addDays(today(), -30))}" value="${esc(r?.date || "")}"></label>
    </form>`);
  },
  record(c) {
    return shell("記録を書く", c.name, `<form data-record="${esc(c.slug)}">
      <label>内容<textarea name="text" rows="3" required placeholder="例: 一次面接の手応え、結果は11/25までに連絡"></textarea></label>
      <label>日付<input type="date" name="date" value="${isoToday()}" required></label>
    </form>`, { submit: "書く" });
  },
  todo(c) {
    return shell("やることを追加", c.name, `<form data-todo="${esc(c.slug)}">
      <label>内容<input name="text" required placeholder="調べること・転記することなど"></label>
    </form>`, { submit: "追加する" });
  },
  memo(c) {
    return shell("メモ", c.name, `<form data-m="memo" data-slug="${esc(c.slug)}">
      <label>Markdown（調べたこと・出典・リンクなど）<textarea name="memo" rows="14">${esc(c.memo || "")}</textarea></label>
    </form>`);
  },
};

export function openModal(spec) {
  const [kind, slug, ...rest] = spec.split(":");
  const c = bySlug(slug);
  const html = c && builders[kind]?.(c, rest.join(":"));
  if (!html) return;
  const dlg = dialog();
  dlg.innerHTML = html;
  dlg.showModal();
  dlg.querySelector("input:not([type=hidden]):not([type=checkbox]), textarea")?.focus();
}

const fieldsOf = (form) => {
  const v = (n) => (form.querySelector(`[name="${n}"]`)?.value ?? "").trim();
  return v;
};

// form[data-m] の保存
export async function submitModal(form) {
  const slug = form.dataset.slug;
  const c = bySlug(slug);
  if (!c) return;
  const v = fieldsOf(form);
  const kind = form.dataset.m;
  if (kind === "basic") {
    const d = { name: v("name"), industry: v("industry"), priority: Number(v("priority")) || 0, recruitUrl: v("recruitUrl"), salary: v("salary") ? Number(v("salary")) : 0, avgSalary: v("avgSalary") };
    closeModal();
    await commit(() => {
      const x = bySlug(slug);
      if (!x) return;
      Object.assign(x, d);
      for (const k of ["salary", "avgSalary", "priority"]) if (!x[k]) delete x[k];
    }, `${d.name}: 基本情報を更新`);
  } else if (kind === "memo") {
    const memo = form.memo.value.trim();
    closeModal();
    await commit(() => { const x = bySlug(slug); if (x) x.memo = memo; }, `${c.name}: メモを更新`);
  } else if (kind === "prog") {
    const fs = form.querySelector("fieldset.pf");
    const f = (n) => fs.querySelector(`[name="${n}"]`).value.trim();
    const pid = form.dataset.pid || fs.dataset.pid || newId();
    const d = {
      kind: f("kind"), title: f("title") || f("kind"), status: f("status"), period: f("period"),
      flow: f("flow").split(/[、,，→]/).map((s) => s.trim()).filter(Boolean), process: f("process"), url: f("url"), entryUrl: f("entryUrl"),
    };
    const isNew = !form.dataset.pid;
    closeModal();
    await commit(() => {
      const x = bySlug(slug);
      if (!x) return;
      const q = programOf(x, pid);
      if (q) Object.assign(q, d);
      else x.programs = [...x.programs, { id: pid, ...d, state: "plan", step: "" }];
    }, `${c.name}: 選考ルート「${d.title}」を${isNew ? "追加" : "更新"}`);
    if (isNew) location.hash = `#/c/${slug}/${pid}`;
  } else if (kind === "ev") {
    const e = readEvent(form.querySelector("fieldset.ev"));
    const { title, date } = form.dataset;
    const isNew = title === undefined;
    if (c.events.some((y) => y.title === e.title && y.date === e.date && !(y.title === title && y.date === date))) {
      return toast("同じ日に同じ内容の予定がもうあります", true);
    }
    closeModal();
    await commit(() => {
      const x = bySlug(slug);
      if (!x) return;
      if (isNew) {
        if (!x.events.some((y) => y.title === e.title && y.date === e.date)) x.events = [...x.events, e];
        return;
      }
      const i = x.events.findIndex((y) => y.title === title && y.date === date);
      if (i >= 0) x.events[i] = e;
    }, `${c.name}: 予定「${e.title}」を${isNew ? "追加" : "更新"}`);
  }
  render();
}

// モーダルの中の削除ボタン（確かめてから）
export async function deleteFromModal(t) {
  if (t.dataset.delProg) {
    const [slug, pid] = t.dataset.delProg.split(":");
    const c = bySlug(slug);
    const p = programOf(c, pid);
    if (!p || !confirm(`選考ルート「${p.title || p.kind}」を削除します。このルートの予定は「ルートなし」になります。`)) return;
    closeModal();
    await commit(() => {
      const x = bySlug(slug);
      if (!x) return;
      x.programs = x.programs.filter((q) => q.id !== pid);
      for (const e of x.events) if (e.program === pid) delete e.program;
    }, `${c.name}: 選考ルート「${p.title || p.kind}」を削除`);
    location.hash = `#/c/${slug}`;
    return render();
  }
  if (t.dataset.delEv) {
    const [slug, i] = t.dataset.delEv.split(":");
    const c = bySlug(slug);
    const e = c?.events[Number(i)];
    if (!e || !confirm(`予定「${e.title}」を削除します。`)) return;
    const { title, date } = e;
    closeModal();
    await commit(() => {
      const x = bySlug(slug);
      if (x) x.events = x.events.filter((y) => !(y.title === title && y.date === date));
    }, `${c.name}: 予定「${title}」を削除`);
    return render();
  }
}
