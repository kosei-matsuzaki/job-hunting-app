// 描画とルーティング

import { COMPANY_TABS } from "./config.js";
import { getDoc, hasNote, loadAllDocs } from "./data.js";
import { explain } from "./github.js";
import { esc } from "./md.js";
import { companyState } from "./model.js";
import { cfg, state, store, ui } from "./store.js";
import { viewCalendar } from "./views/calendar.js";
import { companyPool, companyRows, currentTab, searching, viewCompanies } from "./views/companies.js";
import { viewCompany } from "./views/company.js";
import { bindDocCounter, viewDoc, viewDocEdit, viewDocs, viewEpisode, viewTopic } from "./views/docs.js";
import { viewAddEvent, viewEdit } from "./views/edit.js";
import { viewHome } from "./views/home.js";
import { loadSearchDocs, searchResults, viewSearch } from "./views/search.js";
import { viewLogin, viewSettings } from "./views/settings.js";

export const $view = () => document.getElementById("view");

export function route() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  return { parts: (path || "home").split("/").map(decodeURIComponent), query: new URLSearchParams(query) };
}

export function renderChrome() {
  const [name, , sub] = route().parts;
  const tab = { c: "companies", new: "companies", doc: "docs", add: "calendar", schedule: "home" }[name] || name;
  document.querySelectorAll(".tabs a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.tab === tab));
  // 画面ごとに幅を変える（フォームや文章は読みやすい幅、一覧やダッシュボードは広く）
  $view().dataset.view = sub === "edit" ? "form" : { new: "form", add: "form", settings: "form", search: "form" }[name] || name || "home";
  document.getElementById("reload").classList.toggle("spinning", state.loading);
  document.body.classList.toggle("signed-out", !cfg.token);
}

export async function render() {
  // ログインの画面は企業の一覧にまとめた
  if (route().parts[0] === "logins") return void location.replace("#/companies");
  renderChrome();
  const view = $view();
  if (!cfg.token) {
    view.innerHTML = viewLogin();
    return;
  }
  if (!state.loaded) {
    view.innerHTML = state.error
      ? `<div class="error-panel"><p class="error">${esc(state.error)}</p><button class="btn primary wide" data-retry>もう一度読み込む</button></div>`
      : `<div class="skeleton" aria-label="読み込み中"><i></i><i></i><i></i><i></i></div>`;
    return;
  }
  const { parts, query } = route();
  const [name, arg, sub] = parts;
  let html;
  try {
    if (name === "calendar") html = viewCalendar(arg);
    else if (name === "companies") html = viewCompanies();
    else if (name === "c" && arg && sub === "edit") html = viewEdit(arg);
    else if (name === "c" && arg) html = viewCompany(arg, sub);
    else if (name === "new") html = viewEdit(null);
    else if (name === "add") html = viewAddEvent(arg, query.get("c"));
    else if (name === "docs") html = !arg ? viewDocs() : /^E\d+$/.test(arg) ? viewEpisode(arg) : viewTopic(arg, query);
    else if (name === "search") html = viewSearch();
    else if (name === "settings") html = viewSettings();
    else if (name === "doc") {
      view.innerHTML = `<p class="hint loading">読み込み中…</p>`;
      const doc = await getDoc(arg);
      if (route().parts[1] !== arg) return; // 読み込み中に別の画面へ移動した
      html = sub === "edit" ? viewDocEdit(arg, doc) : viewDoc(arg, doc);
    } else html = viewHome();
  } catch (e) {
    html = `<p class="error">${esc(e.status ? explain(e) : `表示できませんでした（${e.message}）`)}</p>`;
  }
  if (state.error) {
    html = (state.offline
      ? `<p class="offline">電波がないため、前回読み込んだ内容を表示しています。変更は保存できません。</p>`
      : `<p class="error">${esc(state.error)}</p>`) + html;
  }
  view.innerHTML = html;
  afterRender(name, sub, arg);
}

function afterRender(name, sub, arg) {
  // 素材の一覧は全部の素材の中身から作るので、まだ読んでいないものを読んでから描き直す
  if (name === "docs") document.querySelector(".topic-tabs [aria-current]")?.scrollIntoView({ block: "nearest", inline: "center" });
  // 企業ページのESの一覧はノートの中身から作る
  if (name === "c" && sub !== "edit" && hasNote(arg) && !state.docCache.has(`notes/${arg}.md`)) {
    getDoc(`notes/${arg}.md`).then(() => route().parts[1] === arg && render()).catch(() => {});
  }
  if (name === "docs") loadAllDocs().then((loaded) => loaded && route().parts[0] === "docs" && render());
  if (name === "doc" && sub === "edit") bindDocCounter();
  if (name === "search") {
    const box = document.getElementById("q");
    box.addEventListener("input", () => {
      ui.q = box.value;
      document.getElementById("results").innerHTML = searchResults(ui.q);
    });
    if (!ui.q) box.focus();
    loadSearchDocs();
  }
  if (name === "companies") {
    document.getElementById("co-sort").addEventListener("change", (ev) => {
      ui.sort = ev.target.value;
      store.set("jh.sort", ui.sort);
      document.getElementById("co-results").innerHTML = companyRows();
    });
    const box = document.getElementById("cq");
    box.addEventListener("input", () => {
      ui.cq = box.value;
      document.getElementById("co-results").innerHTML = companyRows();
      const pool = companyPool();
      document.querySelectorAll(".ctabs button").forEach((b) => {
        const t = COMPANY_TABS.find((x) => x.v === b.dataset.ctab);
        b.querySelector("span").textContent = pool.filter((c) => t.test(companyState(c))).length;
        b.setAttribute("aria-selected", !searching() && b.dataset.ctab === currentTab());
      });
    });
  }
}
