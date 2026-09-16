import { useEffect, useState } from "react";
import { WD, SLOT, NAVY, LINE, fmt, slotText, slotShort, covers, dayColor } from "../lib/util.js";
import { Card, Tag } from "../ui.jsx";

export default function PublishedView({ data, days, mk, isManager }) {
  const [preview, setPreview] = useState(false);
  const [focus, setFocus] = useState(null); // {kind:"staff", s} | {kind:"date", k}
  useEffect(() => { setFocus(null); }, [mk]); // 月を切り替えたら選択を解除

  if (!data.published && !(isManager && preview)) {
    return (
      <div className="p-6 text-sm max-w-md mx-auto text-center">
        <div className="mb-3">{mk.replace("-", "年")}月のシフトはまだ公開されていません。</div>
        {isManager && <button onClick={() => setPreview(true)} className="text-xs underline opacity-70">管理者用プレビューを表示</button>}
      </div>
    );
  }

  const approved = (sid, k) => { const r = data.requests[sid]?.[k]; return r && r.status === "approved" ? r : null; };
  const staff = data.staff.filter((s) => days.some((d) => approved(s.id, d.k)));
  const cellW = 60;
  const byStaff = (s) => days.map((d) => ({ d, r: approved(s.id, d.k) })).filter((x) => x.r);
  const byDate = (k) => data.staff.map((s) => ({ s, r: approved(s.id, k) })).filter((x) => x.r);

  return (
    <div className="p-4">
      {!data.published && <div className="mb-3 text-xs px-3 py-2 rounded" style={{ background: "#F3D27A", color: "#4A3600" }}>未公開のプレビューです。スタッフには表示されません。</div>}
      <div className="text-xs opacity-70 mb-2">名前をタップ → その人の出勤日一覧。日付をタップ → その日の出勤者一覧。</div>

      <div className="flex flex-wrap gap-4 items-start">
        <Card className="overflow-x-auto flex-1 min-w-0">
          <table className="border-collapse" style={{ minWidth: 140 + days.length * cellW }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 text-sm font-medium" style={{ minWidth: 140, borderRight: `2px solid ${NAVY}`, borderBottom: `1px solid ${LINE}` }}>名前</th>
                {days.map((d) => {
                  const hol = data.isHoliday(d), on = focus?.kind === "date" && focus.k === d.k;
                  return (
                    <th key={d.k} onClick={() => setFocus(on ? null : { kind: "date", k: d.k })}
                      className="cursor-pointer px-1 py-1 text-xs font-normal tabular-nums"
                      style={{ width: cellW, minWidth: cellW, background: on ? "#E3E9F0" : hol ? "#F7F2F2" : "#fff", borderBottom: `1px solid ${LINE}`, color: dayColor(d, hol) }}>
                      {d.d}<span className="opacity-70">({WD[d.w]})</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && <tr><td colSpan={days.length + 1} className="px-3 py-6 text-sm opacity-60">承認済みのシフトがありません。</td></tr>}
              {staff.map((s) => {
                const on = focus?.kind === "staff" && focus.s.id === s.id;
                return (
                  <tr key={s.id} style={{ background: on ? "#E3E9F0" : undefined }}>
                    <td onClick={() => setFocus(on ? null : { kind: "staff", s })}
                      className="sticky left-0 z-10 px-3 py-1.5 text-sm whitespace-nowrap cursor-pointer"
                      style={{ background: on ? "#E3E9F0" : "#fff", borderRight: `2px solid ${NAVY}`, borderBottom: "1px solid #EEF1F3" }}>{s.name}</td>
                    {days.map((d) => {
                      const r = approved(s.id, d.k);
                      const col = focus?.kind === "date" && focus.k === d.k;
                      return (
                        <td key={d.k} className="text-center py-1" style={{ borderBottom: "1px solid #EEF1F3", background: col ? "#E3E9F0" : data.isHoliday(d) && !on ? "#FBF8F8" : undefined }}>
                          {r && <Tag s={SLOT[r.type]} title={slotText(r)}>{slotShort(r)}</Tag>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {focus && (
          <Card className="p-4 w-72 shrink-0 text-sm">
            {focus.kind === "staff" ? (
              <>
                <div className="flex items-center mb-2"><span className="font-medium">{focus.s.name} さんの出勤日</span><button onClick={() => setFocus(null)} className="ml-auto text-xs opacity-60">閉じる</button></div>
                <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
                  {byStaff(focus.s).map(({ d, r }) => (
                    <li key={d.k} className="flex items-center gap-2 py-1.5">
                      <span className="tabular-nums w-16" style={{ color: dayColor(d, data.isHoliday(d)) }}>{fmt(d.k)}</span>
                      <Tag s={SLOT[r.type]}>{slotText(r)}</Tag>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-xs opacity-70">計 {byStaff(focus.s).length} 日</div>
              </>
            ) : (
              <>
                <div className="flex items-center mb-2"><span className="font-medium">{fmt(focus.k)} の出勤者</span><button onClick={() => setFocus(null)} className="ml-auto text-xs opacity-60">閉じる</button></div>
                {["lunch", "dinner"].map((p) => {
                  const list = byDate(focus.k).filter(({ r }) => covers(r, p));
                  const fd = days.find((d) => d.k === focus.k);
                  const need = fd ? data.ruleFor(fd)[p] : 0;
                  return (
                    <div key={p} className="mb-3">
                      <div className="flex items-center gap-2 mb-1"><Tag s={SLOT[p]}>{SLOT[p].label}</Tag><span className="text-xs tabular-nums opacity-70">{list.length}/{need}人</span></div>
                      {list.length === 0 ? <div className="text-xs opacity-50 pl-1">なし</div>
                        : <ul className="pl-1">{list.map(({ s, r }) => <li key={s.id} className="py-0.5 flex gap-2"><span>{s.name}</span>{r.type !== p && <span className="text-xs opacity-60 self-center">{slotText(r)}</span>}</li>)}</ul>}
                    </div>
                  );
                })}
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
