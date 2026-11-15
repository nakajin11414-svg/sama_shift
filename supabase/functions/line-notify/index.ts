// LINE公式アカウント（Messaging API）からスタッフのLINEに通知を送る: 管理者だけが呼べる
//   kind: "announcement" { announcement_id } … お知らせを宛先の店舗のスタッフ（店舗なしなら全員）に送る
//   kind: "publish" { store_id, month }      … シフト公開をその店舗のスタッフに知らせる
//   kind: "check" {}                         … 送らずに友だち追加の状況だけ確認する
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

    // 呼び出した人が管理者か確認
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: me, error: meErr } = await admin.auth.getUser(jwt);
    if (meErr || !me.user) return json({ error: "ログインが必要です" }, 401);
    const { data: caller } = await admin.from("profiles").select("role").eq("id", me.user.id).maybeSingle();
    if (caller?.role !== "manager") return json({ error: "管理者だけが送信できます" }, 403);

    if (!LINE_TOKEN) return json({ error: "LINE_MESSAGING_TOKEN が設定されていません" }, 500);

    const body = await req.json().catch(() => ({}));
    const kind = body.kind as string;

    // 宛先の店舗（null = 全スタッフ）と本文
    let storeId: string | null = null;
    let text = "";
    let announcementId: string | null = null;
    if (kind === "announcement") {
      if (!body.announcement_id) return json({ error: "announcement_id が必要です" }, 400);
      const { data: a, error } = await admin.from("announcements").select("id, title, body, store_id").eq("id", body.announcement_id).maybeSingle();
      if (error) return json({ error: "お知らせの取得に失敗しました", detail: error.message }, 500);
      if (!a) return json({ error: "お知らせが見つかりません" }, 404);
      announcementId = a.id;
      storeId = a.store_id;
      const b = (a.body ?? "").trim();
      text = `【お知らせ】${a.title}${b ? `\n\n${b.length > 300 ? `${b.slice(0, 300)}…` : b}` : ""}`;
    } else if (kind === "publish") {
      if (!body.store_id || !body.month) return json({ error: "store_id と month が必要です" }, 400);
      const { data: st } = await admin.from("stores").select("name").eq("id", body.store_id).maybeSingle();
      if (!st) return json({ error: "店舗が見つかりません" }, 404);
      const [y, m] = String(body.month).split("-").map(Number);
      storeId = body.store_id;
      text = `【シフト公開】${st.name} ${y}年${m}月分のシフトが公開されました。確定シフトを確認してください。`;
    } else if (kind !== "check") {
      return json({ error: "kind が正しくありません" }, 400);
    }
    if (text && APP_URL) text += `\n${APP_URL}`;

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
    const targets: Target[] = (staff ?? [])
      .filter((s) => lineOf[s.profile_id as string])
      .map((s) => ({ name: s.name, profile_id: s.profile_id as string, line_user_id: lineOf[s.profile_id as string] }));

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
    return json({ ok: true, sent: to.length, not_friend: notFriendNames });
  } catch (e) {
    return json({ error: "予期しないエラー", detail: String(e) }, 500);
  }
});
