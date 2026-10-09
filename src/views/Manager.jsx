import { useEffect, useState } from "react";
import { api } from "../lib/data.js";
import { WD, PARTS, PART_KEYS, STATUS, TYPE, SKILLS, NAVY, LINE, RED, fmt, pad, slotText, slotStyle, dayColor, defaultDayHours, autoWork, BREAK_END, workHours, fmtHours, hhmm } from "../lib/util.js";
import { Btn, Card, Tag, Gauge } from "../ui.jsx";

export default function ManagerView(props) {
  const [tab, setTab] = useState("approve");
  const pending = props.data.profiles.filter((p) => p.role === "pending").length;
  const tabs = [["approve", "日程ごとの承認"], ["worklog", "実働時間"], ["roster", `スタッフ名簿${pending ? `（登録待ち ${pending}）` : ""}`], ["stores", "店舗・基準人数"]];
  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap gap-1 mb-4 text-sm">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="px-3 py-1.5 rounded"
            style={tab === k ? { background: NAVY, color: "#fff" } : { background: "#fff", border: `1px solid ${LINE}` }}>{l}</button>
        ))}
      </div>
      {!props.data.store && tab !== "stores" ? <div className="text-sm">まず「店舗・基準人数」で店舗を登録してください。</div>
        : tab === "approve" ? <ApproveView {...props} />
        : tab === "worklog" ? <WorkLogView {...props} />
        : tab === "roster" ? <RosterView {...props} />
        : <StoresView {...props} />}
    </div>
  );
}

// 枠ごとの人数ゲージ＋デリバリー・厨房の警告
function PartGauge({ c, need, compact }) {
  const warn = c.n > 0 && (!c.delivery || !c.kitchen);
  return (
    <span className="inline-flex items-center gap-0.5">
      <Gauge n={c.n} p={c.pending} need={need} />
      {warn && !compact && (
        <span className="text-xs" style={{ color: RED }} title="承認済みの中にデリバリーまたは厨房ができる人がいません">
          {!c.delivery && "配✕"}{!c.kitchen && "厨✕"}
        </span>
      )}
      {warn && compact && <span className="text-xs" style={{ color: RED }}>!</span>}
    </span>
  );
}

