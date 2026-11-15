// 画面: 設定・接続

import { esc } from "../md.js";
import { cfg } from "../store.js";

export function viewSettings() {
  return `
    <header class="page-head"><h1 class="page-title">設定</h1></header>
    <form id="settings" class="sheet form-sheet">
      <label>データのリポジトリ<input name="repo" value="${esc(cfg.repo)}" autocapitalize="off"></label>
      <label>GitHub トークン（変更するときだけ入力）<input name="token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <button class="btn primary wide" type="submit">保存して読み込み直す</button>
    </form>
    <h2 class="sec">この端末から消す</h2>
    <p class="hint">トークンと、端末に残っている企業データ・素材の控えを削除します。</p>
    <button class="btn danger wide" data-logout>この端末からログアウト</button>`;
}

export function viewLogin(message = "") {
  return `
    <div class="login">
      <h1 class="login-title">就活ボード</h1>
      <p>データは非公開リポジトリ <code>${esc(cfg.repo)}</code> に置いてあります。読むために、この端末で一度だけ GitHub のトークンを入れてください。</p>
      <ol class="steps">
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">トークンの作成ページ</a>を開く</li>
        <li>Repository access で「Only select repositories」→ <code>job-hunting</code> だけを選ぶ</li>
        <li>Permissions の Contents を「Read and write」にして作成</li>
        <li>表示された <code>github_pat_…</code> を下に貼る</li>
      </ol>
      ${message ? `<p class="error">${esc(message)}</p>` : ""}
      <form id="login">
        <label>GitHub トークン<input name="token" type="password" required autocomplete="off" placeholder="github_pat_…"></label>
        <details><summary>リポジトリを変える</summary><label>リポジトリ<input name="repo" value="${esc(cfg.repo)}" autocapitalize="off"></label></details>
        <button class="btn primary wide" type="submit">接続する</button>
      </form>
    </div>`;
}
