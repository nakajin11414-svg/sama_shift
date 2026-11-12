import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase.js";
import { autoWork, covers, dkey, holidayName, mkey, monthDays, DEFAULT_RULE, DEFAULT_WINDOWS } from "./util.js";

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
      supabase.from("profiles").select("id, display_name, picture_url, role, announcements_read_at"),
      supabase.from("announcements").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100),
      supabase.from("work_logs").select("*"),
      supabase.from("month_settings").select("*").eq("month", mk),
      // 変更依頼: 未処理はすべての月、処理済みはこの月の分
      supabase.from("change_requests").select("*").or(`status.eq.pending,and(date.gte.${first},date.lte.${last})`).order("created_at", { ascending: false }),
      supabase.from("month_quotas").select("*").eq("month", mk).maybeSingle(),
    ]);
    const err = [stores, staff, staffStores, requests, daySettings, pubs, profiles, ann, logs, monthSet, changes, quota].find((r) => r.error)?.error;
    if (err) return setError(err.message);
    setError(null);
    setRaw({
      stores: stores.data, staff: staff.data, staffStores: staffStores.data, requests: requests.data,
      daySettings: daySettings.data, pubs: pubs.data, profiles: profiles.data, announcements: ann.data, logs: logs.data,
      monthSettings: monthSet.data, changes: changes.data, employeeDaysOff: quota.data?.employee_days_off ?? null,
    });
  }, [first, last, mk]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    window.addEventListener("shift-refresh", reload);
    return () => window.removeEventListener("shift-refresh", reload);
  }, [reload]);
  useEffect(() => {
    const ch = supabase.channel("shift-changes");
    for (const t of ["requests", "day_settings", "publications", "staff", "staff_stores", "stores", "profiles", "announcements", "work_logs", "month_settings", "change_requests", "month_quotas"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => reload());
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  const view = useMemo(() => {
    if (!raw) return null;
    const store = raw.stores.find((s) => s.id === storeId) || raw.stores[0];
    if (!store) return { ...raw, store: null };
    const windows = { ...DEFAULT_WINDOWS, ...(store.windows || {}) };
    const membership = {}; // staff_id -> Set(store_id)
    for (const m of raw.staffStores) (membership[m.staff_id] ||= new Set()).add(m.store_id);
    const staffInStore = raw.staff.filter((s) => membership[s.id]?.has(store.id));

    const requestsAll = {}; // staff_id -> date -> [rows across stores]
    const requests = {};    // staff_id -> date -> row (this store)
    for (const r of raw.requests) {
      ((requestsAll[r.staff_id] ||= {})[r.date] ||= []).push(r);
      if (r.store_id === store.id) (requests[r.staff_id] ||= {})[r.date] = r;
    }
    const daySet = Object.fromEntries(raw.daySettings.filter((d) => d.store_id === store.id).map((d) => [d.date, d]));
    const holidays = new Set(store.holidays || []);
    const defaultType = (day) => (day.w === 0 || day.w === 6 || holidays.has(day.k) || holidayName(day.k) ? "holiday" : "weekday");
    const typeOf = (day) => daySet[day.k]?.day_type || defaultType(day);
    const isHoliday = (day) => typeOf(day) !== "weekday";
    const ruleFor = (day) => ({ ...DEFAULT_RULE, ...(store.rules?.[typeOf(day)] || store.rules?.weekday || {}) });
    const isRecruit = (k) => !!daySet[k]?.recruit;
    // 定休日: 日ごとの設定があればそれ、なければ店舗の毎週の定休日
    const closedWeekdays = new Set(store.closed_weekdays || []);
    const defaultClosed = (day) => closedWeekdays.has(day.w);
    const isClosed = (day) => daySet[day.k]?.closed ?? defaultClosed(day);
    const published = raw.pubs.some((p) => p.store_id === store.id);
    // 締切: この日の終わりまで入力できる。過ぎたら募集中の日以外は変更依頼で受け付ける
    const deadline = raw.monthSettings.find((m) => m.store_id === store.id)?.deadline || null;
    const t = new Date();
    const deadlinePassed = !!deadline && dkey(t.getFullYear(), t.getMonth(), t.getDate()) > deadline;
    const isLocked = (day) => deadlinePassed && !isRecruit(day.k);
    const logs = Object.fromEntries(raw.logs.map((l) => [l.request_id, l]));
    // 実働: 個別入力があればそれ、なければその日の営業時間（一括入力）から計算
    // （全店舗表示でも使うので、希望の店舗の設定で計算する）
    const hoursAll = Object.fromEntries(raw.daySettings.filter((d) => d.work_hours).map((d) => [`${d.store_id}|${d.date}`, d.work_hours]));
    const dayHours = (k) => hoursAll[`${store.id}|${k}`] || null;
    const windowsOf = (sid) => ({ ...DEFAULT_WINDOWS, ...(raw.stores.find((s) => s.id === sid)?.windows || {}) });
    const workOf = (r) => {
      const w = autoWork(r, hoursAll[`${r.store_id}|${r.date}`], windowsOf(r.store_id), logs[r.id]);
      return w && logs[r.id] ? { ...w, individual: true } : w;
    };

    // 枠ごとの人数と、出勤の中のデリバリーだけ・厨房だけ・両方できる人・仕込みができる人の数
    const counts = {};
    for (const day of days) {
      const c = counts[day.k] = {};
      for (const p of ["prep", "lunch", "dinner"]) c[p] = { n: 0, pending: 0, onlyDelivery: 0, onlyKitchen: 0, both: 0, prepper: 0 };
      for (const s of staffInStore) {
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
    return { ...raw, store, windows, membership, staffInStore, requests, requestsAll, daySet, defaultType, typeOf, isHoliday, ruleFor, isRecruit, defaultClosed, isClosed, published, deadline, deadlinePassed, isLocked, counts, logs, dayHours, workOf };
  }, [raw, days, storeId]);

  return { data: view, days, mk, error, reload };
}

// ---------- 書き込み ----------
const check = ({ error }) => {
  if (error) { alert(error.message); throw error; }
  window.dispatchEvent(new Event("shift-refresh"));
};

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
    const orig = r.desired || { type: r.type, parts: r.parts, start_time: r.start_time, end_time: r.end_time };
    const t = (x) => (x ? x.slice(0, 5) : null);
    const same = orig.type === slot.type && [...(orig.parts || [])].sort().join() === [...(slot.parts || [])].sort().join()
      && t(orig.start_time) === t(slot.start_time) && t(orig.end_time) === t(slot.end_time);
    check(await supabase.from("requests").update({ ...slot, status: "approved", desired: same ? null : orig }).eq("id", r.id));
  },
  // 戻す: 枠を変えていたら元の希望に戻して未定にする
  async resetRequest(r) {
    check(await supabase.from("requests").update(r.desired ? { ...r.desired, desired: null, status: "pending" } : { status: "pending" }).eq("id", r.id));
  },
  // 日ごとの設定・公開
  async setDayType(storeId, date, day_type) { check(await supabase.from("day_settings").upsert({ store_id: storeId, date, day_type }, { onConflict: "store_id,date" })); },
  // 締切（null で解除）
  // 社員の休みの日数（null で解除）
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
    check(await supabase.from("change_requests").insert(rows));
  },
  async withdrawChangeRequest(id) { check(await supabase.from("change_requests").delete().eq("id", id)); },
  // 承諾: 希望に反映してから依頼を「承諾」にする
  async approveChangeRequest(c) {
    if (c.action === "remove") {
      check(await supabase.from("requests").delete().eq("staff_id", c.staff_id).eq("store_id", c.store_id).eq("date", c.date));
    } else {
      check(await supabase.from("requests").upsert({
        staff_id: c.staff_id, store_id: c.store_id, date: c.date, type: c.type, parts: c.parts,
        start_time: c.start_time, end_time: c.end_time, status: "approved", desired: null,
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
  async addStore(name, sort_order) { check(await supabase.from("stores").insert({ name, sort_order })); },
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
  async deactivateStaff(id) { check(await supabase.from("staff").update({ active: false, profile_id: null }).eq("id", id)); },
  async setRole(profileId, role) { check(await supabase.from("profiles").update({ role }).eq("id", profileId)); },
  // LINE連携の解除（アカウントを削除。名簿と過去のデータは残る）
  async unlinkLine(profileId) {
    const { data, error } = await supabase.functions.invoke("unlink-line", { body: { profile_id: profileId } });
    let msg = error ? error.message : data?.error;
    if (error?.context?.json) { try { msg = (await error.context.json()).error || msg; } catch { /* 本文なし */ } }
    check({ error: msg ? { message: msg } : null });
  },
  // お知らせ
  async postAnnouncement(row) { check(await supabase.from("announcements").insert(row)); },
  async updateAnnouncement(id, patch) { check(await supabase.from("announcements").update(patch).eq("id", id)); },
  async deleteAnnouncement(id) { check(await supabase.from("announcements").delete().eq("id", id)); },
  async markAnnouncementsRead(profileId) { check(await supabase.from("profiles").update({ announcements_read_at: new Date().toISOString() }).eq("id", profileId)); },
  // 実働時間
  async setDayWork(storeId, date, work_hours, delivery) { check(await supabase.from("day_settings").upsert({ store_id: storeId, date, work_hours, delivery }, { onConflict: "store_id,date" })); },
  async upsertWorkLog(row) { check(await supabase.from("work_logs").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "request_id" })); },
  async deleteWorkLog(requestId) { check(await supabase.from("work_logs").delete().eq("request_id", requestId)); },
};
