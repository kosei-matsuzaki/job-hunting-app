// 画面: 企業ページ
// 同じことは1か所にだけ書く。ルートの状況・段階・結果待ちはそのルートの中身に、
// 予定と記録（済んだ予定を含む）は「予定と記録」の1か所にまとめる。1列で上から読む

import { ENDED, KIND_CLASS, KIND_SHORT, PRIORITY_LABEL, STATE_GROUPS, STATES } from "../config.js";
import { hasNote } from "../data.js";
import { addDays, daysUntil, evRemain, evWhen, fmtDate, isoOf, remainText, today } from "../dates.js";
import { esc, renderMarkdown } from "../md.js";
import { bySlug, byWhen, defaultProgram, flowIndex, hasLogin, isWaiting, programOf, resultEvent, stepEvents, stepOf } from "../model.js";
import { avatar, ICONS, kindBadge, progRow, sortPrograms, statePill } from "../parts.js";
import { state } from "../store.js";

// 箇所ごとの編集（鉛筆）と追加（＋）のボタン。押すとその箇所だけのモーダルが開く
const editBtn = (spec, label) => `<button class="ic-edit" data-modal="${spec}" title="${label}" aria-label="${label}">${ICONS.edit}</button>`;
const addBtn = (spec, label) => `<button class="act" data-modal="${spec}">${ICONS.plus}${label}</button>`;

// 予定にルートの種類を添える（ルートが複数あるときだけ）
const routeTag = (c, e) => {
  const p = c.programs.length > 1 && programOf(c, e.program);
  return p ? `<span class="tag prog">${esc(KIND_SHORT[p.kind] || p.kind)}</span>` : "";
};

// これからの予定の1行: 日付（締切・期間・結果の言い方で）｜内容｜残り日数と編集
function evItem(c, e) {
  const w = evWhen(e);
  const r = evRemain(e);
  return `
    <li class="ev-${esc(e.kind || "deadline")}">
      <label><input type="checkbox" data-toggle="${esc(c.slug)}:${e.i}" aria-label="${esc(e.title)} を済みにする">
      <span class="ck-body">
        <span class="ck-when">${esc(w.main)}${e.tentative ? '<span class="tag tentative">目安</span>' : ""}</span>
        <span class="ck-title">${routeTag(c, e)}${esc(e.title)}</span>
        ${w.sub ? `<span class="ck-sub">${esc(w.sub)}</span>` : ""}
      </span></label>
      <span class="ck-side ${r.cls}">${esc(r.text)}</span>
      ${editBtn(`ev:${esc(c.slug)}:${e.i}`, `${esc(e.title)} を編集`)}
    </li>`;
}

// 結果待ちのとき: いつ頃結果が出るか。受けた日から連絡の予定日までを帯で見せる。
// 上の行に印と段階、右端に操作（予定日の編集）。その下に日付を大きく、右に残り日数
function resultBox(c, p) {
  const r = resultEvent(c, p.id);
  const key = `${esc(c.slug)}:${esc(p.id)}`;
  const step = esc(p.step || p.flow[0] || "選考");
  const since = p.waitingSince ? `<span class="rb-since">${esc(fmtDate(p.waitingSince))}に受けた</span>` : "";
  if (!r) {
    return `<div class="result-box is-empty">
      <div class="box-head"><span class="cp-wait">結果待ち</span><b>${step}</b>${since}</div>
      <p class="rb-ask">結果はいつ頃？</p>
      <div class="rb-quick">${[[7, "1週間後"], [14, "2週間後"], [30, "1か月後"]]
        .map(([d, l]) => `<button class="mini" data-result-in="${key}:${d}">${l}<small>${esc(fmtDate(isoOf(addDays(today(), d))))}</small></button>`)
        .join("")}<button class="mini" data-modal="result:${key}">${ICONS.cal}日付を選ぶ</button></div>
    </div>`;
  }
  const n = daysUntil(r.date);
  const rm = evRemain(r);
  // 受けた日（なければ今日）から予定日までの、いまの位置
  const from = p.waitingSince && p.waitingSince < r.date ? p.waitingSince : null;
  const pct = from ? Math.max(0, Math.min(100, Math.round((-daysUntil(from) / (daysUntil(r.date) - daysUntil(from))) * 100))) : null;
  return `<div class="result-box ${rm.cls}">
    <div class="box-head"><span class="cp-wait">結果待ち</span><b>${step}</b>${since}<span class="box-acts">${editBtn(`result:${key}`, "予定日を変える")}</span></div>
    <div class="rb-when"><span class="rb-date">${esc(fmtDate(r.date))}</span><span class="rb-by">までに連絡</span><em>${esc(n < 0 ? "予定日を過ぎた" : remainText(n))}</em></div>
    ${pct != null ? `<div class="rb-bar" role="img" aria-label="予定日まで${pct}%"><i style="width:${pct}%"></i></div>` : ""}
    ${n < 0 ? '<p class="hint">予定日を過ぎました。連絡を確かめて、下のボタンで記録してください。</p>' : ""}
  </div>`;
}

