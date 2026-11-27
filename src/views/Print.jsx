import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { WD, PARTS, PART_KEYS, LINE, slotShort } from "../lib/util.js";
import { Btn } from "../ui.jsx";

// 月全体のシフトを店舗ごとに印刷する（A4横・1店舗1ページ）
//   kind: "wish"（シフト希望。管理者用）／ "published"（確定シフト）
//   stores: 印刷できる店舗のデータ（data.allStores の要素）
export function PrintButton({ stores, days, mk, kind, small }) {
  const [sel, setSel] = useState(""); // "" = すべての店舗
  const [job, setJob] = useState(null); // 印刷中の店舗リスト
  useEffect(() => { if (sel && !stores.some((D) => D.store.id === sel)) setSel(""); });
  useEffect(() => {
    if (!job) return;
    const done = () => setJob(null);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 50); // 描画してから印刷画面を開く
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [job]);
  if (!stores.length) return null;
  const label = kind === "wish" ? "希望を印刷" : "印刷";
  return (
    <div className="flex items-center gap-1">
      {stores.length > 1 && (
        <select value={sel} onChange={(e) => setSel(e.target.value)} title="印刷する店舗"
          className="border rounded px-1 py-1.5 text-xs bg-white" style={{ borderColor: LINE }}>
          <option value="">すべての店舗</option>
          {stores.map((D) => <option key={D.store.id} value={D.store.id}>{D.store.name}</option>)}
        </select>
      )}
      <Btn small={small} onClick={() => setJob(stores.filter((D) => !sel || D.store.id === sel))}>{label}</Btn>
      {job && createPortal(
        <div className="print-area">
          {job.map((D) => <PrintSheet key={D.store.id} D={D} days={days} mk={mk} kind={kind} />)}
        </div>,
        document.body,
      )}
    </div>
  );
}

const cell = { border: "1px solid #999", padding: "1px 0", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" };

function PrintSheet({ D, days, mk, kind }) {
  const wish = kind === "wish";
  const [y, m] = mk.split("-").map(Number);
  const rowOf = (s, k) => {
    const r = D.requests[s.id]?.[k];
    if (r) return wish || r.status === "approved" ? r : null;
    return wish ? D.sharedOf(s.id, k) || null : null;
  };
  const staff = D.staffInStore.filter((s) => days.some((d) => rowOf(s, d.k)));
  const text = (s, d) => {
    const r = rowOf(s, d.k);
    if (!r) return "";
    const own = r.store_id === D.store.id;
    const base = (own ? "" : `(${D.storeName(r.store_id).slice(0, 1)})`) + slotShort(r);
    if (!wish || r.type === "off") return base;
    return base + (r.status === "approved" ? "○" : r.status === "rejected" ? "×" : "");
  };
  const now = new Date();
  return (
    <section className="print-page">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <b style={{ fontSize: 14 }}>{D.store.name}　{y}年{m}月　{wish ? "シフト希望" : "確定シフト"}</b>
        {!wish && !D.published && <span style={{ fontSize: 10 }}>（未公開）</span>}
        <span style={{ marginLeft: "auto", fontSize: 9 }}>
          {wish && "○ 出勤　× 休み　印なし 未定　(他) = 他店の希望　"}
          仕=仕込み ラ=ランチ デ=ディナー 通=通し 事=事務 休=休み希望　印刷 {now.getMonth() + 1}/{now.getDate()}
        </span>
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed", fontSize: 9 }}>
        <colgroup><col style={{ width: "11%" }} />{days.map((d) => <col key={d.k} />)}</colgroup>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: "left", paddingLeft: 3 }}>名前</th>
            {days.map((d) => {
              const hol = D.isHoliday(d);
              return (
                <th key={d.k} style={{ ...cell, fontWeight: "normal", background: D.isClosed(d) ? "#ddd" : hol ? "#f3e6e6" : undefined }}>
                  {d.d}<br />{WD[d.w]}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {staff.length === 0 && <tr><td colSpan={days.length + 1} style={{ ...cell, padding: 8 }}>{wish ? "希望はありません" : "出勤の人がいません"}</td></tr>}
          {staff.map((s) => (
            <tr key={s.id}>
              <td style={{ ...cell, textAlign: "left", paddingLeft: 3 }}>{s.name}</td>
              {days.map((d) => {
                const r = rowOf(s, d.k);
                return (
                  <td key={d.k} style={{ ...cell, background: D.isClosed(d) ? "#eee" : undefined, color: r && r.store_id !== D.store.id ? "#777" : undefined, textDecoration: wish && r?.status === "rejected" ? "line-through" : undefined }}>
                    {text(s, d)}
                  </td>
                );
              })}
            </tr>
          ))}
          {PART_KEYS.map((p) => (
            <tr key={p}>
              <td style={{ ...cell, textAlign: "left", paddingLeft: 3, background: "#f4f4f4" }}>{PARTS[p].label}（出勤/基準）</td>
              {days.map((d) => {
                if (D.isClosed(d)) return <td key={d.k} style={{ ...cell, background: "#eee" }}>定休</td>;
                const n = D.counts[d.k][p].n, need = D.ruleFor(d)[p];
                return <td key={d.k} style={{ ...cell, background: "#f4f4f4", fontWeight: n < need ? "bold" : undefined }}>{need || n ? `${n}/${need}` : ""}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
