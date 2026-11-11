// 知らせ（トースト）とコピー

import { esc } from "./md.js";

let toastTimer;

let toastAction = null;

// action を渡すと「元に戻す」ボタン付きで少し長めに出す
export function toast(message, isError = false, action = null) {
  const el = document.getElementById("toast");
  toastAction = action;
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="toast-btn" data-toast-action>${esc(action.label)}</button>` : ""}`;
  el.classList.toggle("error", isError);
  el.classList.toggle("actionable", !!action);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    toastAction = null;
  }, isError ? 6000 : action ? 6000 : 2200);
}

export async function copy(text, label = "") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(label ? `${label}をコピーしました` : "コピーしました");
}

// トーストのボタンが押されたとき、出していた操作を受け取る（1回だけ）
export function takeToastAction() {
  const action = toastAction;
  toastAction = null;
  document.getElementById("toast").classList.remove("show");
  return action;
}
