// 画面: 企業ページ
// 同じことは1か所にだけ書く。ルートの状況・段階・結果待ちはそのルートの中身に、
// 予定と記録（済んだ予定を含む）は「予定と記録」の1か所にまとめる。1列で上から読む

import { ENDED, KIND_CLASS, KIND_SHORT, PRIORITY_LABEL, STATE_GROUPS, STATES } from "../config.js";
import { hasNote } from "../data.js";
import { addDays, daysUntil, evRemain, evWhen, fmtDate, isoOf, remainText, today } from "../dates.js";
import { googleCalUrl } from "../ics.js";
import { esc, renderMarkdown } from "../md.js";
import { bySlug, byWhen, defaultProgram, flowIndex, hasLogin, isWaiting, programOf, resultEvent } from "../model.js";
import { avatar, ICONS, kindBadge, progRow, sortPrograms, statePill } from "../parts.js";
import { state } from "../store.js";

// 予定にルートの種類を添える（ルートが複数あるときだけ）
const routeTag = (c, e) => {
  const p = c.programs.length > 1 && programOf(c, e.program);
  return p ? `<span class="tag prog">${esc(KIND_SHORT[p.kind] || p.kind)}</span>` : "";
};

// これからの予定の1行: 日付（締切・期間・結果の言い方で）｜内容｜残りとカレンダーに追加
function evItem(c, e) {
  const w = evWhen(e);
  const r = evRemain(e);
  const add = r.cls === "late" ? "" : `<span class="cal-icons">
      <button class="ic" data-ics="${esc(c.slug)}:${e.i}" title="カレンダーに追加（.ics）" aria-label="${esc(e.title)} をカレンダーに追加">${ICONS.calAdd}</button>
      <a class="ic g" href="${esc(googleCalUrl(e, c))}" target="_blank" rel="noopener noreferrer" title="Googleカレンダーに追加" aria-label="${esc(e.title)} をGoogleカレンダーに追加">G</a>
    </span>`;
  return `
    <li class="ev-${esc(e.kind || "deadline")}">
      <label><input type="checkbox" data-toggle="${esc(c.slug)}:${e.i}" aria-label="${esc(e.title)} を済みにする">
      <span class="ck-body">
        <span class="ck-when">${esc(w.main)}${e.tentative ? '<span class="tag tentative">目安</span>' : ""}</span>
        <span class="ck-title">${routeTag(c, e)}${esc(e.title)}</span>
        ${w.sub ? `<span class="ck-sub">${esc(w.sub)}</span>` : ""}
      </span></label>
      <span class="ck-side"><span class="${r.cls}">${esc(r.text)}</span>${add}</span>
    </li>`;
}

// 結果待ちのとき: いつ頃結果が出るか。受けた日から連絡の予定日までを帯で見せる
function resultBox(c, p) {
  const r = resultEvent(c, p.id);
  const key = `${esc(c.slug)}:${esc(p.id)}`;
  const step = esc(p.step || p.flow[0] || "選考");
  const form = (label) => `<form class="result-form" data-result="${key}">
      <input type="date" name="date" required min="${isoOf(addDays(today(), -30))}" value="${esc(r?.date || "")}" aria-label="結果の連絡の予定日">
      <button class="btn small${r ? "" : " primary"}" type="submit">${label}</button>
    </form>`;
  const since = p.waitingSince ? `<span class="rb-since">${esc(fmtDate(p.waitingSince))}に受けた</span>` : "";
  if (!r) {
    return `<div class="result-box is-empty">
      <p class="result-head"><span class="cp-wait">結果待ち</span><b>${step}</b>${since}</p>
      <p class="rb-ask">結果はいつ頃？</p>
      <div class="rb-quick">${[[7, "1週間後"], [14, "2週間後"], [30, "1か月後"]]
        .map(([d, l]) => `<button class="mini" data-result-in="${key}:${d}">${l}<small>${esc(fmtDate(isoOf(addDays(today(), d))))}</small></button>`)
        .join("")}</div>
      ${form("この日")}
    </div>`;
  }
  const n = daysUntil(r.date);
  const rm = evRemain(r);
  // 受けた日（なければ今日）から予定日までの、いまの位置
  const from = p.waitingSince && p.waitingSince < r.date ? p.waitingSince : null;
  const pct = from ? Math.max(0, Math.min(100, Math.round((-daysUntil(from) / (daysUntil(r.date) - daysUntil(from))) * 100))) : null;
  return `<div class="result-box ${rm.cls}">
    <p class="result-head"><span class="cp-wait">結果待ち</span><b>${step}</b>${since}</p>
    <div class="rb-when"><span class="rb-date">${esc(fmtDate(r.date))}</span><span class="rb-by">までに連絡</span><em>${esc(n < 0 ? "予定日を過ぎた" : remainText(n))}</em></div>
    ${pct != null ? `<div class="rb-bar" role="img" aria-label="予定日まで${pct}%"><i style="width:${pct}%"></i></div>` : ""}
    ${n < 0 ? '<p class="hint">予定日を過ぎました。連絡を確かめて、下のボタンで記録してください。</p>' : ""}
    <details class="result-edit"><summary>予定日を変える</summary>${form("変える")}</details>
  </div>`;
}

