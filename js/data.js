// 企業データと素材の読み込み・保存

import { DATA_PATH, DOC_GROUPS, EXTRA_DOCS, OLD_STATES, STATES } from "./config.js";
import { explain, listDocs, readFile, writeFile } from "./github.js";
import { render, renderChrome } from "./render.js";
import { cfg, state, store } from "./store.js";
import { toast } from "./toast.js";

export const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// 古い形（会社ごとに状況を1つだけ持つ・以前の状況の名前・リンクの欄）のデータも、いまの形にそろえる
export function normalize(c) {
  c.events ||= [];
  c.todo ||= [];
  c.history ||= [];
  c.memo ||= "";
  c.mypage ||= { url: "", id: "", password: "" };
  // リンクの欄はメモの末尾に移す
  if (c.links?.length) {
    const list = c.links.map((l) => `- [${l.label || l.url}](${l.url})`).join("\n");
    c.memo = `${c.memo.trim()}\n\nリンク:\n${list}`.trim();
  }
  delete c.links;
  if (!Array.isArray(c.programs)) {
    const kind = c.track || "本選考";
    c.programs = [{
      id: "p1", kind, title: kind, url: "", entryUrl: "", period: "",
      flow: c.flow || [], process: "", status: "不明", state: c.state || "plan", step: c.step || "",
    }];
    delete c.track;
    delete c.state;
    delete c.step;
    delete c.flow;
  }
  for (const p of c.programs) {
    p.id ||= newId();
    p.flow ||= [];
    p.state = OLD_STATES[p.state] || p.state;
    p.state = STATES[p.state] ? p.state : "plan";
    p.step ||= "";
  }
  return c;
}

export function loadCache() {
  try {
    const c = JSON.parse(store.get("jh.cache") || "null");
    if (c?.repo === cfg.repo) {
      state.companies = c.companies.map(normalize);
      state.sha = c.sha;
      state.loaded = true;
    }
  } catch { /* キャッシュが壊れていたら無視 */ }
}

function saveCache() {
  store.set("jh.cache", JSON.stringify({ repo: cfg.repo, companies: state.companies, sha: state.sha }));
}

export async function loadCompanies() {
  state.loading = true;
  renderChrome();
  try {
    const { text, sha } = await readFile(DATA_PATH);
    state.companies = (JSON.parse(text).companies || []).map(normalize);
    state.sha = sha;
    state.loaded = true;
    state.loadedAt = Date.now();
    state.error = null;
    state.offline = false;
    saveCache();
  } catch (e) {
    state.error = explain(e);
    state.offline = e instanceof TypeError && state.loaded;
  } finally {
    state.loading = false;
  }
}

// 変更を当てて保存する。別の端末が先に保存していたら、最新を読み直して同じ変更を当て直す。
// apply は state.companies を slug で引いて書き換える関数（何度呼ばれても同じ結果になるように書く）。
// 保存は1つずつ順に行う（続けて押したとき、前の保存の途中の内容に次の変更を重ねて食い違わないように）
let queue = Promise.resolve();
export function commit(apply, message, opts) {
  const run = queue.then(() => commitNow(apply, message, opts));
  queue = run.catch(() => {});
  return run;
}

// 保存の途中でないか（裏での読み直しは、保存が終わるまで待つ）
export const saving = () => state.saving > 0;
export const idle = () => queue;

