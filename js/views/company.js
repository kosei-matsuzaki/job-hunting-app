// 画面: 企業ページ

import { ENDED, KIND_CLASS, PRIORITY_LABEL, STATE_GROUPS, STATES } from "../config.js";
import { hasNote } from "../data.js";
import { daysUntil, fmtDate, remainText, urgency, whenText } from "../dates.js";
import { googleCalUrl } from "../ics.js";
import { esc, renderMarkdown } from "../md.js";
import { bySlug, byWhen, defaultProgram, flowIndex, hasLogin, isWaiting, nextEvent, programOf } from "../model.js";
import { avatar, eventTitle, ICONS, kindBadge, progPill, statePill } from "../parts.js";
import { companyPieces } from "./docs.js";
import { state } from "../store.js";

function programPanel(c, p) {
  const s = p.state;
  const idx = flowIndex(p);
  const slug = esc(c.slug);
  const key = `${slug}:${esc(p.id)}`;
  let html = `
    <section class="prog-panel ${KIND_CLASS[p.kind] || "main"}">
      <div class="prog-head">
        ${kindBadge(p.kind)}
        <h2 class="prog-title">${esc(p.title || p.kind)}</h2>
        ${p.status && p.status !== "不明" ? `<span class="open ${p.status === "受付中" ? "on" : ""}" title="募集の受付">${esc(p.status)}</span>` : ""}
      </div>
      ${p.period ? `<p class="prog-period">${esc(p.period)}</p>` : ""}`;
  const nx = nextEvent(c, p.id);
  if (nx) {
    const n = daysUntil(nx.date);
    html += `<p class="prog-next ${urgency(n)}"><b>次の予定</b>${esc(fmtDate(nx.date))}${nx.time ? ` ${esc(nx.time)}` : ""} ${esc(nx.title)}<span>${esc(remainText(n))}</span></p>`;
  }

  // 状況: 押すとシートで選べる
  const waiting = isWaiting(c, p);
  html += `<button class="status-btn ${s}" data-sheet="${key}" aria-haspopup="dialog">
      ${progPill(c, p)}<span class="status-text">${esc(waiting ? "これからの予定がない。連絡が来たら段階を進めるか予定を足す" : STATES[s].hint)}</span><span class="status-change">変更</span>
    </button>`;

  if (p.flow.length) {
    html += `<ol class="route${ENDED.has(s) ? " dim" : ""}">`;
    p.flow.forEach((name, i) => {
      const cls = s === "offer" || i < idx ? "past" : i === idx ? "now" : "";
      const tag = i === idx && s === "todo" ? `<span class="here${waiting ? " waiting" : ""}">${waiting ? "結果待ち" : "いま"}</span>` : "";
      html += `<li class="${cls}"><button class="station" data-step="${key}:${i}" aria-label="段階を「${esc(name)}」にする">
        <span class="st"></span><span class="route-name">${esc(name)}</span>${tag}</button></li>`;
    });
    html += `</ol><p class="hint route-hint">欄を押すと、いまの段階を変えられます。</p>`;
  }

  // いま一番よく押すボタンを1つだけ大きく出す
  if (s === "plan") {
    html += `<button class="btn primary wide" data-pass="${key}">応募した${p.flow[0] ? `（${esc(p.flow[0])}から選考開始）` : ""}</button>`;
  } else if (s === "todo" && p.flow.length) {
    const nextStep = idx >= 0 ? p.flow[idx + 1] : p.flow[0];
    const label = idx < 0 ? `選考を始める（${p.flow[0]}から）` : nextStep ? `${p.flow[idx]}を通過した（次は${nextStep}）` : `${p.flow[idx]}を通過した（内定）`;
    html += `<button class="btn primary wide" data-pass="${key}">${esc(label)}</button>`;
  }
  if (s === "todo" && /面接/.test(p.step)) {
    html += `<a class="btn ghost wide" href="#/doc/${encodeURIComponent("profile/面接.md")}">面接の想定問答を開く</a>`;
  } else if ((s === "todo" || s === "plan") && (/ES|書類|エントリー/.test(p.step) || s === "plan")) {
    html += hasNote(c.slug)
      ? `<a class="btn ghost wide" href="#/doc/${encodeURIComponent(`notes/${c.slug}.md`)}">ESの下書きを開く</a>`
      : `<a class="btn ghost wide" href="#/docs">ESの素材を開く</a>`;
  }

  // 調べた募集の情報は畳んでおく
  const links = [
    p.url && `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">募集ページ</a>`,
    p.entryUrl && `<a href="${esc(p.entryUrl)}" target="_blank" rel="noopener noreferrer">エントリー</a>`,
    p.source && p.source !== p.url && `<a class="faint" href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">出典</a>`,
  ].filter(Boolean);
  if (p.process || links.length) {
    html += `<details class="prog-info"><summary>選考プロセス・募集ページ</summary>
      ${p.process ? `<div class="md prog-process">${renderMarkdown(p.process)}</div>` : ""}
      ${links.length ? `<p class="prog-links">${links.join("")}</p>` : ""}</details>`;
  }
  return html + `</section>`;
}

