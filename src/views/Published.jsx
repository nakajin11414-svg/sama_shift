import { useEffect, useState } from "react";
import { WD, PARTS, PART_KEYS, NAVY, LINE, fmt, slotText, slotShort, slotStyle, covers, dayColor, workHours, fmtHours } from "../lib/util.js";
import { Btn, Card, Tag } from "../ui.jsx";

export default function PublishedView({ data, days, mk, profile, isManager }) {
  const [preview, setPreview] = useState(false);
  const [focus, setFocus] = useState(null); // {kind:"staff", s} | {kind:"date", k}
  const [mineAll, setMineAll] = useState(false);
  useEffect(() => { setFocus(null); }, [mk, data.store?.id]);
  const S = data.store;
  const myRow = data.staff.find((s) => s.profile_id === profile.id);

  // 自分の全店舗の確定シフト（公開済みの店舗のみ）
  const myAll = myRow ? days.flatMap((d) => (data.requestsAll[myRow.id]?.[d.k] || [])
    .filter((r) => r.status === "approved" && data.pubs.some((p) => p.store_id === r.store_id))
    .map((r) => ({ d, r, store: data.stores.find((s) => s.id === r.store_id) }))) : [];

  if (mineAll && myRow) {
    return (
      <div className="p-4 max-w-xl mx-auto text-sm">
        <div className="flex items-center mb-3"><span className="font-medium">{myRow.name} さんの全店舗の出勤日（{mk.replace("-", "年")}月）</span><Btn small className="ml-auto" onClick={() => setMineAll(false)}>店舗の表に戻る</Btn></div>
        <Card className="p-4">
          {myAll.length === 0 ? <div className="opacity-60">公開済みの出勤日はありません。</div> : (
            <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
              {myAll.map(({ d, r, store }) => (
                <li key={r.id} className="flex items-center gap-2 py-1.5">
                  <span className="tabular-nums w-16" style={{ color: dayColor(d, data.isHoliday(d)) }}>{fmt(d.k)}</span>
                  <span className="w-20 truncate text-xs opacity-70">{store?.name}</span>
                  <Tag s={slotStyle(r)}>{slotText(r)}</Tag>
                  {data.logs[r.id] && <span className="ml-auto text-xs tabular-nums opacity-70">実働 {fmtHours(workHours(data.logs[r.id]))}h</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 text-xs opacity-70">計 {myAll.length} 日{Object.values(data.logs).length > 0 && `　実働合計 ${fmtHours(myAll.reduce((a, x) => a + workHours(data.logs[x.r.id]), 0))}h`}</div>
        </Card>
      </div>
    );
  }

  if (!data.published && !(isManager && preview)) {
    return (
      <div className="p-6 text-sm max-w-md mx-auto text-center">
        <div className="mb-3">{S.name} の {mk.replace("-", "年")}月のシフトはまだ公開されていません。</div>
        <div className="flex flex-col items-center gap-2">
          {isManager && <button onClick={() => setPreview(true)} className="text-xs underline opacity-70">管理者用プレビューを表示</button>}
          {myRow && data.stores.length > 1 && <button onClick={() => setMineAll(true)} className="text-xs underline opacity-70">自分の全店舗の出勤日を見る</button>}
        </div>
      </div>
    );
  }

  const approved = (sid, k) => { const r = data.requests[sid]?.[k]; return r && r.status === "approved" ? r : null; };
  const staff = data.staffInStore.filter((s) => days.some((d) => approved(s.id, d.k)));
  const cellW = 60;
  const byStaff = (s) => days.map((d) => ({ d, r: approved(s.id, d.k) })).filter((x) => x.r);
  const byDate = (k) => data.staffInStore.map((s) => ({ s, r: approved(s.id, k) })).filter((x) => x.r);

  return (
    <div className="p-4">
      {!data.published && <div className="mb-3 text-xs px-3 py-2 rounded" style={{ background: "#F3D27A", color: "#4A3600" }}>未公開のプレビューです。スタッフには表示されません。</div>}
      <div className="flex flex-wrap items-center gap-2 text-xs opacity-70 mb-2">
        <span>{S.name}：名前をタップ → その人の出勤日一覧。日付をタップ → その日の出勤者一覧。</span>
        {myRow && data.stores.length > 1 && <button onClick={() => setMineAll(true)} className="underline">自分の全店舗の出勤日</button>}
      </div>

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
                          {r && <Tag s={slotStyle(r)} title={slotText(r)}>{slotShort(r)}</Tag>}
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
                      <Tag s={slotStyle(r)}>{slotText(r)}</Tag>
                      {data.logs[r.id] && <span className="ml-auto text-xs tabular-nums opacity-70">{fmtHours(workHours(data.logs[r.id]))}h</span>}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-xs opacity-70">計 {byStaff(focus.s).length} 日</div>
              </>
            ) : (
              <>
                <div className="flex items-center mb-2"><span className="font-medium">{fmt(focus.k)} の出勤者</span><button onClick={() => setFocus(null)} className="ml-auto text-xs opacity-60">閉じる</button></div>
                {PART_KEYS.map((p) => {
                  const list = byDate(focus.k).filter(({ r }) => covers(r, p, data.windows));
                  const fd = days.find((d) => d.k === focus.k);
                  const need = fd ? data.ruleFor(fd)[p] : 0;
                  return (
                    <div key={p} className="mb-3">
                      <div className="flex items-center gap-2 mb-1"><Tag s={PARTS[p]}>{PARTS[p].label}</Tag><span className="text-xs tabular-nums opacity-70">{list.length}/{need}人</span></div>
                      {list.length === 0 ? <div className="text-xs opacity-50 pl-1">なし</div>
                        : <ul className="pl-1">{list.map(({ s, r }) => <li key={s.id} className="py-0.5 flex gap-2"><span>{s.name}</span><span className="text-xs opacity-60 self-center">{s.can_delivery && "配"}{s.can_kitchen && "厨"}</span>{r.type === "custom" && <span className="text-xs opacity-60 self-center">{slotText(r)}</span>}</li>)}</ul>}
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
