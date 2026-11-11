// 就活ボードの起動

import "./events.js";
import { loadCache, loadCompanies, loadDocList } from "./data.js";
import { render, route } from "./render.js";
import { cfg, state } from "./store.js";

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* なくても動く */ });
}

// アプリに戻ってきたとき、前の読み込みから2分以上たっていれば最新にする（編集中は除く）
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !cfg.token || !state.loaded) return;
  if (Date.now() - (state.loadedAt || 0) < 120000) return;
  const { parts } = route();
  if (["new", "add"].includes(parts[0]) || parts.includes("edit")) return;
  const y = window.scrollY;
  await loadCompanies();
  render();
  window.scrollTo(0, y);
});

window.addEventListener("online", async () => {
  if (!state.offline) return;
  await loadCompanies();
  render();
});

(async function start() {
  if (!cfg.token) return render();
  loadCache();
  render();
  await Promise.all([loadCompanies(), loadDocList().catch(() => {})]);
  render();
})();
