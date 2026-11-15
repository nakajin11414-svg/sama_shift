import { useEffect, useState } from "react";
import { api, notifyResult } from "../lib/data.js";
import { NAVY, LINE, RED } from "../lib/util.js";
import { Btn, Card } from "../ui.jsx";

const MAX_MB = 50; // 1ファイルの上限（Storage のバケット設定と同じ）

// 画像・動画の表示（画像はタップで原寸を別タブで開く）
function Media({ items, urls, onRemove }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((m) => {
        const url = urls[m.path];
        return (
          <div key={m.path} className="relative rounded overflow-hidden" style={{ border: `1px solid ${LINE}`, background: "#F4F6F8" }}>
            {!url ? <div className="w-40 h-28 flex items-center justify-center text-xs opacity-60">読み込み中…</div>
              : m.type === "video" ? <video src={url} controls playsInline preload="metadata" className="block max-h-80 max-w-full" />
              : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={m.name || ""} loading="lazy" className="block max-h-64 max-w-full object-contain" /></a>}
            {onRemove && (
              <button onClick={() => onRemove(m)} title="外す" className="absolute top-1 right-1 w-6 h-6 rounded-full text-xs"
                style={{ background: "rgba(0,0,0,.6)", color: "#fff" }}>✕</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// お知らせ: 管理者が投稿、全員が閲覧
export default function AnnouncementsView({ data, profile, isManager }) {
  // form: {id?, title, body, store_id, pinned, notify, attachments, added: 今回アップロードしたpath, removed: 保存済みから外したpath}
  const [form, setForm] = useState(null);
  const [uploading, setUploading] = useState(0);
  const list = data.announcements.filter((a) => !a.store_id || !data.store || a.store_id === data.store.id);
  const readAt = profile.announcements_read_at;

  // 開いたら既読にする
  useEffect(() => {
    if (list.some((a) => a.created_at > readAt)) api.markAnnouncementsRead(profile.id).catch(() => {});
  }, []); // eslint-disable-line

  // 画像・動画の一時URL（1時間有効なので50分ごとに取り直す）
  const [urls, setUrls] = useState({});
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => { setUrls({}); setTick((n) => n + 1); }, 50 * 60 * 1000); return () => clearInterval(t); }, []);
  const paths = [...list.flatMap((a) => a.attachments || []), ...(form?.attachments || [])].map((m) => m.path);
  const missing = [...new Set(paths.filter((p) => !urls[p]))];
  const missingKey = missing.join("|");
  useEffect(() => {
    if (!missing.length) return;
    let alive = true;
    api.mediaUrls(missing).then((u) => alive && setUrls((cur) => ({ ...cur, ...u })));
    return () => { alive = false; };
  }, [missingKey, tick]); // eslint-disable-line

  const [sending, setSending] = useState(null); // 送信中のお知らせのid
  const storeName = (id) => (id ? data.stores.find((s) => s.id === id)?.name : "全店舗");
  const notify = async (id) => {
    setSending(id);
    try {
      const res = await api.lineNotify({ kind: "announcement", announcement_id: id });
      alert(notifyResult(res));
    } catch { /* lineNotify が alert 済み */ } finally { setSending(null); }
  };

  const addFiles = async (files) => {
    const ok = [...files].filter((f) => {
      if (!/^(image|video)\//.test(f.type)) { alert(`${f.name} は画像・動画ではありません`); return false; }
      if (f.size > MAX_MB * 1024 * 1024) { alert(`${f.name} は ${MAX_MB}MB を超えているので添付できません`); return false; }
      return true;
    });
    for (const f of ok) {
      setUploading((n) => n + 1);
      try {
        const m = await api.uploadMedia(f);
        setForm((cur) => cur && { ...cur, attachments: [...cur.attachments, m], added: [...cur.added, m.path] });
      } catch { /* uploadMedia が alert 済み */ } finally { setUploading((n) => n - 1); }
    }
  };
  const removeFile = (m) => {
    setForm((cur) => {
      const isNew = cur.added.includes(m.path);
      if (isNew) api.removeMedia([m.path]); // まだ保存していないものはすぐ消す
      return { ...cur, attachments: cur.attachments.filter((x) => x.path !== m.path), added: cur.added.filter((p) => p !== m.path), removed: isNew ? cur.removed : [...cur.removed, m.path] };
    });
  };
  const cancel = () => { api.removeMedia(form.added); setForm(null); };
  const save = async () => {
    if (!form.title.trim()) return alert("タイトルを入れてください");
    const row = { title: form.title.trim(), body: form.body, store_id: form.store_id || null, pinned: form.pinned, attachments: form.attachments };
    if (form.id) {
      await api.updateAnnouncement(form.id, row);
      await api.removeMedia(form.removed);
      setForm(null);
      return;
    }
    const created = await api.postAnnouncement({ ...row, created_by: profile.id });
    const send = form.notify;
    setForm(null);
    if (send && created) await notify(created.id);
  };
  const open = (a) => setForm(a
    ? { id: a.id, title: a.title, body: a.body, store_id: a.store_id || "", pinned: a.pinned, attachments: a.attachments || [], added: [], removed: [] }
    : { title: "", body: "", store_id: data.store?.id || "", pinned: false, notify: true, attachments: [], added: [], removed: [] });

  return (
    <div className="p-4 max-w-3xl mx-auto">
      {isManager && !form && <div className="mb-3 flex"><Btn tone="primary" onClick={() => open(null)}>お知らせを投稿</Btn></div>}
      {form && (
        <Card className="p-4 mb-4 text-sm">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="タイトル" className="w-full border rounded px-2 py-1.5 mb-2" />
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="本文（改行できます）" rows={5} className="w-full border rounded px-2 py-1.5 mb-2" />
          <div className="mb-3">
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer text-xs" style={{ border: `1px solid ${LINE}`, color: NAVY }}>
              画像・動画を追加
              <input type="file" accept="image/*,video/*" multiple className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
            <span className="ml-2 text-xs opacity-60">{uploading ? `アップロード中…（残り${uploading}件）` : `1ファイル${MAX_MB}MBまで。複数選べます`}</span>
            <Media items={form.attachments} urls={urls} onRemove={removeFile} />
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <label className="flex items-center gap-1">宛先
              <select value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })} className="border rounded px-1 py-1">
                <option value="">全店舗</option>
                {data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />上に固定</label>
            {!form.id && <label className="flex items-center gap-1"><input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} />LINEで通知する</label>}
            <span className="ml-auto flex gap-2"><Btn small onClick={cancel}>キャンセル</Btn><Btn small tone="primary" disabled={uploading > 0} onClick={save}>{form.id ? "更新" : "投稿"}</Btn></span>
          </div>
        </Card>
      )}
      {list.length === 0 ? <div className="text-sm opacity-60">お知らせはまだありません。</div> : (
        <ul className="space-y-3">
          {list.map((a) => (
            <li key={a.id}>
              <Card className="p-4 text-sm" style={a.pinned ? { borderColor: NAVY } : {}}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {a.pinned && <span className="text-xs px-1.5 rounded" style={{ background: NAVY, color: "#fff" }}>固定</span>}
                  {a.created_at > readAt && <span className="text-xs px-1.5 rounded" style={{ background: RED, color: "#fff" }}>新着</span>}
                  <span className="font-medium">{a.title}</span>
                  <span className="ml-auto text-xs opacity-60">{storeName(a.store_id)}　{new Date(a.created_at).toLocaleDateString("ja-JP")}</span>
                </div>
                <div className="whitespace-pre-wrap">{a.body}</div>
                <Media items={a.attachments} urls={urls} />
                {isManager && (
                  <div className="flex flex-wrap items-center gap-2 justify-end mt-2">
                    {a.notified_at && <span className="text-xs opacity-60 mr-auto">LINE送信済み（{new Date(a.notified_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）</span>}
                    <Btn small disabled={sending === a.id}
                      onClick={() => confirm(a.notified_at ? "このお知らせをもう一度LINEで送りますか？" : "このお知らせをLINEで送りますか？") && notify(a.id)}>
                      {sending === a.id ? "送信中…" : a.notified_at ? "LINEで再送" : "LINEで送る"}
                    </Btn>
                    <Btn small onClick={() => open(a)}>編集</Btn>
                    <Btn small onClick={() => confirm("このお知らせを削除しますか？（添付した画像・動画も消えます）") && api.deleteAnnouncement(a)}>削除</Btn>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
