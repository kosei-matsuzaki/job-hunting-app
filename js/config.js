// 定数: 状況・選考の種類・業界など

export const DEFAULT_REPO = "kosei-matsuzaki/job-hunting";

export const DATA_PATH = "data/companies.json";

export const DOC_GROUPS = [
  { dir: "profile", label: "ES・面接の素材" },
  { dir: "notes", label: "企業研究・ES下書き" },
];

export const EXTRA_DOCS = [{ path: "links.md", name: "就活サイト・対策" }];

// 選考ルートごとの状況。step は選考フローの中のいまの段階
// 「気になる → 応募予定 → 選考中（対応中・結果待ち） → 内定」と進み、途中で終わったら「終了」
export const STATES = {
  watch: { label: "気になる", hint: "候補。まだ応募するか決めていない" },
  plan: { label: "応募予定", hint: "応募すると決めた。締切を追いかける" },
  todo: { label: "対応中", long: "選考中（自分の番）", hint: "提出・受験・面接を控えている" },
  waiting: { label: "結果待ち", long: "選考中（相手の番）", hint: "結果や連絡を待っている" },
  offer: { label: "内定", hint: "内定をもらった" },
  skip: { label: "見送り", hint: "応募しないと決めた" },
  declined: { label: "辞退", hint: "選考の途中や内定のあとに辞退した" },
  rejected: { label: "不合格", hint: "選考で不合格だった" },
};

export const STATE_GROUPS = [
  { label: "応募する前", states: ["watch", "plan"] },
  { label: "選考中", states: ["todo", "waiting"] },
  { label: "結果", states: ["offer", "declined", "rejected", "skip"] },
];

export const LIVE = ["watch", "plan", "todo", "waiting"];

export const IN_SELECTION = new Set(["todo", "waiting"]);

export const TRACKED = new Set(["plan", "todo", "waiting", "offer"]);

export const ENDED = new Set(["skip", "declined", "rejected"]);

export const STATE_RANK = { offer: 0, todo: 1, waiting: 2, plan: 3, watch: 4, skip: 5, declined: 6, rejected: 7 };

// 企業一覧のタブ
export const COMPANY_TABS = [
  { v: "active", label: "選考中", test: (s) => s === "todo" || s === "waiting" || s === "offer" },
  { v: "plan", label: "応募予定", test: (s) => s === "plan" },
  { v: "watch", label: "気になる", test: (s) => s === "watch" },
  { v: "closed", label: "終了", test: (s) => ENDED.has(s) },
];

export const KINDS = ["本選考", "インターン", "早期選考", "説明会・イベント"];

export const KIND_CLASS = { 本選考: "main", インターン: "intern", 早期選考: "early", "説明会・イベント": "info" };

export const OPEN_STATUSES = ["受付中", "受付前", "終了", "不明"];

export const INDUSTRIES = ["ゲーム", "IT・Web", "AI・R&D", "SIer・通信", "コンサル", "メーカー", "商社", "金融"];

export const IND_CLASS = { ゲーム: "game", "IT・Web": "web", "AI・R&D": "ai", "SIer・通信": "sier", コンサル: "consult", メーカー: "maker", 商社: "trade", 金融: "finance" };

export const SORTS = [
  { v: "deadline", label: "締切が近い順" },
  { v: "salary", label: "初任給が高い順" },
  { v: "priority", label: "志望度順" },
];

export const DEFAULT_FLOW = ["ES", "Webテスト", "一次面接", "最終面接"];

export const PRIORITY_LABEL = { 3: "第一志望群", 2: "受けたい", 1: "様子見" };

export const EVENT_KINDS = [
  { v: "deadline", label: "締切（ES・Webテスト・エントリーなど）" },
  { v: "event", label: "日程（面接・説明会・インターン当日など）" },
];

export const WD = "日月火水木金土";

export const PAST_DAYS = 14;
