import { useState } from "react";
import { api } from "../lib/data.js";
import { WD, SLOT, NAVY, LINE, RED, slotShort, dayColor } from "../lib/util.js";
import { Btn, Card } from "../ui.jsx";

export default function StaffView({ data, days, profile }) {
  const me = data.staff.find((s) => s.profile_id === profile.id);
  const [sel, setSel] = useState(new Set());
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("14:00");
  const [busy, setBusy] = useState(false);

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

  const mine = data.requests[me.id] || {};
  const lead = days[0].w;
  const toggle = (k) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const pick = (pred) => setSel(new Set(days.filter(pred).map((d) => d.k)));

  const apply = async (type) => {
    setBusy(true);
    try {
      if (type) await api.upsertRequests(me.id, [...sel], type, start, end);
      else await api.deleteRequests(me.id, [...sel]);
      setSel(new Set());
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex flex-wrap gap-2 mb-2 text-sm items-center">
        <span className="mr-2">{me.name} さん</span>
        <Btn small onClick={() => pick(() => true)}>全選択</Btn>
        <Btn small onClick={() => pick((d) => !data.isHoliday(d))}>平日のみ</Btn>
        <Btn small onClick={() => pick(data.isHoliday)}>土日祝のみ</Btn>
        <Btn small onClick={() => setSel(new Set())}>選択解除</Btn>
      </div>
      <div className="text-xs opacity-70 mb-2">日付をタップで複数選択 → 下で時間を選ぶと一括登録</div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1">
        {WD.map((w, i) => <div key={w} className="py-1" style={{ color: i === 0 ? RED : i === 6 ? "#2C5282" : undefined }}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }).map((_, i) => <div key={"e" + i} />)}
        {days.map((day) => {
          const r = mine[day.k];
          const hol = data.isHoliday(day);
          const on = sel.has(day.k);
          return (
            <button key={day.k} onClick={() => toggle(day.k)}
              className="rounded text-left p-1.5 min-h-16 flex flex-col"
              style={{ border: `2px solid ${on ? NAVY : LINE}`, background: on ? "#E3E9F0" : hol ? "#F7F2F2" : "#fff" }}>
              <span className="text-sm tabular-nums" style={{ color: dayColor(day, hol) }}>{day.d}</span>
              {r && (
                <span className="mt-auto text-xs px-1 rounded self-start" style={{ background: SLOT[r.type].bg, color: SLOT[r.type].fg, opacity: r.status === "rejected" ? 0.5 : 1 }}>
                  {slotShort(r)}{r.status !== "pending" && <span className="ml-1">{r.status === "approved" ? "✓" : "✕"}</span>}
                </span>
              )}
              {data.isRecruit(day.k) && !r && <span className="mt-auto text-xs" style={{ color: RED }}>募集中</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-1 text-xs opacity-70">✓ 承認済み ／ ✕ 今回は入れません ／ 印なし 確認待ち</div>

      <Card className="mt-4 p-4">
        <div className="text-sm mb-2">{sel.size ? `選択中の ${sel.size} 日に入れる時間` : "日付を選んでください"}</div>
        <div className="flex flex-wrap gap-2 items-center">
          {["lunch", "dinner", "both"].map((t) => (
            <button key={t} disabled={!sel.size || busy} onClick={() => apply(t)} className="px-3 py-1.5 rounded text-sm disabled:opacity-40"
              style={{ background: SLOT[t].bg, color: SLOT[t].fg }}>{SLOT[t].label}</button>
          ))}
          <span className="flex items-center gap-1 text-sm">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="border rounded px-1" />〜
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="border rounded px-1" />
            <button disabled={!sel.size || busy} onClick={() => apply("custom")} className="px-3 py-1.5 rounded disabled:opacity-40"
              style={{ background: SLOT.custom.bg, color: SLOT.custom.fg }}>時間指定で登録</button>
          </span>
          <Btn small disabled={!sel.size || busy} onClick={() => apply(null)}>選択日の希望を取り消す</Btn>
        </div>
      </Card>
    </div>
  );
}
