// LINEログイン → Supabase セッション発行
// 1. フロントから認可コードを受け取る
// 2. LINE にコードを渡してIDトークンを取得し、LINE の verify エンドポイントで検証
// 3. LINEユーザーIDに対応する Supabase ユーザーを作成／取得
// 4. マジックリンクのトークンを生成して返す（フロントが verifyOtp でセッションにする）

import { createClient } from "npm:@supabase/supabase-js@2";

const LINE_CHANNEL_ID = Deno.env.get("LINE_CHANNEL_ID")!;
const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")!;
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
    const { code, redirect_uri } = await req.json();
    if (!code || !redirect_uri) return json({ error: "code と redirect_uri が必要です" }, 400);

    // --- LINE: コードをトークンに交換 ---
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri,
        client_id: LINE_CHANNEL_ID,
        client_secret: LINE_CHANNEL_SECRET,
      }),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.id_token) return json({ error: "LINEのトークン取得に失敗", detail: token }, 401);

    // --- LINE: IDトークンを検証（署名検証はLINE側で行う） ---
    const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: token.id_token, client_id: LINE_CHANNEL_ID }),
    });
    const claims = await verifyRes.json();
    if (!verifyRes.ok || !claims.sub) return json({ error: "LINEのIDトークン検証に失敗", detail: claims }, 401);

    const lineUserId: string = claims.sub;
    const displayName: string = claims.name ?? "LINEユーザー";
    const pictureUrl: string | null = claims.picture ?? null;
    const email = `${lineUserId.toLowerCase()}@line.local`; // LINEはメールを返さないので識別用の擬似アドレス

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // --- 既存プロフィールを探す ---
    const { data: existing } = await admin.from("profiles").select("id").eq("line_user_id", lineUserId).maybeSingle();

    if (existing) {
      await admin.from("profiles").update({ display_name: displayName, picture_url: pictureUrl }).eq("id", existing.id);
    } else {
      // 初回ログイン: ユーザー作成。最初にログインした人を管理者にする
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { line_user_id: lineUserId, display_name: displayName },
      });
      if (cErr || !created.user) return json({ error: "ユーザー作成に失敗", detail: cErr?.message }, 500);

      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true });
      const role = (count ?? 0) === 0 ? "manager" : "pending";
      const { error: pErr } = await admin.from("profiles").insert({
        id: created.user.id,
        line_user_id: lineUserId,
        display_name: displayName,
        picture_url: pictureUrl,
        role,
      });
      if (pErr) return json({ error: "プロフィール作成に失敗", detail: pErr.message }, 500);
    }

    // --- セッション用トークンを発行 ---
    const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (lErr || !link.properties?.hashed_token) return json({ error: "セッション発行に失敗", detail: lErr?.message }, 500);

    return json({ token_hash: link.properties.hashed_token });
  } catch (e) {
    return json({ error: "予期しないエラー", detail: String(e) }, 500);
  }
});
