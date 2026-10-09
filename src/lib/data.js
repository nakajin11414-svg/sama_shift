import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase.js";
import { covers, mkey, monthDays, DEFAULT_WINDOWS } from "./util.js";

// 月と店舗ごとのデータをまとめて取得し、変更があれば自動で再取得する
export function useShiftData(ym, storeId) {
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const mk = mkey(ym.y, ym.m);
  const days = useMemo(() => monthDays(ym.y, ym.m), [ym]);
  const first = days[0].k, last = days[days.length - 1].k;

  const reload = useCallback(async () => {
    const [stores, staff, staffStores, requests, daySettings, pubs, profiles, ann, logs] = await Promise.all([
      supabase.from("stores").select("*").order("sort_order").order("created_at"),
      supabase.from("staff").select("*").eq("active", true).order("sort_order").order("created_at"),
      supabase.from("staff_stores").select("*"),
      supabase.from("requests").select("*").gte("date", first).lte("date", last), // 全店舗分（店舗横断の表示に使う）
      supabase.from("day_settings").select("*").gte("date", first).lte("date", last),
      supabase.from("publications").select("*").eq("month", mk),
      supabase.from("profiles").select("id, display_name, picture_url, role, announcements_read_at"),
      supabase.from("announcements").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100),
      supabase.from("work_logs").select("*"),
    ]);
    const err = [stores, staff, staffStores, requests, daySettings, pubs, profiles, ann, logs].find((r) => r.error)?.error;
    if (err) return setError(err.message);
    setError(null);
    setRaw({
      stores: stores.data, staff: staff.data, staffStores: staffStores.data, requests: requests.data,
      daySettings: daySettings.data, pubs: pubs.data, profiles: profiles.data, announcements: ann.data, logs: logs.data,
    });
  }, [first, last, mk]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    window.addEventListener("shift-refresh", reload);
    return () => window.removeEventListener("shift-refresh", reload);
  }, [reload]);
  useEffect(() => {
    const ch = supabase.channel("shift-changes");
    for (const t of ["requests", "day_settings", "publications", "staff", "staff_stores", "stores", "profiles", "announcements", "work_logs"]) {
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
    const defaultType = (day) => (day.w === 0 || day.w === 6 || holidays.has(day.k) ? "holiday" : "weekday");
    const typeOf = (day) => daySet[day.k]?.day_type || defaultType(day);
    const isHoliday = (day) => typeOf(day) !== "weekday";
    const ruleFor = (day) => ({ prep: 0, lunch: 0, dinner: 0, ...(store.rules?.[typeOf(day)] || store.rules?.weekday || {}) });
    const isRecruit = (k) => !!daySet[k]?.recruit;
    const published = raw.pubs.some((p) => p.store_id === store.id);
    const logs = Object.fromEntries(raw.logs.map((l) => [l.request_id, l]));

    // 枠ごとの人数と、デリバリー・厨房の有無
    const counts = {};
    for (const day of days) {
      const c = counts[day.k] = {};
      for (const p of ["prep", "lunch", "dinner"]) c[p] = { n: 0, pending: 0, delivery: false, kitchen: false };
      for (const s of staffInStore) {
        const r = requests[s.id]?.[day.k];
        if (!r || r.status === "rejected") continue;
        for (const p of ["prep", "lunch", "dinner"]) {
          if (!covers(r, p, windows)) continue;
          if (r.status === "approved") {
            c[p].n++;
            if (s.can_delivery) c[p].delivery = true;
            if (s.can_kitchen) c[p].kitchen = true;
          } else c[p].pending++;
        }
      }
    }
    return { ...raw, store, windows, membership, staffInStore, requests, requestsAll, daySet, defaultType, typeOf, isHoliday, ruleFor, isRecruit, published, counts, logs };
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
      ...(status ? { status } : {}),
    }));
    check(await supabase.from("requests").upsert(rows, { onConflict: "staff_id,date,store_id" }));
  },
  async deleteRequests(staffId, storeId, dates) {
    check(await supabase.from("requests").delete().eq("staff_id", staffId).eq("store_id", storeId).in("date", dates));
  },
  async setStatus(id, status) { check(await supabase.from("requests").update({ status }).eq("id", id)); },
  // 日ごとの設定・公開
  async setDayType(storeId, date, day_type) { check(await supabase.from("day_settings").upsert({ store_id: storeId, date, day_type }, { onConflict: "store_id,date" })); },
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
  // お知らせ
  async postAnnouncement(row) { check(await supabase.from("announcements").insert(row)); },
  async updateAnnouncement(id, patch) { check(await supabase.from("announcements").update(patch).eq("id", id)); },
  async deleteAnnouncement(id) { check(await supabase.from("announcements").delete().eq("id", id)); },
  async markAnnouncementsRead(profileId) { check(await supabase.from("profiles").update({ announcements_read_at: new Date().toISOString() }).eq("id", profileId)); },
  // 実働時間
  async upsertWorkLog(row) { check(await supabase.from("work_logs").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "request_id" })); },
  async deleteWorkLog(requestId) { check(await supabase.from("work_logs").delete().eq("request_id", requestId)); },
};
