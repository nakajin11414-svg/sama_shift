import { useEffect, useState } from "react";
import { api } from "../lib/data.js";
import { WD, PARTS, PART_KEYS, STATUS, CHANGE_STATUS, OFFICE, OFF_WISH, canOffice, isPartTime, TYPE, SKILLS, POSITIONS, skillShort, NAVY, LINE, RED, CLOSED_BG, fmt, pad, holidayName, skillShortage, DEFAULT_RULE, DEFAULT_WINDOWS, slotText, slotStyle, dayColor, defaultDayHours, autoWork, BREAK_END, workHours, fmtHours, hhmm } from "../lib/util.js";
import { Btn, Card, Tag, Gauge } from "../ui.jsx";

export default function ManagerView(props) {
  const [tab, setTab] = useState("approve");
  const pending = props.data.profiles.filter((p) => p.role === "pending").length;
  const changes = props.data.changes.filter((c) => c.status === "pending").length;
  const tabs = [["approve", "シフト管理"], ["changes", `変更依頼${changes ? `（${changes}）` : ""}`], ["worklog", "実働時間"], ["roster", `スタッフ名簿${pending ? `（登録待ち ${pending}）` : ""}`], ["stores", "店舗・基準人数"]];
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
        : tab === "changes" ? <ChangesView {...props} />
        : tab === "worklog" ? <WorkLogView {...props} />
        : tab === "roster" ? <RosterView {...props} />
        : <StoresView {...props} />}
    </div>
  );
}

// 枠ごとの人数ゲージ＋デリバリー・厨房・仕込みの警告
function PartGauge({ c, rule, part, compact }) {
  const sh = skillShortage(c, rule, part);
  const warn = c.n > 0 && sh.any;
  return (
    <span className="inline-flex items-center gap-0.5">
      <Gauge n={c.n} p={c.pending} need={rule[part]} />
      {warn && !compact && (
        <span className="text-xs" style={{ color: RED }} title="出勤の人だけでは、デリバリー・厨房・仕込みの必要人数に足りません（配達と厨房の両方ができる人はどちらか一方に数えます）">
          {[sh.delivery && `配達-${sh.delivery}`, sh.kitchen && `厨房-${sh.kitchen}`, sh.either && `配達か厨房-${sh.either}`, sh.prepper && `仕込み-${sh.prepper}`].filter(Boolean).join(" ")}
        </span>
      )}
      {warn && compact && <span className="text-xs" style={{ color: RED }}>!</span>}
    </span>
  );
}


