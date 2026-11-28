import { useEffect, useMemo, useState } from "react";
import { usePayPeriodData } from "../lib/data.js";
import { WD, PARTS, PART_KEYS, NAVY, LINE, CLOSED_BG, OFFICE, officeSpan, isPartTime, fmt, skillShort, slotText, slotShort, slotStyle, covers, dayColor, workHours, fmtHours, dkey, payPeriodOfMonth } from "../lib/util.js";
import { Card, Tag, DualScroll } from "../ui.jsx";
import { PrintButton } from "./Print.jsx";

export default function PublishedView({ data, days, mk, profile, isManager }) {
  const [preview, setPreview] = useState(false);
  const [focus, setFocus] = useState(null); // {kind:"staff", s} | {kind:"date", k}
  useEffect(() => { setFocus(null); }, [mk, data.store?.id]);
  const S = data.store;
  const myRow = data.staff.find((s) => s.profile_id === profile.id);

  // 今期（表示月を支給月とする給与期間）の実働。アルバイトだけ
  const [py, pm] = mk.split("-").map(Number);
  const period = useMemo(() => payPeriodOfMonth({ y: py, m: pm - 1 }, data.payClosingDay, data.payDay), [py, pm, data.payClosingDay, data.payDay]);
  const { pd } = usePayPeriodData(isManager || (myRow && isPartTime(myRow)) ? period : null, data.stores);
  const periodWork = (staffId) => {
    if (!pd) return null;
    const t = new Date(), today = dkey(t.getFullYear(), t.getMonth(), t.getDate());
    const rs = pd.requests.filter((r) => r.staff_id === staffId);
    return {
      period,
      hours: rs.reduce((a, r) => a + workHours(pd.workOf(r)), 0),
      missing: new Set(rs.filter((r) => r.date <= today && !pd.workOf(r)).map((r) => r.date)).size, // 今日までで実働が未入力の日
    };
  };

  // 自分の全店舗の確定シフト（公開済みの店舗のみ）
  const myAll = myRow ? days.flatMap((d) => (data.requestsAll[myRow.id]?.[d.k] || [])
    .filter((r) => r.status === "approved" && data.pubs.some((p) => p.store_id === r.store_id))
    .map((r) => ({ d, r, store: data.stores.find((s) => s.id === r.store_id) }))) : [];

  // 自分の出勤日（全店舗）は店舗の表の下に常に出す
  const mine = myRow && <MyShifts data={data} myRow={myRow} myAll={myAll} mk={mk} pw={isPartTime(myRow) ? periodWork(myRow.id) : null} />;

  if (!data.published && !(isManager && preview)) {
    return (
      <div className="p-4">
        <div className="text-sm text-center py-4">
          <div className="mb-3">{S.name} の {mk.replace("-", "年")}月のシフトはまだ公開されていません。</div>
          {isManager && <button onClick={() => setPreview(true)} className="text-xs underline opacity-70">管理者用プレビューを表示</button>}
        </div>
        {mine && data.stores.length > 1 && <div className="mt-2 flex justify-center">{mine}</div>}
      </div>
    );
  }

  const approved = (sid, k) => { const r = data.requests[sid]?.[k]; return r && r.status === "approved" ? r : null; };
  const staff = data.staffInStore.filter((s) => days.some((d) => approved(s.id, d.k)));
  const cellW = 42; // 日付の列の最小幅（PCで31日分が横に収まるように）
  const byStaff = (s) => days.map((d) => ({ d, r: approved(s.id, d.k) })).filter((x) => x.r);
  const byDate = (k) => data.staffInStore.map((s) => ({ s, r: approved(s.id, k) })).filter((x) => x.r);

  return (
    <div className="p-4">
      {!data.published && <div className="mb-3 text-xs px-3 py-2 rounded" style={{ background: "#F3D27A", color: "#4A3600" }}>未公開のプレビューです。スタッフには表示されません。</div>}
      <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
        <span className="opacity-70">{S.name}：名前をタップ → その人の出勤日一覧。日付をタップ → その日の出勤者一覧。</span>
        <span className="ml-auto">
          <PrintButton small stores={(data.allStores || [data]).filter((D) => isManager ? D.published || D.store.id === S.id : D.published && data.membership?.[myRow?.id]?.has(D.store.id))} days={days} mk={mk} kind="published" />
        </span>
      </div>

      <div className="flex flex-wrap gap-4 items-start">
        <Card className="flex-1 min-w-0">
          <DualScroll>
          {/* 横幅いっぱいに広げ、日付の列は残りを均等に分ける。狭い画面では最小幅で横スクロール */}
          <table className="border-collapse w-full" style={{ minWidth: 140 + days.length * cellW }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 text-sm font-medium whitespace-nowrap" style={{ width: "1%", minWidth: 140, borderRight: `2px solid ${NAVY}`, borderBottom: `1px solid ${LINE}` }}>名前</th>
                {days.map((d) => {
                  const hol = data.isHoliday(d), on = focus?.kind === "date" && focus.k === d.k;
                  return (
                    <th key={d.k} onClick={() => setFocus(on ? null : { kind: "date", k: d.k })}
                      className="cursor-pointer px-0.5 py-1 text-xs font-normal tabular-nums leading-tight"
                      style={{ minWidth: cellW, background: on ? "#E3E9F0" : data.isClosed(d) ? CLOSED_BG : hol ? "#F7F2F2" : "#fff", borderBottom: `1px solid ${LINE}`, color: dayColor(d, hol) }}>
                      {d.d}<span className="block opacity-70">{WD[d.w]}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && <tr><td colSpan={days.length + 1} className="px-3 py-6 text-sm opacity-60">出勤の人がいません。</td></tr>}
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
          </DualScroll>
        </Card>

        {focus && (
          <Card className="p-4 w-full sm:w-72 shrink-0 text-sm">
            {focus.kind === "staff" ? (
              <>
                <div className="flex items-center mb-2"><span className="font-medium">{focus.s.name} さんの出勤日</span><button onClick={() => setFocus(null)} className="ml-auto text-xs opacity-60">閉じる</button></div>
                <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
                  {byStaff(focus.s).map(({ d, r }) => (
                    <li key={d.k} className="flex items-center gap-2 py-1.5">
                      <span className="tabular-nums w-16" style={{ color: dayColor(d, data.isHoliday(d)) }}>{fmt(d.k)}</span>
                      <Tag s={slotStyle(r)}>{slotText(r)}</Tag>
                      {isPartTime(focus.s) && data.workOf(r) && <span className="ml-auto text-xs tabular-nums opacity-70">{fmtHours(workHours(data.workOf(r)))}h</span>}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-xs opacity-70">計 {byStaff(focus.s).length} 日</div>
                {isPartTime(focus.s) && (isManager || focus.s.id === myRow?.id) && <PeriodWork pw={periodWork(focus.s.id)} />}
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
                      <div className="flex items-center gap-2 mb-1"><Tag s={PARTS[p]}>{PARTS[p].label}</Tag><span className="text-xs tabular-nums opacity-70">{list.filter(({ s }) => s.position !== "trainee").length}/{need}人</span></div>
                      {list.length === 0 ? <div className="text-xs opacity-50 pl-1">なし</div>
                        : <ul className="pl-1">{list.map(({ s, r }) => <li key={s.id} className="py-0.5 flex gap-2"><span>{s.name}{s.position === "trainee" && <span className="text-xs opacity-60">（研修）</span>}</span><span className="text-xs opacity-60 self-center">{skillShort(s)}</span>{r.type === "custom" && <span className="text-xs opacity-60 self-center">{slotText(r)}</span>}</li>)}</ul>}
                    </div>
                  );
                })}
                {(() => {
                  const office = byDate(focus.k).filter(({ r }) => r.type === "office");
                  return office.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-1"><Tag s={OFFICE}>{OFFICE.label}</Tag><span className="text-xs tabular-nums opacity-70">{office.length}人</span></div>
                      <ul className="pl-1">{office.map(({ s, r }) => <li key={s.id} className="py-0.5">{s.name}{officeSpan(r) && <span className="text-xs opacity-60">（{officeSpan(r).label}）</span>}</li>)}</ul>
                    </div>
                  );
                })()}
              </>
            )}
          </Card>
        )}
      </div>
      {mine && <div className="mt-4">{mine}</div>}
    </div>
  );
}

// 自分の出勤日（公開済みの全店舗分）
// 今期の実働「今期の実働 48.5h（11/16〜12/15、12/25支給）未入力 3日」
function PeriodWork({ pw }) {
  if (!pw) return null;
  return (
    <div className="mt-2 text-xs px-2 py-1.5 rounded tabular-nums" style={{ background: "#F4F6F8" }}>
      今期の実働 <b className="text-sm">{fmtHours(pw.hours)}h</b>
      <span className="opacity-70">（{pw.period.short}）</span>
      {pw.missing > 0 && <span className="ml-1" style={{ color: "#7A4A00" }}>未入力 {pw.missing}日</span>}
    </div>
  );
}

function MyShifts({ data, myRow, myAll, mk, pw }) {
  const multi = data.stores.length > 1;
  const pt = isPartTime(myRow); // 実働時間はアルバイトだけ
  const total = myAll.reduce((a, x) => a + workHours(data.workOf(x.r)), 0);
  return (
    <Card className="p-4 text-sm w-full max-w-xl text-left">
      <div className="font-medium mb-2">
        {myRow.name} さんの出勤日{multi && "（全店舗）"}
        <span className="text-xs font-normal opacity-60 ml-2">{mk.replace("-", "年")}月・公開済みの店舗のみ</span>
      </div>
      {myAll.length === 0 ? <div className="opacity-60">公開済みの出勤日はありません。</div> : (
        <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
          {myAll.map(({ d, r, store }) => (
            <li key={r.id} className="flex items-center gap-2 py-1.5">
              <span className="tabular-nums w-16" style={{ color: dayColor(d, data.isHoliday(d)) }}>{fmt(d.k)}</span>
              {multi && <span className="w-20 truncate text-xs opacity-70">{store?.name}</span>}
              <Tag s={slotStyle(r)}>{slotText(r)}</Tag>
              {pt && data.workOf(r) && <span className="ml-auto text-xs tabular-nums opacity-70">実働 {fmtHours(workHours(data.workOf(r)))}h</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-xs opacity-70">計 {myAll.length} 日{pt && myAll.some((x) => data.workOf(x.r)) && `　${mk.replace("-", "年")}月の実働合計 ${fmtHours(total)}h`}</div>
      {pt && <PeriodWork pw={pw} />}
    </Card>
  );
}