function statusSheet(key) {
  const [slug, pid] = key.split(":");
  const c = bySlug(slug);
  const p = programOf(c, pid);
  if (!p) return "";
  return `
    <form method="dialog" class="sheet-inner">
      <p class="sheet-title">${esc(c.name)}<small>${esc(p.title || p.kind)}</small></p>
      ${STATE_GROUPS.map((g) => `
        <p class="sheet-group">${g.label}</p>
        <div class="sheet-options">
          ${g.states.map((st) => `<button type="button" class="sheet-opt${st === p.state ? " current" : ""}" data-state="${esc(slug)}:${esc(pid)}:${st}">
            ${statePill(st)}<span>${esc(STATES[st].hint)}</span>${st === p.state ? '<em>いま</em>' : ""}</button>`).join("")}
        </div>`).join("")}
      <button class="btn wide" value="cancel">閉じる</button>
    </form>`;
}

export function openSheet(key) {
  let dlg = document.getElementById("status-sheet");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "status-sheet";
    dlg.className = "sheet-dialog";
    dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
    document.body.append(dlg);
  }
  dlg.innerHTML = statusSheet(key);
  dlg.showModal();
}

// ノートの「## ES」に書いた設問の一覧（ルートごと）
function esList(c) {
  const list = companyPieces(c.slug);
  if (!list) return `<p class="hint">読み込み中…</p>`;
  if (!list.length) return `<p class="hint">ESの設問はまだ書かれていません。</p>`;
  const routes = [...new Set(list.map((x) => x.route))];
  const mark = { sent: '<span class="sent">提出</span>', final: '<span class="sent">確定</span>', old: '<span class="tag">以前の版</span>', draft: '<span class="tag draft">下書き</span>' };
  return routes
    .map((r) => `${r ? `<h3 class="sub">${esc(r)}</h3>` : ""}<ul class="es-list">${list
      .filter((x) => x.route === r)
      .map((x) => `<li><span class="es-q">${esc(x.title)}</span><span class="es-meta">${x.mine ? '<span class="mine">本人</span>' : ""}${mark[x.state]}<span class="chars">${x.chars}字${x.limit ? `<small>／${esc(x.limit)}</small>` : ""}</span><button class="mini" data-copy="${esc(x.text)}">コピー</button></span></li>`)
      .join("")}</ul>`)
    .join("");
}

// マイページ: 開く・コピーをいちばん上に。未登録ならその場で登録する
function loginCard(c) {
  const m = c.mypage;
  const slug = esc(c.slug);
  const form = `<form class="mp-form" data-mypage="${slug}">
      <label>マイページのURL<input type="url" name="url" value="${esc(m.url)}" autocapitalize="off"></label>
      <div class="pf-row">
        <label>ID<input name="id" value="${esc(m.id)}" autocapitalize="off" autocomplete="off"></label>
        <label>パスワード<input name="password" value="${esc(m.password)}" autocapitalize="off" autocomplete="off"></label>
      </div>
      <button class="btn primary small" type="submit">保存する</button>
    </form>`;
  const recruit = c.recruitUrl
    ? `<a class="qa" href="${esc(c.recruitUrl)}" target="_blank" rel="noopener noreferrer">${ICONS.globe}<span>採用ページ</span></a>`
    : "";
  if (!hasLogin(c)) {
    return `<section class="login-card">
      ${recruit ? `<nav class="quick">${recruit}</nav>` : ""}
      <details class="mp-edit"><summary class="qa muted">${ICONS.key}<span>マイページを登録する</span></summary>${form}</details>
    </section>`;
  }
  return `<section class="login-card">
    <nav class="quick" aria-label="よく使うリンク">
      ${recruit}
      ${m.url ? `<a class="qa" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${ICONS.door}<span>マイページ</span></a>` : ""}
      ${m.id ? `<button class="qa" data-copy="${esc(m.id)}" data-copy-label="ID">${ICONS.id}<span>IDをコピー</span></button>` : ""}
      ${m.password ? `<button class="qa" data-copy="${esc(m.password)}" data-copy-label="パスワード">${ICONS.key}<span>PWをコピー</span></button>` : ""}
    </nav>
    <div class="cred">
      ${m.id ? `<span>ID <code>${esc(m.id)}</code></span>` : ""}
      ${m.password ? `<span>PW <button class="pw-mask" data-reveal="${esc(m.password)}" aria-label="パスワードを表示">••••••</button></span>` : ""}
      <details class="mp-edit"><summary>変更</summary>${form}</details>
    </div>
  </section>`;
}

