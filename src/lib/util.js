export const WD = ["日", "月", "火", "水", "木", "金", "土"];
export const NAVY = "#1F2A44";
export const LINE = "#D5DCE2";
export const RED = "#9B2C2C";

export const SLOT = {
  lunch: { label: "ランチ", short: "L", bg: "#F3D27A", fg: "#4A3600" },
  dinner: { label: "ディナー", short: "D", bg: "#B99BC6", fg: "#2B1234" },
  both: { label: "通し", short: "通", bg: "#8FBFA6", fg: "#0F3A24" },
  custom: { label: "時間指定", short: "他", bg: "#CFD8DE", fg: "#1F2A44" },
};
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

const LUNCH_WIN = [11, 15];
const DINNER_WIN = [17, 22];

export const pad = (n) => String(n).padStart(2, "0");
export const dkey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const mkey = (y, m) => `${y}-${pad(m + 1)}`;
export const fmt = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`;
};
export const hhmm = (t) => (t ? t.slice(0, 5) : "");
const toHour = (t) => {
  const [h, mm] = (t || "0:0").split(":").map(Number);
  return h + (mm || 0) / 60;
};
const overlaps = (s, e, [a, b]) => Math.min(e, b) - Math.max(s, a) > 0;

export const slotText = (r) => (r.type === "custom" ? `${hhmm(r.start_time)}〜${hhmm(r.end_time)}` : SLOT[r.type].label);
export const slotShort = (r) => (r.type === "custom" ? `${hhmm(r.start_time).slice(0, 2)}-${hhmm(r.end_time).slice(0, 2)}` : SLOT[r.type].short);

export function covers(req, part) {
  if (!req) return false;
  if (req.type === "both" || req.type === part) return true;
  if (req.type === "custom") return overlaps(toHour(req.start_time), toHour(req.end_time), part === "lunch" ? LUNCH_WIN : DINNER_WIN);
  return false;
}

export function monthDays(y, m) {
  const n = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: n }, (_, i) => ({ d: i + 1, k: dkey(y, m, i + 1), w: new Date(y, m, i + 1).getDay() }));
}

export const dayColor = (d, hol) => (d.w === 0 || (hol && d.w !== 6) ? RED : d.w === 6 ? "#2C5282" : undefined);
