# KESSHO（結晶）— 夜業の観測所

AI が毎晩書いたコードの記録を、環状線ダイアグラムの一枚絵として観測する Web アプリ。
新事業「ダッシュボード先行」路線の小さいサービス第1号。

- 公開 URL: **https://kokimi28.github.io/kessho/**（GitHub Pages・main への push で自動配信）
- 戦略: `docs/STRATEGY.md`（人間性の駆動因 → 製品仮説）
- 要件: `docs/REQUIREMENTS.md`（v1.0 スコープの正本）
- 設計: `docs/DESIGN.md`（モジュール構成・決定論規約・レイアウト系譜 §1–13）

## 使い方（開発）

Node >= 22 のみ（依存パッケージゼロ）。

| 目的 | コマンド |
|---|---|
| データ抽出（git 履歴 → stream.json） | `node scripts/extract-stream.mjs [リポ親dir]` |
| ビルド（単一 HTML 生成） | `node scripts/build.mjs` |
| **テスト（実装後に必ず）** | `node scripts/test.mjs` |

成果物は `dist/index.html`（完全自己完結・そのまま静的ホスティング可）。

## 自動化（.github/workflows/）

| workflow | 役割 |
|---|---|
| `deploy.yml` | main への push → test → build → `gh-pages` ブランチへ配信（Pages ソースは gh-pages / root） |
| `nightly.yml` | 毎晩 JST 23:45 に 13 リポの git 履歴を採取 → `data/stream.json` と `dist/` を main に更新コミット → gh-pages へ再配信 |

- `nightly.yml` は secret **`KESSHO_READ_TOKEN`**（対象 13 リポ read 権限の PAT）が必要。
  未設定の間はデータ採取をスキップして正常終了する（表示は既存データのまま）。
  設定場所: Settings → Secrets and variables → Actions。
- 決定論規約: seed 20260729・レイアウト `ring-v1`。同一データなら形は不変
  （`data/shape-checksum.json` の回帰テストで凍結）。

## secrets

値はコード・コミット・Issue・PR・ログに書かない（扱うのはキー名のみ）。
本リポで扱うキー名は `KESSHO_READ_TOKEN` の 1 つだけ。

## 👤 に残る作業

1. secret `KESSHO_READ_TOKEN` の投入（夜間データ更新の有効化。未投入でも表示は動く）。
2. 独自ドメイン判断（現状は github.io で運用）。
3. X 自動投稿の接続判断（brypo-landing の publish 資産を移植。`PUBLISH_TOKEN` 等の投入は 👤）。
