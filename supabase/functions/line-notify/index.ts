// LINE公式アカウント（Messaging API）からLINEに通知を送る
// ■ スタッフ宛て（管理者だけが呼べる）
//   kind: "announcement" { announcement_id } … お知らせを宛先の店舗のスタッフ（店舗なしなら全員）に送る
//   kind: "publish" { store_id, month }      … シフト公開をその店舗のスタッフに知らせる
//   kind: "recruit" { store_id, month, lines? } … その月の募集中の日（今日以降）をその店舗のスタッフに知らせる
//                                              lines = 「11/3(月) ディナーあと1人」のような行（なければ日付だけ）
//   kind: "check" {}                         … 送らずに友だち追加の状況だけ確認する
// ■ 管理者宛て（スタッフ本人が呼ぶ。管理者通知を受け取る設定の管理者に送る。呼んだ本人には送らない）
//   kind: "change_request" { ids }           … 送った変更依頼（本人のもの・確認待ちのみ）を知らせる
//   kind: "recruit_wish" { store_id, dates } … 募集中の日に入れた希望（本人のもの）を知らせる
// 友だち追加していない人には送れないので、プロフィール取得（404 = 未追加）で確認してから送る
// Secrets: LINE_MESSAGING_TOKEN（必須・チャネルアクセストークン）、APP_URL（任意・本文の最後に付ける）

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LINE_TOKEN = Deno.env.get("LINE_MESSAGING_TOKEN") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Target = { name: string; profile_id: string; line_user_id: string };

// 表示用（src/lib/util.js の slotText・fmt と同じ表記）
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const fmtDate = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return `${m}/${d}(${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
};
const PART_LABEL: Record<string, string> = { prep: "仕込み", lunch: "ランチ", dinner: "ディナー" };
// deno-lint-ignore no-explicit-any
const slotText = (r: any) =>
  r.type === "off" ? "休み希望" : r.type === "office" ? "事務"
  : r.type === "custom" ? `${String(r.start_time ?? "").slice(0, 5)}〜${String(r.end_time ?? "").slice(0, 5)}`
  : ["prep", "lunch", "dinner"].filter((p) => (r.parts ?? []).includes(p)).map((p) => PART_LABEL[p]).join("＋").replace("ランチ＋ディナー", "通し") || "？";
// 日本時間の今日 "YYYY-MM-DD"
const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const MANAGER_KINDS = ["announcement", "publish", "recruit", "check"];
const STAFF_KINDS = ["change_request", "recruit_wish"];

// 友だち追加しているか（プロフィールが取れれば追加済み、404 なら未追加・ブロック）
async function isFriend(userId: string): Promise<boolean> {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${LINE_TOKEN}` },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`LINEのプロフィール取得に失敗しました（${res.status}）: ${await res.text()}`);
  return true;
}