// keepView: フォームから保存するときは描き直さない（保存できなかったとき、書いた内容を消さないように）
async function commitNow(apply, message, { quiet = false, keepView = false } = {}) {
  // 失敗したら、内容と sha の両方を保存前に戻す（sha だけ新しいと、次の保存で別の端末の変更を上書きしてしまう）
  const snapshot = { companies: JSON.stringify(state.companies), sha: state.sha };
  state.saving = (state.saving || 0) + 1;
  apply();
  if (!keepView) render();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const text = JSON.stringify({ companies: state.companies }, null, 2) + "\n";
        state.sha = await writeFile(DATA_PATH, text, state.sha, message);
        saveCache();
        if (!quiet || attempt) toast(attempt ? "別の端末の変更と合わせて保存しました" : "保存しました");
        return attempt ? MERGED : true;
      } catch (err) {
        let e = err;
        if ((e.status === 409 || e.status === 422) && attempt < 2) {
          try {
            const latest = await readFile(DATA_PATH);
            state.companies = (JSON.parse(latest.text).companies || []).map(normalize);
            state.sha = latest.sha;
            apply();
            continue;
          } catch (reloadError) {
            e = reloadError;
          }
        }
        state.companies = JSON.parse(snapshot.companies);
        state.sha = snapshot.sha;
        if (!keepView) render();
        toast(`${explain(e)}（変更は保存されていません）`, true);
        return false;
      }
    }
  } finally {
    state.saving--;
  }
}

// 素材は一度開いたら端末に残し、電波がないときはそれを出す
export const DOC_KEY = "jh.doc:";

export async function loadDocList() {
  try {
    state.docs = await Promise.all(DOC_GROUPS.map(async (g) => ({ ...g, paths: await listDocs(g.dir) })));
    store.set("jh.doclist", JSON.stringify(state.docs));
  } catch (e) {
    const cached = store.get("jh.doclist");
    if (!cached) throw e;
    state.docs = JSON.parse(cached);
  }
}

export async function getDoc(path, fresh = false) {
  if (!fresh && state.docCache.has(path)) return state.docCache.get(path);
  try {
    const doc = await readFile(path);
    state.docCache.set(path, doc);
    store.set(DOC_KEY + path, JSON.stringify(doc));
    return doc;
  } catch (e) {
    const cached = store.get(DOC_KEY + path);
    if (e.status || !cached) throw e;
    const doc = { ...JSON.parse(cached), offline: true };
    state.docCache.set(path, doc);
    return doc;
  }
}

// 素材の一部を書き換えて保存する。別の端末が先に保存していたら、最新を読み直して transform を当て直す
export async function saveDoc(path, transform, message) {
  let doc = await getDoc(path);
  for (let attempt = 0; ; attempt++) {
    const text = transform(doc.text);
    try {
      const sha = await writeFile(path, text, doc.sha, message);
      doc = { text, sha };
      state.docCache.set(path, doc);
      store.set(DOC_KEY + path, JSON.stringify(doc));
      return doc;
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && attempt < 2) {
        doc = await getDoc(path, true);
        continue;
      }
      throw e;
    }
  }
}

// 素材をすべて読み込む（素材の一覧と検索で使う）。新しく読んだものがあれば true
let loadingAll = null;
export function loadAllDocs() {
  if (!state.docs) return Promise.resolve(false);
  if (loadingAll) return loadingAll;
  const paths = [...state.docs.flatMap((g) => g.paths), ...EXTRA_DOCS.map((d) => d.path)].filter((p) => !state.docCache.has(p));
  if (!paths.length) return Promise.resolve(false);
  state.docsLoading = true;
  loadingAll = Promise.all(paths.map((p) => getDoc(p).catch(() => null))).then(() => {
    state.docsLoading = false;
    loadingAll = null;
    return true;
  });
  return loadingAll;
}

// 新しく作ったファイルを素材の一覧に足す（端末の控えも）
export function addDocPath(dir, path) {
  const g = state.docs?.find((x) => x.dir === dir);
  if (!g || g.paths.includes(path)) return;
  g.paths.push(path);
  store.set("jh.doclist", JSON.stringify(state.docs));
}

export const hasNote = (slug) => state.docs?.find((g) => g.dir === "notes")?.paths.includes(`notes/${slug}.md`);

// commit が別の端末の変更と合わせて保存したときの戻り値（真として扱える）
export const MERGED = 2;