// いまの段階の締切（日程）。結果待ちの欄と同じ形: 上の行に印と段階、右端に「済み」と編集。
// その下に予定の名前、日付を大きく、右に残り日数。複数の回があれば下に並べる
function stepBox(c, p, i) {
  const step = p.flow[i];
  const key = `${esc(c.slug)}:${esc(p.id)}`;
  const evs = stepEvents(c, p, i);
  if (!evs.length) {
    return `<div class="step-box is-empty"><div class="box-head"><span class="step-tag">締切</span><b>${esc(step)}</b>
      <span class="box-acts">${addBtn(`ev:${key.replace(":", ":new~")}~${i}`, "締切を入れる")}</span></div></div>`;
  }
  const [e, ...more] = evs;
  const rm = evRemain(e);
  const w = evWhen(e);
  const label = e.kind === "event" ? "日程" : "締切";
  return `<div class="step-box ${rm.cls}">
    <div class="box-head"><span class="step-tag">${label}</span><b>${esc(step)}</b>
      <span class="box-acts"><button class="mini sb-done" data-done="${esc(c.slug)}:${e.i}" aria-label="${esc(e.title)} を済みにする">${ICONS.check}済み</button>${editBtn(`ev:${esc(c.slug)}:${e.i}`, `${esc(e.title)} を編集`)}</span></div>
    <p class="box-title">${esc(e.title)}${e.tentative ? '<span class="tag tentative">目安</span>' : ""}</p>
    <div class="rb-when"><span class="rb-date">${esc(fmtDate(e.date))}</span><span class="rb-by">${esc(w.main.replace(fmtDate(e.date), "").trim())}</span><em>${esc(rm.text)}</em></div>
    ${w.sub ? `<p class="hint">${esc(w.sub)}</p>` : ""}
    ${more.length ? `<ul class="sb-more">${more.map((x) => `<li><span class="h-date">${esc(fmtDate(x.date))}</span><span class="tl-body">${esc(x.title)}</span><em class="${evRemain(x).cls}">${esc(evRemain(x).text)}</em>${editBtn(`ev:${esc(c.slug)}:${x.i}`, `${esc(x.title)} を編集`)}</li>`).join("")}</ul>` : ""}
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

  // 状況（押すと選べる）。応募前なら受付状況もここに。右端にこのルートの編集
  html += `<div class="prog-state">
      <button class="state-btn ${s}" data-sheet="${key}" aria-haspopup="dialog" aria-label="状況を変える（いまは${esc(STATES[s].label)}）">${esc(STATES[s].label)}<span aria-hidden="true">▾</span></button>
      ${s === "plan" && recruit ? `<span class="prog-recruit">${recruit}</span>` : ""}
      ${editBtn(`prog:${key}`, "この選考ルートを編集")}
    </div>`;

  if (p.flow.length) {
    html += `<ol class="route${ENDED.has(s) ? " dim" : ""}" aria-label="選考の段階">`;
    p.flow.forEach((name, i) => {
      const cls = s === "offer" || i < idx ? "past" : i === idx ? `now${waiting && s === "todo" ? " wait" : ""}` : "";
      // まだ先の段階には、その段階の締切（日程）の日付を小さく
      const dl = s !== "offer" && i >= Math.max(idx, 0) && !ENDED.has(s) ? stepEvents(c, p, i)[0] : null;
      const dlTag = dl ? `<span class="st-dl ${evRemain(dl).cls}">${esc(fmtDate(dl.date).replace(/\(.\)$/, "").replace(/^\d{4}\//, ""))}${dl.kind === "event" ? "" : "締切"}</span>` : "";
      html += `<li class="${cls}"${i === idx ? ' aria-current="step"' : ""}><button class="station" data-step="${key}:${i}" title="押すと、いまの段階を「${esc(name)}」にする">
        <span class="st"></span><span class="route-name">${esc(name)}</span>${dlTag}</button></li>`;
    });
    html += `</ol>`;
  }

  if (waiting) html += resultBox(c, p);
  // 結果待ちでなければ、いまの段階（応募前なら最初の段階）の締切
  // （応募前は、締切が入っている最初の段階。どこにもなければ最初の段階）
  else if (p.flow.length && (s === "plan" || s === "todo")) {
    const first = p.flow.findIndex((_, i) => stepEvents(c, p, i).length);
    html += stepBox(c, p, s === "plan" || idx < 0 ? Math.max(first, 0) : idx);
  }

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

// 上: 調べたリンクの列（採用ページ・開いているルートの募集ページとエントリー）と、
// その下にログインのまとまり（マイページ・ID・PW と、その編集）。ID は見せたまま、パスワードは伏せたまま押すとコピー
function linkBar(c, p) {
  const m = c.mypage;
  const slugE = esc(c.slug);
  const ext = (url, icon, label, sub = "") => `<a class="qa" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon}<span>${label}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</a>`;
  // ルートが複数あるときは、どのルートのリンクか添える
  const which = p && c.programs.length > 1 ? KIND_SHORT[p.kind] || p.kind : "";
  const seen = new Set([c.recruitUrl]);
  const route = p ? [[p.url, ICONS.globe, "募集ページ"], [p.entryUrl, ICONS.door, "エントリー"]]
    .filter(([u]) => u && !seen.has(u) && seen.add(u))
    .map(([u, i, l]) => ext(u, i, l, which)) : [];
  const links = [c.recruitUrl && ext(c.recruitUrl, ICONS.globe, "採用ページ"), ...route].filter(Boolean).join("");
  const login = hasLogin(c)
    ? `<div class="login-box"><span class="login-label">${ICONS.key}ログイン</span>
        ${m.url ? ext(m.url, ICONS.door, "マイページ") : ""}
        ${m.id ? `<button class="qa cred-chip" data-copy="${esc(m.id)}" data-copy-label="ID" title="IDをコピー" aria-label="IDをコピー"><small>ID</small><code>${esc(m.id)}</code>${ICONS.copy}</button>` : ""}
        ${m.password ? `<button class="qa cred-chip" data-copy="${esc(m.password)}" data-copy-label="パスワード" title="パスワードをコピー" aria-label="パスワードをコピー"><small>PW</small><code>••••••</code>${ICONS.copy}</button>` : ""}
        ${editBtn(`login:${slugE}`, "ログイン情報を編集")}</div>`
    : `<div class="login-box is-empty">${addBtn(`login:${slugE}`, "マイページのログインを登録")}</div>`;
  return `<section class="login-card">${links ? `<div class="quick">${links}</div>` : ""}${login}</section>`;
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
  // 段階に付いた締切・日程はルートの中（押印欄と締切の欄）に出すので、ここには出さない
  const open = all.filter((e) => !e.done && !isShown(e) && stepOf(c, e) < 0).sort(byWhen);
  const past = [
    ...all.filter((e) => e.done).map((e) => ({ date: e.date, ev: e })),
    ...c.history.map((h) => ({ date: h.date, text: h.text })),
  ].sort((a, b) => b.date.localeCompare(a.date) || (a.ev ? 1 : 0) - (b.ev ? 1 : 0));
  const pastItem = (x) => x.ev
    ? `<li class="tl-ev"><span class="h-date">${esc(fmtDate(x.date))}</span><span class="tl-body"><span class="tl-done">済</span>${routeTag(c, x.ev)}${esc(x.ev.title)}</span>
        <label class="tl-undo" title="済みを取り消す"><input type="checkbox" checked data-toggle="${slugE}:${x.ev.i}" aria-label="${esc(x.ev.title)} を未完了に戻す"></label>${editBtn(`ev:${slugE}:${x.ev.i}`, `${esc(x.ev.title)} を編集`)}</li>`
    : `<li><span class="h-date">${esc(fmtDate(x.date))}</span><span class="tl-body">${esc(x.text)}</span></li>`;
  const head = past.slice(0, 20);
  const rest = past.slice(20);
  return `<section class="card timeline"><h2 class="sec">予定と記録<span class="sec-acts">${addBtn(`ev:${slugE}:new~${p ? esc(p.id) : ""}`, "予定")}${addBtn(`record:${slugE}`, "記録")}</span></h2>
    ${open.length ? `<ul class="checklist ev-list">${open.slice(0, SOON).map((e) => evItem(c, e)).join("")}</ul>` : `<p class="hint">これからの予定はありません。</p>`}
    ${open.length > SOON ? `<details class="tl-more"><summary>その先の予定<span class="count">${open.length - SOON}</span></summary><ul class="checklist ev-list">${open.slice(SOON).map((e) => evItem(c, e)).join("")}</ul></details>` : ""}
    ${past.length ? `<h3 class="tl-head">これまで</h3><ol class="history">${head.map(pastItem).join("")}</ol>` : ""}
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
      ${editBtn(`basic:${slugE}`, "基本情報を編集")}
    </header>
    ${c.dropped ? `<section class="dropped-banner"><p><b>見送りにした企業</b><span>${esc(fmtDate(c.dropped))}に行かないと決めました。ホームと予定には出ません。</span></p><button class="btn" data-drop="${slugE}:off">見送りをやめる</button></section>` : ""}
    ${linkBar(c, p)}`;

  // 選考ルートが複数あれば1行ずつ並べ、選んだルートの中身をその下に開く
  html += `<h2 class="sec">選考ルート${c.programs.length > 1 ? `<span class="count">${c.programs.length}</span>` : ""}${addBtn(`prog:${slugE}:`, "ルート")}</h2>`;
  if (c.programs.length > 1) {
    html += `<ol class="prog-list">${sortPrograms(c)
        .map((q) => `<li class="${q.id === p.id ? "is-open" : ""}">${progRow(c, q, { current: q.id === p.id })}${q.id === p.id ? programPanel(c, q, { inList: true }) : ""}</li>`)
        .join("")}</ol>`;
  } else {
    html += p
      ? programPanel(c, p)
      : `<section class="empty-panel">選考ルート（本選考・インターンなど）が登録されていません。${addBtn(`prog:${slugE}:`, "ルートを追加")}</section>`;
  }

  html += timeline(c, p);

  // ES・企業研究はノートを開くだけ（設問と文章はノートで見る）
  const note = hasNote(c.slug);
  html += `<section class="card"><h2 class="sec">ES・企業研究</h2>${note
    ? `<a class="btn wide" href="#/doc/${encodeURIComponent(`notes/${c.slug}.md`)}">${ICONS.doc}ノートを開く</a>`
    : state.docs ? `<button class="btn ghost wide" data-newnote="${slugE}">${ICONS.plus}ノートを作る</button>` : `<p class="hint">読み込み中…</p>`}</section>`;

  html += `<section class="card"><h2 class="sec">メモ${editBtn(`memo:${slugE}`, "メモを編集")}</h2>${
    c.memo?.trim() ? `<div class="md">${renderMarkdown(c.memo)}</div>` : `<p class="hint">調べたことや出典はここに。</p>`}</section>`;

  // やること: 済んだらチェックで消える
  html += `<section class="card"><h2 class="sec">やること${c.todo.length ? `<span class="count">${c.todo.length}</span>` : ""}${addBtn(`todo:${slugE}`, "やること")}</h2>
    ${c.todo.length ? `<ul class="checklist todo-list">${c.todo
      .map((t) => `<li><label><input type="checkbox" data-todo-done="${slugE}" value="${esc(t)}"><span class="ck-body"><span class="ck-title">${esc(t)}</span></span></label></li>`)
      .join("")}</ul>` : `<p class="hint">調べること・転記することなど。済んだらチェックで消えます。</p>`}
  </section>`;
  // 企業として見送る（行かないと決めた）。選考ルートの状況は残すので、やめれば元に戻る
  if (!c.dropped) {
    html += `<section class="drop-row"><button class="btn quiet wide" data-drop="${slugE}:on">この企業を見送る（行かないと決めた）</button>
      <p class="hint">ホーム・予定・志望度のタブから外れ、企業一覧の「見送り」のタブに移ります。選考ルートの状況やメモはそのまま残ります。</p></section>`;
  }
  return html;
}
