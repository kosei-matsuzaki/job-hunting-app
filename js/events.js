// 画面の操作を受け取る

import { markDone, statusClick, triage, undoable } from "./actions.js";
import { DEFAULT_FLOW, PRIORITY_LABEL } from "./config.js";
import { commit, DOC_KEY, loadCompanies, loadDocList, newId, normalize } from "./data.js";
import { daysUntil, isoToday } from "./dates.js";
import { explain, writeFile } from "./github.js";
import { downloadIcs } from "./ics.js";
import { esc } from "./md.js";
import { bySlug, liveEvents, programOf } from "./model.js";
import { $view, render, renderChrome } from "./render.js";
import { cfg, state, store, ui } from "./store.js";
import { copy, takeToastAction, toast } from "./toast.js";
import { openSheet } from "./views/company.js";
import { docName } from "./views/docs.js";
import { eventFieldset, programFieldset, readEvent, readForm } from "./views/edit.js";
import { viewLogin } from "./views/settings.js";

document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("button, [data-copy]");
  if (!t) return;
  if (t.hasAttribute("data-toast-action")) {
    const action = takeToastAction();
    if (action) await action.run();
    return;
  }
  if (t.hasAttribute("data-retry")) {
    state.error = null;
    await Promise.all([loadCompanies(), loadDocList().catch(() => {})]);
    return render();
  }
  if (t.dataset.jump) {
    document.getElementById(t.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (t.dataset.copy !== undefined) return copy(t.dataset.copy, t.dataset.copyLabel);
  if (t.dataset.done) return markDone(t.dataset.done);
  if (t.dataset.state || t.dataset.step || t.dataset.pass) return statusClick(t);
  if (t.dataset.sheet) return openSheet(t.dataset.sheet);
  if (t.dataset.triage) {
    const [slug, to] = t.dataset.triage.split(":");
    return triage(slug, to);
  }
  if (t.dataset.ctab) {
    ui.ctab = t.dataset.ctab;
    store.set("jh.ctab", ui.ctab);
    return render();
  }
  if (t.dataset.calall !== undefined) {
    ui.calAll = t.dataset.calall === "1";
    store.set("jh.calAll", ui.calAll ? "1" : "0");
    return render();
  }
  if (t.dataset.prio) {
    const [slug, n] = t.dataset.prio.split(":");
    const c = bySlug(slug);
    const v = c.priority === Number(n) ? 0 : Number(n);
    const old = c.priority || 0;
    const ok = await commit(() => { const x = bySlug(slug); if (x) x.priority = v; }, `${c.name}: 志望度を${PRIORITY_LABEL[v] || "未設定"}に`, { quiet: true });
    if (ok) undoable(`志望度を「${PRIORITY_LABEL[v] || "未設定"}」にしました`, () => commit(() => { const x = bySlug(slug); if (x) x.priority = old; }, `${c.name}: 志望度を戻す`), ok);
    return;
  }
  if (t.dataset.filter !== undefined) {
    ui.industry = t.dataset.filter;
    store.set("jh.industry", ui.industry);
    return render();
  }
  if (t.dataset.kind !== undefined && t.closest(".seg")) {
    ui.kind = t.dataset.kind;
    store.set("jh.kind", ui.kind);
    return render();
  }
  if (t.dataset.reveal !== undefined) {
    const shown = t.textContent !== "••••••";
    t.textContent = shown ? "••••••" : t.dataset.reveal;
    t.classList.toggle("shown", !shown);
    return;
  }
  if (t.dataset.ics) {
    const [slug, i] = t.dataset.ics.split(":");
    const c = bySlug(slug);
    const e = c.events[Number(i)];
    return downloadIcs(`${c.slug}-${e.date}.ics`, [{ e, c }]);
  }
  if (t.hasAttribute("data-ics-all")) {
    const items = liveEvents().filter((e) => daysUntil(e.date) >= 0).map((e) => ({ e, c: e.c }));
    if (!items.length) return toast("書き出す予定がありません", true);
    downloadIcs(`shukatsu-${isoToday()}.ics`, items);
    return toast(`${items.length}件の予定を書き出しました`);
  }
  if (t.hasAttribute("data-add-ev")) {
    const form = t.closest("form");
    const c = bySlug(form.dataset.slug);
    document.getElementById("events").insertAdjacentHTML("beforeend", eventFieldset({}, c?.programs || []));
    document.querySelector("#events fieldset:last-child .ev-title-in").focus();
    return;
  }
  if (t.hasAttribute("data-add-prog")) {
    document.getElementById("programs").insertAdjacentHTML("beforeend", programFieldset({ id: newId(), kind: "インターン", title: "", flow: DEFAULT_FLOW }));
    return;
  }
  if (t.hasAttribute("data-remove-fs")) return t.closest("fieldset").remove();
  if (t.dataset.delete) {
    const c = bySlug(t.dataset.delete);
    if (!confirm(`${c.name} を削除します。予定・ログイン情報・メモも消えます。`)) return;
    const slug = c.slug;
    if (await commit(() => { state.companies = state.companies.filter((x) => x.slug !== slug); }, `${c.name} を削除`)) {
      location.hash = "#/companies";
    }
    return;
  }
  if (t.dataset.newnote) {
    const c = bySlug(t.dataset.newnote);
    const path = `notes/${c.slug}.md`;
    // 形は profile/README.md の「ESの記録の仕方」
    const text = `# ${c.name}\n\n## 企業研究\n\n- \n\n## ES\n\n### 設問をここに書く\n\n> 種類: ガクチカ｜字数: 400字以内｜状態: 下書き｜ルート: 本選考｜話: E1\n\n## 面接\n\n## 参考\n`;
    t.disabled = true;
    try {
      const sha = await writeFile(path, text, null, `${c.name} のノートを作成`);
      state.docCache.set(path, { text, sha });
      state.docs.find((g) => g.dir === "notes").paths.push(path);
      location.hash = `#/doc/${encodeURIComponent(path)}/edit`;
    } catch (e) {
      toast(explain(e), true);
      t.disabled = false;
    }
    return;
  }
  if (t.id === "reload") {
    state.docCache.clear();
    await Promise.all([loadCompanies(), loadDocList().catch(() => {})]);
    render();
    if (!state.error) toast("最新の内容にしました");
    return;
  }
  if (t.hasAttribute("data-logout")) {
    if (!confirm("この端末からトークンとデータの控えを削除します。")) return;
    ["jh.token", "jh.cache", "jh.repo", "jh.doclist", "jh.industry", "jh.kind"].forEach((k) => store.del(k));
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(DOC_KEY)).forEach((k) => store.del(k));
    } catch { /* noop */ }
    location.hash = "";
    location.reload();
  }
});

