import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase.js";
import { finishLineLogin, signOut, startLineLogin } from "./lib/auth.js";
import { useShiftData } from "./lib/data.js";
import { NAVY } from "./lib/util.js";
import { Btn } from "./ui.jsx";
import StaffView from "./views/Staff.jsx";
import ManagerView from "./views/Manager.jsx";
import PublishedView from "./views/Published.jsx";
import ManualView from "./views/Manual.jsx";

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
        <Menu profile={profile} isManager={isManager} onSelect={setMode} />
      </header>

      {error && <div className="px-4 py-2 text-sm" style={{ background: "#F7C6C6", color: "#7A1E1E" }}>読み込みエラー: {error}</div>}
      {!data ? <div className="p-6 text-sm">読み込み中…</div>
        : mode === "staff" ? <StaffView data={data} days={days} profile={profile} />
        : mode === "manager" && isManager ? <ManagerView data={data} days={days} mk={mk} profile={profile} />
        : mode === "manual-manager" && isManager ? <ManualView kind="manager" />
        : mode === "manual-staff" ? <ManualView kind="staff" />
        : <PublishedView data={data} days={days} mk={mk} isManager={isManager} />}
    </div>
  );
}

// 右上の三本線メニュー。項目を増やすときは items に追加する
function Menu({ profile, isManager, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, []);
  const items = [
    ...(isManager ? [{ label: "管理者マニュアル", action: () => onSelect("manual-manager") }] : []),
    { label: "スタッフの使い方", action: () => onSelect("manual-staff") },
    { label: "ログアウト", action: signOut, danger: true },
  ];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="メニュー" className="p-2 rounded hover:bg-white/10">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded bg-white shadow-lg z-20 text-sm" style={{ color: NAVY, border: "1px solid #D5DCE2" }}>
          <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ borderBottom: "1px solid #EEF1F3" }}>
            {profile.picture_url && <img src={profile.picture_url} alt="" className="w-6 h-6 rounded-full" />}
            <span className="truncate">{profile.display_name}</span>
            {isManager && <span className="ml-auto opacity-60">管理者</span>}
          </div>
          {items.map((it) => (
            <button key={it.label} onClick={() => { setOpen(false); it.action(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-100" style={it.danger ? { color: "#9B2C2C" } : {}}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
