// 画面: 企業ページ
// 同じことは1か所にだけ書く。ルートの状況・段階・結果待ち・予定は、そのルートの中身にまとめる

import { ENDED, KIND_CLASS, PRIORITY_LABEL, STATE_GROUPS, STATES } from "../config.js";
import { hasNote } from "../data.js";
import { addDays, daysUntil, evRemain, evWhen, fmtDate, isoOf, today } from "../dates.js";
import { googleCalUrl } from "../ics.js";
import { esc, renderMarkdown } from "../md.js";
import { bySlug, byWhen, defaultProgram, flowIndex, hasLogin, isWaiting, programOf, resultEvent } from "../model.js";
import { avatar, ICONS, kindBadge, progRow, sortPrograms, statePill } from "../parts.js";
import { companyPieces } from "./docs.js";
import { state } from "../store.js";

// 予定の1行: 日付（締切・期間・結果の言い方で）｜内容｜残りとカレンダーに追加
function evItem(c, e) {
  const w = evWhen(e);
  const r = evRemain(e);
  const add = e.done || r.cls === "late" ? "" : `<span class="cal-icons">
      <button class="ic" data-ics="${esc(c.slug)}:${e.i}" title="カレンダーに追加（.ics）" aria-label="${esc(e.title)} をカレンダーに追加">${ICONS.calAdd}</button>
      <a class="ic g" href="${esc(googleCalUrl(e, c))}" target="_blank" rel="noopener noreferrer" title="Googleカレンダーに追加" aria-label="${esc(e.title)} をGoogleカレンダーに追加">G</a>
    </span>`;
  return `
    <li class="ev-${esc(e.kind || "deadline")}${e.done ? " done" : ""}">
      <label><input type="checkbox" data-toggle="${esc(c.slug)}:${e.i}"${e.done ? " checked" : ""} aria-label="${esc(e.title)} を済みにする">
      <span class="ck-body">
        <span class="ck-when">${esc(w.main)}${e.tentative ? '<span class="tag tentative">目安</span>' : ""}</span>
        <span class="ck-title">${esc(e.title)}</span>
        ${w.sub && !e.done ? `<span class="ck-sub">${esc(w.sub)}</span>` : ""}
      </span></label>
      <span class="ck-side">${e.done ? "" : `<span class="${r.cls}">${esc(r.text)}</span>`}${add}</span>
    </li>`;
}

// これからの予定を上に、済んだものは畳む
function evList(c, events, empty) {
  const open = events.filter((e) => !e.done);
  const done = events.filter((e) => e.done);
  let html = open.length ? `<ul class="checklist ev-list">${open.map((e) => evItem(c, e)).join("")}</ul>` : `<p class="hint">${empty}</p>`;
  if (done.length) html += `<details class="done-evs"><summary>済んだ予定<span class="count">${done.length}</span></summary><ul class="checklist ev-list">${done.map((e) => evItem(c, e)).join("")}</ul></details>`;
  return html;
}

// 結果待ちのとき: いつ頃連絡が来るか。日付はここでだけ出す
function resultBox(c, p) {
  const r = resultEvent(c, p.id);
  const key = `${esc(c.slug)}:${esc(p.id)}`;
  const form = (label) => `<form class="result-form" data-result="${key}">
      <input type="date" name="date" required min="${isoOf(addDays(today(), -30))}" value="${esc(r?.date || "")}" aria-label="結果の連絡の予定日">
      <button class="btn small${r ? "" : " primary"}" type="submit">${label}</button>
    </form>`;
  if (!r) {
    return `<div class="result-box is-empty">
      <p class="result-head"><span class="cp-wait">結果待ち</span>連絡の予定日は未登録</p>
      <p class="hint">案内に「○日までに連絡」とあれば、その日を入れるとカレンダーに出ます。</p>
      ${form("入れる")}
    </div>`;
  }
  const rm = evRemain(r);
  return `<div class="result-box ${rm.cls}">
    <p class="result-head"><span class="cp-wait">結果待ち</span><b>${esc(fmtDate(r.date))}までに連絡</b><em>${esc(rm.text)}</em></p>
    ${daysUntil(r.date) < 0 ? '<p class="hint">予定日を過ぎました。連絡を確かめて、下のボタンで記録してください。</p>' : ""}
    <details class="result-edit"><summary>予定日を変える</summary>${form("変える")}</details>
  </div>`;
}

// ルートの予定（ルートが1つなら、ルートを指定していない予定もここに）
function routeEvents(c, p) {
  const solo = c.programs.length === 1;
  return c.events
    .map((e, i) => ({ ...e, i }))
    .filter((e) => e.program === p.id || (solo && !programOf(c, e.program)))
    .sort(byWhen);
}