// ---------- 日程ごとの承認 ----------
function ApproveView({ data, days, mk }) {
  const [sel, setSel] = useState(days[0].k);
  useEffect(() => { if (!days.find((d) => d.k === sel)) setSel(days[0].k); }, [days, sel]);
  const S = data.store;
  const day = days.find((d) => d.k === sel) || days[0];
  const req = data.ruleFor(day);
  const c = data.counts[day.k];
  const rows = data.staffInStore.map((s) => ({ s, r: data.requests[s.id]?.[day.k] })).filter((x) => x.r);
  const order = { pending: 0, approved: 1, rejected: 2 };
  rows.sort((a, b) => order[a.r.status] - order[b.r.status]);
  const pendingTotal = days.reduce((a, d) => a + PART_KEYS.reduce((b, p) => b + data.counts[d.k][p].pending, 0), 0);
  const otherStore = (staffId) => (data.requestsAll[staffId]?.[day.k] || []).filter((r) => r.store_id !== S.id && r.status !== "rejected");

  return (
    <div>
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3 mb-4 text-sm">
        <span>{S.name}：承認済みの人数が各日の基準に揃ったら公開してください。</span>
        {pendingTotal > 0 && <span className="text-xs opacity-70">未承認 {pendingTotal} 件</span>}
        <span className="ml-auto" />
        <Btn tone={data.published ? "ghost" : "primary"} onClick={() => api.setPublished(S.id, mk, !data.published)}>
          {data.published ? "公開を取り下げる" : `${mk.replace("-", "年")}月分を公開する`}
        </Btn>
      </Card>

      <div className="flex flex-wrap gap-4 items-start">
        <Card className="flex-1 min-w-80 overflow-x-auto">
          <div className="grid text-xs px-3 py-2 opacity-70" style={{ gridTemplateColumns: "5rem 1fr 1fr 1fr 3.5rem", minWidth: 380, borderBottom: `1px solid ${LINE}` }}>
            <span>日付</span>{PART_KEYS.map((p) => <span key={p}>{PARTS[p].label}</span>)}<span>募集</span>
          </div>
          {days.map((d) => {
            const hol = data.isHoliday(d), t = data.typeOf(d), rr = data.ruleFor(d), cc = data.counts[d.k], on = sel === d.k;
            const short = PART_KEYS.some((p) => cc[p].n < rr[p]);
            const rec = data.isRecruit(d.k);
            return (
              <div key={d.k} onClick={() => setSel(d.k)} className="grid items-center px-3 py-1.5 cursor-pointer text-sm"
                style={{ gridTemplateColumns: "5rem 1fr 1fr 1fr 3.5rem", minWidth: 380, background: on ? "#E3E9F0" : t === "event" ? "#FBF6EC" : hol ? "#FBF8F8" : "#fff",
                  borderBottom: "1px solid #EEF1F3", borderLeft: `3px solid ${on ? NAVY : "transparent"}` }}>
                <span className="tabular-nums" style={{ color: dayColor(d, hol) }}>
                  {d.d}<span className="opacity-70 text-xs">({WD[d.w]})</span>
                  {t === "event" && <span className="block text-xs" style={{ color: TYPE.event.fg }}>イベント</span>}
                </span>
                {PART_KEYS.map((p) => <span key={p}><PartGauge c={cc[p]} need={rr[p]} compact /></span>)}
                <span onClick={(e) => { e.stopPropagation(); api.setRecruit(S.id, d.k, !rec); }}>
                  <span className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
                    style={rec ? { background: RED, color: "#fff" } : { border: `1px dashed ${short ? RED : "#B8C2CC"}`, color: short ? RED : "#B8C2CC" }}>
                    {rec ? "募集中" : "募集"}
                  </span>
                </span>
              </div>
            );
          })}
          <div className="px-3 py-2 text-xs opacity-70">「承認済み/基準 +未承認」。赤＝多い、黄＝足りない。「!」＝デリバリーか厨房ができる人がいない。</div>
        </Card>

        <Card className="flex-1 min-w-80 p-4 sticky top-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-base font-medium">{fmt(day.k)}</span>
          </div>
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            {PART_KEYS.map((p) => <span key={p} className="flex items-center gap-1"><Tag s={PARTS[p]}>{PARTS[p].label}</Tag><PartGauge c={c[p]} need={req[p]} /></span>)}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
            <span>この日の区分</span>
            <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
              {Object.entries(TYPE).map(([t, v]) => {
                const on = data.typeOf(day) === t;
                return (
                  <button key={t} onClick={() => api.setDayType(S.id, day.k, t === data.defaultType(day) ? null : t)} className="px-3 py-1"
                    style={on ? { background: NAVY, color: "#fff" } : { background: "#fff", color: v.fg }}>{v.label}</button>
                );
              })}
            </div>
            <span className="tabular-nums opacity-70">基準 {PART_KEYS.map((p) => `${PARTS[p].short}${req[p]}`).join(" / ")}</span>
            {data.daySet[day.k]?.day_type && <span className="opacity-60">（通常は{TYPE[data.defaultType(day)].label}）</span>}
          </div>

          {rows.length === 0 ? <div className="text-sm opacity-60 py-4">この日の希望はまだありません。</div> : (
            <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
              {rows.map(({ s, r }) => {
                const ot = otherStore(s.id);
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" style={{ opacity: r.status === "rejected" ? 0.6 : 1 }}>
                    <span className="w-24 truncate">{s.name}
                      <span className="ml-1 text-xs opacity-60">{s.can_delivery && SKILLS.can_delivery.short}{s.can_kitchen && SKILLS.can_kitchen.short}</span>
                    </span>
                    <Tag s={slotStyle(r)}>{slotText(r)}</Tag>
                    <Tag s={STATUS[r.status]}>{STATUS[r.status].label}</Tag>
                    {ot.length > 0 && <span className="text-xs" style={{ color: "#7A4A00" }} title={ot.map((x) => `${data.stores.find((st) => st.id === x.store_id)?.name}: ${slotText(x)}`).join("、")}>他店も</span>}
                    <span className="ml-auto flex gap-1">
                      {r.status !== "approved" && <Btn small tone="primary" onClick={() => api.setStatus(r.id, "approved")}>承認</Btn>}
                      {r.status !== "rejected" && <Btn small tone="danger" onClick={() => api.setStatus(r.id, "rejected")}>拒否</Btn>}
                      {r.status !== "pending" && <Btn small onClick={() => api.setStatus(r.id, "pending")}>戻す</Btn>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {rows.some((x) => x.r.status === "pending") && (
            <div className="mt-3 flex justify-end">
              <Btn small onClick={() => rows.filter((x) => x.r.status === "pending").forEach((x) => api.setStatus(x.r.id, "approved"))}>未承認をすべて承認</Btn>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------- 実働時間 ----------
const DELIVERY = { main: "メインデリバリー", second: "二台目デリバリー" };

function WorkLogView({ data, days, mk }) {
  const [dayEdit, setDayEdit] = useState(null); // day
  const S = data.store;
  const approved = (sid, k) => { const r = data.requests[sid]?.[k]; return r && r.status === "approved" ? r : null; };
  const staff = data.staffInStore.filter((s) => days.some((d) => approved(s.id, d.k)));
  const hoursOf = (r) => (r ? workHours(data.workOf(r)) : 0);
  const total = (s) => days.reduce((a, d) => a + hoursOf(approved(s.id, d.k)), 0);
  const deliveries = (s, role) => days.filter((d) => data.daySet[d.k]?.delivery?.[role] === s.id).length;
  const cellW = 56;

  const csv = () => {
    const lines = [["名前", ...days.map((d) => `${d.d}(${WD[d.w]})`), "合計時間", `${DELIVERY.main}(回)`, `${DELIVERY.second}(回)`]];
    for (const s of staff) lines.push([s.name, ...days.map((d) => { const r = approved(s.id, d.k); return r && data.workOf(r) ? fmtHours(hoursOf(r)) : ""; }), fmtHours(total(s)), deliveries(s, "main"), deliveries(s, "second")]);
    const blob = new Blob(["﻿" + lines.map((l) => l.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `実働時間_${S.name}_${mk}.csv`; a.click();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <span>日付をタップ → その日のランチ・ディナーの終業、通しの休憩、デリバリー担当を入力。早上がり・遅刻もその画面で一人ずつ直せます。</span>
        <Btn small className="ml-auto" onClick={csv} disabled={!staff.length}>CSVを保存</Btn>
      </div>
      <Card className="overflow-x-auto">
        <table className="border-collapse" style={{ minWidth: 300 + days.length * cellW }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 text-sm font-medium" style={{ minWidth: 120, borderRight: `2px solid ${NAVY}`, borderBottom: `1px solid ${LINE}` }}>名前</th>
              {days.map((d) => (
                <th key={d.k} onClick={() => setDayEdit(d)} className="px-1 py-1 text-xs font-normal tabular-nums cursor-pointer" title="この日の実働を入力"
                  style={{ width: cellW, minWidth: cellW, background: data.dayHours(d.k) ? "#E3F1E8" : data.isHoliday(d) ? "#F7F2F2" : "#fff", borderBottom: `1px solid ${LINE}`, color: dayColor(d, data.isHoliday(d)) }}>
                  {d.d}<span className="opacity-70">({WD[d.w]})</span>
                  {data.dayHours(d.k) && <span className="block" style={{ color: "#0F3A24" }}>入力済</span>}
                </th>
              ))}
              <th className="px-2 py-1 text-xs font-medium whitespace-nowrap" style={{ borderBottom: `1px solid ${LINE}`, borderLeft: `2px solid ${NAVY}` }}>合計</th>
              <th className="px-2 py-1 text-xs font-medium whitespace-nowrap" style={{ borderBottom: `1px solid ${LINE}` }} title={DELIVERY.main}>配メイン</th>
              <th className="px-2 py-1 text-xs font-medium whitespace-nowrap" style={{ borderBottom: `1px solid ${LINE}` }} title={DELIVERY.second}>配2台目</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && <tr><td colSpan={days.length + 4} className="px-3 py-6 text-sm opacity-60">承認済みのシフトがありません。</td></tr>}
            {staff.map((s) => (
              <tr key={s.id}>
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-sm whitespace-nowrap" style={{ borderRight: `2px solid ${NAVY}`, borderBottom: "1px solid #EEF1F3" }}>{s.name}</td>
                {days.map((d) => {
                  const r = approved(s.id, d.k);
                  const w = r && data.workOf(r);
                  const dv = data.daySet[d.k]?.delivery || {};
                  return (
                    <td key={d.k} className="text-center py-1 text-xs tabular-nums" style={{ borderBottom: "1px solid #EEF1F3", background: data.isHoliday(d) ? "#FBF8F8" : undefined }}>
                      {r && (
                        <button onClick={() => setDayEdit(d)} className="px-1.5 py-0.5 rounded" title={`${slotText(r)}${w?.individual ? "（個別に修正）" : ""}`}
                          style={w?.individual ? { background: "#CFE8D8", color: "#0F3A24", outline: "1px solid #0F3A24" } : w ? { background: "#CFE8D8", color: "#0F3A24" } : { background: slotStyle(r).bg, color: slotStyle(r).fg }}>
                          {w ? fmtHours(workHours(w)) : "−"}{w?.individual && "*"}
                        </button>
                      )}
                      {(dv.main === s.id || dv.second === s.id) && <span className="block" style={{ color: "#7A4A00" }}>{dv.main === s.id ? "配1" : "配2"}</span>}
                    </td>
                  );
                })}
                <td className="text-right px-2 py-1 text-sm tabular-nums font-medium" style={{ borderLeft: `2px solid ${NAVY}`, borderBottom: "1px solid #EEF1F3" }}>{fmtHours(total(s))}h</td>
                <td className="text-right px-2 py-1 text-sm tabular-nums" style={{ borderBottom: "1px solid #EEF1F3" }}>{deliveries(s, "main") || ""}</td>
                <td className="text-right px-2 py-1 text-sm tabular-nums" style={{ borderBottom: "1px solid #EEF1F3" }}>{deliveries(s, "second") || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="mt-1 text-xs opacity-70">日付の「入力済」＝その日の実働を入力済み ／ 「*」＝個別に直した人 ／ 配1＝メインデリバリー、配2＝二台目デリバリー</div>
      {dayEdit && <DayWorkEditor key={dayEdit.k} data={data} day={dayEdit} rows={data.staffInStore.map((s) => ({ s, r: approved(s.id, dayEdit.k) })).filter((x) => x.r)} onClose={() => setDayEdit(null)} />}
    </div>
  );
}

// 時刻の選択（時・分のプルダウン）
const HOUR_OPTS = Array.from({ length: 18 }, (_, i) => i + 6); // 6〜23時
const MIN_OPTS = Array.from({ length: 60 }, (_, i) => i);
function TimeSelect({ value, onChange }) {
  const [h, m] = (value || "00:00").split(":").map(Number);
  const hours = HOUR_OPTS.includes(h) ? HOUR_OPTS : [...HOUR_OPTS, h].sort((a, b) => a - b);
  const cls = "border rounded px-0.5 py-0.5 bg-white tabular-nums";
  return (
    <span className="inline-flex items-center gap-0.5">
      <select value={h} onChange={(e) => onChange(`${pad(Number(e.target.value))}:${pad(m)}`)} className={cls}>
        {hours.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>:
      <select value={m} onChange={(e) => onChange(`${pad(h)}:${pad(Number(e.target.value))}`)} className={cls}>
        {MIN_OPTS.map((x) => <option key={x} value={x}>{pad(x)}</option>)}
      </select>
    </span>
  );
}

// その日の実働をまとめて入力（終業・通しの休憩・デリバリー担当）＋一人ずつの修正
function DayWorkEditor({ data, day, rows, onClose }) {
  const W = data.windows;
  const saved = data.daySet[day.k] || {};
  const def = defaultDayHours(W);
  const [v, setV] = useState({
    prep: { end: saved.work_hours?.prep?.end || def.prep.end },
    lunch: { end: saved.work_hours?.lunch?.end || def.lunch.end },
    dinner: { end: saved.work_hours?.dinner?.end || def.dinner.end },
    break_start: saved.work_hours?.break_start || def.break_start,
  });
  const [own, setOwn] = useState(() => Object.fromEntries(rows.filter(({ r }) => data.logs[r.id]).map(({ r }) => [r.id, { start_time: hhmm(data.logs[r.id].start_time), end_time: hhmm(data.logs[r.id].end_time) }])));
  const [dv, setDv] = useState({ main: saved.delivery?.main || "", second: saved.delivery?.second || "" });
  const [busy, setBusy] = useState(false);

  // ランチ終業を変えたら、同じ時刻だった休憩開始も合わせる
  const setEnd = (p, val) => setV({ ...v, [p]: { end: val }, ...(p === "lunch" && v.break_start === v.lunch.end ? { break_start: val } : {}) });
  const workOf = (r) => autoWork(r, v, W, own[r.id]);
  const setOwnTime = (r, key, val) => { const w = workOf(r); setOwn({ ...own, [r.id]: { start_time: w.start_time, end_time: w.end_time, [key]: val } }); };
  const resetOwn = (r) => { const n = { ...own }; delete n[r.id]; setOwn(n); };

  const save = async () => {
    setBusy(true);
    try {
      const delivery = dv.main || dv.second ? { main: dv.main || null, second: dv.second || null } : null;
      await api.setDayWork(data.store.id, day.k, v, delivery);
      for (const { r } of rows) {
        if (own[r.id]) await api.upsertWorkLog({ request_id: r.id, ...own[r.id], break_min: workOf(r).break_min, note: null });
        else if (data.logs[r.id]) await api.deleteWorkLog(r.id);
      }
      onClose();
    } finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await api.setDayWork(data.store.id, day.k, null, null);
      for (const { r } of rows) if (data.logs[r.id]) await api.deleteWorkLog(r.id);
      onClose();
    } finally { setBusy(false); }
  };

  const fixed = (p) => { const h = W[p][0]; return `${Math.floor(h)}:${pad(Math.round((h % 1) * 60))}`; };
  const staffOpts = (exclude) => rows.filter(({ s }) => s.id !== exclude).map(({ s }) => <option key={s.id} value={s.id}>{s.name}{s.can_delivery ? `（${SKILLS.can_delivery.short}）` : ""}</option>);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4" style={{ background: "rgba(31,42,68,.4)" }} onClick={onClose}>
      <Card className="p-4 w-[34rem] max-w-full text-sm max-h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="font-medium mb-3">{fmt(day.k)} の実働</div>

        {PART_KEYS.map((p) => (
          <div key={p} className="flex items-center justify-between gap-2 mb-2">
            <Tag s={PARTS[p]}>{PARTS[p].label}</Tag>
            <span className="flex items-center gap-1"><span className="tabular-nums opacity-70">{fixed(p)}〜</span>終業 <TimeSelect value={v[p].end} onChange={(x) => setEnd(p, x)} /></span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 mb-3">
          <span>通しの休憩</span>
          <span className="flex items-center gap-1"><TimeSelect value={v.break_start} onChange={(x) => setV({ ...v, break_start: x })} />〜{BREAK_END}</span>
        </div>

        {Object.entries(DELIVERY).map(([role, label]) => (
          <div key={role} className="flex items-center justify-between gap-2 mb-2">
            <span>{label}</span>
            <select value={dv[role]} onChange={(e) => setDv({ ...dv, [role]: e.target.value })} className="border rounded px-1 py-0.5 bg-white">
              <option value="">なし</option>
              {staffOpts(role === "second" ? dv.main : dv.second)}
            </select>
          </div>
        ))}

        <div className="mt-3 mb-1 text-xs opacity-70">この日働いた人（早上がり・遅刻は始業・終業を直すと個別扱いになります）</div>
        {rows.length === 0 ? <div className="text-xs opacity-60 mb-3">承認済みのシフトがありません。</div> : (
          <ul className="mb-3 text-xs divide-y" style={{ borderTop: `1px solid ${LINE}`, borderColor: "#EEF1F3" }}>
            {rows.map(({ s, r }) => {
              const w = workOf(r);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                  <span className="w-20 truncate">{s.name}</span>
                  <Tag s={slotStyle(r)}>{slotText(r)}</Tag>
                  {w ? (
                    <span className="flex items-center gap-1 ml-auto">
                      <TimeSelect value={w.start_time} onChange={(x) => setOwnTime(r, "start_time", x)} />〜
                      <TimeSelect value={w.end_time} onChange={(x) => setOwnTime(r, "end_time", x)} />
                      <span className="tabular-nums w-24 text-right">{w.break_min > 0 && `休${w.break_min}分 `}{fmtHours(workHours(w))}h</span>
                    </span>
                  ) : <span className="ml-auto">−</span>}
                  {own[r.id] && <button onClick={() => resetOwn(r)} className="px-1.5 rounded" style={{ color: "#7A4A00", border: "1px solid #E2C99A" }} title="この日の時間に戻す">個別 ✕</button>}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex gap-2 justify-end">
          {(saved.work_hours || saved.delivery || rows.some(({ r }) => data.logs[r.id])) && <Btn small disabled={busy} onClick={clear}>クリア</Btn>}
          <Btn small onClick={onClose}>閉じる</Btn>
          <Btn small tone="primary" disabled={busy} onClick={save}>保存</Btn>
        </div>
      </Card>
    </div>
  );
}

// ---------- スタッフ名簿 ----------
function RosterView({ data, profile }) {
  const [v, setV] = useState("");
  const [names, setNames] = useState({});
  const pending = data.profiles.filter((p) => p.role === "pending");
  const meLinked = data.staff.some((s) => s.profile_id === profile.id);
  const nextOrder = () => (data.staff.length ? Math.max(...data.staff.map((s) => s.sort_order)) + 1 : 0);
  const unlinkedStaff = data.staff.filter((s) => !s.profile_id);
  const curStore = data.store ? [data.store.id] : [];

  const add = async () => { const n = v.trim(); if (!n) return; await api.addStaff(n, nextOrder(), null, curStore); setV(""); };
  const register = async (p) => {
    const n = (names[p.id] ?? p.display_name).trim(); if (!n) return;
    await api.addStaff(n, nextOrder(), p.id, curStore); await api.setRole(p.id, "staff");
  };
  const linkTo = async (staffId, p) => { await api.updateStaff(staffId, { profile_id: p.id }); await api.setRole(p.id, "staff"); };
  const remove = async (s) => {
    if (!confirm(`${s.name} さんを名簿から外しますか？（過去の希望は残ります）`)) return;
    await api.deactivateStaff(s.id); if (s.profile_id) await api.setRole(s.profile_id, "pending");
  };
  const move = async (i, d) => {
    const j = i + d; if (j < 0 || j >= data.staff.length) return;
    await api.updateStaff(data.staff[i].id, { sort_order: j }); await api.updateStaff(data.staff[j].id, { sort_order: i });
  };

  return (
    <div className="flex flex-wrap gap-4 items-start">
      {pending.length > 0 && (
        <Card className="p-4 flex-1 min-w-72" style={{ borderColor: "#F3D27A", background: "#FFFBEF" }}>
          <div className="text-sm font-medium mb-1">LINEでログインした登録待ちの人</div>
          <div className="text-xs opacity-70 mb-3">名簿に載せる名前を確認して登録してください。登録後、所属店舗とできる仕事を名簿で設定します。</div>
          <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
            {pending.map((p) => (
              <li key={p.id} className="py-2 text-sm flex flex-wrap items-center gap-2">
                {p.picture_url && <img src={p.picture_url} alt="" className="w-7 h-7 rounded-full" />}
                <span className="text-xs opacity-70">LINE: {p.display_name}</span>
                <input value={names[p.id] ?? p.display_name} onChange={(e) => setNames({ ...names, [p.id]: e.target.value })} className="px-2 py-1 rounded border w-32" style={{ borderColor: "#B8C2CC" }} />
                <Btn small tone="primary" onClick={() => register(p)}>この名前で登録</Btn>
                {unlinkedStaff.length > 0 && (
                  <select defaultValue="" onChange={(e) => e.target.value && linkTo(e.target.value, p)} className="text-xs border rounded px-1 py-1">
                    <option value="">既存の名前に紐づける…</option>
                    {unlinkedStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4 flex-1 min-w-80 overflow-x-auto">
        <div className="text-sm mb-1">スタッフ名簿（全店舗）</div>
        {!meLinked && <div className="text-xs mb-3 px-2 py-1 rounded" style={{ background: "#F6EBD6", color: "#7A4A00" }}>あなた自身もシフトに入るなら、自分の名前を追加して「これは自分」を押してください。</div>}
        <div className="flex gap-2 mb-3">
          <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="名前を先に作っておく（LINE未ログインでも可）" className="flex-1 px-3 py-1.5 rounded border text-sm" style={{ borderColor: "#B8C2CC" }} />
          <Btn tone="primary" onClick={add}>追加</Btn>
        </div>
        {data.staff.length === 0 ? <div className="text-sm opacity-60">まだ登録がありません。</div> : (
          <table className="text-sm w-full">
            <thead><tr className="text-xs opacity-70 text-left"><th className="py-1 pr-2">名前</th><th className="py-1 pr-2">所属店舗</th><th className="py-1 pr-2">できる仕事</th><th></th></tr></thead>
            <tbody>
              {data.staff.map((s, i) => {
                const p = data.profiles.find((x) => x.id === s.profile_id);
                return (
                  <tr key={s.id} style={{ borderTop: "1px solid #EEF1F3" }}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{s.name}
                      <div className="text-xs opacity-60">{p ? <>LINE: {p.display_name}{p.role === "manager" && "（管理者）"}</> : <span style={{ color: "#7A4A00" }}>LINE未連携</span>}</div>
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex flex-wrap gap-2">
                        {data.stores.map((st) => (
                          <label key={st.id} className="flex items-center gap-1 text-xs whitespace-nowrap">
                            <input type="checkbox" checked={!!data.membership[s.id]?.has(st.id)} onChange={(e) => api.setMembership(s.id, st.id, e.target.checked)} />{st.name}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex gap-2">
                        {Object.entries(SKILLS).map(([k, sk]) => (
                          <label key={k} className="flex items-center gap-1 text-xs whitespace-nowrap">
                            <input type="checkbox" checked={!!s[k]} onChange={(e) => api.updateStaff(s.id, { [k]: e.target.checked })} />{sk.label}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="py-1.5">
                      <div className="flex gap-1 justify-end flex-wrap">
                        {!s.profile_id && !meLinked && <Btn small tone="primary" onClick={() => api.updateStaff(s.id, { profile_id: profile.id })}>これは自分</Btn>}
                        {p && p.role !== "manager" && <Btn small onClick={() => confirm(`${s.name} さんを管理者にしますか？`) && api.setRole(p.id, "manager")}>管理者にする</Btn>}
                        {p && p.role === "manager" && data.profiles.filter((x) => x.role === "manager").length > 1 && <Btn small onClick={() => api.setRole(p.id, "staff")}>管理者を外す</Btn>}
                        <Btn small onClick={() => move(i, -1)}>↑</Btn>
                        <Btn small onClick={() => move(i, 1)}>↓</Btn>
                        <Btn small onClick={() => remove(s)}>外す</Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ---------- 店舗・基準人数 ----------
function StoresView({ data, days }) {
  const [v, setV] = useState("");
  const S = data.store;
  const add = async () => { const n = v.trim(); if (!n) return; await api.addStore(n, data.stores.length); setV(""); };
  const rules = S?.rules || {};
  const windows = data.windows;
  const setRule = (grp, part, val) => api.updateStore(S.id, { rules: { ...rules, [grp]: { ...(rules[grp] || {}), [part]: Math.max(0, Number(val) || 0) } } });
  const setWindow = (part, idx, val) => { const w = [...(windows[part] || [0, 0])]; w[idx] = Math.max(0, Math.min(24, Number(val) || 0)); api.updateStore(S.id, { windows: { ...windows, [part]: w } }); };
  const ev = S ? days.filter((d) => data.typeOf(d) === "event") : [];

  return (
    <div className="flex flex-wrap gap-4 items-start">
      <Card className="p-4 min-w-72">
        <div className="text-sm mb-2">店舗</div>
        <ul className="divide-y mb-3" style={{ borderColor: "#EEF1F3" }}>
          {data.stores.map((st) => (
            <li key={st.id} className="flex items-center gap-2 py-1.5 text-sm">
              <input defaultValue={st.name} key={st.name} onBlur={(e) => e.target.value.trim() && e.target.value !== st.name && api.updateStore(st.id, { name: e.target.value.trim() })} className="flex-1 border rounded px-2 py-1" />
              {st.id === S?.id && <span className="text-xs opacity-60">表示中</span>}
              {data.stores.length > 1 && <Btn small onClick={() => confirm(`「${st.name}」を削除しますか？ この店舗の希望・設定もすべて消えます。`) && api.deleteStore(st.id)}>削除</Btn>}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="新しい店舗名" className="flex-1 px-3 py-1.5 rounded border text-sm" style={{ borderColor: "#B8C2CC" }} />
          <Btn tone="primary" onClick={add}>追加</Btn>
        </div>
        <div className="text-xs opacity-60 mt-2">店舗名は入力欄から離れると保存されます。画面上部の切替で表示する店舗を変えると、下の設定もその店舗のものになります。</div>
      </Card>

      {S && (
        <>
          <Card className="p-4">
            <div className="text-sm mb-3">{S.name} の基準人数</div>
            <table className="text-sm">
              <thead><tr className="text-xs opacity-70"><th></th>{PART_KEYS.map((p) => <th key={p} className="px-2 font-normal"><Tag s={PARTS[p]}>{PARTS[p].label}</Tag></th>)}</tr></thead>
              <tbody>
                {Object.entries(TYPE).map(([g, t]) => (
                  <tr key={g}><td className="pr-2 py-1">{t.label}</td>
                    {PART_KEYS.map((p) => (
                      <td key={p} className="px-2 py-1"><input type="number" min={0} key={`${g}${p}${rules[g]?.[p]}`} defaultValue={rules[g]?.[p] ?? 0} onBlur={(e) => Number(e.target.value) !== (rules[g]?.[p] ?? 0) && setRule(g, p, e.target.value)} className="w-14 border rounded px-1 tabular-nums" />人</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs opacity-60 mt-2">入力欄から離れると保存されます。</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm mb-1">{S.name} の枠の時間帯</div>
            <div className="text-xs opacity-60 mb-3">時間指定の希望は、この時間帯と重なる枠に数えます。実働時間の初期値にも使います。</div>
            {PART_KEYS.map((p) => (
              <div key={p} className="flex items-center gap-2 py-1 text-sm">
                <Tag s={PARTS[p]}>{PARTS[p].label}</Tag>
                <input type="number" min={0} max={24} key={`${p}0${windows[p]?.[0]}`} defaultValue={windows[p]?.[0]} onBlur={(e) => setWindow(p, 0, e.target.value)} className="w-14 border rounded px-1 tabular-nums" />時〜
                <input type="number" min={0} max={24} key={`${p}1${windows[p]?.[1]}`} defaultValue={windows[p]?.[1]} onBlur={(e) => setWindow(p, 1, e.target.value)} className="w-14 border rounded px-1 tabular-nums" />時
              </div>
            ))}
          </Card>
          <Card className="p-4 text-sm">
            <div className="mb-2">{S.name} のこの月のイベント日</div>
            {ev.length === 0 ? <div className="opacity-60 text-xs">「日程ごとの承認」で日付を選び、区分を「イベント」にすると登録されます。</div>
              : <ul>{ev.map((d) => <li key={d.k} className="tabular-nums py-0.5">{fmt(d.k)}</li>)}</ul>}
          </Card>
        </>
      )}
    </div>
  );
}