// 社員の休み残り（全店舗の出勤で数える。休み = その月で出勤（承諾済み）がない日）
function EmployeeDaysOff({ data, days, mk }) {
  const quota = data.employeeDaysOff;
  const employees = data.staff.filter((s) => s.position === "employee");
  const stat = (s) => {
    const all = data.requestsAll[s.id] || {};
    const work = days.filter((d) => (all[d.k] || []).some((r) => r.status === "approved")).length;
    const pending = days.filter((d) => (all[d.k] || []).some((r) => r.status === "pending" && r.type !== "off") && !(all[d.k] || []).some((r) => r.status === "approved")).length;
    const off = days.length - work;
    return { work, pending, off, left: quota == null ? null : quota - off };
  };
  return (
    <Card className="px-4 py-3 mb-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span>社員の休み</span>
        <label className="flex items-center gap-1 text-xs">
          {mk.replace("-", "年")}月の休み
          <input type="number" min={0} max={days.length} key={`${mk}${quota}`} defaultValue={quota ?? ""} placeholder="未設定"
            onBlur={(e) => { const v = e.target.value === "" ? null : Math.max(0, Math.min(days.length, Number(e.target.value) || 0)); if (v !== quota) api.setEmployeeDaysOff(mk, v); }}
            onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
            className="w-16 border rounded px-1 py-0.5 tabular-nums" style={{ borderColor: LINE }} />日
        </label>
        <span className="text-xs opacity-60">全店舗共通。休み＝出勤（承諾済み）がない日。入力欄から離れると保存</span>
      </div>
      {employees.length === 0 ? <div className="text-xs opacity-60">役職が「社員」のスタッフがいません（スタッフ名簿で設定）。</div> : (
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {employees.map((s) => {
            const st = stat(s);
            return (
              <span key={s.id} className="tabular-nums" title={`出勤 ${st.work}日 ／ 休み ${st.off}日${st.pending ? ` ／ 未定 ${st.pending}日` : ""}`}>
                {s.name}：{st.left == null ? <span className="opacity-60">休み {st.off}日</span>
                  : st.left >= 0 ? <>休み残り<b className="mx-0.5">{st.left}</b>日</>
                  : <span style={{ color: RED }}>休み残り0日（{-st.left}日多い）</span>}
                <span className="text-xs opacity-50 ml-1">出勤{st.work}{st.pending ? `・未定${st.pending}` : ""}</span>
              </span>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---------- シフト管理 ----------
// 「出勤」で開く枠の選択。選べるのは希望の範囲内だけ
//   枠の希望: 希望した枠（仕込み・ランチ・ディナーを個別に。複数選べる）＋ その枠の時間内での時間指定
//   時間指定の希望: その時間内に収まる枠 ＋ その時間内での時間指定
//   組み合わせ（ランチ＋ディナー＝通し など）は確定シフトの表記で分かるので、選択肢には出さない
const STEP_MIN = 30; // 時間指定の刻み（分）
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

function slotChoices(orig, windows) {
  const win = (p) => windows[p] || DEFAULT_WINDOWS[p];
  let allowed; // 選べる枠
  let segments; // 時間指定できる範囲 [開始分, 終了分][]
  if (orig.type === "custom") {
    const s = toMin(hhmm(orig.start_time)), e = toMin(hhmm(orig.end_time));
    allowed = PART_KEYS.filter((p) => win(p)[0] * 60 >= s && win(p)[1] * 60 <= e);
    segments = [[s, e]];
  } else {
    const ps = PART_KEYS.filter((p) => (orig.parts || []).includes(p));
    allowed = ps;
    // 続いている枠（仕込み→ランチ→ディナー）はつなげて1つの範囲にする
    segments = [];
    ps.forEach((p, i) => {
      const [a, b] = win(p).map((h) => h * 60);
      const prev = ps[i - 1];
      if (prev && PART_KEYS.indexOf(prev) === PART_KEYS.indexOf(p) - 1) segments[segments.length - 1][1] = Math.max(segments[segments.length - 1][1], b);
      else segments.push([a, b]);
    });
  }
  if (!segments.length) segments = [win("lunch").map((h) => h * 60)]; // 念のため（枠の無い希望）
  return { allowed, segments };
}

// r = 既存の希望（null なら社員・運営の出勤を新しく追加）。office = 運営・社員（全部の枠と事務を選べる）
function SlotEditor({ r, windows, office, onSave, onDone }) {
  const base = r || { type: "parts", parts: [] };
  const orig = base.desired || base; // スタッフの元の希望
  // 運営・社員は希望に関係なく全部の枠を選べる。アルバイトは希望の範囲内だけ
  const { allowed, segments } = slotChoices(office ? { type: "parts", parts: PART_KEYS } : orig, windows);
  const officeWish = !office && orig.type === "office"; // （念のため）事務の希望なら事務だけ
  // mode: "parts"（枠を選ぶ）／ "custom"（時間指定）／ "office"（事務。運営・社員のみ）
  const [mode, setMode] = useState(base.type === "office" || officeWish ? "office" : base.type === "custom" || !allowed.length ? "custom" : "parts");
  const [parts, setParts] = useState(() => new Set(base.type === "custom" ? [] : (base.parts || []).filter((p) => allowed.includes(p))));
  const togglePart = (p) => { setMode("parts"); setParts((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; }); };
  const points = (seg) => {
    const out = new Set([seg[0], seg[1]]);
    for (let m = Math.ceil(seg[0] / STEP_MIN) * STEP_MIN; m < seg[1]; m += STEP_MIN) out.add(m);
    return [...out].sort((a, b) => a - b);
  };
  const segOf = (m) => segments.find(([a, b]) => m >= a && m < b) || segments[0];
  const initStart = base.type === "custom" ? toMin(hhmm(base.start_time)) : segments[0][0];
  const [start, setStart] = useState(initStart);
  const [end, setEnd] = useState(base.type === "custom" ? toMin(hhmm(base.end_time)) : segOf(initStart)[1]);
  const [busy, setBusy] = useState(false);
  const startOpts = segments.flatMap((seg) => points(seg).filter((m) => m < seg[1]));
  const endOpts = points(segOf(start)).filter((m) => m > start);
  const changeStart = (m) => { setStart(m); if (end <= m || end > segOf(m)[1]) setEnd(segOf(m)[1]); };

  const save = async () => {
    if (mode === "parts" && !parts.size) return alert("枠を1つ以上選んでください");
    const slot = mode === "parts" ? { type: "parts", parts: PART_KEYS.filter((p) => parts.has(p)), start_time: null, end_time: null }
      : mode === "office" ? { type: "office", parts: [], start_time: null, end_time: null }
      : { type: "custom", parts: [], start_time: fromMin(start), end_time: fromMin(end) };
    setBusy(true);
    try { await (onSave ? onSave(slot) : api.approveAs(r, slot)); onDone(); } finally { setBusy(false); }
  };
  const chip = (on, s) => (on ? { background: s?.bg || NAVY, color: s?.fg || "#fff", outline: `2px solid ${NAVY}` } : { background: "#fff", color: NAVY, border: `1px solid ${LINE}` });
  const sel = "border rounded px-1 py-0.5 bg-white tabular-nums";
  return (
    <div className="w-full mt-1 p-2 rounded text-xs flex flex-wrap items-center gap-2" style={{ background: "#F4F6F8" }}>
      <span className="opacity-70">出勤の枠</span>
      {!officeWish && allowed.map((p) => (
        <button key={p} onClick={() => togglePart(p)} className="px-2.5 py-1 rounded" style={chip(mode === "parts" && parts.has(p), PARTS[p])}>{PARTS[p].label}</button>
      ))}
      {!officeWish && <button onClick={() => setMode("custom")} className="px-2.5 py-1 rounded" style={chip(mode === "custom")}>時間指定</button>}
      {(office || officeWish) && <button onClick={() => setMode("office")} className="px-2.5 py-1 rounded" style={chip(mode === "office", OFFICE)}>{OFFICE.label}</button>}
      {mode === "parts" && parts.size > 1 && <span className="opacity-60">→ {slotText({ type: "parts", parts: [...parts] })}</span>}
      {mode === "custom" && (
        <span className="flex items-center gap-1">
          <select value={start} onChange={(e) => changeStart(Number(e.target.value))} className={sel}>{startOpts.map((m) => <option key={m} value={m}>{fromMin(m)}</option>)}</select>〜
          <select value={end} onChange={(e) => setEnd(Number(e.target.value))} className={sel}>{endOpts.map((m) => <option key={m} value={m}>{fromMin(m)}</option>)}</select>
        </span>
      )}
      <span className="ml-auto flex gap-1">
        <Btn small tone="primary" disabled={busy} onClick={save}>この内容で出勤</Btn>
        <Btn small onClick={onDone}>やめる</Btn>
      </span>
      <div className="w-full opacity-60">
        {office ? "運営・社員は希望に関係なくすべての枠を選べます。「事務」は出勤日に数えますが、各枠の人数には数えません"
          : `希望（${slotText(orig)}）の範囲内で選べます`}
      </div>
    </div>
  );
}

function ApproveView({ data, days, mk }) {
  const [editing, setEditing] = useState(null); // 枠を変えて出勤にする希望のid
  const [sel, setSel] = useState(days[0].k);
  useEffect(() => { if (!days.find((d) => d.k === sel)) setSel(days[0].k); }, [days, sel]);
  const S = data.store;
  const day = days.find((d) => d.k === sel) || days[0];
  const req = data.ruleFor(day);
  const c = data.counts[day.k];
  const rows = data.staffInStore.map((s) => ({ s, r: data.requests[s.id]?.[day.k] })).filter((x) => x.r);
  // 運営・社員は休み希望のない日が出勤予定（定休日は除く）
  const planned = data.isClosed(day) ? [] : data.staffInStore.filter((s) => canOffice(s) && !data.requests[s.id]?.[day.k]);
  const order = { pending: 0, approved: 1, rejected: 2 };
  rows.sort((a, b) => order[a.r.status] - order[b.r.status]);
  const pendingTotal = days.reduce((a, d) => a + PART_KEYS.reduce((b, p) => b + data.counts[d.k][p].pending, 0), 0);
  const otherStore = (staffId) => (data.requestsAll[staffId]?.[day.k] || []).filter((r) => r.store_id !== S.id && r.status !== "rejected");

  return (
    <div>
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3 mb-4 text-sm">
        <span>{S.name}：出勤の人数が各日の基準に揃ったら公開してください。</span>
        {pendingTotal > 0 && <span className="text-xs opacity-70">未定 {pendingTotal} 件</span>}
        <label className="flex items-center gap-1 text-xs">
          シフト希望締切
          <input type="date" value={data.deadline || ""} min={`${mk}-01`} onChange={(e) => api.setDeadline(S.id, mk, e.target.value || null)}
            className="border rounded px-1 py-0.5 bg-white" style={{ borderColor: LINE }} />
          {data.deadline && <span style={{ color: data.deadlinePassed ? RED : undefined }}>{data.deadlinePassed ? "締切済み" : "まで受付"}</span>}
          {data.deadline && <button onClick={() => api.setDeadline(S.id, mk, null)} className="underline opacity-60">解除</button>}
        </label>
        <span className="ml-auto" />
        <Btn tone={data.published ? "ghost" : "primary"} onClick={() => api.setPublished(S.id, mk, !data.published)}>
          {data.published ? "公開を取り下げる" : `${mk.replace("-", "年")}月分を公開する`}
        </Btn>
      </Card>

      <EmployeeDaysOff data={data} days={days} mk={mk} />

      <div className="flex flex-wrap gap-4 items-start">
        <Card className="flex-1 min-w-[min(20rem,100%)] overflow-x-auto">
          <div className="grid text-xs px-3 py-2 opacity-70" style={{ gridTemplateColumns: "5rem 1fr 1fr 1fr 3.5rem", minWidth: 380, borderBottom: `1px solid ${LINE}` }}>
            <span>日付</span>{PART_KEYS.map((p) => <span key={p}>{PARTS[p].label}</span>)}<span>募集</span>
          </div>
          {days.map((d) => {
            const hol = data.isHoliday(d), t = data.typeOf(d), rr = data.ruleFor(d), cc = data.counts[d.k], on = sel === d.k;
            const closed = data.isClosed(d);
            const short = !closed && PART_KEYS.some((p) => cc[p].n < rr[p]);
            const rec = data.isRecruit(d.k);
            const hasReq = PART_KEYS.some((p) => cc[p].n + cc[p].pending > 0);
            return (
              <div key={d.k} onClick={() => setSel(d.k)} className="grid items-center px-3 py-1.5 cursor-pointer text-sm"
                style={{ gridTemplateColumns: "5rem 1fr 1fr 1fr 3.5rem", minWidth: 380, background: on ? "#E3E9F0" : closed ? CLOSED_BG : t === "event" ? "#FBF6EC" : hol ? "#FBF8F8" : "#fff",
                  borderBottom: "1px solid #EEF1F3", borderLeft: `3px solid ${on ? NAVY : "transparent"}` }}>
                <span className="tabular-nums" style={{ color: dayColor(d, hol) }}>
                  {d.d}<span className="opacity-70 text-xs">({WD[d.w]})</span>
                  {closed ? <span className="block text-xs opacity-70" style={{ color: NAVY }}>定休日</span>
                    : t === "event" && <span className="block text-xs" style={{ color: TYPE.event.fg }}>イベント</span>}
                </span>
                {closed && !hasReq ? <span className="col-span-3 text-xs opacity-50">休業</span>
                  : PART_KEYS.map((p) => <span key={p}><PartGauge c={cc[p]} rule={rr} part={p} compact /></span>)}
                {closed ? <span /> : (
                  <span onClick={(e) => { e.stopPropagation(); api.setRecruit(S.id, d.k, !rec); }}>
                    <span className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
                      style={rec ? { background: RED, color: "#fff" } : { border: `1px dashed ${short ? RED : "#B8C2CC"}`, color: short ? RED : "#B8C2CC" }}>
                      {rec ? "募集中" : "募集"}
                    </span>
                  </span>
                )}
              </div>
            );
          })}
          <div className="px-3 py-2 text-xs opacity-70">「出勤/基準 +未定」。赤＝多い、黄＝足りない。「!」＝デリバリー・厨房の必要人数に足りない（両方できる人はどちらか一方に数えます）。</div>
        </Card>

        <Card className="flex-1 min-w-[min(20rem,100%)] p-4 sticky top-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-base font-medium">{fmt(day.k)}</span>
            {holidayName(day.k) && <span className="text-xs" style={{ color: RED }}>{holidayName(day.k)}</span>}
          </div>
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            {PART_KEYS.map((p) => <span key={p} className="flex items-center gap-1"><Tag s={PARTS[p]}>{PARTS[p].label}</Tag><PartGauge c={c[p]} rule={req} part={p} /></span>)}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
            <span>営業</span>
            <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
              {[[false, "営業日"], [true, "定休日"]].map(([v, l]) => (
                <button key={l} onClick={() => api.setClosed(S.id, day.k, v === data.defaultClosed(day) ? null : v)} className="px-3 py-1"
                  style={data.isClosed(day) === v ? { background: NAVY, color: "#fff" } : { background: "#fff" }}>{l}</button>
              ))}
            </div>
            {data.daySet[day.k]?.closed != null && <span className="opacity-60">（通常は{data.defaultClosed(day) ? "定休日" : "営業日"}）</span>}
            {data.isClosed(day) && rows.length > 0 && <span style={{ color: RED }}>休業日ですが希望が {rows.length} 件あります</span>}
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
            <span className="tabular-nums opacity-70">基準 {PART_KEYS.map((p) => `${PARTS[p].short}${req[p]}`).join(" / ")}（うち配達{req.delivery}・厨房{req.kitchen}・仕込み{req.prepper}）</span>
            {data.daySet[day.k]?.day_type && <span className="opacity-60">（通常は{TYPE[data.defaultType(day)].label}）</span>}
          </div>

          {rows.length === 0 && planned.length === 0 ? <div className="text-sm opacity-60 py-4">この日の希望はまだありません。</div> : (
            <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
              {rows.map(({ s, r }) => {
                const ot = otherStore(s.id);
                if (r.type === "off") return (
                  // 運営・社員の休み希望（出勤にすることもできる）
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" style={{ opacity: 0.7 }}>
                    <span className="w-24 truncate">{s.name}<span className="ml-1 text-xs opacity-60">{POSITIONS[s.position]}</span></span>
                    <Tag s={OFF_WISH}>{OFF_WISH.label}</Tag>
                    <span className="ml-auto flex gap-1">
                      <Btn small onClick={() => setEditing(editing === r.id ? null : r.id)}>出勤にする</Btn>
                      <Btn small onClick={() => confirm(`${s.name} さんの休み希望を取り消して、出勤予定に戻しますか？`) && api.deleteRequests(s.id, S.id, [day.k])}>取消</Btn>
                    </span>
                    {editing === r.id && <SlotEditor r={r} windows={data.windows} office onDone={() => setEditing(null)} />}
                  </li>
                );
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" style={{ opacity: r.status === "rejected" ? 0.6 : 1 }}>
                    <span className="w-24 truncate">{s.name}
                      <span className="ml-1 text-xs opacity-60">{skillShort(s)}</span>
                    </span>
                    <Tag s={slotStyle(r)}>{slotText(r)}</Tag>
                    <Tag s={STATUS[r.status]}>{STATUS[r.status].label}</Tag>
                    {r.desired && <span className="text-xs opacity-60">（希望: {slotText(r.desired)}）</span>}
                    {ot.length > 0 && <span className="text-xs" style={{ color: "#7A4A00" }} title={ot.map((x) => `${data.stores.find((st) => st.id === x.store_id)?.name}: ${slotText(x)}`).join("、")}>他店も</span>}
                    <span className="ml-auto flex gap-1">
                      <Btn small tone={r.status === "approved" ? undefined : "primary"} onClick={() => setEditing(editing === r.id ? null : r.id)}>{r.status === "approved" ? "枠を変更" : "出勤"}</Btn>
                      {r.status !== "rejected" && <Btn small tone="danger" onClick={() => api.setStatus(r.id, "rejected")}>休み</Btn>}
                      {r.status !== "pending" && <Btn small onClick={() => api.resetRequest(r)} title={r.desired ? "元の希望に戻して未定にする" : "未定に戻す"}>戻す</Btn>}
                    </span>
                    {editing === r.id && <SlotEditor r={r} windows={data.windows} office={canOffice(s)} onDone={() => setEditing(null)} />}
                  </li>
                );
              })}
              {planned.map((s) => {
                // 運営・社員で休み希望のない日 = 出勤予定。枠は管理者が決める
                const key = `plan:${s.id}`;
                return (
                  <li key={key} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="w-24 truncate">{s.name}<span className="ml-1 text-xs opacity-60">{POSITIONS[s.position]}</span></span>
                    <Tag s={STATUS.pending}>出勤予定</Tag>
                    <span className="ml-auto flex gap-1">
                      <Btn small tone="primary" onClick={() => setEditing(editing === key ? null : key)}>出勤</Btn>
                      <Btn small tone="danger" onClick={() => api.upsertRequests(s.id, S.id, [day.k], "off", [], null, null, "pending")} title="この日を休みにする（休み希望として記録）">休み</Btn>
                    </span>
                    {editing === key && (
                      <SlotEditor key={key + day.k} r={null} windows={data.windows} office onDone={() => setEditing(null)}
                        onSave={(slot) => api.upsertRequests(s.id, S.id, [day.k], slot.type, slot.parts, slot.start_time, slot.end_time, "approved")} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {rows.some((x) => x.r.status === "pending" && x.r.type !== "off") && (
            <div className="mt-3 flex justify-end">
              <Btn small onClick={() => rows.filter((x) => x.r.status === "pending" && x.r.type !== "off").forEach((x) => api.setStatus(x.r.id, "approved"))}>未定をすべて出勤</Btn>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------- 変更依頼（締切後にスタッフから届く） ----------
function ChangesView({ data, days }) {
  const [busy, setBusy] = useState(null);
  const name = (id) => data.staff.find((s) => s.id === id)?.name || "（名簿外）";
  const storeName = (id) => data.stores.find((s) => s.id === id)?.name || "";
  const multi = data.stores.length > 1;
  // 今の希望（表示中の月の分だけ分かる）
  const current = (c) => (data.requestsAll[c.staff_id]?.[c.date] || []).find((r) => r.store_id === c.store_id);
  const pending = data.changes.filter((c) => c.status === "pending").sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
  const done = data.changes.filter((c) => c.status !== "pending");
  const run = async (c, fn) => { setBusy(c.id); try { await fn(); } finally { setBusy(null); } };
  const sent = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  const Row = ({ c }) => {
    const cur = current(c);
    return (
      <li className="py-2 text-sm flex flex-wrap items-center gap-2">
        <span className="w-24 truncate font-medium">{name(c.staff_id)}</span>
        <span className="tabular-nums w-16">{fmt(c.date)}</span>
        {multi && <span className="text-xs opacity-70 w-16 truncate">{storeName(c.store_id)}</span>}
        <span className="flex items-center gap-1 text-xs">
          {cur ? <Tag s={slotStyle(cur)}>{slotText(cur)}</Tag>
            : days.some((d) => d.k === c.date) ? <span className="opacity-50">希望なし</span>
            : <span className="opacity-50" title="表示中の月以外の依頼です。上部で月を切り替えると今の希望が分かります">他の月</span>}
          <span className="opacity-60">→</span>
          {c.action === "remove" ? <span className="px-1.5 rounded" style={{ background: "#F7E4E4", color: "#7A1E1E" }}>取り消し</span> : <Tag s={slotStyle(c)}>{slotText(c)}</Tag>}
        </span>
        <span className="text-xs opacity-50">{sent(c.created_at)}</span>
        <span className="ml-auto flex gap-1">
          {c.status === "pending" ? <>
            <Btn small tone="primary" disabled={busy === c.id} onClick={() => run(c, () => api.approveChangeRequest(c))}>承諾</Btn>
            <Btn small tone="danger" disabled={busy === c.id} onClick={() => confirm(`${name(c.staff_id)} さんの ${fmt(c.date)} の変更依頼を却下しますか？`) && run(c, () => api.rejectChangeRequest(c.id))}>却下</Btn>
          </> : <Tag s={CHANGE_STATUS[c.status]}>{CHANGE_STATUS[c.status].label}</Tag>}
        </span>
        {c.reason && <div className="w-full text-xs pl-1 opacity-80">理由: {c.reason}</div>}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="text-sm mb-1">確認待ちの変更依頼{multi && "（全店舗）"}</div>
        <div className="text-xs opacity-60 mb-2">締切後にスタッフが送った依頼です。「承諾」すると希望に反映され、追加・変更はそのまま出勤になります。「取り消し」の承諾は、その日の希望を削除します。</div>
        {pending.length === 0 ? <div className="text-sm opacity-60 py-2">確認待ちの依頼はありません。</div>
          : <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>{pending.map((c) => <Row key={c.id} c={c} />)}</ul>}
      </Card>
      {done.length > 0 && (
        <Card className="p-4">
          <div className="text-sm mb-2">処理済み（表示中の月）</div>
          <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>{done.map((c) => <Row key={c.id} c={c} />)}</ul>
        </Card>
      )}
    </div>
  );
}

// ---------- 実働時間 ----------
const DELIVERY = { main: "メインデリバリー", second: "二台目デリバリー" };

function WorkLogView({ data, days, mk }) {
  const [dayEdit, setDayEdit] = useState(null); // day
  const S = data.store;
  const approved = (sid, k) => { const r = data.requests[sid]?.[k]; return r && r.status === "approved" ? r : null; };
  const staff = data.staffInStore.filter((s) => isPartTime(s) && days.some((d) => approved(s.id, d.k))); // 実働時間はアルバイトだけ
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
            {staff.length === 0 && <tr><td colSpan={days.length + 4} className="px-3 py-6 text-sm opacity-60">出勤の人がいません。</td></tr>}
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

        <div className="mt-3 mb-1 text-xs opacity-70">この日働いたアルバイト（早上がり・遅刻は始業・終業を直すと個別扱いになります）</div>
        {rows.filter(({ s }) => isPartTime(s)).length === 0 ? <div className="text-xs opacity-60 mb-3">出勤のアルバイトがいません。</div> : (
          <ul className="mb-3 text-xs divide-y" style={{ borderTop: `1px solid ${LINE}`, borderColor: "#EEF1F3" }}>
            {rows.filter(({ s }) => isPartTime(s)).map(({ s, r }) => {
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
  // 名簿の名前は残し、LINEアカウントとの紐づけだけ外す → そのLINEアカウントは「登録待ち」に戻る
  const unlink = async (s, p) => {
    if (!confirm(`${s.name} さんとLINE（${p.display_name}）の連携を解除しますか？\n名簿の名前と過去の希望・実働は残り、LINEアカウントは「登録待ち」に戻ります。`)) return;
    await api.updateStaff(s.id, { profile_id: null });
    await api.setRole(p.id, "pending");
  };
  // 退職: このアプリのログイン情報を削除する（相手のLINE側には何もしない）
  const retire = async (p) => {
    if (!confirm(`LINE: ${p.display_name} さんを退職扱いにしますか？\nこのアプリのログイン情報を削除し、このLINEアカウントではアプリを使えなくなります。\n（もう一度LINEでログインした場合は、新しく「登録待ち」に表示されます）`)) return;
    await api.unlinkLine(p.id);
  };
  // 名簿から消す（過去の希望・実働は残る）
  const remove = async (s) => {
    if (!confirm(`${s.name} さんを名簿から削除しますか？\nシフト表に表示されなくなります（過去の希望・実働は残ります）。`)) return;
    await api.deactivateStaff(s.id);
  };

  // 絞り込みと並べ替え（表示だけ。保存されている順番は変えない）
  const [f, setF] = useState({ q: "", position: "", store: "", skill: "", line: "", sort: "order" });
  const posRank = Object.fromEntries(Object.keys(POSITIONS).map((k, i) => [k, i]));
  const storeRank = (s) => {
    const ranks = data.stores.map((st, i) => (data.membership[s.id]?.has(st.id) ? i : null)).filter((x) => x !== null);
    return ranks.length ? Math.min(...ranks) : data.stores.length; // 未所属は最後
  };
  const byName = (a, b) => a.name.localeCompare(b.name, "ja");
  const sorters = {
    order: () => 0, // data.staff は登録順
    name: byName,
    position: (a, b) => posRank[a.position || "part_time"] - posRank[b.position || "part_time"] || byName(a, b),
    store: (a, b) => storeRank(a) - storeRank(b) || byName(a, b),
  };
  const shown = data.staff.filter((s) =>
    (!f.q || s.name.includes(f.q.trim())) &&
    (!f.position || (s.position || "part_time") === f.position) &&
    (!f.store || (f.store === "none" ? !data.membership[s.id]?.size : data.membership[s.id]?.has(f.store))) &&
    (!f.skill || s[f.skill]) &&
    (!f.line || (f.line === "linked" ? !!s.profile_id : !s.profile_id))
  ).sort(sorters[f.sort]);
  const filtered = f.q || f.position || f.store || f.skill || f.line;
  const sel = (key, label, opts) => (
    <select value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} aria-label={label}
      className="text-xs border rounded px-1 py-1 bg-white" style={{ borderColor: f[key] && key !== "sort" ? NAVY : LINE }}>
      {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );

  return (
    <div className="flex flex-wrap gap-4 items-start">
      {pending.length > 0 && (
        <Card className="p-4 flex-1 min-w-[min(18rem,100%)]" style={{ borderColor: "#F3D27A", background: "#FFFBEF" }}>
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
                <Btn small onClick={() => retire(p)}>退職</Btn>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4 flex-1 min-w-[min(20rem,100%)] overflow-x-auto">
        <div className="text-sm mb-1">スタッフ名簿（全店舗）</div>
        {!meLinked && <div className="text-xs mb-3 px-2 py-1 rounded" style={{ background: "#F6EBD6", color: "#7A4A00" }}>あなた自身もシフトに入るなら、自分の名前を追加して「これは自分」を押してください。</div>}
        <div className="flex gap-2 mb-3">
          <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="名前を先に作っておく（LINE未ログインでも可）" className="flex-1 px-3 py-1.5 rounded border text-sm" style={{ borderColor: "#B8C2CC" }} />
          <Btn tone="primary" onClick={add}>追加</Btn>
        </div>
        {data.staff.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="名前で検索"
              className="text-xs border rounded px-2 py-1 w-28" style={{ borderColor: LINE }} />
            {sel("position", "役職", [["", "役職: すべて"], ...Object.entries(POSITIONS)])}
            {sel("store", "所属店舗", [["", "店舗: すべて"], ...data.stores.map((st) => [st.id, st.name]), ["none", "未所属"]])}
            {sel("skill", "できる仕事", [["", "仕事: すべて"], ...Object.entries(SKILLS).map(([k, sk]) => [k, sk.label])])}
            {sel("line", "LINE", [["", "LINE: すべて"], ["linked", "連携済み"], ["unlinked", "未連携"]])}
            {sel("sort", "並べ替え", [["order", "登録順"], ["name", "名前順"], ["position", "役職順"], ["store", "店舗順"]])}
            {filtered && <button onClick={() => setF({ ...f, q: "", position: "", store: "", skill: "", line: "" })} className="text-xs underline opacity-70">条件をクリア</button>}
            <span className="text-xs opacity-60 ml-auto">{shown.length} / {data.staff.length} 人</span>
          </div>
        )}
        {data.staff.length === 0 ? <div className="text-sm opacity-60">まだ登録がありません。</div>
          : shown.length === 0 ? <div className="text-sm opacity-60 py-2">条件に合うスタッフはいません。</div> : (
          <table className="text-sm w-full">
            <thead><tr className="text-xs opacity-70 text-left"><th className="py-1 pr-2">名前</th><th className="py-1 pr-2">役職</th><th className="py-1 pr-2">所属店舗</th><th className="py-1 pr-2">できる仕事</th><th></th></tr></thead>
            <tbody>
              {shown.map((s) => {
                const p = data.profiles.find((x) => x.id === s.profile_id);
                return (
                  <tr key={s.id} style={{ borderTop: "1px solid #EEF1F3" }}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      <input defaultValue={s.name} key={s.name} title="名前を変更（入力欄から離れると保存）"
                        onBlur={(e) => { const n = e.target.value.trim(); if (!n) e.target.value = s.name; else if (n !== s.name) api.updateStaff(s.id, { name: n }); }}
                        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                        className="border rounded px-2 py-0.5 w-32" style={{ borderColor: LINE }} />
                      <div className="text-xs opacity-60">{p ? <>LINE: {p.display_name}{p.role === "manager" && "（管理者）"}</> : <span style={{ color: "#7A4A00" }}>LINE未連携</span>}</div>
                    </td>
                    <td className="py-1.5 pr-2">
                      <select value={s.position || "part_time"} onChange={(e) => api.updateStaff(s.id, { position: e.target.value })}
                        className="text-xs border rounded px-1 py-1 bg-white" style={{ borderColor: LINE }}>
                        {Object.entries(POSITIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
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
                        {p && p.id !== profile.id && <Btn small onClick={() => unlink(s, p)}>連携解除</Btn>}
                        {!s.profile_id && <Btn small onClick={() => remove(s)}>名簿削除</Btn>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {data.staff.length > 0 && <div className="text-xs opacity-60 mt-2">名前は欄を直接書き換えると変更できます（入力欄から離れるか Enter で保存）。</div>}
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
      <Card className="p-4 min-w-[min(18rem,100%)]">
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
              <thead>
                <tr className="text-xs opacity-70">
                  <th></th>
                  {PART_KEYS.map((p) => <th key={p} className="px-2 font-normal"><Tag s={PARTS[p]}>{PARTS[p].label}</Tag></th>)}
                  <th className="px-2 font-normal" style={{ borderLeft: `1px solid ${LINE}` }}>うち配達</th>
                  <th className="px-2 font-normal">うち厨房</th>
                  <th className="px-2 font-normal">うち仕込み</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(TYPE).map(([g, t]) => (
                  <tr key={g}><td className="pr-2 py-1">{t.label}</td>
                    {[...PART_KEYS, "delivery", "kitchen", "prepper"].map((key) => {
                      const cur = rules[g]?.[key] ?? DEFAULT_RULE[key];
                      return (
                        <td key={key} className="px-2 py-1" style={key === "delivery" ? { borderLeft: `1px solid ${LINE}` } : undefined}>
                          <input type="number" min={0} key={`${g}${key}${cur}`} defaultValue={cur} onBlur={(e) => Number(e.target.value) !== cur && setRule(g, key, e.target.value)} className="w-14 border rounded px-1 tabular-nums" />人
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs opacity-60 mt-2">入力欄から離れると保存されます。「うち配達」「うち厨房」は、ランチ・ディナーそれぞれの人数のうち何人必要かです。「うち仕込み」は、仕込みの枠に仕込みができる人が何人必要かです。配達と厨房の両方ができる人は、どちらか一方にしか数えません。</div>
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
            <div className="mb-1">{S.name} の定休日（毎週）</div>
            <div className="text-xs opacity-60 mb-3">チェックした曜日は希望入力で「定休日」と表示され、選べなくなります。臨時休業や定休日の営業は「シフト管理」で日ごとに切り替えます。</div>
            <div className="flex flex-wrap gap-3">
              {WD.map((w, i) => {
                const cur = S.closed_weekdays || [];
                return (
                  <label key={w} className="flex items-center gap-1" style={{ color: i === 0 ? RED : i === 6 ? "#2C5282" : undefined }}>
                    <input type="checkbox" checked={cur.includes(i)}
                      onChange={(e) => api.updateStore(S.id, { closed_weekdays: e.target.checked ? [...cur, i].sort() : cur.filter((x) => x !== i) })} />{w}
                  </label>
                );
              })}
            </div>
            {(() => {
              const cl = days.filter((d) => data.isClosed(d));
              return <div className="text-xs opacity-70 mt-3">この月の休業日: {cl.length ? cl.map((d) => fmt(d.k)).join("、") : "なし"}</div>;
            })()}
          </Card>
          <Card className="p-4 text-sm">
            <div className="mb-2">{S.name} のこの月のイベント日</div>
            {ev.length === 0 ? <div className="opacity-60 text-xs">「シフト管理」で日付を選び、区分を「イベント」にすると登録されます。</div>
              : <ul>{ev.map((d) => <li key={d.k} className="tabular-nums py-0.5">{fmt(d.k)}</li>)}</ul>}
          </Card>
        </>
      )}
    </div>
  );
}
