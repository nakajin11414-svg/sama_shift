import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase.js";
import { autoWork, covers, dkey, holidayName, mkey, monthDays, DEFAULT_RULE, DEFAULT_WINDOWS, DEFAULT_PAY } from "./util.js";

// 給与期間（2か月にまたがる）の実働用データ。全店舗の承認済みシフトと実働、日ごとの実働入力、締め確定を読む
//   period = payPeriodFor などの戻り値（null なら読まない）
//   stores = 店舗一覧（枠の時間帯に使う）
export function usePayPeriodData(period, stores) {
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const start = period?.start, end = period?.end;

  const reload = useCallback(async () => {
    if (!start) { setRaw(null); return; }
    const [requests, logs, daySettings, locks] = await Promise.all([
      supabase.from("requests").select("*").eq("status", "approved").neq("type", "off").gte("date", start).lte("date", end),
      supabase.from("work_logs").select("*"),
      supabase.from("day_settings").select("store_id, date, work_hours, delivery").gte("date", start).lte("date", end),
      supabase.from("pay_period_locks").select("*"),
    ]);
    const err = [requests, logs, daySettings, locks].find((r) => r.error)?.error;
    if (err) return setError(err.message);
    setError(null);
    setRaw({ start, requests: requests.data, logs: logs.data, daySettings: daySettings.data, locks: locks.data });
  }, [start, end]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    window.addEventListener("shift-refresh", reload);
    return () => window.removeEventListener("shift-refresh", reload);
  }, [reload]);
  useEffect(() => {
    if (!start) return;
    const ch = supabase.channel(`pay-period-${start}`);
    for (const t of ["requests", "work_logs", "pay_period_locks", "day_settings"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => reload());
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload, start]);

  const view = useMemo(() => {
    if (!raw || raw.start !== start) return null; // 期間を切り替えた直後は古いデータを出さない
    const logs = Object.fromEntries(raw.logs.map((l) => [l.request_id, l]));
    const daySet = {}; // store_id -> date -> day_settings
    for (const d of raw.daySettings) (daySet[d.store_id] ||= {})[d.date] = d;
    const windowsOf = (sid) => ({ ...DEFAULT_WINDOWS, ...((stores || []).find((s) => s.id === sid)?.windows || {}) });
    const workOf = (r) => {
      const w = autoWork(r, daySet[r.store_id]?.[r.date]?.work_hours, windowsOf(r.store_id), logs[r.id]);
      return w && logs[r.id] ? { ...w, individual: true } : w;
    };
    const locked = (storeId) => raw.locks.some((l) => l.period_key === period.key && l.store_id === storeId);
    const lockOf = (storeId) => raw.locks.find((l) => l.period_key === period.key && l.store_id === storeId) || null;
    return { requests: raw.requests, logs, daySet, windowsOf, workOf, locked, lockOf };
  }, [raw, start, stores, period?.key]); // eslint-disable-line

  return { pd: view, error, reload };
}