async function multicast(to: string[], text: string) {
  for (let i = 0; i < to.length; i += 500) {
    const res = await fetch("https://api.line.me/v2/bot/message/multicast", {
      method: "POST",
      headers: { Authorization: `Bearer ${LINE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: to.slice(i, i + 500), messages: [{ type: "text", text }] }),
    });
    if (!res.ok) throw new Error(`LINEの送信に失敗しました（${res.status}）: ${await res.text()}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // 呼び出した人を確認（スタッフ宛ての通知は管理者だけ、管理者宛ての通知はスタッフ本人も呼べる）
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: me, error: meErr } = await admin.auth.getUser(jwt);
    if (meErr || !me.user) return json({ error: "ログインが必要です" }, 401);
    const { data: caller } = await admin.from("profiles").select("role").eq("id", me.user.id).maybeSingle();

    const body = await req.json().catch(() => ({}));
    const kind = body.kind as string;
    if (!MANAGER_KINDS.includes(kind) && !STAFF_KINDS.includes(kind)) return json({ error: "kind が正しくありません" }, 400);
    if (MANAGER_KINDS.includes(kind) && caller?.role !== "manager") return json({ error: "管理者だけが送信できます" }, 403);
    if (STAFF_KINDS.includes(kind) && !["staff", "manager"].includes(caller?.role ?? "")) return json({ error: "スタッフ登録が必要です" }, 403);

    if (!LINE_TOKEN) return json({ error: "LINE_MESSAGING_TOKEN が設定されていません" }, 500);

    // 宛先（"staff" = 店舗のスタッフ（storeId が null なら全員） / "managers" = 管理者）と本文
    let audience: "staff" | "managers" = "staff";
    let storeId: string | null = null;
    let text = "";
    let announcementId: string | null = null;
    const storeNameOf = async (id: string) => (await admin.from("stores").select("name").eq("id", id).maybeSingle()).data?.name as string | undefined;
    // スタッフ宛ての通知を呼んだ本人の名簿（管理者宛ての通知で使う）
    const myStaff = async () => (await admin.from("staff").select("id, name").eq("profile_id", me.user!.id).maybeSingle()).data;

    if (kind === "change_request") {
      audience = "managers";
      const ids = Array.isArray(body.ids) ? body.ids.slice(0, 100) : [];
      if (!ids.length) return json({ error: "ids が必要です" }, 400);
      const st = await myStaff();
      if (!st) return json({ error: "名簿に登録されていません" }, 403);
      const { data: rows, error } = await admin.from("change_requests").select("*").in("id", ids).eq("staff_id", st.id).eq("status", "pending").order("date");
      if (error) return json({ error: "変更依頼の取得に失敗しました", detail: error.message }, 500);
      if (!rows?.length) return json({ ok: true, sent: 0, not_friend: [] });
      const sName = (await storeNameOf(rows[0].store_id)) ?? "";
      const lines = rows.map((c) => `${fmtDate(c.date)} ${c.action === "remove" ? "取り消し" : slotText(c)}${c.reason ? `（${c.reason}）` : ""}`);
      text = `【変更依頼】${sName} ${st.name}さん\n${lines.join("\n")}\n\n「管理者 → 変更依頼」で承諾・却下してください。`;
    } else if (kind === "recruit_wish") {
      audience = "managers";
      const dates = Array.isArray(body.dates) ? body.dates.slice(0, 62) : [];
      if (!body.store_id || !dates.length) return json({ error: "store_id と dates が必要です" }, 400);
      const st = await myStaff();
      if (!st) return json({ error: "名簿に登録されていません" }, 403);
      // 募集中の日に入っている本人の出勤希望だけ
      const [{ data: reqs, error: e1 }, { data: rec, error: e2 }] = await Promise.all([
        admin.from("requests").select("*").eq("staff_id", st.id).eq("store_id", body.store_id).in("date", dates).neq("type", "off").order("date"),
        admin.from("day_settings").select("date").eq("store_id", body.store_id).eq("recruit", true).in("date", dates),
      ]);
      if (e1 || e2) return json({ error: "希望の取得に失敗しました", detail: (e1 ?? e2)!.message }, 500);
      const recDates = new Set((rec ?? []).map((d) => d.date));
      const rows = (reqs ?? []).filter((r) => recDates.has(r.date));
      if (!rows.length) return json({ ok: true, sent: 0, not_friend: [] });
      const sName = (await storeNameOf(body.store_id)) ?? "";
      text = `【募集への希望】${sName} ${st.name}さん\n${rows.map((r) => `${fmtDate(r.date)} ${slotText(r)}`).join("\n")}\n\n「シフト管理」で出勤・休みを決めてください。`;
    } else if (kind === "recruit") {
      if (!body.store_id || !body.month) return json({ error: "store_id と month が必要です" }, 400);
      const sName = await storeNameOf(body.store_id);
      if (!sName) return json({ error: "店舗が見つかりません" }, 404);
      const [y, m] = String(body.month).split("-").map(Number);
      const first = `${body.month}-01`, last = `${body.month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      const from = todayJst() > first ? todayJst() : first;
      const { data: rec, error } = await admin.from("day_settings").select("date").eq("store_id", body.store_id).eq("recruit", true).gte("date", from).lte("date", last).order("date");
      if (error) return json({ error: "募集の取得に失敗しました", detail: error.message }, 500);
      if (!rec?.length) return json({ error: `${sName} の ${y}年${m}月に、今日以降の募集中の日がありません` }, 400);
      const lines: string[] = Array.isArray(body.lines) && body.lines.length
        ? body.lines.slice(0, 31).map((l: unknown) => String(l).slice(0, 80))
        : rec.map((d) => fmtDate(d.date));
      storeId = body.store_id;
      text = `【募集】${sName} で人が足りない日があります。入れる人は希望を出してください（締切後でも入力できます）。\n${lines.join("\n")}`;
    } else if (kind === "announcement") {
      if (!body.announcement_id) return json({ error: "announcement_id が必要です" }, 400);
      const { data: a, error } = await admin.from("announcements").select("id, title, body, store_id, attachments").eq("id", body.announcement_id).maybeSingle();
      if (error) return json({ error: "お知らせの取得に失敗しました", detail: error.message }, 500);
      if (!a) return json({ error: "お知らせが見つかりません" }, 404);
      announcementId = a.id;
      storeId = a.store_id;
      const b = (a.body ?? "").trim();
      text = `【お知らせ】${a.title}${b ? `\n\n${b.length > 300 ? `${b.slice(0, 300)}…` : b}` : ""}`;
      // 画像・動画はLINEには送らず、アプリで見てもらう
      const media = Array.isArray(a.attachments) ? a.attachments : [];
      if (media.length) {
        const nImg = media.filter((m: { type?: string }) => m.type !== "video").length, nVid = media.length - nImg;
        text += `\n\n（${[nImg && `画像${nImg}件`, nVid && `動画${nVid}件`].filter(Boolean).join("・")}があります。アプリのお知らせで確認してください）`;
      }
    } else if (kind === "publish") {
      if (!body.store_id || !body.month) return json({ error: "store_id と month が必要です" }, 400);
      const { data: st } = await admin.from("stores").select("name").eq("id", body.store_id).maybeSingle();
      if (!st) return json({ error: "店舗が見つかりません" }, 404);
      const [y, m] = String(body.month).split("-").map(Number);
      storeId = body.store_id;
      text = `【シフト公開】${st.name} ${y}年${m}月分のシフトが公開されました。確定シフトを確認してください。`;
    }
    if (text && APP_URL) text += `\n${APP_URL}`;

    let targets: Target[] = [];
    if (audience === "managers") {
      // 宛先: 管理者通知を受け取る設定の管理者（呼んだ本人は除く）
      const { data: mgrs, error } = await admin.from("profiles").select("id, display_name, line_user_id")
        .eq("role", "manager").eq("notify_manager", true).neq("id", me.user.id);
      if (error) return json({ error: "管理者の取得に失敗しました", detail: error.message }, 500);
      targets = (mgrs ?? []).filter((p) => p.line_user_id).map((p) => ({ name: p.display_name, profile_id: p.id, line_user_id: p.line_user_id }));
    } else {
      // 宛先: 在籍中で LINE 連携済みのスタッフ（店舗の指定があればその店舗の所属のみ）
      let q = admin.from("staff").select("id, name, profile_id").eq("active", true).not("profile_id", "is", null);
      if (storeId) {
        const { data: ms, error } = await admin.from("staff_stores").select("staff_id").eq("store_id", storeId);
        if (error) return json({ error: "所属の取得に失敗しました", detail: error.message }, 500);
        const ids = (ms ?? []).map((m) => m.staff_id);
        if (!ids.length) return json(kind === "check" ? { ok: true, checked: 0, friends: 0, not_friend: [] } : { ok: true, sent: 0, not_friend: [] });
        q = q.in("id", ids);
      }
      const { data: staff, error: sErr } = await q;
      if (sErr) return json({ error: "名簿の取得に失敗しました", detail: sErr.message }, 500);
      const pids = (staff ?? []).map((s) => s.profile_id as string);
      const { data: profs, error: pErr } = pids.length
        ? await admin.from("profiles").select("id, line_user_id").in("id", pids)
        : { data: [], error: null };
      if (pErr) return json({ error: "プロフィールの取得に失敗しました", detail: pErr.message }, 500);
      const lineOf = Object.fromEntries((profs ?? []).map((p) => [p.id, p.line_user_id]));
      targets = (staff ?? [])
        .filter((s) => lineOf[s.profile_id as string])
        .map((s) => ({ name: s.name, profile_id: s.profile_id as string, line_user_id: lineOf[s.profile_id as string] }));
    }

    // 友だち追加の確認と保存
    const now = new Date().toISOString();
    const friends: Target[] = [];
    const notFriend: Target[] = [];
    for (const t of targets) (await isFriend(t.line_user_id) ? friends : notFriend).push(t);
    const save = async (list: Target[], v: boolean) => {
      if (!list.length) return;
      const { error } = await admin.from("profiles").update({ line_friend: v, line_friend_checked_at: now }).in("id", list.map((t) => t.profile_id));
      if (error) throw new Error(`友だち状況の保存に失敗しました: ${error.message}`);
    };
    await save(friends, true);
    await save(notFriend, false);

    const notFriendNames = notFriend.map((t) => t.name);
    if (kind === "check") return json({ ok: true, checked: targets.length, friends: friends.length, not_friend: notFriendNames });

    // 同じLINEアカウントに2回送らないように重複を除く
    const to = [...new Set(friends.map((t) => t.line_user_id))];
    if (to.length) await multicast(to, text);
    if (announcementId) {
      const { error } = await admin.from("announcements").update({ notified_at: now }).eq("id", announcementId);
      if (error) return json({ error: "送信しましたが、送信日時の保存に失敗しました", detail: error.message }, 500);
    }
    // スタッフが呼んだとき（管理者宛て）は、届かなかった管理者の名前は返さない
    return json({ ok: true, sent: to.length, not_friend: audience === "managers" && caller?.role !== "manager" ? [] : notFriendNames });
  } catch (e) {
    return json({ error: "予期しないエラー", detail: String(e) }, 500);
  }
});
