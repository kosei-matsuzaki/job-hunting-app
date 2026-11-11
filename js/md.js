// リポジトリ内の Markdown（profile/・notes/・メモ欄）を表示するための最小限のレンダラー。
// 見出しごとに区切って文字数・コピーを付けられるよう、HTML 文字列ではなくブロックの配列を返す。

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

function resolvePath(dir, href) {
  const parts = dir ? dir.split("/") : [];
  for (const seg of href.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function link(label, href, ctx) {
  const raw = href.replace(/&amp;/g, "&");
  if (/^https?:\/\//.test(raw)) {
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }
  const path = raw.split("#")[0];
  if (path.endsWith(".md")) {
    const full = resolvePath(ctx.dir || "", path);
    return `<a href="#/doc/${encodeURIComponent(full)}">${label}</a>`;
  }
  return label;
}

export function inline(text, ctx = {}) {
  const tokens = [];
  const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => hold(link(label, href, ctx)));
  s = s.replace(/https?:\/\/[^\s<>（）「」、。]+/g, (url) => hold(link(url, url, ctx)));
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[i]);
}

// コピー用のプレーンテキスト（Markdown 記法を外す）
export function plain(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1");
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function renderList(items, ctx) {
  let html = "";
  const stack = [];
  for (const it of items) {
    const tag = /\d/.test(it.marker) ? "ol" : "ul";
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      stack.push({ indent: it.indent, tag });
      html += `<${tag}>`;
    } else {
      while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) {
        html += `</li></${stack.pop().tag}>`;
      }
      html += "</li>";
    }
    let body = it.text;
    let cls = "";
    const task = body.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      cls = ` class="task${task[1] === " " ? "" : " checked"}"`;
      body = task[2];
    }
    html += `<li${cls}>${inline(body, ctx)}${it.more.map((m) => "<br>" + inline(m, ctx)).join("")}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

export function parseMarkdown(text, ctx = {}) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      const t = body.join("\n");
      blocks.push({ type: "code", text: t, html: `<pre><code>${esc(t)}</code></pre>` });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      blocks.push({ type: "h", level, text: h[2], html: `<h${level + 1}>${inline(h[2], ctx)}</h${level + 1}>` });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr", text: "", html: "<hr>" });
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      const th = head.map((c) => `<th>${inline(c, ctx)}</th>`).join("");
      const tb = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, ctx)}</td>`).join("")}</tr>`).join("");
      blocks.push({ type: "table", text: "", html: `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>` });
      continue;
    }
    if (line.trimStart().startsWith(">")) {
      const body = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) body.push(lines[i++].trimStart().replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: body.join("\n"), html: `<blockquote>${body.map((b) => inline(b, ctx)).join("<br>")}</blockquote>` });
      continue;
    }
    if (LIST_RE.test(line)) {
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        const m = lines[i].match(LIST_RE);
        if (m) items.push({ indent: m[1].replace(/\t/g, "    ").length, marker: m[2], text: m[3], more: [] });
        else if (/^\s/.test(lines[i]) && items.length) items[items.length - 1].more.push(lines[i].trim());
        else break;
        i++;
      }
      blocks.push({ type: "list", text: items.map((it) => it.text).join("\n"), html: renderList(items, ctx) });
      continue;
    }
    const body = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !LIST_RE.test(lines[i]) &&
      !lines[i].trimStart().startsWith(">") &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith("|")
    ) {
      body.push(lines[i++]);
    }
    if (!body.length) {
      // どの記法にも当てはまらない行（表の崩れなど）は段落として出す
      body.push(lines[i++]);
    }
    blocks.push({ type: "p", text: body.join("\n"), html: `<p>${body.map((b) => inline(b, ctx)).join("<br>")}</p>` });
  }
  return blocks;
}

export function renderMarkdown(text, ctx) {
  return parseMarkdown(text, ctx)
    .map((b) => b.html)
    .join("");
}
