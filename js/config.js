// 定数: 状況・選考の種類・業界など

export const DEFAULT_REPO = "kosei-matsuzaki/job-hunting";

export const DATA_PATH = "data/companies.json";

export const DOC_GROUPS = [
  { dir: "profile", label: "ES・面接の素材" },
  { dir: "notes", label: "企業研究・ES下書き" },
];

export const EXTRA_DOCS = [{ path: "links.md", name: "就活サイト・対策" }];

// 素材を設問の種類でまとめる。name は ES の情報の行の「種類」、files は profile/ にある土台
export const TOPICS = [
  { key: "gakuchika", name: "ガクチカ", ask: "学生時代に力を入れたこと・挑戦", files: ["profile/回答/ガクチカ.md"] },
  { key: "hardship", name: "困難・挫折", ask: "苦労した経験・困難をどう乗り越えたか", files: [] },
  { key: "pr", name: "自己PR", ask: "自己PR・強み・人柄", files: ["profile/回答/自己PR.md"] },
  { key: "team", name: "チーム", ask: "チームでの経験・リーダー経験", files: ["profile/回答/チーム.md"] },
  { key: "research", name: "研究", ask: "研究内容・卒業研究・学んでいること", files: ["profile/回答/研究.md"] },
  { key: "motive", name: "志望動機", ask: "志望理由・なぜこの会社か・入社後にやりたいこと", files: ["profile/回答/志望動機.md"] },
  { key: "skill", name: "経験・スキル", ask: "インターン・開発経験・言語・制作物", files: ["profile/回答/経験・スキル.md", "profile/基本情報.md"] },
  { key: "other", name: "その他", ask: "参加理由・興味のある技術・URL など", files: [] },
];

export const EPISODES_PATH = "profile/エピソード.md";

// 確定版（本人が書いた決定稿）。テーマごとに1ファイル
export const FINALS_DIR = "profile/確定版";

// 選考ルートごとの状況。「応募前 → 選考中 → 内定」と進み、途中で終わったら見送り・辞退・不合格。
// 選考中で、そのルートにこれからの予定がなければ「結果待ち」と表示する（予定から決まるので手では切り替えない）。
// 鍵は古い版と同じ plan・todo を使う（古い版の画面で開いても状況が崩れないように）
export const STATES = {
  plan: { label: "応募前", hint: "まだ応募していない。応募しないなら「見送り」に" },
  todo: { label: "選考中", hint: "応募した。通過したら段階を進める" },
  offer: { label: "内定", hint: "内定をもらった" },
  skip: { label: "見送り", hint: "応募しないと決めた" },
  declined: { label: "辞退", hint: "選考の途中や内定のあとに辞退した" },
  rejected: { label: "不合格", hint: "選考で不合格だった" },
};

// 以前の状況（気になる・応募予定・対応中・結果待ち など）の読み替え
export const OLD_STATES = { watch: "plan", before: "plan", waiting: "todo" };

export const STATE_GROUPS = [
  { label: "進んでいる", states: ["plan", "todo", "offer"] },
  { label: "終わった", states: ["skip", "declined", "rejected"] },
];

export const ENDED = new Set(["skip", "declined", "rejected"]);

export const STATE_RANK = { offer: 0, todo: 1, plan: 2, skip: 3, declined: 4, rejected: 5 };

// 企業一覧のタブ
export const COMPANY_TABS = [
  { v: "active", label: "選考中", test: (s) => s === "todo" || s === "offer" },
  { v: "plan", label: "応募前", test: (s) => s === "plan" },
  { v: "closed", label: "終了", test: (s) => ENDED.has(s) },
];

export const KINDS = ["本選考", "インターン", "早期選考", "説明会・イベント"];

// 一覧で使う短い名前
export const KIND_SHORT = { 本選考: "本選考", インターン: "インターン", 早期選考: "早期", "説明会・イベント": "説明会" };

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
  { v: "result", label: "結果の連絡（この日までに来る予定）" },
];

export const WD = "日月火水木金土";

export const PAST_DAYS = 14;
