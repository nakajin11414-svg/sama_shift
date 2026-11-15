import { useEffect, useRef, useState } from "react";
import { NAVY, LINE, RED } from "./lib/util.js";

// 横スクロールのバーを上と下の両方に出す（横に長い表用）
export const DualScroll = ({ children, className = "" }) => {
  const top = useRef(null), body = useRef(null), lock = useRef(false);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const update = () => setW(el.scrollWidth > el.clientWidth ? el.scrollWidth : 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  // 片方を動かしたらもう片方を合わせる（互いに呼び合わないように lock する）
  const sync = (from, to) => () => {
    if (lock.current) { lock.current = false; return; }
    if (to.current && to.current.scrollLeft !== from.current.scrollLeft) { lock.current = true; to.current.scrollLeft = from.current.scrollLeft; }
  };
  return (
    <>
      {w > 0 && (
        <div ref={top} onScroll={sync(top, body)} className="overflow-x-auto overflow-y-hidden" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div style={{ width: w, height: 1 }} />
        </div>
      )}
      <div ref={body} onScroll={sync(body, top)} className={`overflow-x-auto ${className}`}>{children}</div>
    </>
  );
};

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

export const Card = ({ children, className = "", style, ...rest }) => (
  <div className={`rounded bg-white ${className}`} style={{ border: `1px solid ${LINE}`, ...style }} {...rest}>{children}</div>
);

export const Gauge = ({ n, p = 0, need }) => {
  const tone = n > need ? { bg: "#F7C6C6", fg: "#7A1E1E" } : n < need ? { bg: "#FBE7B2", fg: "#5C4300" } : { bg: "#CFE8D8", fg: "#0F3A24" };
  return (
    <span className="tabular-nums text-xs px-1.5 py-0.5 rounded" style={{ background: tone.bg, color: tone.fg }}>
      {n}<span className="opacity-60">/{need}</span>{p > 0 && <span className="opacity-60"> +{p}</span>}
    </span>
  );
};
