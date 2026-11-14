// 画面: 企業の編集・予定の追加

import { DEFAULT_FLOW, EVENT_KINDS, INDUSTRIES, KINDS, OPEN_STATUSES, PRIORITY_LABEL } from "../config.js";
import { newId, normalize } from "../data.js";
import { esc } from "../md.js";
import { bySlug, isEnded } from "../model.js";
import { ICONS } from "../parts.js";
import { state } from "../store.js";

export function programFieldset(p = {}) {
  return `
    <fieldset class="pf" data-pid="${esc(p.id || "")}">
      <div class="pf-row">
        <label>種類<select name="kind">${KINDS.map((k) => `<option${k === (p.kind || "本選考") ? " selected" : ""}>${k}</option>`).join("")}</select></label>
        <label>受付状況<select name="status">${OPEN_STATUSES.map((k) => `<option${k === (p.status || "不明") ? " selected" : ""}>${k}</option>`).join("")}</select></label>
      </div>
      <label>名前<input name="title" value="${esc(p.title || "")}" placeholder="例: エンジニア職 本選考 / 冬季インターン"></label>
      <label>受付期間・時期<input name="period" value="${esc(p.period || "")}" placeholder="例: 2026/10/1〜通年"></label>
      <label>選考フロー（「、」区切り。1つずつ段階の欄になる）<input name="flow" value="${esc((p.flow?.length ? p.flow : DEFAULT_FLOW).join("、"))}"></label>
      <label>選考プロセスの説明<textarea name="process" rows="3">${esc(p.process || "")}</textarea></label>
      <label>募集ページURL<input type="url" name="url" value="${esc(p.url || "")}" autocapitalize="off"></label>
      <label>エントリーURL<input type="url" name="entryUrl" value="${esc(p.entryUrl || "")}" autocapitalize="off"></label>
      <button type="button" class="mini danger" data-remove-fs>この選考ルートを削除</button>
    </fieldset>`;
}

export function eventFieldset(e = {}, programs = [], removable = true) {
  return `
    <fieldset class="ev">
      <input class="ev-title-in" name="title" placeholder="内容（例: ES提出締切）" value="${esc(e.title || "")}">
      <label>種類<select name="kind">${EVENT_KINDS.map((k) => `<option value="${k.v}"${k.v === (e.kind || "deadline") ? " selected" : ""}>${k.label}</option>`).join("")}</select></label>
      <label>選考ルート<select name="program"><option value="">指定なし</option>${programs
        .map((p) => `<option value="${esc(p.id)}"${p.id === e.program ? " selected" : ""}>${esc(p.kind)}：${esc(p.title || p.kind)}</option>`)
        .join("")}</select></label>
      <label>日付（締切・当日）<input type="date" name="date" value="${esc(e.date || "")}"></label>
      <label>時刻<input type="time" name="time" value="${esc(e.time || "")}"></label>
      <label>開始日（期間のときだけ）<input type="date" name="start" value="${esc(e.start || "")}"></label>
      <label>開始時刻<input type="time" name="startTime" value="${esc(e.startTime || "")}"></label>
      <label class="check"><input type="checkbox" name="tentative"${e.tentative ? " checked" : ""}>日付は目安</label>
      <label class="check"><input type="checkbox" name="done"${e.done ? " checked" : ""}>済み</label>
      ${removable ? `<button type="button" class="mini danger" data-remove-fs>この予定を削除</button>` : ""}
    </fieldset>`;
}

