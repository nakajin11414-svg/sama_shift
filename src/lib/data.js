import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase.js";
import { covers, mkey, monthDays } from "./util.js";

// 月ごとのデータをまとめて取得し、変更があれば自動で再取得する
export function useShiftData(ym) {
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const mk = mkey(ym.y, ym.m);
  const days = useMemo(() => monthDays(ym.y, ym.m), [ym]);
  const first = days[0].k, last = days[days.length - 1].k;

  const reload = useCallback(async () => {
    const [staff, requests, settings, daySettings, pub, profiles] = await Promise.all([
      supabase.from("staff").select("*").eq("active", true).order("sort_order").order("created_at"),
      supabase.from("requests").select("*").gte("date", first).lte("date", last),
      supabase.from("settings").select("*").eq("id", 1).single(),
      supabase.from("day_settings").select("*").gte("date", first).lte("date", last),
      supabase.from("publications").select("*").eq("month", mk).maybeSingle(),
      supabase.from("profiles").select("id, display_name, picture_url, role"), // 管理者以外は自分の分だけ返る
    ]);
    const err = [staff, requests, settings, daySettings, pub, profiles].find((r) => r.error)?.error;
    if (err) return setError(err.message);
    setError(null);
    setRaw({ staff: staff.data, requests: requests.data, settings: settings.data, daySettings: daySettings.data, published: !!pub.data, profiles: profiles.data });
  }, [first, last, mk]);

  useEffect(() => { reload(); }, [reload]);

  // 自分の書き込み直後は必ず再取得（Realtimeが無効でも画面が更新されるように）
  useEffect(() => {
    window.addEventListener("shift-refresh", reload);
    return () => window.removeEventListener("shift-refresh", reload);
  }, [reload]);

  useEffect(() => {
    const ch = supabase.channel("shift-changes");
    for (const t of ["requests", "day_settings", "publications", "staff", "settings", "profiles"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => reload());
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  const view = useMemo(() => {
    if (!raw) return null;
    const requests = {}; // staff_id -> date -> row
    for (const r of raw.requests) (requests[r.staff_id] ||= {})[r.date] = r;
    const daySet = Object.fromEntries(raw.daySettings.map((d) => [d.date, d]));
    const holidays = new Set(raw.settings.holidays);
    const defaultType = (day) => (day.w === 0 || day.w === 6 || holidays.has(day.k) ? "holiday" : "weekday");
    const typeOf = (day) => daySet[day.k]?.day_type || defaultType(day);
    const isHoliday = (day) => typeOf(day) !== "weekday";
    const ruleFor = (day) => raw.settings.rules[typeOf(day)] || raw.settings.rules.weekday;
    const isRecruit = (k) => !!daySet[k]?.recruit;
    const counts = {};
    for (const day of days) {
      counts[day.k] = { lunch: 0, dinner: 0, pLunch: 0, pDinner: 0 };
      for (const s of raw.staff) {
        const r = requests[s.id]?.[day.k];
        if (!r || r.status === "rejected") continue;
        const ap = r.status === "approved";
        if (covers(r, "lunch")) counts[day.k][ap ? "lunch" : "pLunch"]++;
        if (covers(r, "dinner")) counts[day.k][ap ? "dinner" : "pDinner"]++;
      }
    }
    return { ...raw, requests, daySet, defaultType, typeOf, isHoliday, ruleFor, isRecruit, counts };
  }, [raw, days]);

  return { data: view, days, mk, error, reload };
}

// ---------- 書き込み ----------
const check = ({ error }) => {
  if (error) { alert(error.message); throw error; }
  window.dispatchEvent(new Event("shift-refresh"));
};

export const api = {
  async upsertRequests(staffId, dates, type, start, end, status) {
    const rows = dates.map((date) => ({
      staff_id: staffId, date, type,
      start_time: type === "custom" ? start : null,
      end_time: type === "custom" ? end : null,
      ...(status ? { status } : {}), // 管理者のみ指定可（スタッフはトリガーで未承認に戻される）
    }));
    check(await supabase.from("requests").upsert(rows, { onConflict: "staff_id,date" }));
  },
  async deleteRequests(staffId, dates) {
    check(await supabase.from("requests").delete().eq("staff_id", staffId).in("date", dates));
  },
  async setStatus(id, status) {
    check(await supabase.from("requests").update({ status }).eq("id", id));
  },
  async setDayType(date, day_type) {
    check(await supabase.from("day_settings").upsert({ date, day_type }, { onConflict: "date" }));
  },
  async setRecruit(date, recruit) {
    check(await supabase.from("day_settings").upsert({ date, recruit }, { onConflict: "date" }));
  },
  async setPublished(month, on) {
    check(on
      ? await supabase.from("publications").upsert({ month })
      : await supabase.from("publications").delete().eq("month", month));
  },
  async setRules(rules) {
    check(await supabase.from("settings").update({ rules }).eq("id", 1));
  },
  async addStaff(name, sort_order, profile_id = null) {
    check(await supabase.from("staff").insert({ name, sort_order, profile_id }));
  },
  async updateStaff(id, patch) {
    check(await supabase.from("staff").update(patch).eq("id", id));
  },
  async deactivateStaff(id) {
    check(await supabase.from("staff").update({ active: false, profile_id: null }).eq("id", id));
  },
  async setRole(profileId, role) {
    check(await supabase.from("profiles").update({ role }).eq("id", profileId));
  },
};
