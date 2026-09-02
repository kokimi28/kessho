# KESSHO（結晶）— 夜業の観測所

AI が毎晩書いたコードの記録を、環状線ダイアグラムの一枚絵として観測する Web アプリ。
新事業「ダッシュボード先行」路線の小さいサービス第1号。

- 公開 URL: **https://kokimi28.github.io/kessho/**（GitHub Pages・main への push で自動配信）
- 戦略: `docs/STRATEGY.md`（人間性の駆動因 → 製品仮説）
- 要件: `docs/REQUIREMENTS.md`（v1.0 スコープの正本）
- 設計: `docs/DESIGN.md`（モジュール構成・決定論規約・レイアウト系譜 §1–13・計測の例外 §14・放送 §15）
- 初動の判定: `docs/SHODO-2026-09.md`（判定日・正式スコア・判定値）

## 使い方（開発）

Node >= 22 のみ（依存パッケージゼロ）。

| 目的 | コマンド |
|---|---|
| データ抽出（git 履歴 → stream.json） | `node scripts/extract-stream.mjs [リポ親dir]` |
| ビルド（単一 HTML 生成） | `node scripts/build.mjs`（`GOATCOUNTER_CODE=<code>` を付けると計測ビーコンを注入） |
| **テスト（実装後に必ず）** | `node scripts/test.mjs` |
| 夜報の放送（既定 dry-run・送信しない） | `node scripts/publish-night.mjs`（`--verify` で鍵確認のみ） |

成果物は `dist/index.html`（自己完結・そのまま静的ホスティング可）。

## 自動化（.github/workflows/）

| workflow | 役割 |
|---|---|
| `deploy.yml` | main への push → test → build → `gh-pages` ブランチへ配信（Pages ソースは gh-pages / root） |
| `nightly.yml` | 毎晩 JST 23:45 に 13 リポの git 履歴を採取 → `data/stream.json` と `dist/` を main に更新コミット → **夜報を X へ放送**（既定 dry-run）→ gh-pages へ再配信 |
| `ci.yml` | PR → test → build → 夜報の dry-run（送信しない） |

- `nightly.yml` は secret **`KESSHO_READ_TOKEN`**（対象 13 リポ read 権限の PAT）が必要。
  未設定の間はデータ採取をスキップして正常終了する（表示は既存データのまま）。
- 決定論規約: seed 20260729・レイアウト `ring-v1`。同一データなら形は不変
  （`data/shape-checksum.json` の回帰テストで凍結）。

## 計測（GoatCounter・DESIGN §14）

- Variables **`GOATCOUNTER_CODE`** = GoatCounter のサイトコード（`https://<code>.goatcounter.com` の `<code>`）。HTML に出る公開値なので secret ではなく **Variables** に入れる。設定されたビルドだけ `dist/index.html` にビーコンを注入し、未設定なら注入しない（描画は外部に依存しない）。
- 送るイベント: 初期化時に 1 回、観測記録が無ければ `event/first`、あれば `event/return`（ダッシュボードでは path `event/first` / `event/return` のヒット数）。
- X からの流入は GoatCounter の **Refs（参照元）に `t.co`** として出る（X はリンクを t.co で短縮するため）。SHODO の「`t.co` 経由訪問／週」はその行の数字。
- ダッシュボード: `https://<GOATCOUNTER_CODE>.goatcounter.com/`

## 放送（X 自動投稿・DESIGN §15）

- `scripts/publish-night.mjs`。brypo-landing の publish 経路（OAuth 1.0a → `POST /2/tweets`）の移植で、本文は「機械の一文 ＋ 数字（+n粒・+m行・リポ数）＋ 公開 URL」。静かな夜（差分 0）も投稿する。テキストのみ（画像は次回）。
- **既定は dry-run**（本文を Actions のログに出すだけ）。本番送信は次のどちらかのときのみ:
  - `nightly` を **workflow_dispatch** で `live=true` にして実行（1 本だけ出す・初回確認用）
  - Variables **`PUBLISH_ENABLED`** = `true`（schedule 実行を毎晩本番化。brypo-landing と同名のキルスイッチ。外せば dry-run に戻る。これが無いと毎晩の本番投稿に到達できないため置いた。`live=true` の明示操作は止めない）
- 冪等: 投稿した夜を `data/last-post.json` に記録（本番成功時のみ・live main の先端に push）。同じ夜に 2 回走っても 2 本目は出ない。「夜」は JST 06:00 境界の日付（schedule が遅れて日付をまたいでも同じ夜）。
- `verify=true` で dispatch すると、投稿せずに鍵を確かめる（署名付き `GET /2/users/me`。どの @ で出るか・読み取り専用トークンの誤りを検出）。

## secrets / variables

値はコード・コミット・Issue・PR・ログに書かない（扱うのはキー名のみ）。設定場所: Settings → Secrets and variables → Actions（Secrets タブ／Variables タブ）。

| 名前 | 種別 | 用途 |
|---|---|---|
| `KESSHO_READ_TOKEN` | Secret | 夜間データ採取（13 リポ read の PAT） |
| `X_API_KEY` / `X_API_SECRET` | Secret | X アプリの consumer key / secret（brypo-landing と同名） |
| `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | Secret | 投稿アカウントのユーザートークン（Read and Write で発行・brypo-landing と同名） |
| `GOATCOUNTER_CODE` | Variable | 計測ビーコン（HTML に出る公開値） |
| `PUBLISH_ENABLED` | Variable | `true` のときだけ schedule の放送を本番送信 |

## 👤 に残る作業（初動・これ以外を増やさない）

1. GoatCounter でサイトを作る → コードを Variables に `GOATCOUNTER_CODE` として投入（Settings → Secrets and variables → Actions → Variables）。次の deploy/nightly からビーコンが入る。
2. 投稿先 X アカウントを決める（brypo 既存 or 新規）→ X developer portal でそのアカウントの **Read and Write** アプリとユーザートークンを発行。
3. Secrets に `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`（brypo-landing と同名）を投入。
4. Actions → nightly → Run workflow: まず `verify=true` で鍵を確認 → 次に `live=true` で 1 本出し、X に出たことを確認。毎晩本番にするなら Variables に `PUBLISH_ENABLED=true`。
5. `docs/SHODO-2026-09.md` の計測開始日と判定値を確定（以後 28 日間は変えない）。

独自ドメイン判断（現状は github.io で運用）は初動の外。