export function viewCompany(slug, pid) {
  const c = bySlug(slug);
  if (!c) return `<p class="empty">この企業は見つかりません。<a href="#/companies">企業一覧に戻る</a></p>`;
  const p = programOf(c, pid) || defaultProgram(c);
  const meta = [c.industry, c.salary ? `初任給 ¥${Number(c.salary).toLocaleString()}` : "", c.lastAction ? `最終更新 ${fmtDate(c.lastAction, true)}` : ""].filter(Boolean);
  const avg = c.avgSalary ? `<p class="meta avg">${esc(c.avgSalary)}</p>` : "";
  const slugE = esc(c.slug);

  let html = `
    <a class="back" href="#/companies">企業</a>
    <header class="co-hero">
      ${avatar(c, "lg")}
      <div class="co-hero-body">
        <h1 class="page-title">${esc(c.name)}</h1>
        <p class="meta">${meta.map(esc).join("　")}</p>
        ${avg}
        <div class="stars" role="group" aria-label="志望度">
          ${[1, 2, 3].map((n) => `<button data-prio="${slugE}:${n}" aria-pressed="${n <= (c.priority || 0)}" aria-label="志望度 ${n}">★</button>`).join("")}
          <span class="stars-label">${esc(PRIORITY_LABEL[c.priority] || "志望度")}</span>
        </div>
      </div>
      <a class="icon-btn" href="#/c/${slugE}/edit" aria-label="編集">${ICONS.edit}</a>
    </header>
    ${loginCard(c)}
    <div class="co-layout"><div class="co-main">`;

  if (c.programs.length > 1) {
    html += `<div class="prog-tabs" role="tablist">${c.programs
      .map((q) => `<a role="tab" href="#/c/${slugE}/${esc(q.id)}" aria-selected="${q.id === p.id}">
        ${kindBadge(q.kind)}<span class="pt-title">${esc(q.title || q.kind)}</span><span class="pt-state">${statePill(q.state)}</span></a>`)
      .join("")}</div>`;
  }
  html += p
    ? programPanel(c, p)
    : `<section class="empty-panel">選考ルート（本選考・インターンなど）が登録されていません。<a href="#/c/${slugE}/edit">編集から追加</a></section>`;

  const events = c.events.map((e, i) => ({ ...e, c, i, p: programOf(c, e.program) })).sort(byWhen);
  html += `</div><div class="co-side"><section class="card"><h2 class="sec">予定<a class="sec-link" href="#/add?c=${slugE}">追加</a></h2>`;
  if (events.length) {
    html += `<ul class="checklist">`;
    for (const e of events) {
      const n = daysUntil(e.date);
      const tail = e.done ? "" : n < 0 ? `<span class="late">期限切れ</span>` : `<span class="${urgency(n)}">${esc(remainText(n))}</span>`;
      html += `
        <li class="${e.done ? "done" : ""}">
          <label><input type="checkbox" data-toggle="${slugE}:${e.i}"${e.done ? " checked" : ""}>
          <span class="ck-body"><span class="ck-when">${esc(whenText(e))}</span><span class="ck-title">${eventTitle(e, true)}</span>
          ${e.done ? "" : `<span class="cal-links"><button class="linkish" data-ics="${slugE}:${e.i}">カレンダーに追加</button><a href="${esc(googleCalUrl(e, c))}" target="_blank" rel="noopener noreferrer">Googleカレンダー</a></span>`}</span></label>
          ${tail}
        </li>`;
    }
    html += `</ul>`;
  } else {
    html += `<p class="hint">予定はまだありません。</p>`;
  }
  html += `</section>`;

  // やること: 済んだらチェックで消える
  html += `<section class="card"><h2 class="sec">やること${c.todo.length ? `<span class="count">${c.todo.length}</span>` : ""}</h2>
    ${c.todo.length ? `<ul class="checklist todo-list">${c.todo
      .map((t) => `<li><label><input type="checkbox" data-todo-done="${slugE}" value="${esc(t)}"><span class="ck-body"><span class="ck-title">${esc(t)}</span></span></label></li>`)
      .join("")}</ul>` : ""}
    <form class="inline-add" data-todo="${slugE}"><input name="text" placeholder="調べること・転記することなど" aria-label="やることを追加" required><button class="mini" type="submit">追加</button></form>
  </section>`;

  html += `<section class="card"><h2 class="sec">ES・企業研究</h2>`;
  html += hasNote(c.slug)
    ? esList(c) + `<a class="btn ghost wide" href="#/doc/${encodeURIComponent(`notes/${c.slug}.md`)}">ノートを開く</a>`
    : state.docs
      ? `<button class="btn ghost wide" data-newnote="${slugE}">ノートを作る</button>`
      : `<p class="hint">読み込み中…</p>`;
  html += `</section></div><div class="co-extra">`;
  html += `<section class="card"><h2 class="sec">メモ<a class="sec-link" href="#/c/${slugE}/edit">編集</a></h2>${
    c.memo?.trim() ? `<div class="md">${renderMarkdown(c.memo)}</div>` : `<p class="hint">調べたことや出典はここに。</p>`}</section>`;
  html += `<section class="card"><h2 class="sec">記録</h2>
    <form class="inline-add" data-record="${slugE}"><input name="text" placeholder="例: ESを出した。結果は11/25までに通知" aria-label="記録を書く" required><button class="mini" type="submit">書く</button></form>
    ${c.history.length ? `<ol class="history">${c.history
      .slice(0, 30)
      .map((h) => `<li><span class="h-date">${esc(fmtDate(h.date))}</span>${esc(h.text)}</li>`)
      .join("")}</ol>` : ""}
  </section>`;
  return html + `</div></div>`;
}
