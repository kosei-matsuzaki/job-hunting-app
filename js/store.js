// 端末内の保存と、アプリ全体で共有する状態

import { DEFAULT_REPO } from "./config.js";

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できない環境では毎回入力 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
};

export const cfg = {
  token: store.get("jh.token"),
  repo: store.get("jh.repo") || DEFAULT_REPO,
};

// 画面の一時的な状態（絞り込みなど）
export const ui = {
  industry: store.get("jh.industry") || "",
  kind: store.get("jh.kind") || "",
  ctab: store.get("jh.ctab") || "",
  sort: store.get("jh.sort") || "deadline",
  cq: "",
  q: "",
};

export const state = {
  companies: [],
  sha: null,
  loaded: false,
  loading: false,
  error: null,
  offline: false,
  docs: null,
  docsLoading: false,
  docCache: new Map(),
};