// ホームの件数から、そのタブを開いた企業一覧へ
document.addEventListener("click", (ev) => {
  const a = ev.target.closest("[data-goto-tab]");
  if (!a) return;
  ui.ctab = a.dataset.gotoTab;
  store.set("jh.ctab", ui.ctab);
}, true);

document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.dataset.toggle) return markDone(t.dataset.toggle, t.checked);
  // 予定の追加: 企業を選んだら、その企業の選考ルートを選べるようにする
  if (t.name === "company" && t.closest("#addev")) {
    const c = bySlug(t.value);
    const sel = t.closest("form").querySelector('[name="program"]');
    sel.innerHTML = `<option value="">指定なし</option>${(c?.programs || [])
      .map((p) => `<option value="${esc(p.id)}">${esc(p.kind)}：${esc(p.title || p.kind)}</option>`)
      .join("")}`;
  }
});

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const button = form.querySelector('[type="submit"]');

  if (form.id === "login" || form.id === "settings") {
    const fd = new FormData(form);
    const token = String(fd.get("token") || "").trim();
    const repo = String(fd.get("repo") || cfg.repo).trim();
    if (token) cfg.token = token;
    cfg.repo = repo;
    button.disabled = true;
    state.error = null;
    await loadCompanies();
    button.disabled = false;
    if (state.error) {
      if (form.id === "login") {
        cfg.token = null;
        renderChrome();
        $view().innerHTML = viewLogin(state.error);
        state.error = null;
      } else {
        toast(state.error, true);
      }
      return;
    }
    store.set("jh.token", cfg.token);
    store.set("jh.repo", cfg.repo);
    loadDocList().then(render).catch(() => {});
    location.hash = "#/home";
    render();
    return;
  }

  if (form.id === "edit") {
    const data = readForm(form);
    if (data.events.some((e) => !e.date || !e.title)) return toast("予定には内容と日付の両方を入れてください", true);
    const slug = form.dataset.slug || data.slug;
    const isNew = !form.dataset.slug;
    if (isNew && bySlug(slug)) return toast(`識別名「${slug}」はもう使われています`, true);
    delete data.slug;
    button.disabled = true;
    const saved = await commit(() => {
      let c = bySlug(slug);
      if (!c) {
        c = normalize({ slug, name: data.name, programs: [], history: [{ date: isoToday(), text: "追加した" }] });
        state.companies.push(c);
      }
      // 状況と段階はフォームにないので、同じ id の選考ルートから引き継ぐ
      const programs = data.programs.map((p) => {
        const old = programOf(c, p.id);
        return { ...p, state: old?.state || "watch", step: old?.step || "" };
      });
      Object.assign(c, structuredClone({ ...data, programs }));
      if (!c.salary) delete c.salary;
      if (!c.avgSalary) delete c.avgSalary;
      if (!c.priority) delete c.priority;
    }, `${data.name} を${isNew ? "追加" : "更新"}`);
    if (saved) location.hash = `#/c/${slug}`;
    button.disabled = false;
    return;
  }

  if (form.id === "addev") {
    const c = bySlug(form.company.value);
    const e = readEvent(form.querySelector("fieldset.ev"));
    if (!c) return toast("企業を選んでください", true);
    if (!e.title || !e.date) return toast("内容と日付の両方を入れてください", true);
    const slug = c.slug;
    button.disabled = true;
    const saved = await commit(() => {
      const x = bySlug(slug);
      if (x && !x.events.some((y) => y.title === e.title && y.date === e.date)) x.events = [...x.events, { ...e }];
    }, `${c.name}: 予定「${e.title}」を追加`);
    if (saved) location.hash = `#/calendar/${e.date}`;
    button.disabled = false;
    return;
  }

  if (form.id === "docedit") {
    const path = form.dataset.path;
    const text = form.querySelector("textarea").value;
    const doc = state.docCache.get(path);
    button.disabled = true;
    try {
      const sha = await writeFile(path, text, doc?.sha, `${docName(path)} を更新`);
      state.docCache.set(path, { text, sha });
      store.set(DOC_KEY + path, JSON.stringify({ text, sha }));
      toast("保存しました");
      location.hash = `#/doc/${encodeURIComponent(path)}`;
    } catch (e) {
      if (e.status === 409) {
        state.docCache.delete(path);
        toast("別の端末で更新されていました。編集内容をコピーしてから、読み込み直してください。", true);
      } else toast(explain(e), true);
      button.disabled = false;
    }
  }
});

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});
