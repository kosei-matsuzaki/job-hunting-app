// 画面の操作を受け取る

import { addRecord, addTodo, finishTodo, markDone, saveMypage, setResultDate, statusClick, undoable } from "./actions.js";
import { DEFAULT_FLOW, FINALS_DIR, PRIORITY_LABEL } from "./config.js";
import { addDocPath, commit, DOC_KEY, idle, loadCompanies, loadDocList, newId, normalize, saveDoc } from "./data.js";
import { daysUntil, isoToday } from "./dates.js";
import { explain, writeFile } from "./github.js";
import { downloadIcs } from "./ics.js";
import { esc } from "./md.js";
import { bySlug, liveEvents, programOf } from "./model.js";
import { $view, isDirty, render, renderChrome } from "./render.js";
import { cfg, state, store, ui } from "./store.js";
import { copy, takeToastAction, toast } from "./toast.js";
import { openSheet } from "./views/company.js";
import { docName, replaceSection } from "./views/docs.js";
import { finalPath, finalPaths, newFinalText, parseFinal, removeVersion, setVersion } from "./finals.js";
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
  if (t.dataset.ctab) {
    ui.ctab = t.dataset.ctab;
    ui.cq = "";
    store.set("jh.ctab", ui.ctab);
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
  if (t.matches("[data-add-ev], [data-add-prog], [data-remove-fs]")) t.closest("form")?.setAttribute("data-dirty", "");
  if (t.hasAttribute("data-add-ev")) {
    // 選考ルートはフォームにいま並んでいるもの（追加したばかりで未保存のルートも選べるように）
    const programs = [...t.closest("form").querySelectorAll("fieldset.pf")].map((fs) => ({
      id: fs.dataset.pid,
      kind: fs.querySelector('[name="kind"]').value,
      title: fs.querySelector('[name="title"]').value.trim(),
    }));
    document.getElementById("events").insertAdjacentHTML("beforeend", eventFieldset({}, programs));
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
      addDocPath("notes", path);
      location.hash = `#/doc/${encodeURIComponent(path)}/edit`;
    } catch (e) {
      toast(explain(e), true);
      t.disabled = false;
    }
    return;
  }
  // 確定版のテーマを足す
  if (t.hasAttribute("data-newtheme")) {
    const name = (prompt("テーマの名前（例: インターン、チェスAI、なぜゲーム業界か）") || "").trim().replace(/[\\/:*?"<>|#]/g, "");
    if (!name) return;
    const path = finalPath(name);
    if (finalPaths().includes(path)) return void (location.hash = `#/docs/final/${encodeURIComponent(name)}`);
    const text = newFinalText(name);
    t.disabled = true;
    try {
      const sha = await writeFile(path, text, null, `確定版: テーマ「${name}」を追加`);
      state.docCache.set(path, { text, sha });
      addDocPath("profile", path);
      location.hash = `#/docs/final/${encodeURIComponent(name)}`;
      toast("テーマを足しました。「話・種類・説明を直す」で、使う設問の種類を決めてください");
    } catch (e) {
      toast(explain(e), true);
      t.disabled = false;
    }
    return;
  }
  if (t.hasAttribute("data-delversion")) {
    const form = t.closest("form");
    const head = form.dataset.old;
    if (!confirm(`「${head}」を消します。`)) return;
    t.disabled = true;
    try {
      await saveDoc(form.dataset.path, (text) => removeVersion(text, head), `確定版: ${form.dataset.file}「${head}」を削除`);
      toast("消しました");
      location.hash = `#/docs/final/${encodeURIComponent(form.dataset.file)}`;
    } catch (e) {
      toast(explain(e), true);
      t.disabled = false;
    }
    return;
  }
  if (t.id === "reload") {
    if (isDirty() && !confirm(LEAVE)) return;
    await idle(); // 保存の途中なら、終わってから読み直す
    state.docCache.clear();
    await Promise.all([loadCompanies(), loadDocList().catch(() => {})]);
    render();
    if (!state.error) toast("最新の内容にしました");
    return;
  }
  if (t.hasAttribute("data-logout")) {
    if (!confirm("この端末からトークンとデータの控えを削除します。")) return;
    ["jh.token", "jh.cache", "jh.repo", "jh.doclist", "jh.industry", "jh.kind", "jh.ctab", "jh.sort", "jh.calAll"].forEach((k) => store.del(k));
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(DOC_KEY)).forEach((k) => store.del(k));
    } catch { /* noop */ }
    location.hash = "";
    location.reload();
  }
});

