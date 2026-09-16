import { useEffect, useState } from "react";
import { api } from "../lib/data.js";
import { WD, SLOT, STATUS, TYPE, NAVY, LINE, RED, fmt, slotText, dayColor } from "../lib/util.js";
import { Btn, Card, Tag, Gauge } from "../ui.jsx";

export default function ManagerView(props) {
  const [tab, setTab] = useState("approve");
  const pending = props.data.profiles.filter((p) => p.role === "pending").length;
  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex gap-1 mb-4 text-sm">
        {[["approve", "日程ごとの承認"], ["roster", `スタッフ名簿${pending ? `（登録待ち ${pending}）` : ""}`], ["rules", "基準人数"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="px-3 py-1.5 rounded"
            style={tab === k ? { background: NAVY, color: "#fff" } : { background: "#fff", border: `1px solid ${LINE}` }}>{l}</button>
        ))}
      </div>
      {tab === "approve" ? <ApproveView {...props} /> : tab === "roster" ? <RosterView {...props} /> : <RulesView {...props} />}
    </div>
  );
}

function ApproveView({ data, days, mk }) {
  const [sel, setSel] = useState(days[0].k);
  useEffect(() => { if (!days.find((d) => d.k === sel)) setSel(days[0].k); }, [days, sel]);

  const day = days.find((d) => d.k === sel);
  const req = data.ruleFor(day);
  const c = data.counts[day.k];
  const rows = data.staff.map((s) => ({ s, r: data.requests[s.id]?.[day.k] })).filter((x) => x.r);
  const order = { pending: 0, approved: 1, rejected: 2 };
  rows.sort((a, b) => order[a.r.status] - order[b.r.status]);
  const pendingTotal = days.reduce((a, d) => a + data.counts[d.k].pLunch + data.counts[d.k].pDinner, 0);

  return (
    <div>
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3 mb-4 text-sm">
        <span>承認済みの人数が各日の基準に揃ったら公開してください。</span>
        {pendingTotal > 0 && <span className="text-xs opacity-70">未承認 {pendingTotal} 件</span>}
        <span className="ml-auto" />
        <Btn tone={data.published ? "ghost" : "primary"} onClick={() => api.setPublished(mk, !data.published)}>
          {data.published ? "公開を取り下げる" : `${mk.replace("-", "年")}月分を公開する`}
        </Btn>
      </Card>

      <div className="flex flex-wrap gap-4 items-start">
        <Card className="flex-1 min-w-72 overflow-hidden">
          <div className="grid text-xs px-3 py-2 opacity-70" style={{ gridTemplateColumns: "5.5rem 1fr 1fr 4.5rem", borderBottom: `1px solid ${LINE}` }}>
            <span>日付</span><span>ランチ</span><span>ディナー</span><span>再募集</span>
          </div>
          {days.map((d) => {
            const hol = data.isHoliday(d), t = data.typeOf(d), rr = data.ruleFor(d), cc = data.counts[d.k], on = sel === d.k;
            const short = cc.lunch < rr.lunch || cc.dinner < rr.dinner;
            const rec = data.isRecruit(d.k);
            return (
              <div key={d.k} onClick={() => setSel(d.k)} className="grid items-center px-3 py-1.5 cursor-pointer text-sm"
                style={{ gridTemplateColumns: "5.5rem 1fr 1fr 4.5rem", background: on ? "#E3E9F0" : t === "event" ? "#FBF6EC" : hol ? "#FBF8F8" : "#fff",
                  borderBottom: "1px solid #EEF1F3", borderLeft: `3px solid ${on ? NAVY : "transparent"}` }}>
                <span className="tabular-nums" style={{ color: dayColor(d, hol) }}>
                  {d.d}<span className="opacity-70 text-xs">({WD[d.w]})</span>
                  {t === "event" && <span className="ml-1 text-xs" style={{ color: TYPE.event.fg }}>イベント</span>}
                </span>
                <span><Gauge n={cc.lunch} p={cc.pLunch} need={rr.lunch} /></span>
                <span><Gauge n={cc.dinner} p={cc.pDinner} need={rr.dinner} /></span>
                <span onClick={(e) => { e.stopPropagation(); api.setRecruit(d.k, !rec); }}>
                  <span className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
                    style={rec ? { background: RED, color: "#fff" } : { border: `1px dashed ${short ? RED : "#B8C2CC"}`, color: short ? RED : "#B8C2CC" }}>
                    {rec ? "募集中" : "募集"}
                  </span>
                </span>
              </div>
            );
          })}
          <div className="px-3 py-2 text-xs opacity-70">人数は「承認済み/基準 +未承認」。赤＝基準より多い、黄＝足りない。</div>
        </Card>

        <Card className="flex-1 min-w-72 p-4 sticky top-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-base font-medium">{fmt(day.k)}</span>
            <span className="ml-auto text-xs flex gap-1"><Gauge n={c.lunch} p={c.pLunch} need={req.lunch} /><Gauge n={c.dinner} p={c.pDinner} need={req.dinner} /></span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
            <span>この日の区分</span>
            <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
              {Object.entries(TYPE).map(([t, v]) => {
                const on = data.typeOf(day) === t;
                return (
                  <button key={t} onClick={() => api.setDayType(day.k, t === data.defaultType(day) ? null : t)} className="px-3 py-1"
                    style={on ? { background: NAVY, color: "#fff" } : { background: "#fff", color: v.fg }}>{v.label}</button>
                );
              })}
            </div>
            <span className="tabular-nums opacity-70">基準 L {req.lunch}人 ／ D {req.dinner}人</span>
            {data.daySet[day.k]?.day_type && <span className="opacity-60">（通常は{TYPE[data.defaultType(day)].label}）</span>}
          </div>

          {rows.length === 0 ? <div className="text-sm opacity-60 py-4">この日の希望はまだありません。</div> : (
            <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
              {rows.map(({ s, r }) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" style={{ opacity: r.status === "rejected" ? 0.6 : 1 }}>
                  <span className="w-24 truncate">{s.name}</span>
                  <Tag s={SLOT[r.type]}>{slotText(r)}</Tag>
                  <Tag s={STATUS[r.status]}>{STATUS[r.status].label}</Tag>
                  <span className="ml-auto flex gap-1">
                    {r.status !== "approved" && <Btn small tone="primary" onClick={() => api.setStatus(r.id, "approved")}>承認</Btn>}
                    {r.status !== "rejected" && <Btn small tone="danger" onClick={() => api.setStatus(r.id, "rejected")}>拒否</Btn>}
                    {r.status !== "pending" && <Btn small onClick={() => api.setStatus(r.id, "pending")}>戻す</Btn>}
                  </span>
                </li>
              ))}
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

function RosterView({ data }) {
  const [v, setV] = useState("");
  const [names, setNames] = useState({}); // pending profile id -> 名簿に載せる名前
  const pending = data.profiles.filter((p) => p.role === "pending");
  const linked = Object.fromEntries(data.staff.filter((s) => s.profile_id).map((s) => [s.profile_id, s]));
  const nextOrder = () => (data.staff.length ? Math.max(...data.staff.map((s) => s.sort_order)) + 1 : 0);

  const add = async () => {
    const n = v.trim();
    if (!n) return;
    await api.addStaff(n, nextOrder());
    setV("");
  };
  const register = async (p) => {
    const n = (names[p.id] ?? p.display_name).trim();
    if (!n) return;
    await api.addStaff(n, nextOrder(), p.id);
    await api.setRole(p.id, "staff");
  };
  const linkTo = async (staffId, p) => {
    await api.updateStaff(staffId, { profile_id: p.id });
    await api.setRole(p.id, "staff");
  };
  const remove = async (s) => {
    if (!confirm(`${s.name} さんを名簿から外しますか？（過去の希望は残ります）`)) return;
    await api.deactivateStaff(s.id);
    if (s.profile_id) await api.setRole(s.profile_id, "pending");
  };
  const move = async (i, d) => {
    const j = i + d;
    if (j < 0 || j >= data.staff.length) return;
    const a = data.staff[i], b = data.staff[j];
    await api.updateStaff(a.id, { sort_order: j });
    await api.updateStaff(b.id, { sort_order: i });
  };
  const unlinkedStaff = data.staff.filter((s) => !s.profile_id);

  return (
    <div className="flex flex-wrap gap-4 items-start">
      {pending.length > 0 && (
        <Card className="p-4 flex-1 min-w-72" style={{ borderColor: "#F3D27A", background: "#FFFBEF" }}>
          <div className="text-sm font-medium mb-1">LINEでログインした登録待ちの人</div>
          <div className="text-xs opacity-70 mb-3">名簿に載せる名前を確認して登録してください。名簿に先に作った名前があれば、その行に紐づけることもできます。</div>
          <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
            {pending.map((p) => (
              <li key={p.id} className="py-2 text-sm flex flex-wrap items-center gap-2">
                {p.picture_url && <img src={p.picture_url} alt="" className="w-7 h-7 rounded-full" />}
                <span className="text-xs opacity-70">LINE: {p.display_name}</span>
                <input value={names[p.id] ?? p.display_name} onChange={(e) => setNames({ ...names, [p.id]: e.target.value })}
                  className="px-2 py-1 rounded border w-32" style={{ borderColor: "#B8C2CC" }} />
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

      <Card className="p-4 flex-1 min-w-72">
        <div className="text-sm mb-3">スタッフ名簿</div>
        <div className="flex gap-2 mb-3">
          <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="名前を先に作っておく（LINE未ログインでも可）" className="flex-1 px-3 py-1.5 rounded border text-sm" style={{ borderColor: "#B8C2CC" }} />
          <Btn tone="primary" onClick={add}>追加</Btn>
        </div>
        {data.staff.length === 0 ? <div className="text-sm opacity-60">まだ登録がありません。</div> : (
          <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
            {data.staff.map((s, i) => {
              const p = data.profiles.find((x) => x.id === s.profile_id);
              return (
                <li key={s.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="flex-1">{s.name}
                    {p ? <span className="ml-2 text-xs opacity-60">LINE: {p.display_name}{p.role === "manager" && "（管理者）"}</span>
                       : <span className="ml-2 text-xs" style={{ color: "#7A4A00" }}>LINE未連携</span>}
                  </span>
                  {p && p.role !== "manager" && <Btn small onClick={() => confirm(`${s.name} さんを管理者にしますか？`) && api.setRole(p.id, "manager")}>管理者にする</Btn>}
                  {p && p.role === "manager" && data.profiles.filter((x) => x.role === "manager").length > 1 && <Btn small onClick={() => api.setRole(p.id, "staff")}>管理者を外す</Btn>}
                  <Btn small onClick={() => move(i, -1)}>↑</Btn>
                  <Btn small onClick={() => move(i, 1)}>↓</Btn>
                  <Btn small onClick={() => remove(s)}>外す</Btn>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RulesView({ data, days }) {
  const rules = data.settings.rules;
  const setRule = (grp, part, v) => api.setRules({ ...rules, [grp]: { ...rules[grp], [part]: Math.max(0, Number(v) || 0) } });
  const ev = days.filter((d) => data.typeOf(d) === "event");
  return (
    <div className="flex flex-wrap gap-4 items-start">
      <Card className="p-4">
        <div className="text-sm mb-3">区分ごとの基準人数</div>
        {Object.entries(TYPE).map(([g, v]) => (
          <div key={g} className="flex items-center gap-3 py-1.5 text-sm">
            <span className="w-16">{v.label}</span>
            {["lunch", "dinner"].map((p) => (
              <label key={p} className="flex items-center gap-1">
                <Tag s={SLOT[p]}>{SLOT[p].label}</Tag>
                <input type="number" min={0} defaultValue={rules[g]?.[p] ?? 0} key={`${g}${p}${rules[g]?.[p]}`}
                  onBlur={(e) => Number(e.target.value) !== rules[g]?.[p] && setRule(g, p, e.target.value)}
                  className="w-12 border rounded px-1 tabular-nums" />人
              </label>
            ))}
          </div>
        ))}
        <div className="text-xs opacity-60 mt-2">入力欄から離れると保存されます。</div>
      </Card>
      <Card className="p-4 text-sm">
        <div className="mb-2">この月のイベント日</div>
        {ev.length === 0 ? <div className="opacity-60 text-xs">「日程ごとの承認」で日付を選び、区分を「イベント」にすると登録されます。</div>
          : <ul>{ev.map((d) => <li key={d.k} className="tabular-nums py-0.5">{fmt(d.k)}</li>)}</ul>}
      </Card>
    </div>
  );
}
