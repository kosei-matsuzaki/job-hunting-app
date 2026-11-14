// 就活ボードの起動

import "./events.js";
import { loadCache, loadCompanies, loadDocList, saving } from "./data.js";
import { isDirty, render, route } from "./render.js";
import { cfg, state } from "./store.js";

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* なくても動く */ });
}

// アプリに戻ってきたとき、前の読み込みから2分以上たっていれば最新にする。
// 編集中（書きかけを描き直すと消える）と保存の途中（読み直した古い内容で保存中の変更が消える）は除く
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !cfg.token || !state.loaded) return;
  if (Date.now() - (state.loadedAt || 0) < 120000) return;
  const { parts, query } = route();
  if (["new", "add"].includes(parts[0]) || parts.includes("edit") || query.has("edit") || query.has("new")) return;
  if (isDirty() || saving()) return;
  const y = window.scrollY;
  await loadCompanies();
  render();
  window.scrollTo(0, y);
});

window.addEventListener("online", async () => {
  if (!state.offline || saving()) return;
  await loadCompanies();
  if (!isDirty()) render();
});

(async function start() {
  if (!cfg.token) return render();
  loadCache();
  render();
  await Promise.all([loadCompanies(), loadDocList().catch(() => {})]);
  render();
})();
