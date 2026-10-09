import { useState } from "react";
import { api } from "../lib/data.js";
import { WD, PARTS, PART_KEYS, CUSTOM, NAVY, LINE, RED, slotShort, slotStyle, dayColor } from "../lib/util.js";
import { Btn, Card } from "../ui.jsx";

const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8〜22時

export default function StaffView({ data, days, profile }) {
  const isManager = profile.role === "manager";
  const myRow = data.staff.find((s) => s.profile_id === profile.id);
  const [targetId, setTargetId] = useState(null);
  const me = isManager ? data.staffInStore.find((s) => s.id === targetId) || (myRow && data.staffInStore.find((s) => s.id === myRow.id)) || data.staffInStore[0] : myRow;
  const editingOther = isManager && me && me.id !== myRow?.id;
  const inStore = me && data.membership[me.id]?.has(data.store.id);
  const [sel, setSel] = useState(new Set());
  const [parts, setParts] = useState(new Set(["lunch"]));
  const [start, setStart] = useState(10);
  const [end, setEnd] = useState("14");
  const [busy, setBusy] = useState(false);

  if (isManager && !me) {
    return <div className="p-6 text-sm opacity-70">この店舗に所属するスタッフがいません。「管理者 → スタッフ名簿」で所属店舗にチェックを入れてください。</div>;
  }
  if (profile.role === "pending" || !me) {
    return (
      <div className="p-6 max-w-md mx-auto text-sm">
        <Card className="p-4">
          <div className="font-medium mb-2">管理者の登録待ちです</div>
          <p className="opacity-80">ログインは完了しています。管理者があなた（{profile.display_name}）をスタッフ名簿に登録すると、ここから希望を入力できるようになります。</p>
        </Card>
      </div>
    );
  }
  if (!inStore) {
    return <div className="p-6 text-sm opacity-70">{me.name} さんは「{data.store.name}」に所属していません。上の店舗切替で所属店舗を選ぶか、管理者に所属の追加を依頼してください。</div>;
  }

  const mine = data.requests[me.id] || {};
  const others = (k) => (data.requestsAll[me.id]?.[k] || []).filter((r) => r.store_id !== data.store.id && r.status !== "rejected");
  const lead = days[0].w;
  const toggle = (k) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const pick = (pred) => setSel(new Set(days.filter(pred).map((d) => d.k)));
  const togglePart = (p) => setParts((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const isThrough = parts.size === 2 && parts.has("lunch") && parts.has("dinner");
  const hh = (h) => `${String(h).padStart(2, "0")}:00`;
  const endFor = (v) => (v === "lunch" || v === "dinner" ? data.windows[v][1] : Number(v));
  const endChoices = [
    ...["lunch", "dinner"].filter((p) => data.windows[p][1] > start).map((p) => ({ v: p, label: `${PARTS[p].label}終業` })),
    ...HOURS.filter((h) => h > start).map((h) => ({ v: String(h), label: `${h}時` })),
  ];
  const changeStart = (h) => { setStart(h); if (endFor(end) <= h) setEnd(String(h + 1)); };

  const apply = async (type) => {
    if (type === "parts" && parts.size === 0) return alert("枠を1つ以上選んでください");
    setBusy(true);
    try {
      if (type) await api.upsertRequests(me.id, data.store.id, [...sel], type, PART_KEYS.filter((p) => parts.has(p)), hh(start), hh(endFor(end)), isManager ? "approved" : undefined);
      else await api.deleteRequests(me.id, data.store.id, [...sel]);
      setSel(new Set());
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4 max-w-3xl mx-auto">
      {isManager && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm p-2 rounded" style={{ background: "#F6EBD6" }}>
          <span>編集する人</span>
          <select value={me.id} onChange={(e) => { setTargetId(e.target.value); setSel(new Set()); }} className="px-2 py-1 rounded border bg-white" style={{ borderColor: "#B8C2CC" }}>
            {data.staffInStore.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === myRow?.id ? "（自分）" : ""}</option>)}
          </select>
          <span className="text-xs opacity-70">管理者が入れた希望はそのまま承認済みになります</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-2 text-sm items-center">
        <span className="mr-2">{me.name} さん{editingOther && <span className="text-xs ml-1" style={{ color: "#7A4A00" }}>の希望を代理で編集中</span>}<span className="text-xs opacity-60 ml-2">{data.store.name}</span></span>
        <Btn small onClick={() => pick(() => true)}>全選択</Btn>
        <Btn small onClick={() => pick((d) => !data.isHoliday(d))}>平日のみ</Btn>
        <Btn small onClick={() => pick(data.isHoliday)}>土日祝のみ</Btn>
        <Btn small onClick={() => setSel(new Set())}>選択解除</Btn>
      </div>
      <div className="text-xs opacity-70 mb-2">日付をタップで複数選択 → 下で枠を選ぶと一括登録</div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1">
        {WD.map((w, i) => <div key={w} className="py-1" style={{ color: i === 0 ? RED : i === 6 ? "#2C5282" : undefined }}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }).map((_, i) => <div key={"e" + i} />)}
        {days.map((day) => {
          const r = mine[day.k];
          const hol = data.isHoliday(day);
          const on = sel.has(day.k);
          const ot = others(day.k);
          return (
            <button key={day.k} onClick={() => toggle(day.k)}
              className="rounded text-left p-1.5 min-h-16 flex flex-col"
              style={{ border: `2px solid ${on ? NAVY : LINE}`, background: on ? "#E3E9F0" : hol ? "#F7F2F2" : "#fff" }}>
              <span className="text-sm tabular-nums" style={{ color: dayColor(day, hol) }}>{day.d}</span>
              {r && (
                <span className="mt-auto text-xs px-1 rounded self-start" style={{ background: slotStyle(r).bg, color: slotStyle(r).fg, opacity: r.status === "rejected" ? 0.5 : 1 }}>
                  {slotShort(r)}{r.status !== "pending" && <span className="ml-1">{r.status === "approved" ? "✓" : "✕"}</span>}
                </span>
              )}
              {ot.length > 0 && <span className="text-xs opacity-60 truncate" title={ot.map((x) => data.stores.find((s) => s.id === x.store_id)?.name).join("、")}>他店{ot.some((x) => x.status === "approved") ? "✓" : ""}</span>}
              {data.isRecruit(day.k) && !r && ot.length === 0 && <span className="mt-auto text-xs" style={{ color: RED }}>募集中</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-1 text-xs opacity-70">✓ 承認済み ／ ✕ 今回は入れません ／ 印なし 確認待ち ／ 他店 = 別店舗に希望あり</div>

      <Card className="mt-4 p-4">
        <div className="text-sm mb-2">{sel.size ? `選択中の ${sel.size} 日に入れる枠` : "日付を選んでください"}</div>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          {PART_KEYS.map((p) => (
            <button key={p} onClick={() => togglePart(p)} className="px-3 py-1.5 rounded text-sm"
              style={parts.has(p) ? { background: PARTS[p].bg, color: PARTS[p].fg, outline: `2px solid ${NAVY}` } : { background: "#fff", color: NAVY, border: `1px solid ${LINE}` }}>
              {PARTS[p].label}
            </button>
          ))}
          <button onClick={() => setParts(isThrough ? new Set() : new Set(["lunch", "dinner"]))} className="px-3 py-1.5 rounded text-sm"
            style={isThrough ? { background: `linear-gradient(90deg, ${PARTS.lunch.bg} 50%, ${PARTS.dinner.bg} 50%)`, color: NAVY, outline: `2px solid ${NAVY}` } : { background: "#fff", color: NAVY, border: `1px solid ${LINE}` }}>
            通し
          </button>
          <Btn tone="primary" disabled={!sel.size || busy || !parts.size} onClick={() => apply("parts")}>この枠で登録</Btn>
          <span className="text-xs opacity-60">通し＝ランチ＋ディナー。複数選ぶと組み合わせ（例: 仕込み＋ランチ）</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="flex items-center gap-1 text-sm">
            <select value={start} onChange={(e) => changeStart(Number(e.target.value))} className="border rounded px-1 py-1 bg-white">
              {HOURS.filter((h) => h < 22).map((h) => <option key={h} value={h}>{h}時</option>)}
            </select>〜
            <select value={end} onChange={(e) => setEnd(e.target.value)} className="border rounded px-1 py-1 bg-white">
              {endChoices.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
            <button disabled={!sel.size || busy} onClick={() => apply("custom")} className="px-3 py-1.5 rounded disabled:opacity-40"
              style={{ background: CUSTOM.bg, color: CUSTOM.fg }}>時間指定で登録</button>
          </span>
          <Btn small disabled={!sel.size || busy} onClick={() => apply(null)}>選択日の希望を取り消す</Btn>
        </div>
      </Card>
    </div>
  );
}
