import { NAVY, LINE, RED } from "./lib/util.js";

export const Tag = ({ s, children, title, style }) => (
  <span title={title} className="inline-block rounded px-1.5 py-0.5 text-xs leading-tight"
    style={{ background: s.bg, color: s.fg, ...style }}>{children}</span>
);

export const Btn = ({ children, onClick, tone = "ghost", small, disabled, className = "" }) => {
  const st = {
    primary: { background: NAVY, color: "#fff" },
    danger: { background: RED, color: "#fff" },
    ghost: { background: "#fff", color: NAVY, border: `1px solid ${LINE}` },
  }[tone];
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded ${small ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm"} disabled:opacity-40 ${className}`} style={st}>{children}</button>
  );
};

export const Card = ({ children, className = "", style }) => (
  <div className={`rounded bg-white ${className}`} style={{ border: `1px solid ${LINE}`, ...style }}>{children}</div>
);

export const Gauge = ({ n, p = 0, need }) => {
  const tone = n > need ? { bg: "#F7C6C6", fg: "#7A1E1E" } : n < need ? { bg: "#FBE7B2", fg: "#5C4300" } : { bg: "#CFE8D8", fg: "#0F3A24" };
  return (
    <span className="tabular-nums text-xs px-1.5 py-0.5 rounded" style={{ background: tone.bg, color: tone.fg }}>
      {n}<span className="opacity-60">/{need}</span>{p > 0 && <span className="opacity-60"> +{p}</span>}
    </span>
  );
};
