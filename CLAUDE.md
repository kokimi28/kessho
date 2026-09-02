# CLAUDE.md — kessho（結晶）

夜業の観測所 — AI の夜間コミット履歴を環状線ダイアグラムの一枚絵で観測する静的 Web アプリ。概要・自動化（deploy/nightly）・secrets は `README.md` が正本。設計は `docs/DESIGN.md`、要件は `docs/REQUIREMENTS.md`。

## 使用コマンド（Node >= 22・依存パッケージゼロ）

| 目的 | コマンド |
|---|---|
| データ抽出（git 履歴 → stream.json） | `node scripts/extract-stream.mjs [リポ親dir]` |
| ビルド（単一 HTML 生成） | `node scripts/build.mjs` |
| **テスト（実装後に必ず）** | `node scripts/test.mjs` |
| 夜報の放送（既定 dry-run・送信しない） | `node scripts/publish-night.mjs`（`--verify` で鍵確認のみ） |

- 成果物は `dist/index.html`（自己完結）。決定論規約（seed 20260729・`ring-v1`）を壊さない — 形が変わる変更は `data/shape-checksum.json` の回帰テストで検出される。
- secrets の値はコード・コミット・Issue・PR・ログに書かない。扱うのはキー名のみ — Secrets: `KESSHO_READ_TOKEN` / `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`、Variables（公開値）: `GOATCOUNTER_CODE` / `PUBLISH_ENABLED`（一覧と用途は `README.md`）。
- 外部参照は許可リスト方式（`gc.zgo.at` のみ・DESIGN §14）。計測以外の外部依存を足さない。放送（X 投稿）は既定 dry-run で、本番化の切替は 👤 のみ（DESIGN §15）。

## リモート/クラウドセッション運用（claude.ai/code・スマホ発）

`CLAUDE_CODE_REMOTE=true` のとき、claude.ai/code のクラウドコンテナ（Linux）で実行されている。SessionStart hook（`.claude/hooks/session-start.mjs`）が環境診断（preflight）を行い、結果をセッション冒頭に出力する。以下の縮退規約に従う。

- **止まらない**: 検証手段が無いことを理由に作業を中断しない。実装 → 実行可能な検証をすべて実行 → push → draft PR 作成 → CI green まで追走、が完了の定義。
- **検証はできるものを全部**: `node scripts/test.mjs` → `node scripts/build.mjs` は必ず実行する。実行できなかった検証は PR 本文の「未検証項目」に列挙する（黙って省略しない）。
- **見た目の実機確認**: ビルド後に `node scripts/verify-ui-remote.mjs "file://$PWD/dist/index.html"` を実行し、スクリーンショット（`.claude/tmp/ui-*.png`）を Read で視覚確認する（同梱 Chromium 使用・依存追加なし・開発サーバー不要）。
- **secrets 非接触**: `nightly.yml` の PAT（`KESSHO_READ_TOKEN`）はリモート環境に無い。実データ採取（`extract-stream.mjs` の全リポ横断）を要する検証はスキップし、未検証項目に記載する（値の要求・推測・生成をしない）。
- **放送の検証は dry-run まで**: `node scripts/publish-night.mjs`（既定 dry-run）は実行できるが、X の secret（`X_*`）はリモート環境に無い。本番送信・`--verify` は 👤 が `nightly.yml` の `workflow_dispatch` で行う。
