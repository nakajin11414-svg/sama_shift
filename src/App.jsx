import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";
import { finishLineLogin, signOut, startLineLogin } from "./lib/auth.js";
import { useShiftData } from "./lib/data.js";
import { NAVY } from "./lib/util.js";
import { Btn } from "./ui.jsx";
import StaffView from "./views/Staff.jsx";
import ManagerView from "./views/Manager.jsx";
import PublishedView from "./views/Published.jsx";

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const isCallback = window.location.pathname === "/callback";

  useEffect(() => {
    if (isCallback) {
      finishLineLogin()
        .then(() => window.location.replace("/"))
        .catch((e) => setLoginError(e.message));
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [isCallback]);

  useEffect(() => {
    if (!session) return setProfile(null);
    supabase.from("profiles").select("*").eq("id", session.user.id).single().then(({ data }) => setProfile(data));
    const ch = supabase.channel("me").on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${session.user.id}` },
      (p) => setProfile(p.new)).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session]);

  if (isCallback) return <Center>{loginError ? <><p className="mb-3">{loginError}</p><Btn tone="primary" onClick={() => window.location.replace("/")}>戻る</Btn></> : "ログイン中…"}</Center>;
  if (session === undefined) return <Center>読み込み中…</Center>;
  if (!session) return <Login />;
  if (!profile) return <Center>読み込み中…</Center>;
  return <Shell profile={profile} />;
}

function Center({ children }) {
  return <div className="min-h-screen flex items-center justify-center p-6 text-sm text-center" style={{ background: "#EEF1F3", color: NAVY }}><div>{children}</div></div>;
}

function Login() {
  return (
    <Center>
      <div className="text-2xl font-semibold mb-2">シフト表</div>
      <p className="mb-6 opacity-70">LINEアカウントでログインして、希望の入力や確定シフトの確認ができます。</p>
      <button onClick={startLineLogin} className="px-6 py-3 rounded text-white font-medium" style={{ background: "#06C755" }}>LINEでログイン</button>
    </Center>
  );
}

function Shell({ profile }) {
  const [mode, setMode] = useState(profile.role === "manager" ? "manager" : "staff");
  const [ym, setYm] = useState(() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() }; });
  const { data, days, mk, error } = useShiftData(ym);
  const shift = (n) => setYm(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const isManager = profile.role === "manager";
  const tabs = [["staff", "希望入力"], ...(isManager ? [["manager", "管理者"]] : []), ["published", "確定シフト"]];

  return (
    <div style={{ color: NAVY, background: "#EEF1F3", minHeight: "100vh" }}>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ background: NAVY, color: "#EEF1F3" }}>
        <div className="text-lg font-semibold tracking-wide">シフト表</div>
        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => shift(-1)} className="px-2 py-1 rounded hover:bg-white/10">‹</button>
          <span className="tabular-nums w-24 text-center">{ym.y}年{ym.m + 1}月</span>
          <button onClick={() => shift(1)} className="px-2 py-1 rounded hover:bg-white/10">›</button>
          {data?.published && <span className="text-xs px-2 py-0.5 rounded" style={{ background: "#8FBFA6", color: "#0F3A24" }}>公開中</span>}
        </div>
        <nav className="ml-auto flex rounded overflow-hidden" style={{ border: "1px solid #EEF1F3" }}>
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className="px-3 py-1 text-sm" style={mode === k ? { background: "#EEF1F3", color: NAVY } : {}}>{l}</button>
          ))}
        </nav>
        <div className="flex items-center gap-2 text-xs">
          {profile.picture_url && <img src={profile.picture_url} alt="" className="w-6 h-6 rounded-full" />}
          <span>{profile.display_name}</span>
          <button onClick={signOut} className="underline opacity-70">ログアウト</button>
        </div>
      </header>

      {error && <div className="px-4 py-2 text-sm" style={{ background: "#F7C6C6", color: "#7A1E1E" }}>読み込みエラー: {error}</div>}
      {!data ? <div className="p-6 text-sm">読み込み中…</div>
        : mode === "staff" ? <StaffView data={data} days={days} profile={profile} />
        : mode === "manager" && isManager ? <ManagerView data={data} days={days} mk={mk} profile={profile} />
        : <PublishedView data={data} days={days} mk={mk} isManager={isManager} />}
    </div>
  );
}
