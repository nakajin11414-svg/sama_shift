export const WD = ["日", "月", "火", "水", "木", "金", "土"];
export const NAVY = "#1F2A44";
export const LINE = "#D5DCE2";
export const RED = "#9B2C2C";

// 枠（仕込み・ランチ・ディナー）
export const PARTS = {
  prep: { label: "仕込み", short: "仕", bg: "#C9D8C2", fg: "#1F3A18" },
  lunch: { label: "ランチ", short: "ラ", bg: "#F3D27A", fg: "#4A3600" },
  dinner: { label: "ディナー", short: "デ", bg: "#B99BC6", fg: "#2B1234" },
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
// 基準人数の初期値（delivery / kitchen はランチ・ディナーそれぞれに必要なデリバリー・厨房の人数。仕込みは不要）
export const DEFAULT_RULE = { prep: 0, lunch: 0, dinner: 0, delivery: 1, kitchen: 1 };
export const SKILL_PARTS = ["lunch", "dinner"];

// デリバリー・厨房の不足。両方できる人は、どちらか一方にしか数えない
// 戻り値: { delivery, kitchen, either }（either = 両方できる人が足りず、どちらかがあと何人足りないか）
export function skillShortage(c, rule, part) {
  const on = SKILL_PARTS.includes(part);
  const d = on ? rule.delivery || 0 : 0, k = on ? rule.kitchen || 0 : 0;
  const delivery = Math.max(0, d - c.onlyDelivery - c.both);
  const kitchen = Math.max(0, k - c.onlyKitchen - c.both);
  const total = Math.max(0, Math.max(0, d - c.onlyDelivery) + Math.max(0, k - c.onlyKitchen) - c.both);
  const either = Math.max(0, total - delivery - kitchen);
  return { delivery, kitchen, either, any: delivery + kitchen + either > 0 };
}

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
  r.type === "custom" ? `${hhmm(r.start_time).slice(0, 2)}-${hhmm(r.end_time).slice(0, 2)}` : ordered(r).map((p) => PARTS[p].short).join("").replace("ラデ", "通") || "？";
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

// 日ごとに入れるのは各枠の終業と通しの休憩開始だけ（開始は店舗の枠の時間帯で固定）
export const defaultDayHours = (windows = DEFAULT_WINDOWS) => ({
  prep: { end: toT(windows.prep[1]) },
  lunch: { end: toT(windows.lunch[1]) },
  dinner: { end: toT(windows.dinner[1]) },
  break_start: toT(windows.lunch[1]),
});

// その人の始業・終業・休憩を出す
// H: その日の終業（一括入力）、own: 個別に直した始業・終業（あれば優先）
export function autoWork(req, H, windows = DEFAULT_WINDOWS, own = null) {
  if (!H && !own) return null;
  const ps = partsOf(req, windows);
  const win = (p) => windows[p] || DEFAULT_WINDOWS[p];
  const endOf = (p) => H?.[p]?.end || toT(win(p)[1]);
  let start, end;
  if (own) {
    start = hhmm(own.start_time); end = hhmm(own.end_time);
  } else if (req.type === "custom") {
    // 「ランチ終業」「ディナー終業」で入れた希望は、その日の実際の終業に合わせる
    const e = toHour(req.end_time);
    start = hhmm(req.start_time);
    end = e === win("lunch")[1] ? endOf("lunch") : e === win("dinner")[1] ? endOf("dinner") : hhmm(req.end_time);
  } else {
    if (!ps.length) return null;
    start = toT(Math.min(...ps.map((p) => win(p)[0])));
    end = ps.map(endOf).reduce((a, b) => (toHour(b) > toHour(a) ? b : a));
  }
  // 通しは休憩開始〜17時を休憩にする
  const through = ps.includes("lunch") && ps.includes("dinner");
  const bs = Math.max(toHour(start), toHour(H?.break_start || endOf("lunch")));
  const be = Math.min(toHour(end), toHour(BREAK_END));
  const break_min = through ? Math.max(0, Math.round((be - bs) * 60)) : 0;
  return { start_time: start, end_time: end, break_min };
}
export const workHours = (log) => (log ? Math.max(0, toHour(log.end_time) - toHour(log.start_time) - (log.break_min || 0) / 60) : 0);
export const fmtHours = (h) => (Math.round(h * 100) / 100).toFixed(2).replace(/\.?0+$/, "");

// 日本の祝日（振替休日・国民の休日を含む）。春分・秋分は 1980〜2099 年の近似式
const holidayCache = {};
function jpHolidays(y) {
  if (holidayCache[y]) return holidayCache[y];
  const h = {};
  const add = (m, d, name) => { h[dkey(y, m - 1, d)] = name; };
  const nthMonday = (m, n) => { const w = new Date(y, m - 1, 1).getDay(); return 1 + ((8 - w) % 7) + (n - 1) * 7; };
  const q = Math.floor((y - 1980) / 4);
  add(1, 1, "元日");
  add(1, nthMonday(1, 2), "成人の日");
  add(2, 11, "建国記念の日");
  add(2, 23, "天皇誕生日");
  add(3, Math.floor(20.8431 + 0.242194 * (y - 1980) - q), "春分の日");
  add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");
  add(7, nthMonday(7, 3), "海の日");
  add(8, 11, "山の日");
  add(9, nthMonday(9, 3), "敬老の日");
  add(9, Math.floor(23.2488 + 0.242194 * (y - 1980) - q), "秋分の日");
  add(10, nthMonday(10, 2), "スポーツの日");
  add(11, 3, "文化の日");
  add(11, 23, "勤労感謝の日");
  const keyOf = (dt) => dkey(dt.getFullYear(), dt.getMonth(), dt.getDate());
  // 国民の休日（祝日に挟まれた平日）
  for (const k of Object.keys(h)) {
    const [yy, mm, dd] = k.split("-").map(Number);
    const mid = new Date(yy, mm - 1, dd + 1), next = new Date(yy, mm - 1, dd + 2);
    if (!h[keyOf(mid)] && h[keyOf(next)] && mid.getDay() !== 0) h[keyOf(mid)] = "国民の休日";
  }
  // 振替休日（日曜の祝日の後の最初の平日）
  for (const k of Object.keys(h)) {
    const [yy, mm, dd] = k.split("-").map(Number);
    if (new Date(yy, mm - 1, dd).getDay() !== 0) continue;
    let dt = new Date(yy, mm - 1, dd + 1);
    while (h[keyOf(dt)]) dt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1);
    h[keyOf(dt)] = "振替休日";
  }
  return (holidayCache[y] = h);
}
export const holidayName = (k) => jpHolidays(Number(k.slice(0, 4)))[k];

export function monthDays(y, m) {
  const n = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: n }, (_, i) => ({ d: i + 1, k: dkey(y, m, i + 1), w: new Date(y, m, i + 1).getDay() }));
}

export const dayColor = (d, hol) => (d.w === 0 || (hol && d.w !== 6) ? RED : d.w === 6 ? "#2C5282" : undefined);
