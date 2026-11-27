-- ============================================================
-- 店舗ごとの並び順: 調整表で人の行をドラッグしたときの順番を店舗ごとに持つ
--   staff_stores.sort_order : その店舗での並び順（空ならスタッフ名簿の順）
--   手稲店で動かしても、千歳店での順番は変わりません
-- 何度実行しても安全です
-- ============================================================

alter table public.staff_stores add column if not exists sort_order int;

-- 今の並び（スタッフ名簿の順）を店舗ごとの初期値にする（まだ入っていない行だけ）
update public.staff_stores ss
set sort_order = s.sort_order
from public.staff s
where s.id = ss.staff_id and ss.sort_order is null;