// 書きかけのまま別の画面へ移ると消えるので、確かめる
const LEAVE = "書きかけの内容は保存されていません。破棄して移動しますか？";
const markDirty = (ev) => {
  const form = ev.target.closest?.("#view form");
  if (form && !["login", "settings"].includes(form.id)) form.setAttribute("data-dirty", "");
};
document.addEventListener("input", markDirty);
document.addEventListener("change", markDirty, true);
document.addEventListener("click", (ev) => {
  const a = ev.target.closest('a[href^="#"]');
  if (!a || !isDirty() || a.getAttribute("href") === location.hash) return;
  if (!confirm(LEAVE)) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
  } else {
    document.querySelectorAll("#view form[data-dirty]").forEach((f) => f.removeAttribute("data-dirty"));
  }
}, true);
window.addEventListener("beforeunload", (ev) => {
  if (isDirty()) ev.preventDefault();
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
  if (t.dataset.todoDone) return finishTodo(t.dataset.todoDone, t.value);
  // 予定の追加: 企業を選んだら、その企業の選考ルートを選べるようにする
  if (t.name === "company" && t.closest("#addev")) {
    const c = bySlug(t.value);
    const sel = t.closest("form").querySelector('[name="program"]');
    sel.innerHTML = `<option value="">指定なし</option>${(c?.programs || [])
      .map((p) => `<option value="${esc(p.id)}">${esc(p.kind)}：${esc(p.title || p.kind)}</option>`)
      .join("")}`;
  }
});

// 送信中は書きかけの印を外す（保存して移動するときに確かめないように）。保存できずに同じ画面に残ったら戻す
document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const dirty = form.hasAttribute("data-dirty");
  const hash = location.hash;
  form.removeAttribute("data-dirty");
  try {
    await onSubmit(form);
  } finally {
    if (dirty && form.isConnected && location.hash === hash) form.setAttribute("data-dirty", "");
  }
});

