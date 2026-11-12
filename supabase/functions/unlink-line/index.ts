// LINE連携の解除（退職者など）: 管理者だけが呼べる
// 対象の Supabase ユーザーを削除する → profiles は連鎖削除、staff.profile_id は null になる
// 名簿（staff）と過去の希望・実働はそのまま残る。本人が再度LINEでログインすると「登録待ち」の新規ユーザーになる

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // 呼び出した人が管理者か確認
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: me, error: meErr } = await admin.auth.getUser(jwt);
    if (meErr || !me.user) return json({ error: "ログインが必要です" }, 401);
    const { data: caller } = await admin.from("profiles").select("role").eq("id", me.user.id).maybeSingle();
    if (caller?.role !== "manager") return json({ error: "管理者だけが解除できます" }, 403);

    const { profile_id } = await req.json();
    if (!profile_id) return json({ error: "profile_id が必要です" }, 400);
    if (profile_id === me.user.id) return json({ error: "自分自身の連携は解除できません" }, 400);

    const { data: target } = await admin.from("profiles").select("role").eq("id", profile_id).maybeSingle();
    if (!target) return json({ error: "対象のユーザーが見つかりません" }, 404);

    const { error: dErr } = await admin.auth.admin.deleteUser(profile_id);
    if (dErr) return json({ error: "解除に失敗しました", detail: dErr.message }, 500);
    return json({ ok: true });
  } catch (e) {
    return json({ error: "予期しないエラー", detail: String(e) }, 500);
  }
});