function programPanel(c, p, { inList = false } = {}) {
  const s = p.state;
  const idx = flowIndex(p);
  const key = `${esc(c.slug)}:${esc(p.id)}`;
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
      const cls = s === "offer" || i < idx ? "past" : i === idx ? `now${waiting && s === "todo" ? " wait" : ""}` : "";
      html += `<li class="${cls}"${i === idx ? ' aria-current="step"' : ""}><button class="station" data-step="${key}:${i}" title="押すと、いまの段階を「${esc(name)}」にする">
        <span class="st"></span><span class="route-name">${esc(name)}</span></button></li>`;
    });
    html += `</ol>`;
  }

  if (waiting) html += resultBox(c, p);

  // いま押すボタン。選考中なら「通過」を大きく、「受けた（結果待ち）」と「不合格」を下に
  if (s === "plan") {
    html += `<button class="btn primary wide" data-pass="${key}">応募した${p.flow[0] ? `（${esc(p.flow[0])}から選考開始）` : ""}</button>`;
  } else if (s === "todo" && p.flow.length) {
    const nextStep = idx >= 0 ? p.flow[idx + 1] : p.flow[0];
    const label = idx < 0 ? `選考を始める（${p.flow[0]}から）` : nextStep ? `${p.flow[idx]}を通過（次は${nextStep}）` : `${p.flow[idx]}を通過（内定）`;
    const reject = idx >= 0 ? `<button class="btn quiet" data-state="${key}:rejected">不合格</button>` : "";
    // 結果待ちなら「通過」と「不合格」を横に並べる。まだ受けていなければ「受けた・結果待ち」も
    html += waiting || idx < 0
      ? `<div class="pass-row inline"><button class="btn primary" data-pass="${key}">${esc(label)}</button>${reject}</div>`
      : `<div class="pass-row"><button class="btn primary" data-pass="${key}">${esc(label)}</button>
        <div class="pass-sub"><button class="btn" data-wait="${key}">${ICONS.clock}受けた・結果待ち</button>${reject}</div></div>`;
  }

  // 調べた募集の情報は畳んでおく（募集ページ・エントリーのリンクは上のボタンの列に）
  const showRecruit = s !== "plan" && recruit;
  const src = p.source && p.source !== p.url ? `<p class="prog-links"><a href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">出典</a></p>` : "";
  if (p.process || showRecruit || src) {
    html += `<details class="prog-info"><summary>募集の情報</summary>
      ${showRecruit ? `<p class="prog-recruit">${recruit}</p>` : ""}
      ${p.process ? `<div class="md prog-process">${renderMarkdown(p.process)}</div>` : ""}
      ${src}</details>`;
  }

  const aside = s === "todo" && /面接/.test(p.step)
    ? [`#/doc/${encodeURIComponent("profile/面接.md")}`, "面接の想定問答"]
    : s === "plan" || (s === "todo" && /ES|書類|エントリー/.test(p.step))
      ? hasNote(c.slug) ? [`#/doc/${encodeURIComponent(`notes/${c.slug}.md`)}`, "ESの下書き"] : ["#/docs", "ESの素材"]
      : null;
  if (aside) html += `<p class="prog-aside"><a class="act" href="${aside[0]}">${ICONS.doc}${aside[1]}を開く</a></p>`;
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
      <button class="btn wide" value="cancel" data-close-sheet>閉じる</button>
    </form>`;
}

export function openSheet(key) {
  let dlg = document.getElementById("status-sheet");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "status-sheet";
    dlg.className = "sheet-dialog";
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg || ev.target.closest("[data-close-sheet]")) dlg.close();
    });
    document.body.append(dlg);
  }
  dlg.innerHTML = statusSheet(key);
  dlg.showModal();
}

// 上のボタンの列: 採用ページ・開いているルートの募集ページとエントリー・マイページ・ID・PW。
// ID は見せたまま押すとコピー、パスワードは伏せたまま押すとコピー
function linkBar(c, p) {
  const m = c.mypage;
  const form = `<form class="mp-form" data-mypage="${esc(c.slug)}">
      <label>マイページのURL<input type="url" name="url" value="${esc(m.url)}" autocapitalize="off"></label>
      <div class="pf-row">
        <label>ID<input name="id" value="${esc(m.id)}" autocapitalize="off" autocomplete="off"></label>
        <label>パスワード<input name="password" value="${esc(m.password)}" autocapitalize="off" autocomplete="off"></label>
      </div>
      <button class="btn primary small" type="submit">保存する</button>
    </form>`;
  const ext = (url, icon, label, sub = "") => `<a class="qa" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon}<span>${label}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</a>`;
  // ルートが複数あるときは、どのルートのリンクか添える
  const which = p && c.programs.length > 1 ? KIND_SHORT[p.kind] || p.kind : "";
  const seen = new Set([c.recruitUrl]);
  const route = p ? [[p.url, ICONS.globe, "募集ページ"], [p.entryUrl, ICONS.door, "エントリー"]]
    .filter(([u]) => u && !seen.has(u) && seen.add(u))
    .map(([u, i, l]) => ext(u, i, l, which)) : [];
  const chips = [
    c.recruitUrl && ext(c.recruitUrl, ICONS.globe, "採用ページ"),
    ...route,
    m.url && ext(m.url, ICONS.door, "マイページ"),
    m.id && `<button class="qa cred-chip" data-copy="${esc(m.id)}" data-copy-label="ID" title="IDをコピー" aria-label="IDをコピー"><small>ID</small><code>${esc(m.id)}</code>${ICONS.copy}</button>`,
    m.password && `<button class="qa cred-chip" data-copy="${esc(m.password)}" data-copy-label="パスワード" title="パスワードをコピー" aria-label="パスワードをコピー"><small>PW</small><code>••••••</code>${ICONS.copy}</button>`,
  ].filter(Boolean).join("");
  const has = hasLogin(c);
  return `<section class="login-card">
    <div class="quick">${chips}<details class="mp-edit"><summary class="qa ${has ? "" : "muted"}">${has ? `${ICONS.edit}<span>ログインを変更</span>` : `${ICONS.key}<span>マイページを登録</span>`}</summary>${form}</details></div>
  </section>`;
}

// これからの予定は近いものだけ見せ、残りは畳む
const SOON = 5;

// 予定と記録: これからの予定（チェックで済み）→ 記録を書く欄 → 済んだ予定と記録を新しい順に
function timeline(c, p) {
  const slugE = esc(c.slug);
  const all = c.events.map((e, i) => ({ ...e, i }));
  // 結果待ちの欄に出した連絡予定は重ねない
  const shown = c.programs.filter((q) => isWaiting(c, q)).map((q) => resultEvent(c, q.id)).filter(Boolean);
  const isShown = (e) => shown.some((r) => r.program === e.program && r.date === e.date && r.title === e.title);
  const open = all.filter((e) => !e.done && !isShown(e)).sort(byWhen);
  const past = [
    ...all.filter((e) => e.done).map((e) => ({ date: e.date, ev: e })),
    ...c.history.map((h) => ({ date: h.date, text: h.text })),
  ].sort((a, b) => b.date.localeCompare(a.date) || (a.ev ? 1 : 0) - (b.ev ? 1 : 0));
  const addHref = `#/add?c=${slugE}${p ? `&p=${esc(p.id)}` : ""}`;
  const pastItem = (x) => x.ev
    ? `<li class="tl-ev"><span class="h-date">${esc(fmtDate(x.date))}</span><span class="tl-body"><span class="tl-done">済</span>${routeTag(c, x.ev)}${esc(x.ev.title)}</span>
        <label class="tl-undo" title="済みを取り消す"><input type="checkbox" checked data-toggle="${slugE}:${x.ev.i}" aria-label="${esc(x.ev.title)} を未完了に戻す"></label></li>`
    : `<li><span class="h-date">${esc(fmtDate(x.date))}</span><span class="tl-body">${esc(x.text)}</span></li>`;
  const head = past.slice(0, 20);
  const rest = past.slice(20);
  return `<section class="card timeline"><h2 class="sec">予定と記録<a class="act" href="${addHref}">${ICONS.plus}予定を追加</a></h2>
    ${open.length ? `<ul class="checklist ev-list">${open.slice(0, SOON).map((e) => evItem(c, e)).join("")}</ul>` : `<p class="hint">これからの予定はありません。</p>`}
    ${open.length > SOON ? `<details class="tl-more"><summary>その先の予定<span class="count">${open.length - SOON}</span></summary><ul class="checklist ev-list">${open.slice(SOON).map((e) => evItem(c, e)).join("")}</ul></details>` : ""}
    <form class="inline-add tl-add" data-record="${slugE}"><input name="text" placeholder="記録を書く（例: 面接の手応え、連絡が来た）" aria-label="記録を書く" required><button class="mini" type="submit">書く</button></form>
    ${past.length ? `<ol class="history">${head.map(pastItem).join("")}</ol>` : ""}
    ${rest.length ? `<details class="tl-more"><summary>それより前<span class="count">${rest.length}</span></summary><ol class="history">${rest.map(pastItem).join("")}</ol></details>` : ""}
  </section>`;
}

