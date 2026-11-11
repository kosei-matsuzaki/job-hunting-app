// 画面: 企業ページ

import { ENDED, IN_SELECTION, KIND_CLASS, PRIORITY_LABEL, STATE_GROUPS, STATES } from "../config.js";
import { hasNote } from "../data.js";
import { daysUntil, fmtDate, remainText, urgency, whenText } from "../dates.js";
import { googleCalUrl } from "../ics.js";
import { esc, renderMarkdown } from "../md.js";
import { bySlug, byWhen, defaultProgram, flowIndex, nextEvent, programOf } from "../model.js";
import { avatar, eventTitle, ICONS, kindBadge, statePill } from "../parts.js";
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
        ${p.status && p.status !== "不明" ? `<span class="open ${p.status === "受付中" ? "on" : ""}">${esc(p.status)}</span>` : ""}
      </div>
      ${p.period ? `<p class="prog-period">受付・時期: ${esc(p.period)}</p>` : ""}`;
  const nx = nextEvent(c, p.id);
  if (nx) {
    const n = daysUntil(nx.date);
    html += `<p class="prog-next ${urgency(n)}"><b>次の予定</b>${esc(fmtDate(nx.date))}${nx.time ? ` ${esc(nx.time)}` : ""} ${esc(nx.title)}<span>${esc(remainText(n))}</span></p>`;
  }

  // 状況: 押すとシートで選べる
  html += `<button class="status-btn ${s}" data-sheet="${key}" aria-haspopup="dialog">
      ${statePill(s)}<span class="status-text">${esc(STATES[s].long || STATES[s].hint)}</span><span class="status-change">変更</span>
    </button>`;

  if (IN_SELECTION.has(s)) {
    html += `<div class="seg small turn" role="group" aria-label="いまはどちらの番か">
      <button data-state="${key}:todo" aria-pressed="${s === "todo"}">自分の番</button>
      <button data-state="${key}:waiting" aria-pressed="${s === "waiting"}">結果待ち</button>
    </div>`;
  }

  if (p.flow.length) {
    html += `<ol class="route${ENDED.has(s) ? " dim" : ""}">`;
    p.flow.forEach((name, i) => {
      const cls = s === "offer" || i < idx ? "past" : i === idx ? "now" : "";
      const tag = i === idx && IN_SELECTION.has(s) ? `<span class="here ${s}">${STATES[s].label}</span>` : "";
      html += `<li class="${cls}"><button class="station" data-step="${key}:${i}" aria-label="段階を「${esc(name)}」にする">
        <span class="st"></span><span class="route-name">${esc(name)}</span>${tag}</button></li>`;
    });
    html += `</ol><p class="hint route-hint">欄を押すと、いまの段階を変えられます。</p>`;
  }

  // いま一番よく押すボタンを1つだけ大きく出す
  if (s === "watch") {
    html += `<div class="actions-row">
      <button class="btn primary" data-state="${key}:plan">応募予定にする</button>
      <button class="btn" data-pass="${key}">もう応募した</button>
    </div>`;
  } else if (s === "plan") {
    html += `<button class="btn primary wide" data-pass="${key}">応募した${p.flow[0] ? `（${esc(p.flow[0])}から選考開始）` : ""}</button>`;
  } else if (IN_SELECTION.has(s) && p.flow.length) {
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

  if (p.process) html += `<h3 class="sub">選考プロセス</h3><div class="md prog-process">${renderMarkdown(p.process)}</div>`;
  const links = [
    p.url && `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">募集ページ</a>`,
    p.entryUrl && `<a href="${esc(p.entryUrl)}" target="_blank" rel="noopener noreferrer">エントリー</a>`,
    p.source && p.source !== p.url && `<a class="faint" href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">出典</a>`,
  ].filter(Boolean);
  if (links.length) html += `<p class="prog-links">${links.join("")}</p>`;
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
  const mark = { sent: '<span class="sent">提出</span>', old: '<span class="tag">以前の版</span>', draft: '<span class="tag draft">下書き</span>' };
  return routes
    .map((r) => `${r ? `<h3 class="sub">${esc(r)}</h3>` : ""}<ul class="es-list">${list
      .filter((x) => x.route === r)
      .map((x) => `<li><span class="es-q">${esc(x.title)}</span><span class="es-meta">${mark[x.state]}<span class="chars">${x.chars}字${x.limit ? `<small>／${esc(x.limit)}</small>` : ""}</span><button class="mini" data-copy="${esc(x.text)}">コピー</button></span></li>`)
      .join("")}</ul>`)
    .join("");
}

