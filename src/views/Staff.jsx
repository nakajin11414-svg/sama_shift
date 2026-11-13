import { useState } from "react";
import { api } from "../lib/data.js";
import { WD, PARTS, PART_KEYS, CUSTOM, OFF_WISH, canOffice, CHANGE_STATUS, NAVY, LINE, RED, CLOSED_BG, slotShort, slotText, slotStyle, dayColor } from "../lib/util.js";
import { Btn, Card, Tag } from "../ui.jsx";

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
  const [reason, setReason] = useState("");

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
  // 定休日は選べない（ただし既に希望が入っている日は、取り消せるように選べる）
  const selectable = (d) => !data.isClosed(d) || !!mine[d.k];
  // 締切後は募集中の日以外を直接変更できない（変更依頼を送る）。管理者は常に直接変更できる
  const locked = (d) => !isManager && data.isLocked(d);
  const dayOf = (k) => days.find((d) => d.k === k);
  const pick = (pred) => setSel(new Set(days.filter((d) => !data.isClosed(d) && !locked(d) && pred(d)).map((d) => d.k)));
  const lockedSel = [...sel].filter((k) => locked(dayOf(k)));
  const mode = lockedSel.length === 0 ? "edit" : lockedSel.length === sel.size ? "request" : "mixed";
  const offMode = canOffice(me); // 運営・社員は休み希望を出す
  // 募集中の日の不足: [枠, あと何人][]（基準人数 − 出勤の人数。研修中は数えない）
  const shortOf = (d) => PART_KEYS.map((p) => [p, data.ruleFor(d)[p] - data.counts[d.k][p].n]).filter(([, n]) => n > 0);
  const recruitDays = days.filter((d) => data.isRecruit(d.k) && !data.isClosed(d));
  // 自分の変更依頼（この店舗）
  const myChanges = (data.changes || []).filter((c) => c.staff_id === me.id && c.store_id === data.store.id);
  const pendingChange = Object.fromEntries(myChanges.filter((c) => c.status === "pending").map((c) => [c.date, c]));
  // 「通し」はランチ・ディナーとは別のボタンとして選ぶ（どちらかを選ぶともう一方は外れる）
  const togglePart = (p) => setParts((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else {
      n.add(p);
      if (p === "through") { n.delete("lunch"); n.delete("dinner"); }
      if (p === "lunch" || p === "dinner") n.delete("through");
    }
    return n;
  });
  const chosenParts = () => PART_KEYS.filter((p) => parts.has(p) || (parts.has("through") && (p === "lunch" || p === "dinner")));

  const hh = (h) => `${String(h).padStart(2, "0")}:00`;
  const endFor = (v) => (v === "lunch" || v === "dinner" ? data.windows[v][1] : Number(v));
  const endChoices = [
    ...["lunch", "dinner"].filter((p) => data.windows[p][1] > start).map((p) => ({ v: p, label: `${PARTS[p].label}終業` })),
    ...HOURS.filter((h) => h > start).map((h) => ({ v: String(h), label: `${h}時` })),
  ];
  const changeStart = (h) => { setStart(h); if (endFor(end) <= h) setEnd(String(h + 1)); };

  const apply = async (type) => {
    if (type === "parts" && parts.size === 0) return alert("枠を1つ以上選んでください");
    // 定休日には登録しない（取り消しだけできる）
    const open = [...sel].filter((k) => !data.isClosed(dayOf(k)));
    if (type && !open.length) return alert("選択中の日はすべて定休日です");
    if (mode === "request") {
      // 締切後: 変更依頼として管理者に送る
      const dates = type ? open : [...sel].filter((k) => mine[k]);
      if (!dates.length) return alert("選択中の日に取り消す希望がありません");
      if (dates.some((k) => pendingChange[k]) && !confirm("確認待ちの変更依頼がある日が含まれています。新しい依頼も送りますか？")) return;
      setBusy(true);
      try {
        await api.sendChangeRequests(me.id, data.store.id, dates, type ? "set" : "remove", type, chosenParts(), hh(start), hh(endFor(end)), reason.trim());
        setSel(new Set()); setReason("");
        alert(`${dates.length} 日分の変更依頼を送りました。管理者の確認をお待ちください。`);
      } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      // 管理者の代理入力は出勤として確定。休み希望は出勤ではないので未定のまま
      const status = type === "off" ? (isManager ? "pending" : undefined) : isManager ? "approved" : undefined;
      if (type) await api.upsertRequests(me.id, data.store.id, open, type, chosenParts(), hh(start), hh(endFor(end)), status);
      else await api.deleteRequests(me.id, data.store.id, [...sel]);
      setSel(new Set());
    } finally { setBusy(false); }
  };
  const verb = mode === "request" ? "変更依頼" : "登録";
  const fmtDl = (k) => { const [, m, d] = k.split("-").map(Number); return `${m}/${d}(${WD[new Date(k + "T00:00").getDay()]})`; };

  return (
    <div className="p-4 max-w-3xl mx-auto">
      {isManager && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm p-2 rounded" style={{ background: "#F6EBD6" }}>
          <span>編集する人</span>
          <select value={me.id} onChange={(e) => { setTargetId(e.target.value); setSel(new Set()); }} className="px-2 py-1 rounded border bg-white" style={{ borderColor: "#B8C2CC" }}>
            {data.staffInStore.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === myRow?.id ? "（自分）" : ""}</option>)}
          </select>
          <span className="text-xs opacity-70">管理者が入れた希望はそのまま出勤になります</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-2 text-sm items-center">
        <span className="mr-2">{me.name} さん{editingOther && <span className="text-xs ml-1" style={{ color: "#7A4A00" }}>の希望を代理で編集中</span>}<span className="text-xs opacity-60 ml-2">{data.store.name}</span></span>
        <Btn small onClick={() => pick(() => true)}>全選択</Btn>
        <Btn small onClick={() => pick((d) => !data.isHoliday(d))}>平日のみ</Btn>
        <Btn small onClick={() => pick(data.isHoliday)}>土日祝のみ</Btn>
        <Btn small onClick={() => setSel(new Set())}>選択解除</Btn>
      </div>
      {data.deadline && (
        data.deadlinePassed ? (
          <div className="text-xs mb-2 px-3 py-2 rounded" style={{ background: "#F7E4E4", color: "#7A1E1E" }}>
            締切（{fmtDl(data.deadline)}）を過ぎました。{isManager ? "管理者は引き続き直接変更できます。" : "「募集中」の日だけ直接入力できます。それ以外の日を変えたいときは、日付を選んで下から変更依頼を送ってください。"}
          </div>
        ) : (
          <div className="text-xs mb-2 px-3 py-2 rounded" style={{ background: "#F6EBD6", color: "#7A4A00" }}>
            締切: {fmtDl(data.deadline)} まで。締切後は変更依頼（管理者の承諾が必要）になります。
          </div>
        )
      )}
      <div className="text-xs opacity-70 mb-2">日付をタップで複数選択 → 下で枠を選ぶと一括{verb}</div>

      {recruitDays.length > 0 && (
        <div className="mb-2 px-3 py-2 rounded text-xs" style={{ background: "#F7E4E4", color: "#7A1E1E" }}>
          <div className="font-medium mb-1">人が足りない日（募集中）{offMode ? "" : "　タップで選択"}</div>
          <ul className="flex flex-col gap-0.5">
            {recruitDays.map((d) => {
              const sh = shortOf(d);
              return (
                <li key={d.k}>
                  <button disabled={offMode || !selectable(d)} onClick={() => toggle(d.k)} className="text-left underline-offset-2 hover:underline disabled:no-underline">
                    <span className="tabular-nums">{fmtDl(d.k)}</span>{" "}
                    {sh.length ? sh.map(([p, n]) => `${PARTS[p].label}あと${n}人`).join("、") : "募集中"}
                    {mine[d.k] && <span className="opacity-70">（希望済み: {slotText(mine[d.k])}）</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
          const closed = data.isClosed(day);
          return (
            <button key={day.k} onClick={() => toggle(day.k)} disabled={!selectable(day)}
              className="rounded text-left p-1.5 min-h-16 flex flex-col disabled:cursor-not-allowed"
              style={{ border: `2px solid ${on ? NAVY : LINE}`, background: on ? "#E3E9F0" : closed ? CLOSED_BG : hol ? "#F7F2F2" : "#fff" }}>
              <span className="text-sm tabular-nums" style={{ color: dayColor(day, hol), opacity: closed ? 0.6 : 1 }}>{day.d}</span>
              {closed && <span className="text-xs opacity-60">定休日</span>}
              {r && (
                <span className="mt-auto text-xs px-1 rounded self-start" style={{ background: slotStyle(r).bg, color: slotStyle(r).fg, opacity: r.status === "rejected" ? 0.5 : 1 }}>
                  {slotShort(r)}{r.status !== "pending" && <span className="ml-1">{r.status === "approved" ? "✓" : "✕"}</span>}
                </span>
              )}
              {ot.length > 0 && <span className="text-xs opacity-60 truncate" title={ot.map((x) => data.stores.find((s) => s.id === x.store_id)?.name).join("、")}>他店{ot.some((x) => x.status === "approved") ? "✓" : ""}</span>}
              {data.isRecruit(day.k) && !closed && !r && ot.length === 0 && (
                <span className="mt-auto text-xs leading-tight" style={{ color: RED }}>募集{shortOf(day).length > 0 && <span className="block">{shortOf(day).map(([p, n]) => `${PARTS[p].short}${n}`).join(" ")}</span>}</span>
              )}
              {pendingChange[day.k] && <span className="text-xs truncate" style={{ color: "#7A4A00" }}>依頼中</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-1 text-xs opacity-70">✓ 出勤 ／ ✕ 休み ／ 印なし 確認待ち ／ 他店 = 別店舗に希望あり ／ 灰色 = 定休日（選べません）{offMode && " ／ 休 = 休み希望（それ以外の日は出勤予定）"}{data.deadlinePassed && !isManager && " ／ 依頼中 = 変更依頼の確認待ち"}</div>

      <Card className="mt-4 p-4" style={mode === "request" ? { borderColor: "#E0B35A", background: "#FFFBEF" } : undefined}>
        {mode === "mixed" ? (
          <div className="text-sm" style={{ color: RED }}>「募集中」の日と締切後の日が混ざっています。募集中の日（直接入力）と、それ以外の日（変更依頼）は分けて選んでください。</div>
        ) : <>
        <div className="text-sm mb-2">
          {!sel.size ? "日付を選んでください" : mode === "request" ? `選択中の ${sel.size} 日の変更依頼（締切後のため、管理者の承諾が必要です）` : offMode ? `選択中の ${sel.size} 日` : `選択中の ${sel.size} 日に入れる枠`}
        </div>
        {mode === "request" && (
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="理由（例: 学校の予定が入ったため）"
            className="w-full mb-3 px-2 py-1.5 rounded border text-sm bg-white" style={{ borderColor: "#B8C2CC" }} />
        )}
        {offMode ? (
          // 運営・社員: 休みたい日だけ出す。それ以外の日は出勤予定（枠は管理者が決める）
          <div className="flex flex-wrap gap-2 items-center">
            <button disabled={!sel.size || busy} onClick={() => apply("off")} className="px-3 py-1.5 rounded text-sm disabled:opacity-40"
              style={{ background: OFF_WISH.bg, color: OFF_WISH.fg }}>休み希望で{verb}</button>
            <Btn small disabled={!sel.size || busy} onClick={() => apply(null)}>{mode === "request" ? "選択日の取り消しを依頼" : "選択日の休み希望を取り消す"}</Btn>
            <span className="w-full text-xs opacity-60">運営・社員は休みたい日だけ入れてください。それ以外の日は出勤予定として、管理者が枠（仕込み・ランチ・ディナー・事務など）を決めます。</span>
          </div>
        ) : <>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          {PART_KEYS.map((p) => (
            <button key={p} onClick={() => togglePart(p)} className="px-3 py-1.5 rounded text-sm"
              style={parts.has(p) ? { background: PARTS[p].bg, color: PARTS[p].fg, outline: `2px solid ${NAVY}` } : { background: "#fff", color: NAVY, border: `1px solid ${LINE}` }}>
              {PARTS[p].label}
            </button>
          ))}
          <button onClick={() => togglePart("through")} className="px-3 py-1.5 rounded text-sm"
            style={parts.has("through") ? { background: slotStyle({ parts: ["lunch", "dinner"] }).bg, color: slotStyle({ parts: ["lunch", "dinner"] }).fg, outline: `2px solid ${NAVY}` } : { background: "#fff", color: NAVY, border: `1px solid ${LINE}` }}>
            通し
          </button>
          <Btn tone="primary" disabled={!sel.size || busy || !parts.size} onClick={() => apply("parts")}>この枠で{verb}</Btn>
          <span className="text-xs opacity-60">仕込みと組み合わせることもできます（例: 仕込み＋ランチ、仕込み＋通し）</span>
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
              style={{ background: CUSTOM.bg, color: CUSTOM.fg }}>時間指定で{verb}</button>
          </span>
          <Btn small disabled={!sel.size || busy} onClick={() => apply(null)}>{mode === "request" ? "選択日の取り消しを依頼" : "選択日の希望を取り消す"}</Btn>
        </div>
        </>}
        </>}
      </Card>

      {myChanges.length > 0 && (
        <Card className="mt-4 p-4 text-sm">
          <div className="mb-2">送った変更依頼</div>
          <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
            {myChanges.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="tabular-nums w-16">{fmtDl(c.date)}</span>
                {c.action === "remove" ? <span className="text-xs">取り消し</span> : <Tag s={slotStyle(c)}>{slotText(c)}</Tag>}
                {c.reason && <span className="text-xs opacity-70 truncate max-w-[12rem]" title={c.reason}>{c.reason}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <Tag s={CHANGE_STATUS[c.status]}>{CHANGE_STATUS[c.status].label}</Tag>
                  {c.status === "pending" && <Btn small onClick={() => confirm("この変更依頼を取り下げますか？") && api.withdrawChangeRequest(c.id)}>取り下げ</Btn>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
