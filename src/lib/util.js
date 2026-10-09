export const WD = ["日", "月", "火", "水", "木", "金", "土"];
export const NAVY = "#1F2A44";
export const LINE = "#D5DCE2";
export const RED = "#9B2C2C";

// 枠（仕込み・ランチ・ディナー）
export const PARTS = {
  prep: { label: "仕込み", short: "仕", bg: "#C9D8C2", fg: "#1F3A18" },
  lunch: { label: "ランチ", short: "L", bg: "#F3D27A", fg: "#4A3600" },
  dinner: { label: "ディナー", short: "D", bg: "#B99BC6", fg: "#2B1234" },
};
export const PART_KEYS = ["prep", "lunch", "dinner"];
export const CUSTOM = { label: "時間指定", short: "他", bg: "#CFD8DE", fg: "#1F2A44" };
export const STATUS = {
  pending: { label: "未承認", bg: "#EEF1F3", fg: "#5A6B7A" },
  approved: { label: "承認", bg: "#CFE8D8", fg: "#0F3A24" },
  rejected: { label: "不可", bg: "#F7E4E4", fg: "#7A1E1E" },
};
export const TYPE = {
  weekday: { label: "平日", fg: NAVY },
  holiday: { label: "土日祝", fg: RED },
  event: { label: "イベント", fg: "#7A4A00" },
};
export const SKILLS = {
  can_delivery: { label: "デリバリー", short: "配" },
  can_kitchen: { label: "厨房", short: "厨" },
};
export const DEFAULT_WINDOWS = { prep: [9, 11], lunch: [11, 15], dinner: [17, 22] };

export const pad = (n) => String(n).padStart(2, "0");
export const dkey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const mkey = (y, m) => `${y}-${pad(m + 1)}`;
export const fmt = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`;
};
export const hhmm = (t) => (t ? t.slice(0, 5) : "");
export const toHour = (t) => {
  const [h, mm] = (t || "0:0").split(":").map(Number);
  return h + (mm || 0) / 60;
};
const overlaps = (s, e, [a, b]) => Math.min(e, b) - Math.max(s, a) > 0;

// 希望がどの枠に入るか
export function partsOf(req, windows = DEFAULT_WINDOWS) {
  if (!req) return [];
  if (req.type === "custom") {
    const s = toHour(req.start_time), e = toHour(req.end_time);
    return PART_KEYS.filter((p) => overlaps(s, e, windows[p] || DEFAULT_WINDOWS[p]));
  }
  return PART_KEYS.filter((p) => (req.parts || []).includes(p));
}
export const covers = (req, part, windows) => partsOf(req, windows).includes(part);

// 表示用
const ordered = (r) => PART_KEYS.filter((p) => (r.parts || []).includes(p));
export const slotText = (r) =>
  r.type === "custom" ? `${hhmm(r.start_time)}〜${hhmm(r.end_time)}` : ordered(r).map((p) => PARTS[p].label).join("＋") || "？";
export const slotShort = (r) =>
  r.type === "custom" ? `${hhmm(r.start_time).slice(0, 2)}-${hhmm(r.end_time).slice(0, 2)}` : ordered(r).map((p) => PARTS[p].short).join("") || "？";
export const slotStyle = (r) => {
  if (r.type === "custom") return CUSTOM;
  const ps = ordered(r);
  if (ps.length === 1) return PARTS[ps[0]];
  if (ps.includes("lunch") && ps.includes("dinner")) return { bg: "#8FBFA6", fg: "#0F3A24" }; // 通し
  return PARTS[ps[0]] || CUSTOM;
};

const toT = (h) => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;

// 枠の組み合わせから標準の始業・終業（実働時間の初期値）
export function defaultTimes(req, windows = DEFAULT_WINDOWS) {
  if (req.type === "custom") return { start: hhmm(req.start_time), end: hhmm(req.end_time) };
  const ps = partsOf(req, windows);
  if (!ps.length) return { start: "10:00", end: "15:00" };
  const w = ps.map((p) => windows[p] || DEFAULT_WINDOWS[p]);
  return { start: toT(Math.min(...w.map((x) => x[0]))), end: toT(Math.max(...w.map((x) => x[1]))) };
}

// 通しの休憩はこの時刻まで（休憩開始だけ日ごとに入力する）
export const BREAK_END = "17:00";

// 日ごとの営業時間の初期値（枠の時間帯から）
export const defaultDayHours = (windows = DEFAULT_WINDOWS) => ({
  lunch: { start: toT(windows.lunch[0]), end: toT(windows.lunch[1]) },
  dinner: { start: toT(windows.dinner[0]), end: toT(windows.dinner[1]) },
  break_start: toT(windows.lunch[1]),
});

// 日ごとの営業時間（一括入力）から、その人の始業・終業・休憩を出す
export function autoWork(req, H, windows = DEFAULT_WINDOWS) {
  if (!H) return null;
  const ps = partsOf(req, windows);
  if (!ps.length) return null;
  let start, end;
  if (req.type === "custom") {
    // 「ランチ終業」「ディナー終業」で入れた希望は、その日の実際の終業に合わせる
    const e = toHour(req.end_time);
    start = hhmm(req.start_time);
    end = e === windows.lunch[1] ? H.lunch.end : e === windows.dinner[1] ? H.dinner.end : hhmm(req.end_time);
  } else {
    const range = (p) => (H[p] ? [H[p].start, H[p].end] : (windows[p] || DEFAULT_WINDOWS[p]).map(toT));
    const rs = ps.map(range);
    start = rs.map((r) => r[0]).reduce((a, b) => (toHour(b) < toHour(a) ? b : a));
    end = rs.map((r) => r[1]).reduce((a, b) => (toHour(b) > toHour(a) ? b : a));
  }
  const through = ps.includes("lunch") && ps.includes("dinner");
  const bs = Math.max(toHour(start), toHour(H.break_start || H.lunch.end));
  const be = Math.min(toHour(end), toHour(BREAK_END));
  const break_min = through ? Math.max(0, Math.round((be - bs) * 60)) : 0;
  return { start_time: start, end_time: end, break_min };
}
export const workHours = (log) => (log ? Math.max(0, toHour(log.end_time) - toHour(log.start_time) - (log.break_min || 0) / 60) : 0);
export const fmtHours = (h) => (Math.round(h * 100) / 100).toFixed(2).replace(/\.?0+$/, "");

export function monthDays(y, m) {
  const n = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: n }, (_, i) => ({ d: i + 1, k: dkey(y, m, i + 1), w: new Date(y, m, i + 1).getDay() }));
}

export const dayColor = (d, hol) => (d.w === 0 || (hol && d.w !== 6) ? RED : d.w === 6 ? "#2C5282" : undefined);