export function viewCompany(slug, pid) {
  const c = bySlug(slug);
  if (!c) return `<p class="empty">この企業は見つかりません。<a href="#/companies">企業一覧に戻る</a></p>`;
  const p = programOf(c, pid) || defaultProgram(c);
  const m = c.mypage;
  const meta = [c.industry, c.salary ? `初任給 ¥${Number(c.salary).toLocaleString()}` : "", c.lastAction ? `最終更新 ${fmtDate(c.lastAction, true)}` : ""].filter(Boolean);
  const avg = c.avgSalary ? `<p class="meta avg">${esc(c.avgSalary)}</p>` : "";

  let html = `
    <a class="back" href="#/companies">企業</a>
    <header class="co-hero">
      ${avatar(c, "lg")}
      <div class="co-hero-body">
        <h1 class="page-title">${esc(c.name)}</h1>
        <p class="meta">${meta.map(esc).join("　")}</p>
        ${avg}
        <div class="stars" role="group" aria-label="志望度">
          ${[1, 2, 3].map((n) => `<button data-prio="${esc(c.slug)}:${n}" aria-pressed="${n <= (c.priority || 0)}" aria-label="志望度 ${n}">★</button>`).join("")}
          <span class="stars-label">${esc(PRIORITY_LABEL[c.priority] || "志望度")}</span>
        </div>
      </div>
      <a class="icon-btn" href="#/c/${esc(c.slug)}/edit" aria-label="編集">${ICONS.edit}</a>
    </header>
    <nav class="quick" aria-label="よく使うリンク">
      ${c.recruitUrl ? `<a class="qa" href="${esc(c.recruitUrl)}" target="_blank" rel="noopener noreferrer">${ICONS.globe}<span>採用ページ</span></a>` : `<a class="qa muted" href="#/c/${esc(c.slug)}/edit">${ICONS.globe}<span>採用ページ未登録</span></a>`}
      ${m.url ? `<a class="qa" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${ICONS.door}<span>マイページ</span></a>` : `<a class="qa muted" href="#/c/${esc(c.slug)}/edit">${ICONS.door}<span>マイページ未登録</span></a>`}
      ${m.id ? `<button class="qa" data-copy="${esc(m.id)}" data-copy-label="ID">${ICONS.id}<span>IDをコピー</span></button>` : ""}
      ${m.password ? `<button class="qa" data-copy="${esc(m.password)}" data-copy-label="パスワード">${ICONS.key}<span>PWをコピー</span></button>` : ""}
    </nav>
    <div class="co-layout"><div class="co-main">`;

  if (c.programs.length > 1) {
    html += `<div class="prog-tabs" role="tablist">${c.programs
      .map((q) => `<a role="tab" href="#/c/${esc(c.slug)}/${esc(q.id)}" aria-selected="${q.id === p.id}">
        ${kindBadge(q.kind)}<span class="pt-title">${esc(q.title || q.kind)}</span><span class="pt-state">${statePill(q.state)}</span></a>`)
      .join("")}</div>`;
  }
  html += p
    ? programPanel(c, p)
    : `<section class="empty-panel">選考ルート（本選考・インターンなど）が登録されていません。<a href="#/c/${esc(c.slug)}/edit">編集から追加</a></section>`;

  const events = c.events.map((e, i) => ({ ...e, c, i, p: programOf(c, e.program) })).sort(byWhen);
  html += `</div><div class="co-side"><section class="card"><h2 class="sec">予定<a class="sec-link" href="#/add?c=${esc(c.slug)}">追加</a></h2>`;
  if (events.length) {
    html += `<ul class="checklist">`;
    for (const e of events) {
      const n = daysUntil(e.date);
      const tail = e.done ? "" : n < 0 ? `<span class="late">期限切れ</span>` : `<span class="${urgency(n)}">${esc(remainText(n))}</span>`;
      html += `
        <li class="${e.done ? "done" : ""}">
          <label><input type="checkbox" data-toggle="${esc(c.slug)}:${e.i}"${e.done ? " checked" : ""}>
          <span class="ck-body"><span class="ck-when">${esc(whenText(e))}</span><span class="ck-title">${eventTitle(e, true)}</span>
          ${e.done ? "" : `<span class="cal-links"><button class="linkish" data-ics="${esc(c.slug)}:${e.i}">カレンダーに追加</button><a href="${esc(googleCalUrl(e, c))}" target="_blank" rel="noopener noreferrer">Googleカレンダー</a></span>`}</span></label>
          ${tail}
        </li>`;
    }
    html += `</ul>`;
  } else {
    html += `<p class="hint">予定はまだありません。</p>`;
  }
  html += `</section>`;

  if (c.todo.length) html += `<section class="card"><h2 class="sec">調べること・転記すること</h2><ul class="plain-list">${c.todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></section>`;
  if (c.links.length) {
    html += `<section class="card"><h2 class="sec">リンク</h2><ul class="plain-list">${c.links
      .map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a></li>`)
      .join("")}</ul></section>`;
  }
  html += `<section class="card"><h2 class="sec">ES・企業研究</h2>`;
  html += hasNote(c.slug)
    ? esList(c) + `<a class="btn ghost wide" href="#/doc/${encodeURIComponent(`notes/${c.slug}.md`)}">ノートを開く</a>`
    : state.docs
      ? `<button class="btn ghost wide" data-newnote="${esc(c.slug)}">ノートを作る</button>`
      : `<p class="hint">読み込み中…</p>`;
  html += `</section></div><div class="co-extra">`;
  if (c.memo?.trim()) html += `<section class="card"><h2 class="sec">メモ</h2><div class="md">${renderMarkdown(c.memo)}</div></section>`;
  if (c.history.length) {
    html += `<section class="card"><h2 class="sec">これまでの記録</h2><ol class="history">${c.history
      .slice(0, 30)
      .map((h) => `<li><span class="h-date">${esc(fmtDate(h.date))}</span>${esc(h.text)}</li>`)
      .join("")}</ol></section>`;
  }
  return html + `</div></div>`;
}
