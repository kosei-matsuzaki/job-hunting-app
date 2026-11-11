// 画面: ログイン情報

import { esc } from "../md.js";
import { isEnded } from "../model.js";
import { avatar, stars } from "../parts.js";
import { state } from "../store.js";

export function viewLogins() {
  const withLogin = state.companies
    .filter((c) => c.mypage.url || c.mypage.id || c.mypage.password)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  let html = `
    <header class="page-head"><h1 class="page-title">ログイン</h1>
    <p class="page-sub">パスワードは伏せたままコピーできます。押すと表示します。</p></header>
    <input id="lq" class="search-box" type="search" placeholder="企業名で探す" enterkeyhint="search">
    <ul class="login-list">`;
  for (const c of withLogin) {
    const m = c.mypage;
    html += `
      <li class="login-row">
        ${avatar(c, "sm")}
        <div class="lr-body">
          <a class="lr-name" href="#/c/${esc(c.slug)}">${esc(c.name)}</a>
          <span class="lr-cred">${m.id ? `<code>${esc(m.id)}</code>` : '<span class="hint">ID未登録</span>'}${m.password ? `<button class="pw-mask" data-reveal="${esc(m.password)}" aria-label="パスワードを表示">••••••</button>` : ""}</span>
        </div>
        <div class="lr-actions">
          ${m.url ? `<a class="mini" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">開く</a>` : `<a class="mini muted" href="#/c/${esc(c.slug)}/edit">URL</a>`}
          ${m.id ? `<button class="mini" data-copy="${esc(m.id)}" data-copy-label="ID">ID</button>` : ""}
          ${m.password ? `<button class="mini" data-copy="${esc(m.password)}" data-copy-label="パスワード">PW</button>` : ""}
        </div>
      </li>`;
  }
  html += `</ul>`;
  const missing = state.companies
    .filter((c) => !withLogin.includes(c) && !isEnded(c))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, "ja"));
  if (missing.length) {
    html += `<h2 class="sec">マイページ未登録<span class="count">${missing.length}</span></h2>
      <ul class="login-list unregistered">${missing
        .map((c) => `<li class="login-row">${avatar(c, "sm")}<div class="lr-body"><a class="lr-name" href="#/c/${esc(c.slug)}">${esc(c.name)}</a>${stars(c)}</div>
          <div class="lr-actions">${c.recruitUrl ? `<a class="mini" href="${esc(c.recruitUrl)}" target="_blank" rel="noopener noreferrer">採用</a>` : ""}<a class="mini" href="#/c/${esc(c.slug)}/edit">入力</a></div></li>`)
        .join("")}</ul>`;
  }
  return html;
}
