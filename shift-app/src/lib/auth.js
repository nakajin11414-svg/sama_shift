import { supabase, LINE_CHANNEL_ID, REDIRECT_URI } from "./supabase.js";

// LINEのログイン画面へ
export function startLineLogin() {
  const state = crypto.randomUUID();
  sessionStorage.setItem("line_state", state);
  const u = new URL("https://access.line.me/oauth2/v2.1/authorize");
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: LINE_CHANNEL_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: "profile openid",
    bot_prompt: "normal",
  }).toString();
  window.location.href = u.toString();
}

// /callback で呼ぶ: コードをEdge Functionに渡してセッションにする
export async function finishLineLogin() {
  const p = new URLSearchParams(window.location.search);
  const code = p.get("code");
  const state = p.get("state");
  if (p.get("error")) throw new Error(p.get("error_description") || "LINEログインがキャンセルされました");
  if (!code || state !== sessionStorage.getItem("line_state")) throw new Error("ログイン状態を確認できませんでした。もう一度お試しください。");
  sessionStorage.removeItem("line_state");

  const { data, error } = await supabase.functions.invoke("line-login", { body: { code, redirect_uri: REDIRECT_URI } });
  if (error) throw new Error(error.message);
  if (!data?.token_hash) throw new Error(data?.error || "ログインに失敗しました");

  const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
  if (vErr) throw new Error(vErr.message);
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "/";
}
