import { useEffect, useState } from "react";
import { api } from "../lib/data.js";
import { NAVY, LINE, RED } from "../lib/util.js";
import { Btn, Card } from "../ui.jsx";

// お知らせ: 管理者が投稿、全員が閲覧
export default function AnnouncementsView({ data, profile, isManager }) {
  const [form, setForm] = useState(null); // {id?, title, body, store_id, pinned}
  const list = data.announcements.filter((a) => !a.store_id || !data.store || a.store_id === data.store.id);
  const readAt = profile.announcements_read_at;

  // 開いたら既読にする
  useEffect(() => {
    if (list.some((a) => a.created_at > readAt)) api.markAnnouncementsRead(profile.id).catch(() => {});
  }, []); // eslint-disable-line

  const storeName = (id) => (id ? data.stores.find((s) => s.id === id)?.name : "全店舗");
  const save = async () => {
    if (!form.title.trim()) return alert("タイトルを入れてください");
    const row = { title: form.title.trim(), body: form.body, store_id: form.store_id || null, pinned: form.pinned };
    if (form.id) await api.updateAnnouncement(form.id, row);
    else await api.postAnnouncement({ ...row, created_by: profile.id });
    setForm(null);
  };

  return (
    <div className="p-4 max-w-3xl mx-auto">
      {isManager && !form && <div className="mb-3 flex"><Btn tone="primary" onClick={() => setForm({ title: "", body: "", store_id: data.store?.id || "", pinned: false })}>お知らせを投稿</Btn></div>}
      {form && (
        <Card className="p-4 mb-4 text-sm">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="タイトル" className="w-full border rounded px-2 py-1.5 mb-2" />
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="本文（改行できます）" rows={5} className="w-full border rounded px-2 py-1.5 mb-2" />
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <label className="flex items-center gap-1">宛先
              <select value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })} className="border rounded px-1 py-1">
                <option value="">全店舗</option>
                {data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />上に固定</label>
            <span className="ml-auto flex gap-2"><Btn small onClick={() => setForm(null)}>キャンセル</Btn><Btn small tone="primary" onClick={save}>{form.id ? "更新" : "投稿"}</Btn></span>
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
                {isManager && (
                  <div className="flex gap-2 justify-end mt-2">
                    <Btn small onClick={() => setForm({ id: a.id, title: a.title, body: a.body, store_id: a.store_id || "", pinned: a.pinned })}>編集</Btn>
                    <Btn small onClick={() => confirm("このお知らせを削除しますか？") && api.deleteAnnouncement(a.id)}>削除</Btn>
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
