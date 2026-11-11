// GitHub API（Contents API でファイルを読み書きする）

import { cfg } from "./store.js";

class ApiError extends Error {
  constructor(status, body) {
    super(`GitHub API ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

function b64decode(s) {
  const bin = atob(s.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function b64encode(text) {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function readFile(path) {
  const r = await api(`contents/${encPath(path)}`);
  return { text: b64decode(r.content), sha: r.sha };
}

export async function writeFile(path, text, sha, message) {
  const r = await api(`contents/${encPath(path)}`, {
    method: "PUT",
    body: { message, content: b64encode(text), ...(sha ? { sha } : {}) },
  });
  return r.content.sha;
}

export async function listDocs(dir) {
  try {
    const files = await api(`contents/${encPath(dir)}`);
    // 下のフォルダ（profile/回答 など）もたどる
    const subs = await Promise.all(files.filter((f) => f.type === "dir").map((f) => listDocs(f.path)));
    return [...files.filter((f) => f.type === "file" && f.name.endsWith(".md")).map((f) => f.path), ...subs.flat()];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

export function explain(e) {
  if (e.status === 401) return "トークンが無効か、期限が切れています。設定から新しいトークンを入れてください。";
  if (e.status === 403) return "このトークンには権限がありません。Contents の Read and write を付けたトークンにしてください。";
  if (e.status === 404) return `${cfg.repo} にファイルが見つかりません。リポジトリ名とトークンの対象リポジトリを確認してください。`;
  if (e instanceof TypeError) return "GitHub に接続できません。電波の状況を確認してください。";
  return `読み込みに失敗しました（${e.message}）`;
}
