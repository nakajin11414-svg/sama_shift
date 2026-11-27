import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, notifyResult, usePayPeriodData } from "../lib/data.js";
import { WD, PARTS, PART_KEYS, STATUS, CHANGE_STATUS, OFFICE, OFF_WISH, canOffice, isPartTime, TYPE, SKILLS, POSITIONS, skillShort, NAVY, LINE, RED, CLOSED_BG, fmt, pad, holidayName, skillShortage, DEFAULT_RULE, DEFAULT_WINDOWS, slotText, slotShort, slotStyle, dayColor, defaultDayHours, autoWork, BREAK_END, workHours, fmtHours, hhmm, hourLabel, payPeriodOfMonth, shiftPayPeriod, periodDays } from "../lib/util.js";
import { Btn, Card, Tag, Gauge, DualScroll } from "../ui.jsx";
import { PrintButton } from "./Print.jsx";

export default function ManagerView(props) {
  const [tab, setTab] = useState("approve");
  const pending = props.data.profiles.filter((p) => p.role === "pending").length;
  const changes = props.data.changes.filter((c) => c.status === "pending").length;
  const tabs = [["approve", "シフト管理"], ["changes", `変更依頼${changes ? `（${changes}）` : ""}`], ["worklog", "実働時間"], ["roster", `スタッフ名簿${pending ? `（登録待ち ${pending}）` : ""}`], ["stores", "店舗・基準人数"]];
  return (
    // シフト管理は月の表を31日分並べるので、PCでは画面の横幅いっぱいに使う
    <div className={`p-4 mx-auto ${tab === "approve" ? "" : "max-w-6xl"}`}>
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
function PartGauge({ c, rule, part, compact, tight }) {
  const sh = skillShortage(c, rule, part);
  const warn = c.n > 0 && sh.any;
  // 月の表の細い列: 「!」を横に足さず、赤い枠で示す
  if (tight) return <Gauge n={c.n} p={c.pending} need={rule[part]} tight warn={warn} />;
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


// 他店舗のその日の状況（出勤/基準）。店舗が2つ以上のときだけ出す
function OtherStoresDay({ data, day }) {
  if (!data.otherStores.length) return null;
  return (
    <div className="flex flex-col gap-1 text-xs mb-2 px-2 py-1.5 rounded" style={{ background: "#F4F6F8" }}>
      <span className="opacity-60">他店舗の状況</span>
      {data.otherStores.map((o) => {
        const sh = o.shortOf(day);
        return (
          <div key={o.store.id} className="flex flex-wrap items-center gap-2">
            <span className="w-16 truncate">{o.store.name}</span>
            {o.isClosed(day) ? <span className="opacity-60">定休日</span> : <>
              {PART_KEYS.map((p) => (
                <span key={p} className="flex items-center gap-1"><Tag s={PARTS[p]}>{PARTS[p].short}</Tag><PartGauge c={o.counts[day.k][p]} rule={o.ruleFor(day)} part={p} compact /></span>
              ))}
              {sh.length > 0 && <span style={{ color: RED }}>{sh.map(([p, n]) => `${PARTS[p].label}あと${n}人`).join("、")}</span>}
            </>}
          </div>
        );
      })}
    </div>
  );
}

// 研修中の人の研修残り（全店舗・月をまたいで、表示中の月の終わりまでの出勤（承諾済み）の日数で数える）
function TraineeCount({ data, mk }) {
  const trainees = data.staff.filter((s) => s.position === "trainee");
  if (!trainees.length) return null;
  const total = data.trainingShifts;
  return (
    <Card className="px-4 py-3 mb-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span>研修中</span>
        <label className="flex items-center gap-1 text-xs">
          研修の回数
          <input type="number" min={1} key={total} defaultValue={total}
            onBlur={(e) => { const v = Math.max(1, Number(e.target.value) || 1); if (v !== total) api.setTrainingShifts(v); else e.target.value = total; }}
            onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
            className="w-14 border rounded px-1 py-0.5 tabular-nums" style={{ borderColor: LINE }} />回
        </label>
        <span className="text-xs opacity-60">全店舗の出勤（承諾済み）を最初の出勤から{mk.replace("-", "年")}月末まで数えます。研修中は出勤の人数に数えません</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {trainees.map((s) => {
          const done = data.trainingDone[s.id] || 0;
          const left = total - done;
          return (
            <span key={s.id} className="tabular-nums">
              {s.name}：{left > 0 ? <>研修残り<b className="mx-0.5">{left}</b>回</>
                : <span style={{ color: "#0F3A24" }}>研修終了（スタッフ名簿で役職を変更してください）</span>}
              <span className="text-xs opacity-50 ml-1">出勤{done}回</span>
            </span>
          );
        })}
      </div>
    </Card>
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

// 1人・1日分の出勤・休みの操作（日ごとの表示と月の表で共通）
//   r = その日の希望（null なら運営・社員の出勤予定）
// 名簿の位置（行の並び順）のロック。ロック中は調整表の行の並べ替え（⠿）を出さない
const OrderLockCtx = createContext(true);

function StaffDayRow({ data, s, day, r }) {
  const [editing, setEditing] = useState(false);
  const S = data.store;
  const ot = (data.requestsAll[s.id]?.[day.k] || []).filter((x) => x.store_id !== S.id && x.status !== "rejected");
  const li = "flex flex-wrap items-center gap-2 py-2 text-sm";
  const pos = <span className="ml-1 text-xs opacity-60">{POSITIONS[s.position]}</span>;
  const sh = !r && data.sharedOf(s.id, day.k); // 他店に出ている希望・出勤（複数店舗に所属する人）

  if (sh) {
    const from = data.storeName(sh.store_id);
    const label = sh.type === "off" ? null : sh.status === "approved" ? `${from}で出勤` : sh.status === "rejected" ? `${from}で休み` : `${from}に希望・未定`;
    const move = async (slot) => {
      if (sh.status === "approved" && sh.type !== "off"
        && !confirm(`${s.name} さんは ${fmt(day.k)} に${from}で出勤（${slotText(sh)}）になっています。\n${from}の出勤を外して、${S.name}で出勤にしますか？`)) return;
      await api.moveRequest(sh, S.id, slot);
    };
    return (
      <li className={li} style={{ opacity: sh.status === "approved" && sh.type !== "off" ? 0.75 : 1 }}>
        <span className="w-24 truncate">{s.name}{pos}</span>
        <span className="text-xs px-1.5 rounded" style={{ background: "#EEF1F3", border: `1px solid ${LINE}` }}>{from}</span>
        {sh.type === "off" ? <Tag s={OFF_WISH}>{OFF_WISH.label}</Tag> : <Tag s={slotStyle(sh)}>{slotText(sh)}</Tag>}
        {label && <span className="text-xs" style={{ color: sh.status === "approved" ? "#0F3A24" : sh.status === "rejected" ? STATUS.rejected.fg : "#7A4A00" }}>{label}</span>}
        <span className="ml-auto flex gap-1">
          <Btn small tone={sh.status === "approved" && sh.type !== "off" ? undefined : "primary"} onClick={() => setEditing(!editing)}>
            {sh.status === "approved" && sh.type !== "off" ? `${S.name}に移す` : `${S.name}で出勤`}
          </Btn>
        </span>
        {editing && <SlotEditor r={sh} windows={data.windows} office={canOffice(s)} onSave={move} onDone={() => setEditing(false)} />}
      </li>
    );
  }

  if (!r) return (
    // 運営・社員で休み希望のない日 = 出勤予定。枠は管理者が決める
    <li className={li}>
      <span className="w-24 truncate">{s.name}{pos}</span>
      <Tag s={STATUS.pending}>出勤予定</Tag>
      <span className="ml-auto flex gap-1">
        <Btn small tone="primary" onClick={() => setEditing(!editing)}>出勤</Btn>
        <Btn small tone="danger" onClick={() => api.upsertRequests(s.id, S.id, [day.k], "off", [], null, null, "pending")}>休み</Btn>
      </span>
      {editing && (
        <SlotEditor r={null} windows={data.windows} office onDone={() => setEditing(false)}
          onSave={(slot) => api.upsertRequests(s.id, S.id, [day.k], slot.type, slot.parts, slot.start_time, slot.end_time, "approved")} />
      )}
    </li>
  );

  if (r.type === "off") return (
    // 運営・社員の休み希望（出勤にすることもできる）
    <li className={li} style={{ opacity: 0.7 }}>
      <span className="w-24 truncate">{s.name}{pos}</span>
      <Tag s={OFF_WISH}>{OFF_WISH.label}</Tag>
      <span className="ml-auto flex gap-1">
        <Btn small onClick={() => setEditing(!editing)}>出勤にする</Btn>
        <Btn small onClick={() => confirm(`${s.name} さんの休み希望を取り消して、出勤予定に戻しますか？`) && api.deleteRequests(s.id, S.id, [day.k])}>取消</Btn>
      </span>
      {editing && <SlotEditor r={r} windows={data.windows} office onDone={() => setEditing(false)} />}
    </li>
  );

  return (
    <li className={li} style={{ opacity: r.status === "rejected" ? 0.6 : 1 }}>
      <span className="w-24 truncate">{s.name}
        <span className="ml-1 text-xs opacity-60">{skillShort(s)}</span>
        {s.position === "trainee" && <span className="ml-1 text-xs px-1 rounded" style={{ background: "#F6EBD6", color: "#7A4A00" }} title="研修中は出勤の人数に数えません">研修</span>}
      </span>
      <Tag s={slotStyle(r)}>{slotText(r)}</Tag>
      <Tag s={STATUS[r.status]}>{STATUS[r.status].label}</Tag>
      {r.desired && <span className="text-xs opacity-60">（希望: {slotText(r.desired)}）</span>}
      {ot.length > 0 && <span className="text-xs" style={{ color: "#7A4A00" }} title={ot.map((x) => `${data.stores.find((st) => st.id === x.store_id)?.name}: ${slotText(x)}`).join("、")}>他店も</span>}
      <span className="ml-auto flex gap-1">
        <Btn small tone={r.status === "approved" ? undefined : "primary"} onClick={() => setEditing(!editing)}>{r.status === "approved" ? "枠を変更" : "出勤"}</Btn>
        {r.status !== "rejected" && <Btn small tone="danger" onClick={() => api.setStatus(r.id, "rejected")}>休み</Btn>}
        {r.status !== "pending" && <Btn small onClick={() => api.resetRequest(r)}>戻す</Btn>}
      </span>
      {editing && <SlotEditor r={r} windows={data.windows} office={canOffice(s)} onDone={() => setEditing(false)} />}
    </li>
  );
}

// 月の表（確定シフトと同じ形）。全店舗を1つの表にまとめ、表示中の店舗を先頭に、他店舗を下に並べる
// セルをタップすると下に出勤・休みの操作が出る（操作はそのセルの店舗に対して行う）
function MonthGrid({ data, days }) {
  const orderLocked = useContext(OrderLockCtx);
  const [cell, setCell] = useState(null); // { st: 店舗id, sid?: スタッフid, k: 日付 }
  useEffect(() => { setCell(null); }, [data.store?.id, days[0].k]);
  const cellW = 60;
  const hl = "#E3E9F0";
  const sections = data.allStores; // [表示中の店舗, ...他店舗]（どれも data と同じ形）
  const multi = sections.length > 1;

  // 行の並べ替え（名前の左の ⠿ をドラッグ）。並び順は店舗ごと（手稲店で動かしても千歳店の順は変わらない）
  // マウスでもスマホの指でも動くように Pointer Events で実装する
  const [rowOrder, setRowOrder] = useState(null); // 保存中に先に並びを反映する { sec: 店舗id, ids }
  useEffect(() => { setRowOrder(null); }, [data.staffStores]);
  const sorted = (list, sec) => {
    if (rowOrder?.sec !== sec) return list;
    const rank = Object.fromEntries(rowOrder.ids.map((id, i) => [id, i]));
    return [...list].sort((a, b) => (rank[a.id] ?? 1e9) - (rank[b.id] ?? 1e9));
  };
  const drag = useRef(null); // { sec: 店舗id, id: スタッフid }
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null); // { id, after }
  const endDrag = () => { drag.current = null; setDragId(null); setOver(null); };
  const dragStart = (e, sec, id) => {
    if (orderLocked) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { sec, id };
    setDragId(id);
  };
  const dragMove = (e) => {
    if (!drag.current) return;
    // 画面の端に来たら少しスクロールする
    if (e.clientY < 60) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
    const tr = document.elementFromPoint(e.clientX, e.clientY)?.closest("tr[data-row]");
    if (!tr || tr.dataset.sec !== drag.current.sec) return setOver(null);
    const rect = tr.getBoundingClientRect();
    setOver({ id: tr.dataset.row, after: e.clientY > rect.top + rect.height / 2 });
  };
  const dragEnd = async () => {
    const d = drag.current, o = over;
    endDrag();
    if (!d || !o || o.id === d.id) return;
    const D = sections.find((x) => x.store.id === d.sec);
    if (!D) return;
    const ids = sorted(D.staffInStore, d.sec).map((s) => s.id).filter((id) => id !== d.id);
    const at = ids.indexOf(o.id);
    if (at < 0) return;
    ids.splice(o.after ? at + 1 : at, 0, d.id);
    setRowOrder({ sec: d.sec, ids });
    try { await api.reorderStaff(d.sec, ids, data.staffStores); } catch { setRowOrder(null); }
  };

  const mark = (D, s, d) => {
    const r = D.requests[s.id]?.[d.k];
    if (r) {
      if (r.type === "off") return <Tag tight s={OFF_WISH} title="休み希望">{OFF_WISH.short}</Tag>;
      if (r.status === "approved") return <Tag tight s={slotStyle(r)} title={`出勤 ${slotText(r)}`}>{slotShort(r)}</Tag>;
      if (r.status === "rejected") return <span className="text-xs" style={{ color: STATUS.rejected.fg }} title={`休み（希望: ${slotText(r)}）`}>✕</span>;
      const st = slotStyle(r);
      return <Tag tight s={{ bg: "#fff", fg: st.fg }} style={{ border: `1px dashed ${st.fg}` }} title={`未定（希望: ${slotText(r)}）`}>{slotShort(r)}</Tag>;
    }
    // 他店に出ている希望・出勤（店舗名の1文字目を付けて薄く出す）
    const sh = D.sharedOf(s.id, d.k);
    if (sh) {
      const from = D.storeName(sh.store_id);
      const ini = <span className="opacity-70" style={{ fontSize: 10 }}>{from.slice(0, 1)}</span>;
      if (sh.type === "off") return <span className="inline-block text-xs px-0.5 rounded whitespace-nowrap tracking-tighter leading-tight" style={{ background: OFF_WISH.bg, color: OFF_WISH.fg, opacity: 0.6 }} title={`休み希望（${from}）`}>{ini}{OFF_WISH.short}</span>;
      if (sh.status === "approved") return <span className="inline-block text-xs px-0.5 rounded whitespace-nowrap tracking-tighter leading-tight" style={{ background: "#E4E7EA", color: "#5A6B7A" }} title={`${from}で出勤 ${slotText(sh)}`}>{ini}{slotShort(sh)}</span>;
      if (sh.status === "rejected") return <span className="text-xs" style={{ color: STATUS.rejected.fg, opacity: 0.6 }} title={`${from}で休み（希望: ${slotText(sh)}）`}>{ini}✕</span>;
      const st = slotStyle(sh);
      return <span className="inline-block text-xs px-0.5 rounded whitespace-nowrap tracking-tighter leading-tight" style={{ border: `1px dotted ${st.fg}`, color: st.fg }} title={`${from}に希望・未定（${slotText(sh)}）。タップして${D.store.name}で出勤にできます`}>{ini}{slotShort(sh)}</span>;
    }
    if (!D.isClosed(d) && canOffice(s)) return <span className="inline-block text-xs px-0.5 rounded whitespace-nowrap tracking-tighter leading-tight" style={{ border: "1px dashed #B8C2CC", color: "#5A6B7A" }} title="出勤予定（枠は未定）">予</span>;
    return null;
  };

  // 選択中のセルの店舗・人・日（日付を押したときは st なし＝全店舗の一覧）
  const sd = cell?.st ? sections.find((x) => x.store.id === cell.st) : null;
  const cs = sd && cell.sid && sd.staffInStore.find((s) => s.id === cell.sid);
  const cd = cell && days.find((d) => d.k === cell.k);
  const cr = cs && cd ? sd.requests[cs.id]?.[cd.k] || null : null;
  // 募集の切り替え（店舗・日ごと）
  const recruitBtn = (D, d, small) => {
    const rec = D.isRecruit(d.k), short = D.shortOf(d).length > 0;
    return (
      <button onClick={(e) => { e.stopPropagation(); api.setRecruit(D.store.id, d.k, !rec); }}
        title={rec ? `${D.store.name}: 募集中（押すと取り下げ）` : `${D.store.name}: 押すと募集する${short ? "（人が足りません）" : ""}`}
        className={`text-xs rounded whitespace-nowrap ${small ? "px-0.5 tracking-tighter" : "px-1.5 py-0.5"}`}
        style={rec ? { background: RED, color: "#fff" } : { border: `1px dashed ${short ? RED : "#B8C2CC"}`, color: short ? RED : "#B8C2CC" }}>
        {rec ? "募集中" : "募集"}
      </button>
    );
  };

  // 日付をタップしたとき：その店舗のその日の希望者（日ごとの表示の右側と同じ並び）
  const order = { pending: 0, approved: 1, rejected: 2 };
  const rowsOf = (D, d) => [
    ...D.staffInStore.map((s) => ({ s, r: D.requests[s.id]?.[d.k] })).filter((x) => x.r)
      .sort((a, b) => (a.r.type === "off") - (b.r.type === "off") || order[a.r.status] - order[b.r.status]),
    // 他店に希望・出勤がある人（休業日は出さない）と、運営・社員の出勤予定
    ...(D.isClosed(d) ? [] : D.staffInStore.filter((s) => D.sharedOf(s.id, d.k)).map((s) => ({ s, r: null }))),
    ...(D.isClosed(d) ? [] : D.staffInStore.filter((s) => canOffice(s) && !D.requests[s.id]?.[d.k] && !D.sharedOf(s.id, d.k)).map((s) => ({ s, r: null }))),
  ];
  const pendingOf = (rows) => rows.filter((x) => x.r && x.r.status === "pending" && x.r.type !== "off");
  const colOn = (k) => cell && !cell.sid && cell.k === k; // 日付の列を選択中
  const gauges = (D, d) => PART_KEYS.map((p) => (
    <span key={p} className="flex items-center gap-1 text-xs"><Tag s={PARTS[p]}>{PARTS[p].short}</Tag><PartGauge c={D.counts[d.k][p]} rule={D.ruleFor(d)} part={p} compact /></span>
  ));
  const sticky = "sticky left-0 z-10 px-3 whitespace-nowrap";

  return (
    <div className={cell ? (cs ? "pb-56" : "pb-[60vh]") : ""}>
      <Card>
        <DualScroll>
        {/* 横幅いっぱいに広げ、日付の列は残りを均等に分ける。狭い画面では最小幅で横スクロール */}
        <table className="border-collapse w-full" style={{ minWidth: 140 + days.length * cellW }}>
          <thead>
            <tr>
              <th className={`${sticky} bg-white text-left py-2 text-sm font-medium`} style={{ width: "1%", minWidth: 140, borderRight: `2px solid ${NAVY}`, borderBottom: `1px solid ${LINE}` }}>名前</th>
              {days.map((d) => {
                const hol = data.isHoliday(d), on = cell?.k === d.k;
                return (
                  <th key={d.k} onClick={() => setCell(colOn(d.k) ? null : { k: d.k })} title={multi ? "この日の全店舗の希望者を見る" : "この日の希望者を見る"}
                    className="cursor-pointer px-0.5 py-1 text-xs font-normal tabular-nums leading-tight"
                    style={{ minWidth: cellW, background: on ? hl : hol ? "#F7F2F2" : "#fff", borderBottom: `1px solid ${LINE}`, color: dayColor(d, hol) }}>
                    {d.d}<span className="block opacity-70">{WD[d.w]}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          {sections.map((D, si) => {
            const sid = D.store.id;
            const staff = sorted(D.staffInStore, sid);
            return (
              <tbody key={sid}>
                {/* 店舗の見出し行: 日ごとの募集の切り替え（定休日は出さない） */}
                <tr>
                  <td className={`${sticky} py-1.5 text-sm font-medium`}
                    style={{ background: "#F4F6F8", borderRight: `2px solid ${NAVY}`, borderTop: si > 0 ? `3px solid ${NAVY}` : undefined, borderBottom: `1px solid ${LINE}` }}>
                    {D.store.name}
                    {D.published && <span className="ml-1 text-xs px-1 rounded" style={{ background: "#8FBFA6", color: "#0F3A24" }}>公開中</span>}
                  </td>
                  {days.map((d) => {
                    const closed = D.isClosed(d);
                    return (
                      <td key={d.k} className="text-center py-1 px-0.5 text-xs"
                        style={{ background: colOn(d.k) ? hl : closed ? CLOSED_BG : "#F4F6F8", borderTop: si > 0 ? `3px solid ${NAVY}` : undefined, borderBottom: `1px solid ${LINE}` }}>
                        {closed ? <span className="opacity-60">定休</span> : recruitBtn(D, d, true)}
                      </td>
                    );
                  })}
                </tr>
                {staff.length === 0 && <tr><td colSpan={days.length + 1} className="px-3 py-4 text-sm opacity-60">この店舗のスタッフがいません。</td></tr>}
                {staff.map((s) => {
                  // ドラッグ中: 落とす位置に線を出す
                  const ind = over?.id === s.id && dragId && dragId !== s.id && drag.current?.sec === sid
                    ? (over.after ? { borderBottom: `3px solid ${NAVY}` } : { borderTop: `3px solid ${NAVY}` }) : {};
                  const dragging = dragId === s.id && drag.current?.sec === sid;
                  return (
                  <tr key={s.id} data-row={s.id} data-sec={sid} style={{ opacity: dragging ? 0.5 : 1 }}>
                    <td className={`${sticky} py-1.5 text-sm`}
                      style={{ background: dragging || (cell?.st === sid && cell?.sid === s.id) ? hl : "#fff", borderRight: `2px solid ${NAVY}`, borderBottom: "1px solid #EEF1F3", ...ind }}>
                      {!orderLocked && (
                        <span onPointerDown={(e) => dragStart(e, sid, s.id)} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={endDrag}
                          title="ドラッグで並べ替え" className="inline-block mr-1.5 px-0.5 opacity-50 select-none"
                          style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}>⠿</span>
                      )}
                      {s.name}
                      <span className="ml-1 text-xs opacity-60">{POSITIONS[s.position]}</span>
                    </td>
                    {days.map((d) => {
                      const on = cell?.st === sid && cell?.sid === s.id && cell?.k === d.k;
                      return (
                        <td key={d.k} onClick={() => setCell(on ? null : { st: sid, sid: s.id, k: d.k })}
                          className="text-center py-1 px-0.5 cursor-pointer"
                          style={{ borderBottom: "1px solid #EEF1F3", background: on || colOn(d.k) ? hl : D.isClosed(d) ? CLOSED_BG : D.isHoliday(d) ? "#FBF8F8" : undefined, outline: on ? `2px solid ${NAVY}` : undefined, outlineOffset: -2, ...ind }}>
                          {mark(D, s, d)}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
                {PART_KEYS.map((p, i) => (
                  <tr key={p}>
                    <td className={`${sticky} bg-white py-1 text-xs`}
                      style={{ borderRight: `2px solid ${NAVY}`, borderTop: i === 0 ? `2px solid ${NAVY}` : undefined }}>
                      <Tag s={PARTS[p]}>{PARTS[p].label}</Tag><span className="ml-1 opacity-60">出勤/基準</span>
                    </td>
                    {days.map((d) => (
                      <td key={d.k} className="text-center py-1 px-0.5" style={{ borderTop: i === 0 ? `2px solid ${NAVY}` : undefined, background: D.isClosed(d) ? CLOSED_BG : undefined }}>
                        {!D.isClosed(d) && <PartGauge c={D.counts[d.k][p]} rule={D.ruleFor(d)} part={p} tight />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
        </DualScroll>
        <div className="px-3 py-2 text-xs opacity-70 flex flex-wrap gap-x-4 gap-y-1">
          <span>色付き＝出勤</span>
          <span>点線＝未定（希望）</span>
          <span>✕＝休み</span>
          <span>休＝休み希望</span>
          <span>予＝出勤予定（運営・社員、枠は未定）</span>
          <span>人数の下の +1＝未定の希望の人数。赤い枠＝配達・厨房・仕込みのできる人が足りない</span>
          {multi && <span>店舗名の1文字付き（薄い色）＝他店に出ている希望・出勤（タップでその段の店舗に移せます）</span>}
          <span>セルをタップ → その人の出勤・休みを決める。日付をタップ → {multi ? "全店舗の" : ""}その日の希望者を一覧で見る。店舗名の行の「募集」→ その店舗のその日を募集中にする（赤い点線＝人が足りない日）</span>
        </div>
      </Card>

      {cd && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-2 pb-2">
          {/* 日付の一覧（複数店舗）は横に並べるので幅を広くする */}
          <Card className={`${!cs && multi ? "max-w-6xl" : "max-w-3xl"} mx-auto p-3 shadow-lg flex flex-col`} style={{ maxHeight: cs ? undefined : "55vh" }}>
            <div className="flex flex-wrap items-center gap-2 mb-1 text-sm">
              {multi && sd && <span className="text-xs px-1.5 rounded" style={{ background: NAVY, color: "#fff" }}>{sd.store.name}</span>}
              <span className="font-medium tabular-nums" style={{ color: dayColor(cd, (sd || data).isHoliday(cd)) }}>{fmt(cd.k)}</span>
              {holidayName(cd.k) && <span className="text-xs" style={{ color: RED }}>{holidayName(cd.k)}</span>}
              {sd && (sd.isClosed(cd) ? <span className="text-xs opacity-70">定休日</span> : gauges(sd, cd))}
              <span className="ml-auto flex gap-2 text-xs">
                {cs && <button onClick={() => setCell({ k: cd.k })} className="underline opacity-70">この日の全員を見る</button>}
                <button onClick={() => setCell(null)} className="opacity-60">閉じる</button>
              </span>
            </div>
            {sd && <OtherStoresDay data={sd} day={cd} />}
            {cs ? (
              cr || (!sd.isClosed(cd) && (canOffice(cs) || sd.sharedOf(cs.id, cd.k))) ? (
                <ul><StaffDayRow key={`${sd.store.id}:${cs.id}:${cd.k}`} data={sd} s={cs} day={cd} r={cr} /></ul>
              ) : (
                <div className="text-sm py-2"><span className="mr-2">{cs.name}</span><span className="opacity-60">{sd.isClosed(cd) ? "定休日です" : "この日の希望はありません"}</span></div>
              )
            ) : (
              // その日の希望者を店舗ごとに（全店舗）
              // 広い画面では店舗を左右に並べる（表示中の店舗が左）。スマホでは縦に並ぶ
              <div className="overflow-y-auto grid gap-x-4 items-start" style={{ gridTemplateColumns: multi ? `repeat(auto-fit, minmax(min(22rem, 100%), 1fr))` : undefined }}>
                {sections.map((D) => {
                  const rows = rowsOf(D, cd);
                  const pend = pendingOf(rows);
                  return (
                    <div key={D.store.id} className="mb-2">
                      <div className="flex flex-wrap items-center gap-2 px-2 py-1 mt-1 rounded text-sm" style={{ background: "#F4F6F8" }}>
                        <span className="font-medium">{D.store.name}</span>
                        {D.isClosed(cd) ? <span className="text-xs opacity-70">定休日</span> : gauges(D, cd)}
                        {D.shortOf(cd).length > 0 && <span className="text-xs" style={{ color: RED }}>{D.shortOf(cd).map(([p, n]) => `${PARTS[p].label}あと${n}人`).join("、")}</span>}
                        {!D.isClosed(cd) && <span className="ml-auto">{recruitBtn(D, cd)}</span>}
                      </div>
                      {rows.length === 0 ? <div className="text-sm opacity-60 py-2 px-2">この日の希望はまだありません。</div> : (
                        <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
                          {rows.map(({ s, r }) => <StaffDayRow key={`${D.store.id}:${r ? "" : "plan:"}${s.id}:${cd.k}`} data={D} s={s} day={cd} r={r || null} />)}
                        </ul>
                      )}
                      {pend.length > 0 && (
                        <div className="mt-1 flex justify-end">
                          <Btn small onClick={() => pend.forEach((x) => api.setStatus(x.r.id, "approved"))}>{multi ? `${D.store.name}の未定をすべて出勤` : "未定をすべて出勤"}</Btn>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function ApproveView({ data, days, mk }) {
  const [view, setView] = useState("month"); // "month"（月の表。初期表示）／ "day"（日ごと）
  // 名簿の位置（行の並び順）のロック。誤タップで動かないように、最初はロック。最後の状態をこの端末に覚えておく
  const [orderLocked, setOrderLockedState] = useState(() => { try { return localStorage.getItem("sama-shift-order-lock") !== "0"; } catch { return true; } });
  const setOrderLocked = (v) => { setOrderLockedState(v); try { localStorage.setItem("sama-shift-order-lock", v ? "1" : "0"); } catch { /* 保存できなくても動く */ } };
  const lockBtn = (on, set, name) => (
    <button onClick={() => set(!on)} title={on ? `押すと${name}を変更できるようになります` : `押すと${name}をロックして、誤タップで変わらないようにします`}
      className="text-xs px-3 py-1.5 rounded"
      style={on ? { background: "#F6EBD6", color: "#7A4A00", border: "1px solid #E0B35A" } : { background: "#fff", border: `1px solid ${LINE}` }}>
      {on ? `🔒 ${name}ロック中` : `🔓 ${name}を変更できます`}
    </button>
  );
  const [sel, setSel] = useState(days[0].k);
  const openDay = (k) => { setSel(k); setView("day"); };
  // 公開とLINEでの通知
  const [notifying, setNotifying] = useState(false);
  const notifyPublish = async () => {
    setNotifying(true);
    try { alert(notifyResult(await api.lineNotify({ kind: "publish", store_id: data.store.id, month: mk }))); }
    catch { /* lineNotify が alert 済み */ } finally { setNotifying(false); }
  };
  const togglePublish = async () => {
    const on = !data.published;
    await api.setPublished(data.store.id, mk, on);
    if (on && confirm("公開しました。スタッフにLINEで知らせますか？")) await notifyPublish();
  };
  // LINEで知らせる: 今日以降の募集中の日がある店舗ごとに、その店舗のスタッフへ送る
  const t0 = new Date();
  const today = `${t0.getFullYear()}-${pad(t0.getMonth() + 1)}-${pad(t0.getDate())}`;
  const recruitTargets = data.allStores
    .map((D) => ({ D, ds: days.filter((d) => d.k >= today && D.isRecruit(d.k) && !D.isClosed(d)) }))
    .filter((x) => x.ds.length);
  // 送り先の店舗（"" = 募集のあるすべての店舗）
  const [recruitTo, setRecruitTo] = useState("");
  const recruitSel = recruitTargets.filter((x) => !recruitTo || x.D.store.id === recruitTo);
  useEffect(() => { if (recruitTo && !recruitTargets.some((x) => x.D.store.id === recruitTo)) setRecruitTo(""); });
  const notifyRecruit = async () => {
    if (!recruitSel.length) return;
    const list = recruitSel.map(({ D, ds }) => `${D.store.name}: ${ds.map((d) => fmt(d.k)).join("、")}`).join("\n");
    const who = recruitSel.length === 1 ? `${recruitSel[0].D.store.name}のスタッフ` : "各店舗のスタッフ";
    if (!confirm(`募集中の日を、${who}にLINEで知らせますか？\n\n${list}`)) return;
    setNotifying(true);
    try {
      const msgs = [];
      for (const { D, ds } of recruitSel) {
        const lines = ds.map((d) => `${fmt(d.k)} ${D.shortOf(d).map(([p, n]) => `${PARTS[p].label}あと${n}人`).join("、") || "募集中"}`);
        const res = await api.lineNotify({ kind: "recruit", store_id: D.store.id, month: mk, lines });
        msgs.push(`【${D.store.name}】${notifyResult(res)}`);
      }
      alert(msgs.join("\n\n"));
    } catch { /* lineNotify が alert 済み */ } finally { setNotifying(false); }
  };
  useEffect(() => { if (!days.find((d) => d.k === sel)) setSel(days[0].k); }, [days, sel]);
  const S = data.store;
  const day = days.find((d) => d.k === sel) || days[0];
  const req = data.ruleFor(day);
  const c = data.counts[day.k];
  const rows = data.staffInStore.map((s) => ({ s, r: data.requests[s.id]?.[day.k] })).filter((x) => x.r);
  // 他店に希望・出勤がある人（複数店舗に所属。定休日は除く）
  const shared = data.isClosed(day) ? [] : data.staffInStore.filter((s) => data.sharedOf(s.id, day.k));
  // 運営・社員は休み希望のない日が出勤予定（定休日・他店に希望や出勤がある日は除く）
  const planned = data.isClosed(day) ? [] : data.staffInStore.filter((s) => canOffice(s) && !data.requests[s.id]?.[day.k] && !data.sharedOf(s.id, day.k));
  const order = { pending: 0, approved: 1, rejected: 2 };
  rows.sort((a, b) => order[a.r.status] - order[b.r.status]);
  const pendingTotal = days.reduce((a, d) => a + PART_KEYS.reduce((b, p) => b + data.counts[d.k][p].pending, 0), 0);

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
        {data.published && <Btn disabled={notifying} onClick={() => confirm(`${S.name} のスタッフに、${mk.replace("-", "年")}月分のシフト公開をLINEで知らせますか？`) && notifyPublish()}>{notifying ? "送信中…" : "LINEで公開を知らせる"}</Btn>}
        <Btn tone={data.published ? "ghost" : "primary"} onClick={togglePublish}>
          {data.published ? "公開を取り下げる" : `${mk.replace("-", "年")}月分を公開する`}
        </Btn>
      </Card>

      {(() => {
        // 募集中の日に届いた未定の希望（出勤・休みを決めると消える）
        const items = days.filter((d) => data.isRecruit(d.k)).flatMap((d) => data.staffInStore
          .map((s) => ({ d, s, r: data.requests[s.id]?.[d.k] }))
          .filter(({ r }) => r && r.status === "pending" && r.type !== "off"));
        return items.length > 0 && (
          <Card className="px-4 py-3 mb-4 text-sm" style={{ borderColor: RED, background: "#FDF3F3" }}>
            <div className="font-medium mb-1" style={{ color: RED }}>募集中の日に出勤希望が {items.length} 件届いています</div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {items.map(({ d, s, r }) => (
                <li key={r.id}>
                  <button onClick={() => openDay(d.k)} className="hover:underline text-left">
                    <span className="tabular-nums">{fmt(d.k)}</span> {s.name}（{slotText(r)}）
                  </button>
                </li>
              ))}
            </ul>
            <div className="text-xs opacity-60 mt-1">タップするとその日を開きます。出勤・休みを決めるとここから消えます。</div>
          </Card>
        );
      })()}

      <EmployeeDaysOff data={data} days={days} mk={mk} />
      <TraineeCount data={data} mk={mk} />

      <OrderLockCtx.Provider value={orderLocked}>
      {/* 調整表の上: 表示の切り替え・ロック・募集の告知・印刷 */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex rounded overflow-hidden text-xs" style={{ border: `1px solid ${LINE}` }}>
          {[["month", "月全体"], ["day", "日単位"]].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className="px-3 py-1.5"
              style={view === v ? { background: NAVY, color: "#fff" } : { background: "#fff" }}>{l}</button>
          ))}
        </div>
        {view === "month" && lockBtn(orderLocked, setOrderLocked, "名簿の位置")}
        <span className="ml-auto" />
        {recruitTargets.length > 0 && (
          <div className="flex items-center gap-1">
            {recruitTargets.length > 1 && (
              <select value={recruitTo} onChange={(e) => setRecruitTo(e.target.value)} title="知らせる店舗"
                className="border rounded px-1 py-1.5 text-xs bg-white" style={{ borderColor: LINE }}>
                <option value="">すべての店舗</option>
                {recruitTargets.map(({ D, ds }) => <option key={D.store.id} value={D.store.id}>{D.store.name}（{ds.length}日）</option>)}
              </select>
            )}
            <Btn disabled={notifying} onClick={notifyRecruit}>
              <span style={{ color: RED }}>{notifying ? "送信中…"
                : `${recruitSel.length === 1 && recruitTargets.length > 1 ? `${recruitSel[0].D.store.name}に` : ""}募集を告知（${recruitSel.reduce((a, x) => a + x.ds.length, 0)}日）`}</span>
            </Btn>
          </div>
        )}
        <PrintButton stores={data.allStores} days={days} mk={mk} kind="wish" />
      </div>

      {view === "month" ? <MonthGrid data={data} days={days} /> : (
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

          <OtherStoresDay data={data} day={day} />
          {rows.length === 0 && shared.length === 0 && planned.length === 0 ? <div className="text-sm opacity-60 py-4">この日の希望はまだありません。</div> : (
            <ul className="divide-y" style={{ borderColor: "#EEF1F3" }}>
              {rows.map(({ s, r }) => <StaffDayRow key={`${s.id}:${day.k}`} data={data} s={s} day={day} r={r} />)}
              {shared.map((s) => <StaffDayRow key={`shared:${s.id}:${day.k}`} data={data} s={s} day={day} r={null} />)}
              {planned.map((s) => <StaffDayRow key={`plan:${s.id}:${day.k}`} data={data} s={s} day={day} r={null} />)}
            </ul>
          )}
          {rows.some((x) => x.r.status === "pending" && x.r.type !== "off") && (
            <div className="mt-3 flex justify-end">
              <Btn small onClick={() => rows.filter((x) => x.r.status === "pending" && x.r.type !== "off").forEach((x) => api.setStatus(x.r.id, "approved"))}>未定をすべて出勤</Btn>
            </div>
          )}
        </Card>
      </div>
      )}
      </OrderLockCtx.Provider>
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
const HALF_HOURS = Array.from({ length: 49 }, (_, i) => i / 2); // 0〜24時、30分刻み
const DELIVERY = { main: "メインデリバリー", second: "二台目デリバリー" };

// 給与期間（締め日の翌日〜次の締め日）で実働を管理する。希望・承認・公開は暦の月のまま
function WorkLogView({ data, mk }) {
  const [y, m] = mk.split("-").map(Number);
  const C = data.payClosingDay, P = data.payDay;
  // 初期値はヘッダーの表示月を支給月とする期間。月や締め日を変えたら追従する
  const base = useMemo(() => payPeriodOfMonth({ y, m: m - 1 }, C, P), [y, m, C, P]);
  const [period, setPeriod] = useState(base);
  useEffect(() => { setPeriod(base); }, [base]);
  const [allStores, setAllStores] = useState(false);
  const [dayEdit, setDayEdit] = useState(null); // { day, storeId }
  const [busy, setBusy] = useState(false);
  const { pd, error } = usePayPeriodData(period, data.stores);
  const days = useMemo(() => periodDays(period), [period]);
  const S = data.store;
  const multiStore = data.stores.length > 1;
  const cellW = 56;

  // 対象のシフト: 承認済み・アルバイト（研修中を含む）・表示中の店舗（全店舗で見るなら全店舗）
  const staffById = Object.fromEntries(data.staff.map((s) => [s.id, s]));
  const reqs = (pd?.requests || []).filter((r) => isPartTime(staffById[r.staff_id]) && (allStores || r.store_id === S.id));
  const idx = {}; // staff_id -> store_id -> date -> request
  for (const r of reqs) ((idx[r.staff_id] ||= {})[r.store_id] ||= {})[r.date] = r;
  const hoursOf = (r) => (r && pd ? workHours(pd.workOf(r)) : 0);

  // 行: スタッフごと。全店舗で見るときは店舗別の内訳行（2店舗以上なら合計行も）
  const rows = [];
  for (const s of data.staff) {
    const byStore = idx[s.id];
    if (!byStore) continue;
    if (!allStores) { rows.push({ key: s.id, s, storeId: S.id, first: true }); continue; }
    const sts = data.stores.filter((st) => byStore[st.id]);
    sts.forEach((st, i) => rows.push({ key: `${s.id}:${st.id}`, s, storeId: st.id, storeName: st.name, first: i === 0 }));
    if (sts.length > 1) rows.push({ key: `${s.id}:total`, s, total: true, storeIds: sts.map((st) => st.id) });
  }
  const reqOf = (row, k) => idx[row.s.id]?.[row.storeId]?.[k] || null;
  const reqsOfRow = (row) => (row.total ? row.storeIds : [row.storeId]).flatMap((sid) => Object.values(idx[row.s.id]?.[sid] || {}));
  const rowHours = (row) => reqsOfRow(row).reduce((a, r) => a + hoursOf(r), 0);
  const rowDays = (row) => new Set(reqsOfRow(row).map((r) => r.date)).size;
  const deliveries = (row, role) => (row.total ? row.storeIds : [row.storeId])
    .reduce((a, sid) => a + days.filter((d) => pd?.daySet[sid]?.[d.k]?.delivery?.[role] === row.s.id).length, 0);

  // 期間全体の集計
  const totalHours = reqs.reduce((a, r) => a + hoursOf(r), 0);
  const workDays = new Set(reqs.map((r) => `${r.staff_id}|${r.date}`)).size;
  const entered = pd ? reqs.filter((r) => pd.workOf(r)).length : 0;

  const lockedS = !!pd?.locked(S.id);
  const lockInfo = pd?.lockOf(S.id);
  const toggleLock = async () => {
    const msg = lockedS
      ? `${period.label} の締め確定を解除しますか？\n${S.name} の実働をまた修正できるようになります。`
      : `${period.label} を締め確定しますか？\n${S.name} のこの期間の実働は、解除するまで修正できなくなります。`;
    if (!confirm(msg)) return;
    setBusy(true);
    try { await api.lockPayPeriod(period.key, S.id, !lockedS); } finally { setBusy(false); }
  };

  const savePay = (key, v, min, max, cur) => {
    const n = Math.max(min, Math.min(max, Math.round(Number(v)) || cur));
    if (n !== cur) api.setPaySettings({ [key]: n });
    return n;
  };

  const csv = () => {
    const q = (x) => { const t = String(x ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [
      [`${period.label}`, allStores ? "全店舗" : S.name],
      ["名前", ...(allStores ? ["店舗"] : []), ...days.map((d) => `${d.m}/${d.d}(${WD[d.w]})`), "合計時間", "出勤日数", `${DELIVERY.main}(回)`, `${DELIVERY.second}(回)`],
    ];
    for (const row of rows) {
      const cells = days.map((d) => {
        const rs = row.total ? row.storeIds.map((sid) => idx[row.s.id]?.[sid]?.[d.k]).filter(Boolean) : [reqOf(row, d.k)].filter(Boolean);
        return rs.some((r) => pd.workOf(r)) ? fmtHours(rs.reduce((a, r) => a + hoursOf(r), 0)) : "";
      });
      lines.push([row.s.name, ...(allStores ? [row.total ? "合計" : row.storeName] : []), ...cells, fmtHours(rowHours(row)), rowDays(row), deliveries(row, "main"), deliveries(row, "second")]);
    }
    const blob = new Blob(["﻿" + lines.map((l) => l.map(q).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `実働時間_${allStores ? "全店舗" : S.name}_${period.key}支給分.csv`; a.click();
  };

  // 実働入力ダイアログ用（その店舗の設定と、期間のデータを渡す）
  const editorData = (storeId) => {
    const st = data.stores.find((x) => x.id === storeId) || S;
    return { ...data, store: st, windows: pd.windowsOf(st.id), daySet: pd.daySet[st.id] || {}, logs: pd.logs };
  };
  const editorRows = (storeId, k) => (pd?.requests || [])
    .filter((r) => r.store_id === storeId && r.date === k && staffById[r.staff_id])
    .map((r) => ({ s: staffById[r.staff_id], r }));
  const openEdit = (d, storeId) => { if (!pd?.locked(storeId)) setDayEdit({ day: d, storeId }); };

  const monthStart = (i) => i > 0 && days[i].m !== days[i - 1].m;
  const laterMonth = (d) => d.m !== days[0].m;
  const colBg = (d, hol) => (laterMonth(d) ? "#F6F8FA" : hol ? "#FBF8F8" : undefined);
  const colBorder = (i) => (monthStart(i) ? { borderLeft: `2px solid ${NAVY}` } : {});
  const sel = "border rounded px-1 py-0.5 w-12 tabular-nums bg-white";

  return (
    <div>
      <Card className="px-4 py-3 mb-3 text-sm">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button onClick={() => setPeriod(shiftPayPeriod(period, -1))} className="px-2 py-0.5 rounded" style={{ border: `1px solid ${LINE}` }} aria-label="前の期間">‹</button>
          <span className="font-medium tabular-nums">{period.label}</span>
          <button onClick={() => setPeriod(shiftPayPeriod(period, 1))} className="px-2 py-0.5 rounded" style={{ border: `1px solid ${LINE}` }} aria-label="次の期間">›</button>
          {period.key !== base.key && <button onClick={() => setPeriod(base)} className="text-xs underline opacity-70">表示月に戻す</button>}
          <span className="ml-auto flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1">締め日:
              <input type="number" min={1} max={28} key={`c${C}`} defaultValue={C} className={sel} style={{ borderColor: LINE }}
                onBlur={(e) => { e.target.value = savePay("pay_closing_day", e.target.value, 1, 28, C); }}
                onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />日{C >= 28 && "（月末）"}
            </label>
            <span className="opacity-40">／</span>
            <label className="flex items-center gap-1">支給日:
              <input type="number" min={1} max={31} key={`p${P}`} defaultValue={P} className={sel} style={{ borderColor: LINE }}
                onBlur={(e) => { e.target.value = savePay("pay_day", e.target.value, 1, 31, P); }}
                onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />日
            </label>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="tabular-nums">合計 <b>{fmtHours(totalHours)}</b>h</span>
          <span className="tabular-nums">出勤 <b>{workDays}</b>日</span>
          <span className="tabular-nums" title="実働を入力済みのシフト / 承認済みのシフト">入力済 <b>{entered}</b>/{reqs.length}</span>
          {multiStore && (
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={allStores} onChange={(e) => setAllStores(e.target.checked)} />全店舗で見る</label>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Btn small onClick={csv} disabled={!rows.length}>CSVを保存</Btn>
            {lockedS ? (
              <Btn small disabled={busy || !pd} onClick={toggleLock}>確定済み（解除）</Btn>
            ) : (
              <Btn small tone="primary" disabled={busy || !pd} onClick={toggleLock}>締め確定{multiStore ? `（${S.name}）` : ""}</Btn>
            )}
          </span>
        </div>
        {lockedS && (
          <div className="text-xs mt-2 px-2 py-1 rounded" style={{ background: "#E3F1E8", color: "#0F3A24" }}>
            {S.name} のこの期間は締め確定済みです{lockInfo?.locked_at && `（${new Date(lockInfo.locked_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）`}。修正するには「確定済み（解除）」を押してください。
          </div>
        )}
      </Card>

      {error ? <div className="text-sm" style={{ color: RED }}>読み込みエラー: {error}（SQL 0016 を実行したか確認してください）</div>
        : !pd ? <div className="text-sm opacity-60">読み込み中…</div> : (
        <Card>
          <DualScroll>
            <table className="border-collapse" style={{ minWidth: 340 + days.length * cellW }}>
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 text-sm font-medium" style={{ minWidth: 130, borderRight: `2px solid ${NAVY}`, borderBottom: `1px solid ${LINE}` }}>名前</th>
                  {days.map((d, i) => {
                    const hol = !!holidayName(d.k);
                    const done = pd.daySet[S.id]?.[d.k]?.work_hours;
                    return (
                      <th key={d.k} onClick={() => openEdit(d, S.id)} title={lockedS ? "締め確定済み" : `${S.name} のこの日の実働を入力`}
                        className={`px-1 py-1 text-xs font-normal tabular-nums whitespace-nowrap ${lockedS ? "" : "cursor-pointer"}`}
                        style={{ width: cellW, minWidth: cellW, background: done ? "#E3F1E8" : colBg(d, hol) || "#fff", borderBottom: `1px solid ${LINE}`, color: dayColor(d, hol), ...colBorder(i) }}>
                        {d.m}/{d.d}<span className="opacity-70">({WD[d.w]})</span>
                        {done && <span className="block" style={{ color: "#0F3A24" }}>入力済</span>}
                      </th>
                    );
                  })}
                  <th className="px-2 py-1 text-xs font-medium whitespace-nowrap" style={{ borderBottom: `1px solid ${LINE}`, borderLeft: `2px solid ${NAVY}` }}>合計</th>
                  <th className="px-2 py-1 text-xs font-medium whitespace-nowrap" style={{ borderBottom: `1px solid ${LINE}` }}>日数</th>
                  <th className="px-2 py-1 text-xs font-medium whitespace-nowrap" style={{ borderBottom: `1px solid ${LINE}` }} title={DELIVERY.main}>配メイン</th>
                  <th className="px-2 py-1 text-xs font-medium whitespace-nowrap" style={{ borderBottom: `1px solid ${LINE}` }} title={DELIVERY.second}>配2台目</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={days.length + 5} className="px-3 py-6 text-sm opacity-60">この期間に出勤のアルバイトがいません。</td></tr>}
                {rows.map((row) => {
                  const line = row.first && allStores ? `1px solid ${LINE}` : "1px solid #EEF1F3";
                  const locked = !row.total && pd.locked(row.storeId);
                  return (
                    <tr key={row.key} style={row.total ? { background: "#F4F6F8" } : undefined}>
                      <td className="sticky left-0 z-10 px-3 py-1.5 text-sm whitespace-nowrap" style={{ background: row.total ? "#F4F6F8" : "#fff", borderRight: `2px solid ${NAVY}`, borderTop: line }}>
                        {row.total ? <span className="text-xs opacity-70 pl-2">合計</span> : <>
                          {(row.first || !allStores) ? row.s.name : <span className="opacity-0">{row.s.name}</span>}
                          {allStores && <span className="ml-1 text-xs opacity-50">{row.storeName}</span>}
                          {locked && allStores && <span className="ml-1 text-xs opacity-50" title="締め確定済み">🔒</span>}
                        </>}
                      </td>
                      {days.map((d, i) => {
                        const hol = !!holidayName(d.k);
                        const style = { borderTop: line, background: colBg(d, hol), ...colBorder(i) };
                        if (row.total) {
                          const rs = row.storeIds.map((sid) => idx[row.s.id]?.[sid]?.[d.k]).filter(Boolean);
                          const any = rs.some((r) => pd.workOf(r));
                          return <td key={d.k} className="text-center py-1 text-xs tabular-nums font-medium" style={style}>{rs.length ? (any ? fmtHours(rs.reduce((a, r) => a + hoursOf(r), 0)) : "−") : ""}</td>;
                        }
                        const r = reqOf(row, d.k);
                        const w = r && pd.workOf(r);
                        const dv = pd.daySet[row.storeId]?.[d.k]?.delivery || {};
                        return (
                          <td key={d.k} className="text-center py-1 text-xs tabular-nums" style={style}>
                            {r && (
                              <button onClick={() => openEdit(d, row.storeId)} disabled={locked} className="px-1.5 py-0.5 rounded disabled:cursor-default"
                                title={`${slotText(r)}${w?.individual ? "（個別に修正）" : ""}${locked ? "（締め確定済み）" : ""}`}
                                style={w?.individual ? { background: "#CFE8D8", color: "#0F3A24", outline: "1px solid #0F3A24" } : w ? { background: "#CFE8D8", color: "#0F3A24" } : { background: slotStyle(r).bg, color: slotStyle(r).fg }}>
                                {w ? fmtHours(workHours(w)) : "−"}{w?.individual && "*"}
                              </button>
                            )}
                            {(dv.main === row.s.id || dv.second === row.s.id) && <span className="block" style={{ color: "#7A4A00" }}>{dv.main === row.s.id ? "配1" : "配2"}</span>}
                          </td>
                        );
                      })}
                      <td className="text-right px-2 py-1 text-sm tabular-nums font-medium whitespace-nowrap" style={{ borderLeft: `2px solid ${NAVY}`, borderTop: line }}>{fmtHours(rowHours(row))}h</td>
                      <td className="text-right px-2 py-1 text-sm tabular-nums" style={{ borderTop: line }}>{rowDays(row)}</td>
                      <td className="text-right px-2 py-1 text-sm tabular-nums" style={{ borderTop: line }}>{deliveries(row, "main") || ""}</td>
                      <td className="text-right px-2 py-1 text-sm tabular-nums" style={{ borderTop: line }}>{deliveries(row, "second") || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DualScroll>
        </Card>
      )}
      <div className="mt-1 text-xs opacity-70">
        日付をタップ → {S.name} のその日の終業・通しの休憩・デリバリー担当を入力（早上がり・遅刻も一人ずつ直せます）。
        「入力済」＝その日の実働を入力済み ／ 「−」＝出勤だが実働が未入力 ／ 「*」＝個別に直した人 ／ 配1＝メインデリバリー、配2＝二台目デリバリー ／ 太線＝月の変わり目
      </div>
      {dayEdit && pd && (
        <DayWorkEditor key={`${dayEdit.storeId}:${dayEdit.day.k}`} data={editorData(dayEdit.storeId)} day={dayEdit.day}
          rows={editorRows(dayEdit.storeId, dayEdit.day.k)} onClose={() => setDayEdit(null)} />
      )}
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

// ---------- LINE通知（公式アカウント） ----------
function LineNotifyCard({ data }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = data.lineBotId;
  const link = id ? `https://line.me/R/ti/p/@${id}` : "";
  // 在籍中で LINE 連携済みのスタッフの友だち状況
  const linked = data.staff.map((s) => data.profiles.find((p) => p.id === s.profile_id)).filter(Boolean);
  const checked = linked.filter((p) => p.line_friend_checked_at);
  const friends = checked.filter((p) => p.line_friend).length;
  const lastChecked = checked.reduce((a, p) => (p.line_friend_checked_at > a ? p.line_friend_checked_at : a), "");

  const saveId = (v) => { const n = v.trim().replace(/^@/, ""); if (n !== id) api.setLineBotId(n); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { prompt("このリンクをコピーしてください", link); }
  };
  const check = async () => {
    setBusy(true);
    try {
      const res = await api.lineNotify({ kind: "check" });
      alert(`${res.checked} 人を確認しました。友だち追加済み ${res.friends} 人。` +
        (res.not_friend?.length ? `\n\nまだ友だち追加していない人:\n${res.not_friend.join("、")}` : ""));
    } catch { /* lineNotify が alert 済み */ } finally { setBusy(false); }
  };

  return (
    <Card className="p-4 w-full text-sm">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-medium">LINE通知</span>
        <span className="text-xs opacity-60">お知らせ・シフト公開・募集はスタッフに、変更依頼・募集への希望は管理者に、公式アカウントからLINEで送ります。届くのは公式アカウントを友だち追加した人だけです</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <label className="flex items-center gap-1 text-xs">
          公式アカウントID
          <span className="opacity-60">@</span>
          <input key={id} defaultValue={id} placeholder="例: 123abcde" onBlur={(e) => saveId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
            className="border rounded px-2 py-0.5 w-32" style={{ borderColor: LINE }} />
        </label>
        {link && (
          <>
            <a href={link} target="_blank" rel="noreferrer" className="text-xs underline break-all" style={{ color: NAVY }}>{link}</a>
            <Btn small onClick={copy}>{copied ? "コピーしました" : "リンクをコピー"}</Btn>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Btn small disabled={busy} onClick={check}>{busy ? "確認中…" : "友だち状況を更新"}</Btn>
        <span className="text-xs tabular-nums">
          {checked.length ? <>友だち追加済み <b>{friends}</b> / {linked.length} 人（LINE連携済みの人のうち）</> : <span className="opacity-60">まだ確認していません</span>}
          {lastChecked && <span className="opacity-60 ml-1">最終確認 {new Date(lastChecked).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
        </span>
      </div>
      <div className="text-xs opacity-60 mt-2">リンクをLINEグループに送って、スタッフに友だち追加してもらってください。名簿の「通知○／✕」は最後に確認したときの状態です。</div>
      {/* 管理者宛ての通知（変更依頼・募集への希望）を受け取る管理者 */}
      <div className="mt-3 pt-3" style={{ borderTop: "1px solid #EEF1F3" }}>
        <div className="text-xs mb-1">管理者への通知（変更依頼が届いたとき・募集中の日に希望が入ったとき）を受け取る人</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {data.profiles.filter((p) => p.role === "manager").map((p) => (
            <label key={p.id} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={p.notify_manager !== false} onChange={(e) => api.setManagerNotify(p.id, e.target.checked)} />
              {data.staff.find((s) => s.profile_id === p.id)?.name || p.display_name}
            </label>
          ))}
        </div>
        <div className="text-xs opacity-60 mt-1">自分の操作で送られる通知は自分には届きません。公式アカウントを友だち追加していない管理者には届きません。</div>
      </div>
    </Card>
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
      <LineNotifyCard data={data} />
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
                      <div className="text-xs">
                        {p ? <span className="opacity-60">LINE: {p.display_name}{p.role === "manager" && "（管理者）"}</span> : <span style={{ color: "#7A4A00" }}>LINE未連携</span>}
                        {p?.line_friend_checked_at && (
                          <span className="ml-1 px-1 rounded" title={`公式アカウントの友だち追加（${new Date(p.line_friend_checked_at).toLocaleString("ja-JP")} 確認）`}
                            style={p.line_friend ? { background: "#CFE8D8", color: "#0F3A24" } : { background: "#F7E4E4", color: "#7A1E1E" }}>
                            通知{p.line_friend ? "○" : "✕"}
                          </span>
                        )}
                      </div>
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
                {[0, 1].map((i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i === 1 && "〜"}
                    <select value={windows[p]?.[i] ?? 0} onChange={(e) => setWindow(p, i, e.target.value)} className="border rounded px-1 py-0.5 bg-white tabular-nums">
                      {HALF_HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                    </select>
                  </span>
                ))}
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
