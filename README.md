# シフト表アプリ セットアップ手順

LINEログインで使うシフト希望・承認・公開アプリです。
構成: React (Vite) ＋ Supabase（DB・認証・Edge Function）＋ Vercel（公開）。すべて無料枠で運用できます。

所要時間の目安: 1〜2時間。順番どおりに進めてください。

---

## 0. 用意するもの

- GitHub アカウント（コードを置く）
- Supabase アカウント https://supabase.com
- Vercel アカウント https://vercel.com （GitHubでログインすると楽です）
- LINE Developers アカウント https://developers.line.biz （普段のLINEアカウントでログイン可）
- PC に Node.js 18 以上（ローカルで動かす場合のみ。Vercel に任せるなら不要）

## 1. コードを GitHub に置く

1. GitHub で新しいリポジトリを作る（Private でよい）
2. このフォルダの中身をそのままアップロードする（`node_modules` と `.env` は含めない）

## 2. Supabase プロジェクトを作る

1. Supabase で **New project**。リージョンは **Northeast Asia (Tokyo)** を選ぶ
2. 作成後、左メニュー **SQL Editor** を開き、`supabase/migrations/0001_schema.sql` の内容を全部貼り付けて **Run**
3. 左メニュー **Authentication → Providers → Email** が有効になっていることを確認（メールは実際には送りません。セッション発行に内部で使うだけです）
4. **Project Settings → API** で次の2つをメモ
   - Project URL（`https://xxxx.supabase.co`）
   - `anon` `public` キー
   - 同じ画面の `service_role` キーもあとで使います（**絶対に公開しない**）

## 3. LINE Developers でログイン用チャネルを作る

1. https://developers.line.biz/console/ で **プロバイダーを作成**（店名などでOK）
2. そのプロバイダー内で **新規チャネル作成 → LINEログイン**
   - アプリタイプ: **ウェブアプリ** にチェック
   - 他は任意
3. 作成後、**チャネル基本設定** タブで
   - **チャネルID** と **チャネルシークレット** をメモ
4. **LINEログイン設定** タブで **コールバックURL** に次を登録（URLは手順5で確定するので、まずは仮でよい）
   ```
   https://あなたのアプリ.vercel.app/callback
   ```
   ローカルでも試すなら 1行追加: `http://localhost:5173/callback`
5. **チャネル基本設定** の下部で、チャネルを **「開発中」→「公開済み」** に切り替える（これをしないと自分以外がログインできません）

## 4. Edge Function（LINEログイン処理）を配置する

Supabase の CLI を使います。PCのターミナルで:

```bash
npm install -g supabase
supabase login
cd shift-app
supabase link --project-ref <プロジェクトの参照ID>   # ダッシュボードURLの xxxx の部分

# LINE のキーを Edge Function の秘密情報として登録
supabase secrets set LINE_CHANNEL_ID=<チャネルID> LINE_CHANNEL_SECRET=<チャネルシークレット>

# 関数をデプロイ（ログイン前なので JWT 検証は無効にする）
supabase functions deploy line-login --no-verify-jwt
```

`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は Supabase が自動で関数に渡すので設定不要です。

> CLI を入れたくない場合: ダッシュボードの **Edge Functions → Deploy a new function** から `supabase/functions/line-login/index.ts` の内容を貼り付けて作成し、**Secrets** に `LINE_CHANNEL_ID` と `LINE_CHANNEL_SECRET` を追加、関数の設定で **Verify JWT** をオフにしてください。

## 5. Vercel で公開する

1. Vercel で **Add New → Project**、手順1のリポジトリを選ぶ
2. **Environment Variables** に3つ追加
   | 名前 | 値 |
   |---|---|
   | `VITE_SUPABASE_URL` | 手順2の Project URL |
   | `VITE_SUPABASE_ANON_KEY` | 手順2の anon キー |
   | `VITE_LINE_CHANNEL_ID` | 手順3のチャネルID |
3. **Deploy**。数十秒で `https://xxxx.vercel.app` が発行される
4. 発行された URL を **LINE のコールバックURL**（手順3-4）に正しく登録し直す

## 6. 初回ログインと運用開始

1. 発行されたURLを開き **LINEでログイン**
   **最初にログインした人が自動的に管理者になります。** 管理者になる人が先にログインしてください
2. 管理者タブ → **スタッフ名簿** でスタッフの名前を先に作っておく（任意）
3. URL を LINE グループに送る
4. スタッフがログインすると、管理者の名簿に「登録待ち」として表示される。名前を確認して **この名前で登録**（または先に作った名前に紐づける）
5. 登録されたスタッフは「希望入力」から入力できるようになる
6. 管理者は「日程ごとの承認」で承認・拒否 → 揃ったら **公開する**。公開すると全員の「確定シフト」タブに表が表示される

管理者を増やしたい場合は、名簿の該当スタッフの **管理者にする** を押してください。

---

## 開発メモ

- ローカルで動かす: `.env.example` を `.env` にコピーして値を入れ、`npm install && npm run dev`
- 祝日: `settings.holidays` に日付を入れるか、管理画面で日ごとに「土日祝」に切り替える。年ごとの祝日を SQL で追加する例:
  ```sql
  update settings set holidays = array['2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23']::date[] where id = 1;
  ```
- 時間指定の希望は、11〜15時と重なればランチ、17〜22時と重なればディナーとして人数に数えます（`src/lib/util.js` の `LUNCH_WIN` / `DINNER_WIN`）
- 権限は DB の Row Level Security で守っています。スタッフは自分の希望と承認済みの希望だけ読めて、承認状態は変更できません（`requests_reset_status` トリガー）
- LINE は `openid` スコープの ID トークンをサーバー側で検証しています。LINEのメールアドレスは使わず、`<LINEユーザーID>@line.local` という擬似アドレスで Supabase ユーザーを作っています

## 困ったとき

| 症状 | 確認するところ |
|---|---|
| LINEでログイン→「400 Bad Request」 | LINE のコールバックURLが `https://…/callback` と完全一致しているか |
| ログイン中…のまま止まる／「LINEのトークン取得に失敗」 | Edge Function の Secrets（チャネルID・シークレット）、`--no-verify-jwt` でデプロイしたか |
| 自分以外がログインできない | LINE チャネルが「公開済み」になっているか |
| 読み込みエラーが出る | SQL がすべて実行されているか（`settings` に1行あるか） |
| 希望を入力しても管理者に反映されない | 別タブで再読み込み。Realtime が有効か（**Database → Replication**）|