export function viewEdit(slug) {
  const isNew = !slug;
  const c = isNew ? normalize({ name: "", programs: [{ id: newId(), kind: "本選考", title: "本選考", flow: DEFAULT_FLOW, status: "不明" }] }) : bySlug(slug);
  if (!c) return `<p class="empty">この企業は見つかりません。</p>`;
  const m = c.mypage;
  return `
    <a class="back" href="${isNew ? "#/companies" : `#/c/${esc(c.slug)}`}">${isNew ? "企業" : esc(c.name)}</a>
    <h1 class="page-title">${isNew ? "企業を追加" : "編集"}</h1>
    <form id="edit" data-slug="${esc(c.slug || "")}">
      <section class="sheet form-sheet">
        <label>会社名<input name="name" required value="${esc(c.name || "")}"></label>
        ${isNew ? `<label>英字の識別名（ノートのファイル名になる。例: capcom）<input name="slug" required pattern="[a-z0-9-]+" autocapitalize="off"></label>` : ""}
        <div class="pf-row">
          <label>業界<input name="industry" list="industries" value="${esc(c.industry || "")}"></label>
          <label>志望度<select name="priority">${[3, 2, 1, 0].map((v) => `<option value="${v}"${v === (c.priority || 0) ? " selected" : ""}>${PRIORITY_LABEL[v] || "未設定"}</option>`).join("")}</select></label>
        </div>
        <datalist id="industries">${INDUSTRIES.map((i) => `<option value="${i}">`).join("")}</datalist>
        <label>新卒採用ページURL<input type="url" name="recruitUrl" value="${esc(c.recruitUrl || "")}" autocapitalize="off"></label>
        <label>初任給（修士・月額、円）<input type="number" name="salary" inputmode="numeric" value="${esc(c.salary || "")}"></label>
        <label>平均年収など（有価証券報告書の値と年度）<input name="avgSalary" value="${esc(c.avgSalary || "")}"></label>
      </section>

      <h2 class="sec">マイページ</h2>
      <section class="sheet form-sheet">
        <label>URL<input type="url" name="mpUrl" value="${esc(m.url || "")}" autocapitalize="off"></label>
        <label>ID<input name="mpId" value="${esc(m.id || "")}" autocapitalize="off" autocomplete="off"></label>
        <label>パスワード<input name="mpPassword" value="${esc(m.password || "")}" autocapitalize="off" autocomplete="off"></label>
      </section>

      <h2 class="sec">選考ルート</h2>
      <p class="hint">本選考とインターンなど、選考が分かれているものはルートを分けます。状況と段階は企業ページで変えます。</p>
      <div id="programs">${c.programs.map(programFieldset).join("")}</div>
      <button type="button" class="btn ghost wide" data-add-prog>${ICONS.plus}選考ルートを追加</button>

      <h2 class="sec">予定</h2>
      <div id="events">${c.events.map((e) => eventFieldset(e, c.programs)).join("")}</div>
      <button type="button" class="btn ghost wide" data-add-ev>${ICONS.plus}予定を追加</button>

      <h2 class="sec">そのほか</h2>
      <section class="sheet form-sheet">
        <label>メモ（Markdown。調べたこと・出典・リンクなど）<textarea name="memo" rows="10">${esc(c.memo || "")}</textarea></label>
        <label>やること（1行に1つ。企業ページでチェックすると消える）<textarea name="todo" rows="3">${esc(c.todo.join("\n"))}</textarea></label>
      </section>

      <div class="form-actions">
        <button class="btn primary wide" type="submit">保存する</button>
        ${isNew ? "" : `<button type="button" class="btn danger wide" data-delete="${esc(c.slug)}">この企業を削除</button>`}
      </div>
    </form>`;
}

export function readEvent(fs) {
  const v = (n) => fs.querySelector(`[name="${n}"]`);
  const e = { title: v("title").value.trim(), date: v("date").value };
  if (["event", "result"].includes(v("kind")?.value)) e.kind = v("kind").value;
  if (v("program")?.value) e.program = v("program").value;
  if (v("time").value) e.time = v("time").value;
  if (v("start").value) e.start = v("start").value;
  if (v("startTime").value) e.startTime = v("startTime").value;
  if (v("tentative").checked) e.tentative = true;
  if (v("done").checked) e.done = true;
  return e;
}

export function readForm(form) {
  const fd = new FormData(form);
  const get = (k) => String(fd.get(k) ?? "").trim();
  const lines = (k) => get(k).split("\n").map((s) => s.trim()).filter(Boolean);
  const programs = [...form.querySelectorAll("fieldset.pf")].map((fs) => {
    const v = (n) => fs.querySelector(`[name="${n}"]`).value.trim();
    return {
      id: fs.dataset.pid || newId(),
      kind: v("kind"),
      title: v("title") || v("kind"),
      status: v("status"),
      period: v("period"),
      flow: v("flow").split(/[、,，→]/).map((s) => s.trim()).filter(Boolean),
      process: v("process"),
      url: v("url"),
      entryUrl: v("entryUrl"),
    };
  });
  return {
    name: get("name"),
    slug: get("slug"),
    industry: get("industry"),
    priority: Number(get("priority")) || 0,
    recruitUrl: get("recruitUrl"),
    salary: get("salary") ? Number(get("salary")) : null,
    avgSalary: get("avgSalary"),
    mypage: { url: get("mpUrl"), id: get("mpId"), password: get("mpPassword") },
    programs,
    events: [...form.querySelectorAll("fieldset.ev")].map(readEvent).filter((e) => e.title || e.date),
    todo: lines("todo"),
    memo: get("memo"),
  };
}

export function viewAddEvent(date, slug) {
  // 企業ページから来たときは、終了した企業でもその企業を選べるようにする
  const options = [...state.companies]
    .filter((c) => !isEnded(c) || c.slug === slug)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    .map((c) => `<option value="${esc(c.slug)}"${c.slug === slug ? " selected" : ""}>${esc(c.name)}</option>`)
    .join("");
  const c = bySlug(slug);
  const back = c ? `<a class="back" href="#/c/${esc(c.slug)}">${esc(c.name)}</a>` : `<a class="back" href="#/calendar${date ? `/${esc(date)}` : ""}">予定</a>`;
  return `
    ${back}
    <h1 class="page-title">予定を追加</h1>
    <form id="addev"${c ? ' data-from="company"' : ""}>
      <label>企業<select name="company" required><option value="">選んでください</option>${options}</select></label>
      ${eventFieldset({ date: date || "" }, c?.programs || [], false)}
      <button class="btn primary wide" type="submit">追加する</button>
      <p class="hint">ここにない企業は、先に「企業」タブで追加してください。</p>
    </form>`;
}