// 月と店舗ごとのデータをまとめて取得し、変更があれば自動で再取得する
export function useShiftData(ym, storeId) {
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const mk = mkey(ym.y, ym.m);
  const days = useMemo(() => monthDays(ym.y, ym.m), [ym]);
  const first = days[0].k, last = days[days.length - 1].k;

  const reload = useCallback(async () => {
    const [stores, staff, staffStores, requests, daySettings, pubs, profiles, ann, logs, monthSet, changes, quota] = await Promise.all([
      supabase.from("stores").select("*").order("sort_order").order("created_at"),
      supabase.from("staff").select("*").eq("active", true).order("sort_order").order("created_at"),
      supabase.from("staff_stores").select("*"),
      supabase.from("requests").select("*").gte("date", first).lte("date", last), // 全店舗分（店舗横断の表示に使う）
      supabase.from("day_settings").select("*").gte("date", first).lte("date", last),
      supabase.from("publications").select("*").eq("month", mk),
      supabase.from("profiles").select("id, display_name, picture_url, role, announcements_read_at, line_friend, line_friend_checked_at, notify_manager"),
      supabase.from("announcements").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100),
      supabase.from("work_logs").select("*"),
      supabase.from("month_settings").select("*").eq("month", mk),
      // 変更依頼: 未処理はすべての月、処理済みはこの月の分
      supabase.from("change_requests").select("*").or(`status.eq.pending,and(date.gte.${first},date.lte.${last})`).order("created_at", { ascending: false }),
      supabase.from("month_quotas").select("*").eq("month", mk).maybeSingle(),
    ]);
    const err = [stores, staff, staffStores, requests, daySettings, pubs, profiles, ann, logs, monthSet, changes, quota].find((r) => r.error)?.error;
    if (err) return setError(err.message);
    // 研修中の人の出勤回数（月をまたいで、表示中の月の終わりまで。同じ日は1回）
    const trainees = staff.data.filter((s) => s.position === "trainee").map((s) => s.id);
    const [setting, tr] = await Promise.all([
      supabase.from("settings").select("training_shifts, line_bot_id, pay_closing_day, pay_day").eq("id", 1).maybeSingle(),
      trainees.length
        ? supabase.from("requests").select("staff_id, date").in("staff_id", trainees).eq("status", "approved").neq("type", "off").lte("date", last)
        : Promise.resolve({ data: [] }),
    ]);
    const err2 = [setting, tr].find((r) => r.error)?.error;
    if (err2) return setError(err2.message);
    const trainingDone = {};
    for (const r of tr.data) (trainingDone[r.staff_id] ||= new Set()).add(r.date);
    setError(null);
    setRaw({
      stores: stores.data, staff: staff.data, staffStores: staffStores.data, requests: requests.data,
      daySettings: daySettings.data, pubs: pubs.data, profiles: profiles.data, announcements: ann.data, logs: logs.data,
      monthSettings: monthSet.data, changes: changes.data, employeeDaysOff: quota.data?.employee_days_off ?? null,
      trainingShifts: setting.data?.training_shifts ?? 10,
      lineBotId: setting.data?.line_bot_id || "",
      payClosingDay: setting.data?.pay_closing_day ?? DEFAULT_PAY.closingDay,
      payDay: setting.data?.pay_day ?? DEFAULT_PAY.payDay,
      trainingDone: Object.fromEntries(Object.entries(trainingDone).map(([k, v]) => [k, v.size])),
    });
  }, [first, last, mk]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    window.addEventListener("shift-refresh", reload);
    return () => window.removeEventListener("shift-refresh", reload);
  }, [reload]);
  useEffect(() => {
    const ch = supabase.channel("shift-changes");
    for (const t of ["requests", "day_settings", "publications", "staff", "staff_stores", "stores", "profiles", "announcements", "work_logs", "month_settings", "change_requests", "month_quotas", "settings"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => reload());
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  const view = useMemo(() => {
    if (!raw) return null;
    const store = raw.stores.find((s) => s.id === storeId) || raw.stores[0];
    if (!store) return { ...raw, store: null };
    const membership = {}; // staff_id -> Set(store_id)
    for (const m of raw.staffStores) (membership[m.staff_id] ||= new Set()).add(m.store_id);

    const requestsAll = {}; // staff_id -> date -> [rows across stores]
    for (const r of raw.requests) ((requestsAll[r.staff_id] ||= {})[r.date] ||= []).push(r);

    // 店舗ごとの区分・基準人数・定休日・人数（表示中の店舗と、他店舗の状況の両方で使う）
    const storeView = (st) => {
      const windows = { ...DEFAULT_WINDOWS, ...(st.windows || {}) };
      // 店舗ごとの並び順（staff_stores.sort_order。空ならスタッフ名簿の順）
      const ord = Object.fromEntries(raw.staffStores.filter((m) => m.store_id === st.id).map((m) => [m.staff_id, m.sort_order]));
      const pos = Object.fromEntries(raw.staff.map((s, i) => [s.id, i]));
      const staffInStore = raw.staff.filter((s) => membership[s.id]?.has(st.id))
        .sort((a, b) => (ord[a.id] ?? a.sort_order) - (ord[b.id] ?? b.sort_order) || pos[a.id] - pos[b.id]);
      const requests = {}; // staff_id -> date -> row (この店舗)
      for (const r of raw.requests) if (r.store_id === st.id) (requests[r.staff_id] ||= {})[r.date] = r;
      const daySet = Object.fromEntries(raw.daySettings.filter((d) => d.store_id === st.id).map((d) => [d.date, d]));
      const holidays = new Set(st.holidays || []);
      const defaultType = (day) => (day.w === 0 || day.w === 6 || holidays.has(day.k) || holidayName(day.k) ? "holiday" : "weekday");
      const typeOf = (day) => daySet[day.k]?.day_type || defaultType(day);
      const ruleFor = (day) => ({ ...DEFAULT_RULE, ...(st.rules?.[typeOf(day)] || st.rules?.weekday || {}) });
      // 定休日: 日ごとの設定があればそれ、なければ店舗の毎週の定休日
      const closedWeekdays = new Set(st.closed_weekdays || []);
      const defaultClosed = (day) => closedWeekdays.has(day.w);
      const isClosed = (day) => daySet[day.k]?.closed ?? defaultClosed(day);
      // 枠ごとの人数と、出勤の中のデリバリーだけ・厨房だけ・両方できる人・仕込みができる人の数
      const counts = {};
      for (const day of days) {
        const c = counts[day.k] = {};
        for (const p of ["prep", "lunch", "dinner"]) c[p] = { n: 0, pending: 0, onlyDelivery: 0, onlyKitchen: 0, both: 0, prepper: 0 };
        for (const s of staffInStore) {
          if (s.position === "trainee") continue;
          const r = requests[s.id]?.[day.k];
          if (!r || r.status === "rejected") continue;
          for (const p of ["prep", "lunch", "dinner"]) {
            if (!covers(r, p, windows)) continue;
            if (r.status === "approved") {
              c[p].n++;
              if (s.can_delivery && s.can_kitchen) c[p].both++;
              else if (s.can_delivery) c[p].onlyDelivery++;
              else if (s.can_kitchen) c[p].onlyKitchen++;
              if (s.can_prep) c[p].prepper++;
            } else c[p].pending++;
          }
        }
      }
      // その日の不足: [枠, あと何人][]（定休日は空）
      const shortOf = (day) => (isClosed(day) ? [] : ["prep", "lunch", "dinner"].map((p) => [p, ruleFor(day)[p] - counts[day.k][p].n]).filter(([, n]) => n > 0));
      const isHoliday = (day) => typeOf(day) !== "weekday";
      const isRecruit = (k) => !!daySet[k]?.recruit;
      // 複数店舗に所属する人の、他店に出ている希望・出勤（この店舗に希望がない日に代わりに見せる）
      //   出勤 → 未定 → 休み希望 → 休み の順で1件
      const sharedOf = (staffId, k) => {
        if (requests[staffId]?.[k]) return null;
        const ot = (requestsAll[staffId]?.[k] || []).filter((r) => r.store_id !== st.id);
        return ot.length ? [...ot].sort((a, b) => rank(a) - rank(b))[0] : null;
      };
      const published = raw.pubs.some((p) => p.store_id === st.id);
      // 締切: この日の終わりまで入力できる。過ぎたら募集中の日以外は変更依頼で受け付ける
      const deadline = raw.monthSettings.find((m) => m.store_id === st.id)?.deadline || null;
      const deadlinePassed = !!deadline && today > deadline;
      const isLocked = (day) => deadlinePassed && !isRecruit(day.k);
      const dayHours = (k) => hoursAll[`${st.id}|${k}`] || null;
      return { ...common, store: st, windows, staffInStore, requests, daySet, defaultType, typeOf, isHoliday, ruleFor, isRecruit, defaultClosed, isClosed, counts, shortOf, sharedOf, published, deadline, deadlinePassed, isLocked, dayHours };
    };

    const rank = (r) => (r.type === "off" ? 2 : { approved: 0, pending: 1, rejected: 3 }[r.status]);
    const storeName = (id) => raw.stores.find((s) => s.id === id)?.name || "";
    const t = new Date();
    const today = dkey(t.getFullYear(), t.getMonth(), t.getDate());
    const logs = Object.fromEntries(raw.logs.map((l) => [l.request_id, l]));
    // 実働: 個別入力があればそれ、なければその日の営業時間（一括入力）から計算
    // （全店舗表示でも使うので、希望の店舗の設定で計算する）
    const hoursAll = Object.fromEntries(raw.daySettings.filter((d) => d.work_hours).map((d) => [`${d.store_id}|${d.date}`, d.work_hours]));
    const windowsOf = (sid) => ({ ...DEFAULT_WINDOWS, ...(raw.stores.find((s) => s.id === sid)?.windows || {}) });
    const workOf = (r) => {
      const w = autoWork(r, hoursAll[`${r.store_id}|${r.date}`], windowsOf(r.store_id), logs[r.id]);
      return w && logs[r.id] ? { ...w, individual: true } : w;
    };
    const common = { ...raw, membership, requestsAll, storeName, logs, workOf };

    // 表示中の店舗を先頭に、全店舗分を作る。どの店舗の分も同じ形（data として各画面に渡せる）
    //   allStores = [表示中の店舗, ...他店舗] / otherStores = 自分以外の店舗
    const allStores = [store, ...raw.stores.filter((s) => s.id !== store.id)].map(storeView);
    for (const v of allStores) {
      v.allStores = allStores;
      v.otherStores = allStores.filter((o) => o !== v);
    }
    return allStores[0];
  }, [raw, days, storeId]);

  return { data: view, days, mk, error, reload };
}

// ---------- 書き込み ----------
const check = ({ error }) => {
  if (error) { alert(error.message); throw error; }
  window.dispatchEvent(new Event("shift-refresh"));
};

// 枠を変えて出勤にするとき、元の希望を desired に残す（最初に変えたときだけ。同じ枠なら残さない）
function desiredFor(r, slot) {
  const orig = r.desired || { type: r.type, parts: r.parts, start_time: r.start_time, end_time: r.end_time };
  const t = (x) => (x ? x.slice(0, 5) : null);
  const same = orig.type === slot.type && [...(orig.parts || [])].sort().join() === [...(slot.parts || [])].sort().join()
    && t(orig.start_time) === t(slot.start_time) && t(orig.end_time) === t(slot.end_time);
  return same ? null : orig;
}

// line-notify の結果を知らせる文
export const notifyResult = (res) =>
  `LINEで ${res?.sent ?? 0} 人に送信しました。` +
  (res?.not_friend?.length ? `\n\n公式アカウントを友だち追加していないため送れなかった人:\n${res.not_friend.join("、")}` : "");

export const api = {
  // 希望
  async upsertRequests(staffId, storeId, dates, type, parts, start, end, status) {
    const rows = dates.map((date) => ({
      staff_id: staffId, store_id: storeId, date, type,
      parts: type === "parts" ? parts : [],
      start_time: type === "custom" ? start : null,
      end_time: type === "custom" ? end : null,
      desired: null, // 入れ直したら元の希望の記録は消す
      ...(status ? { status } : {}),
    }));
    check(await supabase.from("requests").upsert(rows, { onConflict: "staff_id,date,store_id" }));
  },
  async deleteRequests(staffId, storeId, dates) {
    check(await supabase.from("requests").delete().eq("staff_id", staffId).eq("store_id", storeId).in("date", dates));
  },
  async setStatus(id, status) { check(await supabase.from("requests").update({ status }).eq("id", id)); },
  // 管理者が枠・時間を変えて出勤にする。元の希望は desired に残す（最初に変えたときだけ）
  async approveAs(r, slot) {
    check(await supabase.from("requests").update({ ...slot, status: "approved", desired: desiredFor(r, slot) }).eq("id", r.id));
  },
  // 複数店舗に所属する人の、他店に出ている希望（または出勤・休み）をこの店舗に移して出勤にする
  //   他店の行はこの店舗の行になる（他店からは「○○店で出勤」として見える）
  async moveRequest(r, storeId, slot) {
    // 他店で個別に入れた実働は、移した後の出勤とは合わないので消す
    check(await supabase.from("work_logs").delete().eq("request_id", r.id));
    // 念のため、この店舗の同じ日の行（休みなど）を消してから移す
    check(await supabase.from("requests").delete().eq("staff_id", r.staff_id).eq("store_id", storeId).eq("date", r.date));
    check(await supabase.from("requests").update({ ...slot, store_id: storeId, status: "approved", desired: r.type === "off" ? null : desiredFor(r, slot) }).eq("id", r.id));
  },
  // 戻す: 枠を変えていたら元の希望に戻して未定にする
  async resetRequest(r) {
    check(await supabase.from("requests").update(r.desired ? { ...r.desired, desired: null, status: "pending" } : { status: "pending" }).eq("id", r.id));
  },
  // 日ごとの設定・公開
  async setDayType(storeId, date, day_type) { check(await supabase.from("day_settings").upsert({ store_id: storeId, date, day_type }, { onConflict: "store_id,date" })); },
  // 締切（null で解除）
  // 社員の休みの日数（null で解除）
  async setTrainingShifts(n) { check(await supabase.from("settings").update({ training_shifts: n }).eq("id", 1)); },
  async setEmployeeDaysOff(month, n) {
    check(n == null ? await supabase.from("month_quotas").delete().eq("month", month)
                    : await supabase.from("month_quotas").upsert({ month, employee_days_off: n }, { onConflict: "month" }));
  },
  async setDeadline(storeId, month, deadline) { check(await supabase.from("month_settings").upsert({ store_id: storeId, month, deadline }, { onConflict: "store_id,month" })); },
  // 変更依頼
  async sendChangeRequests(staffId, storeId, dates, action, type, parts, start, end, reason) {
    const rows = dates.map((date) => ({
      staff_id: staffId, store_id: storeId, date, action, reason,
      type: action === "set" ? type : null,
      parts: action === "set" && type === "parts" ? parts : [],
      start_time: action === "set" && type === "custom" ? start : null,
      end_time: action === "set" && type === "custom" ? end : null,
    }));
    const { data, error } = await supabase.from("change_requests").insert(rows).select("id");
    check({ error });
    // 管理者にLINEで知らせる（失敗しても依頼は送れているので止めない）
    api.notifyManagers({ kind: "change_request", ids: (data || []).map((x) => x.id) });
  },
  async withdrawChangeRequest(id) { check(await supabase.from("change_requests").delete().eq("id", id)); },
  // 承諾: 希望に反映してから依頼を「承諾」にする
  async approveChangeRequest(c) {
    if (c.action === "remove") {
      check(await supabase.from("requests").delete().eq("staff_id", c.staff_id).eq("store_id", c.store_id).eq("date", c.date));
    } else {
      check(await supabase.from("requests").upsert({
        staff_id: c.staff_id, store_id: c.store_id, date: c.date, type: c.type, parts: c.parts,
        start_time: c.start_time, end_time: c.end_time, desired: null,
        status: c.type === "off" ? "pending" : "approved", // 休み希望は出勤ではないので未定のまま
      }, { onConflict: "staff_id,date,store_id" }));
    }
    check(await supabase.from("change_requests").update({ status: "approved", decided_at: new Date().toISOString() }).eq("id", c.id));
  },
  async rejectChangeRequest(id) { check(await supabase.from("change_requests").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("id", id)); },
  async setClosed(storeId, date, closed) { check(await supabase.from("day_settings").upsert({ store_id: storeId, date, closed }, { onConflict: "store_id,date" })); },
  async setRecruit(storeId, date, recruit) { check(await supabase.from("day_settings").upsert({ store_id: storeId, date, recruit }, { onConflict: "store_id,date" })); },
  async setPublished(storeId, month, on) {
    check(on ? await supabase.from("publications").upsert({ store_id: storeId, month }, { onConflict: "store_id,month" })
             : await supabase.from("publications").delete().eq("store_id", storeId).eq("month", month));
  },
  // 店舗
  async addStore(name, sort_order) { check(await supabase.from("stores").insert({ name, sort_order, windows: DEFAULT_WINDOWS })); },
  async updateStore(id, patch) { check(await supabase.from("stores").update(patch).eq("id", id)); },
  async deleteStore(id) { check(await supabase.from("stores").delete().eq("id", id)); },
  async setMembership(staffId, storeId, on) {
    check(on ? await supabase.from("staff_stores").upsert({ staff_id: staffId, store_id: storeId })
             : await supabase.from("staff_stores").delete().eq("staff_id", staffId).eq("store_id", storeId));
  },
  // 名簿
  async addStaff(name, sort_order, profile_id = null, storeIds = []) {
    const { data, error } = await supabase.from("staff").insert({ name, sort_order, profile_id }).select().single();
    check({ error });
    if (storeIds.length) check(await supabase.from("staff_stores").insert(storeIds.map((store_id) => ({ staff_id: data.id, store_id }))));
  },
  async updateStaff(id, patch) { check(await supabase.from("staff").update(patch).eq("id", id)); },
  // 店舗ごとの並び順（調整表の行のドラッグ）: その店舗の ids の順に sort_order = 0,1,2… を振り直す（変わった人だけ更新）
  async reorderStaff(storeId, ids, staffStores) {
    const cur = Object.fromEntries(staffStores.filter((m) => m.store_id === storeId).map((m) => [m.staff_id, m.sort_order]));
    const changed = ids.map((id, i) => [id, i]).filter(([id, i]) => cur[id] !== i);
    const res = await Promise.all(changed.map(([id, i]) => supabase.from("staff_stores").update({ sort_order: i }).eq("staff_id", id).eq("store_id", storeId)));
    res.forEach(check);
  },
  async deactivateStaff(id) { check(await supabase.from("staff").update({ active: false, profile_id: null }).eq("id", id)); },
  async setRole(profileId, role) { check(await supabase.from("profiles").update({ role }).eq("id", profileId)); },
  // LINE連携の解除（アカウントを削除。名簿と過去のデータは残る）
  async unlinkLine(profileId) {
    const { data, error } = await supabase.functions.invoke("unlink-line", { body: { profile_id: profileId } });
    let msg = error ? error.message : data?.error;
    if (error?.context?.json) { try { msg = (await error.context.json()).error || msg; } catch { /* 本文なし */ } }
    check({ error: msg ? { message: msg } : null });
  },
  // LINE通知（公式アカウントのID と Edge Function line-notify）
  async setLineBotId(v) { check(await supabase.from("settings").update({ line_bot_id: v || null }).eq("id", 1)); },
  // 管理者宛ての通知（スタッフの操作のついでに送る）。エラーは表示せず、送れなくても操作は続ける
  async notifyManagers(body) {
    try {
      const { error } = await supabase.functions.invoke("line-notify", { body });
      if (error) console.warn("管理者へのLINE通知に失敗しました", error);
    } catch (e) { console.warn("管理者へのLINE通知に失敗しました", e); }
  },
  async setManagerNotify(profileId, on) { check(await supabase.from("profiles").update({ notify_manager: on }).eq("id", profileId)); },
  async lineNotify(body) {
    const { data, error } = await supabase.functions.invoke("line-notify", { body });
    let msg = error ? error.message : data?.error;
    let detail = data?.detail;
    if (error?.context?.json) { try { const j = await error.context.json(); msg = j.error || msg; detail = j.detail || detail; } catch { /* 本文なし */ } }
    check({ error: msg ? { message: detail ? `${msg}\n${detail}` : msg } : null });
    return data;
  },
  // お知らせ（作成した行を返す）
  async postAnnouncement(row) {
    const { data, error } = await supabase.from("announcements").insert(row).select().single();
    check({ error });
    return data;
  },
  async updateAnnouncement(id, patch) { check(await supabase.from("announcements").update(patch).eq("id", id)); },
  async deleteAnnouncement(a) {
    check(await supabase.from("announcements").delete().eq("id", a.id));
    await api.removeMedia((a.attachments || []).map((x) => x.path));
  },
  // お知らせの画像・動画（Storage の announcements バケット）
  async uploadMedia(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
    const { error } = await supabase.storage.from("announcements").upload(path, file, { contentType: file.type, upsert: false });
    if (error) { alert(`${file.name} をアップロードできませんでした: ${error.message}`); throw error; }
    return { path, type: file.type.startsWith("video/") ? "video" : "image", name: file.name };
  },
  async removeMedia(paths) {
    if (!paths.length) return;
    await supabase.storage.from("announcements").remove(paths); // 失敗しても表示には影響しないので無視
  },
  // 表示用の一時URL（1時間有効）: { path: url }
  async mediaUrls(paths) {
    if (!paths.length) return {};
    const { data, error } = await supabase.storage.from("announcements").createSignedUrls(paths, 3600);
    if (error) return {};
    return Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
  },
  async markAnnouncementsRead(profileId) { check(await supabase.from("profiles").update({ announcements_read_at: new Date().toISOString() }).eq("id", profileId)); },
  // 実働時間
  // 給与期間（締め日・支給日）と締め確定
  async setPaySettings(patch) { check(await supabase.from("settings").update(patch).eq("id", 1)); },
  async lockPayPeriod(periodKey, storeId, on) {
    if (on) {
      const { data: { user } } = await supabase.auth.getUser();
      check(await supabase.from("pay_period_locks").upsert({ period_key: periodKey, store_id: storeId, locked_at: new Date().toISOString(), locked_by: user?.id || null }));
    } else check(await supabase.from("pay_period_locks").delete().eq("period_key", periodKey).eq("store_id", storeId));
  },
  async setDayWork(storeId, date, work_hours, delivery) { check(await supabase.from("day_settings").upsert({ store_id: storeId, date, work_hours, delivery }, { onConflict: "store_id,date" })); },
  async upsertWorkLog(row) { check(await supabase.from("work_logs").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "request_id" })); },
  async deleteWorkLog(requestId) { check(await supabase.from("work_logs").delete().eq("request_id", requestId)); },
};
