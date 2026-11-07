import { supabase, LINE_CHANNEL_ID, REDIRECT_URI } from "./supabase.js";

// 照合用の state はタブ共通の localStorage に置く（LINE内ブラウザが戻り先を別タブで開いても照合できるように）。10分で失効
const STATE_KEY = "line_state";
const STATE_TTL = 10 * 60 * 1000;

function saveState(state) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify({ state, at: Date.now() })); } catch { /* 保存できない環境では照合を省く */ }
}
function takeState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    localStorage.removeItem(STATE_KEY);
    const v = raw && JSON.parse(raw);
    return v && Date.now() - v.at < STATE_TTL ? v.state : null;
  } catch { return null; }
}

// LINEのログイン画面へ
export function startLineLogin() {
  const state = crypto.randomUUID();
  saveState(state);
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
  // 保存した state が残っていれば必ず一致を求める。消えていた場合だけ、コードの検証（1回限り・サーバーがLINEに照会）に任せて続行
  const saved = takeState();
  if (!code || (saved && state !== saved)) throw new Error("ログイン状態を確認できませんでした。もう一度お試しください。");

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