async function onSubmit(form) {
  const button = form.querySelector('[type="submit"]');

  // 企業ページで直接書くもの
  if (form.dataset.mypage) {
    const fd = new FormData(form);
    const get = (k) => String(fd.get(k) ?? "").trim();
    return saveMypage(form.dataset.mypage, { url: get("url"), id: get("id"), password: get("password") });
  }
  if (form.dataset.result) {
    const [slug, pid] = form.dataset.result.split(":");
    button.disabled = true;
    return setResultDate(slug, pid, form.date.value);
  }
  if (form.dataset.todo || form.dataset.record) {
    const text = form.text.value.trim();
    if (!text) return;
    button.disabled = true;
    await (form.dataset.todo ? addTodo(form.dataset.todo, text) : addRecord(form.dataset.record, text));
    return;
  }

  if (form.id === "login" || form.id === "settings") {
    const fd = new FormData(form);
    const token = String(fd.get("token") || "").trim();
    const repo = String(fd.get("repo") || cfg.repo).trim();
    const prev = { token: cfg.token, repo: cfg.repo, companies: state.companies, sha: state.sha, loaded: state.loaded };
    if (token) cfg.token = token;
    cfg.repo = repo;
    button.disabled = true;
    state.error = null;
    await idle();
    await loadCompanies();
    button.disabled = false;
    if (state.error) {
      // つながらなかったら元の接続に戻す（違うリポジトリに古い内容を書き込まないように）
      Object.assign(cfg, { token: prev.token, repo: prev.repo });
      Object.assign(state, { companies: prev.companies, sha: prev.sha, loaded: prev.loaded });
      if (form.id === "login") {
        cfg.token = null;
        renderChrome();
        $view().innerHTML = viewLogin(state.error);
        state.error = null;
      } else {
        toast(state.error, true);
        state.error = null;
      }
      return;
    }
    store.set("jh.token", cfg.token);
    store.set("jh.repo", cfg.repo);
    if (repo !== prev.repo) state.docCache.clear();
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
        return { ...p, state: old?.state || "plan", step: old?.step || "" };
      });
      Object.assign(c, structuredClone({ ...data, programs }));
      if (!c.salary) delete c.salary;
      if (!c.avgSalary) delete c.avgSalary;
      if (!c.priority) delete c.priority;
    }, `${data.name} を${isNew ? "追加" : "更新"}`, { keepView: true });
    if (saved) location.hash = `#/c/${slug}`;
    button.disabled = false;
    return;
  }

  if (form.id === "addev") {
    const c = bySlug(form.company.value);
    const e = readEvent(form.querySelector("fieldset.ev"));
    if (!c) return toast("企業を選んでください", true);
    if (!e.title || !e.date) return toast("内容と日付の両方を入れてください", true);
    if (c.events.some((y) => y.title === e.title && y.date === e.date)) return toast("同じ日に同じ内容の予定がもうあります", true);
    const slug = c.slug;
    button.disabled = true;
    const saved = await commit(() => {
      const x = bySlug(slug);
      if (x && !x.events.some((y) => y.title === e.title && y.date === e.date)) x.events = [...x.events, { ...e }];
    }, `${c.name}: 予定「${e.title}」を追加`, { keepView: true });
    // 企業ページから来たら企業ページへ、カレンダーから来たらその日へ戻る
    if (saved) location.hash = form.dataset.from === "company" ? `#/c/${slug}` : `#/calendar/${e.date}`;
    button.disabled = false;
    return;
  }

  if (form.id === "finalform") {
    const { path, file, old } = form.dataset;
    const v = { head: form.head.value.trim().replace(/^#+\s*/, ""), body: form.body.value.trim(), memo: form.memo.value.trim() };
    if (!v.head || !v.body) return toast("見出しと本文を書いてください", true);
    const cur = state.docCache.get(path);
    if (v.head !== old && cur && parseFinal(path, cur).versions.some((x) => x.head === v.head)) return toast(`「${v.head}」はもうあります。別の見出しにしてください`, true);
    button.disabled = true;
    try {
      await saveDoc(path, (text) => setVersion(text, old, v), `確定版: ${file}「${v.head}」を${old ? "更新" : "追加"}`);
      toast("保存しました");
      location.hash = `#/docs/final/${encodeURIComponent(file)}`;
    } catch (e) {
      toast(explain(e), true);
      button.disabled = false;
    }
    return;
  }

  // 素材の見出し1つだけを直す
  if (form.id === "docedit" && form.dataset.sec) {
    const path = form.dataset.path;
    const k = Number(form.dataset.sec);
    const body = form.querySelector("textarea").value;
    button.disabled = true;
    try {
      await saveDoc(path, (text) => replaceSection(text, k, form.dataset.head, body), `${docName(path)} を更新`);
      toast("保存しました");
      ui.jump = k;
      location.hash = `#/doc/${encodeURIComponent(path)}`;
    } catch (e) {
      toast(e.status ? explain(e) : e.message, true);
      button.disabled = false;
    }
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
      location.hash = path.startsWith(`${FINALS_DIR}/`) ? `#/docs/final/${encodeURIComponent(path.split("/").pop().replace(/\.md$/, ""))}` : `#/doc/${encodeURIComponent(path)}`;
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        state.docCache.delete(path);
        toast("別の端末で更新されていました。編集内容をコピーしてから、読み込み直してください。", true);
      } else toast(explain(e), true);
      button.disabled = false;
    }
  }
}

// 戻るボタンなどで移るときも、書きかけがあれば確かめる（やめたら元の画面のまま）
let lastHash = location.hash;
window.addEventListener("hashchange", () => {
  if (isDirty() && !confirm(LEAVE)) {
    history.pushState(null, "", lastHash || "#/home");
    return;
  }
  // 企業ページの中で選考ルートを切り替えたときは、位置を保って開いたルートを見せる
  const same = (h) => h.match(/^#\/c\/([^/?]+)(?:\/([^/?]+))?$/);
  const a = same(lastHash);
  const b = same(location.hash);
  const inPage = a && b && a[1] === b[1] && a[2] !== "edit" && b[2] !== "edit";
  lastHash = location.hash;
  render();
  if (inPage) document.querySelector(".prog-list .is-open")?.scrollIntoView({ block: "nearest" });
  else window.scrollTo(0, 0);
});