function programPanel(c, p, { inList = false } = {}) {
  const s = p.state;
  const idx = flowIndex(p);
  const slug = esc(c.slug);
  const key = `${slug}:${esc(p.id)}`;
  const waiting = isWaiting(c, p);
  // 募集の受付状況は、応募する前にだけ大事。応募したあとは「募集の情報」に畳む
  const recruit = [
    p.status && p.status !== "不明" ? `<span class="open ${p.status === "受付中" ? "on" : ""}">${esc(p.status)}</span>` : "",
    p.period ? `<span class="period">${esc(p.period)}</span>` : "",
  ].join("");

  let html = `<section class="prog-panel${inList ? " in-list" : ""} ${KIND_CLASS[p.kind] || "main"}">`;
  if (!inList) html += `<div class="prog-head">${kindBadge(p.kind)}<h2 class="prog-title">${esc(p.title || p.kind)}</h2></div>`;

  // 状況（押すと選べる）。応募前なら受付状況もここに
  html += `<div class="prog-state">
      <button class="state-btn ${s}" data-sheet="${key}" aria-haspopup="dialog" aria-label="状況を変える（いまは${esc(STATES[s].label)}）">${esc(STATES[s].label)}<span aria-hidden="true">▾</span></button>
      ${s === "plan" && recruit ? `<span class="prog-recruit">${recruit}</span>` : ""}
    </div>`;

  if (p.flow.length) {
    html += `<ol class="route${ENDED.has(s) ? " dim" : ""}" aria-label="選考の段階">`;
    p.flow.forEach((name, i) => {
      const cls = s === "offer" || i < idx ? "past" : i === idx ? "now" : "";
      html += `<li class="${cls}"${i === idx ? ' aria-current="step"' : ""}><button class="station" data-step="${key}:${i}" title="押すと、いまの段階を「${esc(name)}」にする">
        <span class="st"></span><span class="route-name">${esc(name)}</span></button></li>`;
    });
    html += `</ol>`;
  }

  if (waiting) html += resultBox(c, p);

  // いま一番よく押すボタン。選考中なら、落ちたときのボタンを横に小さく
  if (s === "plan") {
    html += `<button class="btn primary wide" data-pass="${key}">応募した${p.flow[0] ? `（${esc(p.flow[0])}から選考開始）` : ""}</button>`;
  } else if (s === "todo" && p.flow.length) {
    const nextStep = idx >= 0 ? p.flow[idx + 1] : p.flow[0];
    const label = idx < 0 ? `選考を始める（${p.flow[0]}から）` : nextStep ? `${p.flow[idx]}を通過（次は${nextStep}）` : `${p.flow[idx]}を通過（内定）`;
    html += `<div class="pass-row"><button class="btn primary" data-pass="${key}">${esc(label)}</button>${idx >= 0 ? `<button class="btn ghost" data-state="${key}:rejected">不合格</button>` : ""}</div>`;
  }

  // このルートの予定。結果待ちの欄に出した連絡予定は重ねない
  const shown = waiting ? resultEvent(c, p.id) : null;
  const evs = routeEvents(c, p).filter((e) => !(shown && !e.done && e.kind === "result" && e.date === shown.date && e.title === shown.title));
  html += `<div class="prog-evs">
      <h3 class="pe-head">予定<a class="sec-link" href="#/add?c=${slug}&p=${esc(p.id)}">追加</a></h3>
      ${evs.length ? evList(c, evs, "これからの予定はありません。") : `<p class="hint">予定はまだありません。</p>`}
    </div>`;

  // 調べた募集の情報は畳んでおく
  const links = [
    p.url && `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">募集ページ</a>`,
    p.entryUrl && `<a href="${esc(p.entryUrl)}" target="_blank" rel="noopener noreferrer">エントリー</a>`,
    p.source && p.source !== p.url && `<a class="faint" href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">出典</a>`,
  ].filter(Boolean);
  const showRecruit = s !== "plan" && recruit;
  if (p.process || links.length || showRecruit) {
    html += `<details class="prog-info"><summary>募集の情報</summary>
      ${showRecruit ? `<p class="prog-recruit">${recruit}</p>` : ""}
      ${p.process ? `<div class="md prog-process">${renderMarkdown(p.process)}</div>` : ""}
      ${links.length ? `<p class="prog-links">${links.join("")}</p>` : ""}</details>`;
  }

  if (s === "todo" && /面接/.test(p.step)) {
    html += `<p class="prog-aside"><a href="#/doc/${encodeURIComponent("profile/面接.md")}">面接の想定問答を開く</a></p>`;
  } else if (s === "plan" || (s === "todo" && /ES|書類|エントリー/.test(p.step))) {
    html += hasNote(c.slug)
      ? `<p class="prog-aside"><a href="#/doc/${encodeURIComponent(`notes/${c.slug}.md`)}">ESの下書きを開く</a></p>`
      : `<p class="prog-aside"><a href="#/docs">ESの素材を開く</a></p>`;
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

// リンクとログインを1行に。ID は見せたまま押すとコピー、パスワードは伏せたまま押すとコピー
function loginBar(c) {
  const m = c.mypage;
  const form = `<form class="mp-form" data-mypage="${esc(c.slug)}">
      <label>マイページのURL<input type="url" name="url" value="${esc(m.url)}" autocapitalize="off"></label>
      <div class="pf-row">
        <label>ID<input name="id" value="${esc(m.id)}" autocapitalize="off" autocomplete="off"></label>
        <label>パスワード<input name="password" value="${esc(m.password)}" autocapitalize="off" autocomplete="off"></label>
      </div>
      <button class="btn primary small" type="submit">保存する</button>
    </form>`;
  const chips = [
    c.recruitUrl && `<a class="qa" href="${esc(c.recruitUrl)}" target="_blank" rel="noopener noreferrer">${ICONS.globe}<span>採用ページ</span></a>`,
    m.url && `<a class="qa" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${ICONS.door}<span>マイページ</span></a>`,
    m.id && `<button class="qa cred-chip" data-copy="${esc(m.id)}" data-copy-label="ID" title="IDをコピー" aria-label="IDをコピー"><small>ID</small><code>${esc(m.id)}</code>${ICONS.copy}</button>`,
    m.password && `<button class="qa cred-chip" data-copy="${esc(m.password)}" data-copy-label="パスワード" title="パスワードをコピー" aria-label="パスワードをコピー"><small>PW</small><code>••••••</code>${ICONS.copy}</button>`,
  ].filter(Boolean).join("");
  const has = hasLogin(c);
  return `<section class="login-card">
    <div class="quick">${chips}<details class="mp-edit"><summary class="${has ? "mp-change" : "qa muted"}">${has ? "変更" : `${ICONS.key}<span>マイページを登録</span>`}</summary>${form}</details></div>
  </section>`;
}

export function viewCompany(slug, pid) {
  const c = bySlug(slug);
  if (!c) return `<p class="empty">この企業は見つかりません。<a href="#/companies">企業一覧に戻る</a></p>`;
  const p = programOf(c, pid) || defaultProgram(c);
  const meta = [c.industry, c.salary ? `初任給 ¥${Number(c.salary).toLocaleString()}` : ""].filter(Boolean);
  const avg = c.avgSalary ? `<p class="meta avg">${esc(c.avgSalary)}</p>` : "";
  const slugE = esc(c.slug);
  const withIdx = (list) => list.map((e) => ({ ...e, i: c.events.indexOf(e) })).sort(byWhen);

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
    ${loginBar(c)}
    <div class="co-layout"><div class="co-main">`;

  // 選考ルートが複数あれば1行ずつ並べ、選んだルートの中身をその下に開く
  if (c.programs.length > 1) {
    html += `<h2 class="sec">選考ルート<span class="count">${c.programs.length}</span></h2>
      <ol class="prog-list">${sortPrograms(c)
        .map((q) => `<li class="${q.id === p.id ? "is-open" : ""}">${progRow(c, q, { current: q.id === p.id })}${q.id === p.id ? programPanel(c, q, { inList: true }) : ""}</li>`)
        .join("")}</ol>`;
  } else {
    html += p
      ? programPanel(c, p)
      : `<section class="empty-panel">選考ルート（本選考・インターンなど）が登録されていません。<a href="#/c/${slugE}/edit">編集から追加</a></section>`;
  }
  html += `</div><div class="co-side">`;

  // どのルートにも付いていない予定だけ、別に出す（ルートがなければ全部）
  const loose = !c.programs.length ? c.events : c.programs.length > 1 ? c.events.filter((e) => !programOf(c, e.program)) : [];
  if (loose.length || !c.programs.length) {
    html += `<section class="card"><h2 class="sec">${c.programs.length ? "ルートを決めていない予定" : "予定"}<a class="sec-link" href="#/add?c=${slugE}">追加</a></h2>
      ${loose.length ? evList(c, withIdx(loose), "これからの予定はありません。") : `<p class="hint">予定はまだありません。</p>`}</section>`;
  }

  // やること: 済んだらチェックで消える
  html += `<section class="card"><h2 class="sec">やること${c.todo.length ? `<span class="count">${c.todo.length}</span>` : ""}</h2>
    ${c.todo.length ? `<ul class="checklist todo-list">${c.todo
      .map((t) => `<li><label><input type="checkbox" data-todo-done="${slugE}" value="${esc(t)}"><span class="ck-body"><span class="ck-title">${esc(t)}</span></span></label></li>`)
      .join("")}</ul>` : ""}
    <form class="inline-add" data-todo="${slugE}"><input name="text" placeholder="調べること・転記することなど" aria-label="やることを追加" required><button class="mini" type="submit">追加</button></form>
  </section>`;

  const note = hasNote(c.slug);
  html += `<section class="card"><h2 class="sec">ES・企業研究${note ? `<a class="sec-link" href="#/doc/${encodeURIComponent(`notes/${c.slug}.md`)}">ノートを開く</a>` : ""}</h2>`;
  html += note
    ? esList(c)
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