export function viewCompany(slug, pid) {
  const c = bySlug(slug);
  if (!c) return `<p class="empty">この企業は見つかりません。<a href="#/companies">企業一覧に戻る</a></p>`;
  const p = programOf(c, pid) || defaultProgram(c);
  const meta = [c.industry, c.salary ? `初任給 ¥${Number(c.salary).toLocaleString()}` : ""].filter(Boolean);
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
      <a class="act" href="#/c/${slugE}/edit">${ICONS.edit}編集</a>
    </header>
    ${linkBar(c, p)}`;

  // 選考ルートが複数あれば1行ずつ並べ、選んだルートの中身をその下に開く
  if (c.programs.length > 1) {
    html += `<h2 class="sec">選考ルート<span class="count">${c.programs.length}</span></h2>
      <ol class="prog-list">${sortPrograms(c)
        .map((q) => `<li class="${q.id === p.id ? "is-open" : ""}">${progRow(c, q, { current: q.id === p.id })}${q.id === p.id ? programPanel(c, q, { inList: true }) : ""}</li>`)
        .join("")}</ol>`;
  } else {
    html += p
      ? programPanel(c, p)
      : `<section class="empty-panel">選考ルート（本選考・インターンなど）が登録されていません。<a class="act" href="#/c/${slugE}/edit">${ICONS.edit}編集から追加</a></section>`;
  }

  html += timeline(c, p);

  // ES・企業研究はノートを開くだけ（設問と文章はノートで見る）
  const note = hasNote(c.slug);
  html += `<section class="card"><h2 class="sec">ES・企業研究</h2>${note
    ? `<a class="btn wide" href="#/doc/${encodeURIComponent(`notes/${c.slug}.md`)}">${ICONS.doc}ノートを開く</a>`
    : state.docs ? `<button class="btn ghost wide" data-newnote="${slugE}">${ICONS.plus}ノートを作る</button>` : `<p class="hint">読み込み中…</p>`}</section>`;

  html += `<section class="card"><h2 class="sec">メモ<a class="act" href="#/c/${slugE}/edit">${ICONS.edit}編集</a></h2>${
    c.memo?.trim() ? `<div class="md">${renderMarkdown(c.memo)}</div>` : `<p class="hint">調べたことや出典はここに。</p>`}</section>`;

  // やること: 済んだらチェックで消える
  html += `<section class="card"><h2 class="sec">やること${c.todo.length ? `<span class="count">${c.todo.length}</span>` : ""}</h2>
    ${c.todo.length ? `<ul class="checklist todo-list">${c.todo
      .map((t) => `<li><label><input type="checkbox" data-todo-done="${slugE}" value="${esc(t)}"><span class="ck-body"><span class="ck-title">${esc(t)}</span></span></label></li>`)
      .join("")}</ul>` : ""}
    <form class="inline-add" data-todo="${slugE}"><input name="text" placeholder="調べること・転記することなど" aria-label="やることを追加" required><button class="mini" type="submit">追加</button></form>
  </section>`;
  return html;
}
