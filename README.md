# シフト表アプリ セットアップ手順

LINEログインで使うシフト希望・承認・公開アプリです。
構成: React (Vite) ＋ Supabase（DB・認証・Edge Function）＋ Vercel（公開）。

## 既にv1を動かしている場合（v2への更新）

1. Supabase の **SQL Editor** で `supabase/migrations/0002_stores_prep_announcements_worklogs.sql` を実行する（既存のデータは「本店」という店舗に引き継がれます）。続けて `0003_day_work_hours.sql`、`0004_day_delivery.sql` も実行する（実働時間の一括入力・デリバリー担当用）
2. GitHub のファイルをこのフォルダの内容で置き換える（`src/` 以下と `package.json`）
3. Vercel が自動で再デプロイするのを待つ

## 新規セットアップ

### 1. コードを GitHub に置く
新しいリポジトリを作り、このフォルダの中身をそのままアップロード（`node_modules` と `.env` は除く）。

### 2. Supabase
1. **New project**（リージョンは Northeast Asia (Tokyo)）
2. **SQL Editor** で `supabase/migrations/0001_schema.sql` を実行、続けて `0002_...sql`、`0003_...sql`、`0004_...sql` の順に実行
3. **Authentication → Providers → Email** が有効であることを確認（メールは送りません。セッション発行に内部で使うだけ）
4. **Project Settings → API** の Project URL と `anon` キーをメモ

### 3. LINE Developers
1. プロバイダーを作成 → **LINEログイン** チャネルを作成（アプリタイプ: ウェブアプリ）
2. **チャネル基本設定** のチャネルIDとチャネルシークレットをメモ
3. **LINEログイン設定** のコールバックURLに `https://<あなたのアプリ>.vercel.app/callback` を登録
4. チャネルを「開発中」→「公開済み」にする

### 4. Edge Function
ダッシュボードの **Edge Functions → Deploy a new function** で名前を `line-login` にし、`supabase/functions/line-login/index.ts` の内容を貼って Deploy。
**Secrets** に `LINE_CHANNEL_ID` と `LINE_CHANNEL_SECRET` を追加し、関数の設定で **Verify JWT** をオフにする。

### 5. Vercel
リポジトリを選び、Framework Preset は **Vite**。Environment Variables に次の3つを追加して Deploy。

| 名前 | 値 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase の Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase の anon キー |
| `VITE_LINE_CHANNEL_ID` | LINE のチャネルID |

### 6. 運用開始
1. 管理者になる人が最初にログインする（最初の人が自動で管理者）
2. 「管理者 → 店舗・基準人数」で店舗を確認・追加
3. 「スタッフ名簿」で名前を作る、または URL を LINE グループに送ってログインしてもらい、登録待ちから登録
4. 名簿で所属店舗と「できる仕事」（デリバリー・厨房）を設定

## 開発メモ
- ローカル: `.env.example` を `.env` にコピーして値を入れ、`npm install && npm run dev`
- 日本の祝日（振替休日・国民の休日を含む）は自動で「土日祝」になります。それ以外の日は店舗の `holidays`（SQL）か、承認画面で日ごとに「土日祝」に切り替え
- 時間指定の希望は、店舗ごとに設定した枠の時間帯（仕込み 9〜11、ランチ 11〜15、ディナー 17〜22 が初期値）と重なる枠に数えます
- マニュアルは `src/content/*.md` を編集するだけで更新されます

## 困ったとき
| 症状 | 確認するところ |
|---|---|
| LINEでログイン→「400 Bad Request」 | LINE のコールバックURLが完全一致しているか |
| 「LINEのトークン取得に失敗」 | Edge Function の Secrets、Verify JWT がオフか |
| 自分以外がログインできない | LINE チャネルが「公開済み」か |
| 読み込みエラー | SQL（0001〜0004）が最後まで実行されているか |
| 他の人の操作が自動反映されない | Database → Publications → supabase_realtime で各テーブルをオン |
