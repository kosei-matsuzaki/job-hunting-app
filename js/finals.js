// 確定版: profile/確定版/<テーマ>.md
// 本人が書いた決定稿だけを置く。ファイルの頭に「# テーマ名」「> 話: E1｜種類: 経験・スキル、ガクチカ」と説明、
// その下に字数違いの版を「## 200字版」のように並べる。版の下の「> 」の行は、いつ・どこで確定したかのメモ

import { FINALS_DIR, TOPICS } from "./config.js";
import { parseMeta } from "./md.js";
import { state } from "./store.js";

export const countChars = (s) => s.replace(/\s/g, "").length;
export const finalPath = (file) => `${FINALS_DIR}/${file}.md`;
export const isFinal = (path) => path.startsWith(`${FINALS_DIR}/`);
export const finalFile = (path) => path.split("/").pop().replace(/\.md$/, "");

// 見出しで区切る。[頭の部分, "## …" で始まる版, …]
const split = (text) => text.split(/^(?=## )/m);
const headOf = (sec) => sec.split("\n")[0].replace(/^##\s*/, "").trim();

const parsed = new WeakMap();

export function parseFinal(path, doc) {
  if (parsed.has(doc)) return parsed.get(doc);
  const [top, ...secs] = split(doc.text);
  let name = finalFile(path);
  let meta = {};
  const desc = [];
  for (const line of top.split("\n")) {
    const m = line.startsWith(">") && parseMeta(line.replace(/^>\s?/, ""));
    if (/^# /.test(line)) name = line.slice(2).trim();
    else if (m) meta = m;
    else desc.push(line);
  }
  const versions = secs
    .map((sec) => {
      const lines = sec.split("\n").slice(1);
      const memo = lines.filter((l) => l.startsWith(">")).map((l) => l.replace(/^>\s?/, "")).join("\n").trim();
      const body = lines.filter((l) => !l.startsWith(">")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
      // ESの欄に貼るときは、段落の間の空行を1つの改行にする
      return { head: headOf(sec), body, memo, text: body.replace(/\n\s*\n/g, "\n"), chars: countChars(body) };
    })
    .filter((v) => v.head && v.body)
    .sort((a, b) => a.chars - b.chars);
  const kinds = (meta.種類 || "").split(/[、,]/).map((s) => s.trim()).filter(Boolean);
  const theme = {
    path,
    file: finalFile(path),
    name,
    desc: desc.join("\n").trim(),
    eps: (meta.話 || "").split(/[・、,\s]+/).filter(Boolean),
    kinds,
    topics: TOPICS.filter((t) => kinds.includes(t.name)).map((t) => t.key),
    versions,
  };
  parsed.set(doc, theme);
  return theme;
}

export const finalPaths = () => (state.docs?.find((g) => g.dir === "profile")?.paths || []).filter(isFinal);

// 読み込んだ確定版のテーマ。版のあるものを先に
export function finals() {
  return finalPaths()
    .filter((p) => state.docCache.has(p))
    .map((p) => parseFinal(p, state.docCache.get(p)))
    .sort((a, b) => !a.versions.length - !b.versions.length || a.name.localeCompare(b.name, "ja"));
}

const block = (v) => `## ${v.head}\n\n${v.body.trim()}\n${v.memo ? `\n${v.memo.split("\n").map((l) => `> ${l}`).join("\n")}\n` : ""}`;
const join = (top, secs) => [top.trimEnd(), ...secs.map((s) => s.trimEnd())].join("\n\n") + "\n";

// 版を書き換える（old の見出しの版、なければ同じ見出しの版。どちらもなければ末尾に足す）。
// 別の端末と競合したら最新に当て直すので、何度当てても同じ結果になるようにする
export function setVersion(text, old, v) {
  const [top, ...secs] = split(text);
  let i = secs.findIndex((s) => headOf(s) === (old || v.head));
  if (i < 0 && old) i = secs.findIndex((s) => headOf(s) === v.head);
  if (i >= 0) secs[i] = block(v);
  else secs.push(block(v));
  return join(top, secs);
}

export function removeVersion(text, head) {
  const [top, ...secs] = split(text);
  return join(top, secs.filter((s) => headOf(s) !== head));
}

export function newFinalText(name) {
  return `# ${name}\n\n> 種類: その他\n\nどんな設問で使うか。\n`;
}
