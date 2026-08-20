#!/usr/bin/env node
// SessionStart hook — リモート（claude.ai/code クラウド）セッションの準備＋環境自己診断（preflight）。
// ローカル実行では何もしない（即 exit 0）。クロスプラットフォーム（Windows/macOS/Linux）。
// ベストエフォート: 失敗してもセッションを止めない（常に exit 0）。
// stdout はセッション冒頭のコンテキストに注入される＝エージェントが「何ができる環境か」を最初から知る。

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (process.env.CLAUDE_CODE_REMOTE !== 'true') process.exit(0);

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// --- 依存導入（冪等・クラウドのコンテナキャッシュに乗る） ---
let deps = '対象なし';
if (existsSync(join(cwd, 'package.json'))) {
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd,
    encoding: 'utf8',
    timeout: 540000,
  });
  deps =
    r.status === 0
      ? 'npm install 済'
      : `npm install 失敗: ${(r.stderr || String(r.error || '')).trim().split('\n').slice(-3).join(' / ')}`;
}

// --- 能力診断 ---
const have = (bin) =>
  spawnSync(bin, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0
    ? 'あり'
    : 'なし';
const chromium = existsSync('/opt/pw-browsers/chromium') ? 'あり' : 'なし';
// fetch はプロキシ env を見ないため curl で疎通確認する（この環境の HTTPS はプロキシ経由）
const probe = spawnSync(
  'curl',
  ['-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-m', '4', '-w', '%{http_code}', 'https://example.vercel.app'],
  { encoding: 'utf8' }
);
const vercel = (probe.stdout || '').trim() || '000';

console.log(`[remote-preflight] クラウドコンテナ（Linux）で実行中。環境診断:
- 依存: ${deps} / node ${process.version}
- doppler: ${have('doppler')} / 同梱 Chromium: ${chromium} / *.vercel.app 疎通: HTTP ${vercel}（000=遮断）
この環境での動き方（CLAUDE.md「リモート/クラウドセッション運用」節が正）:
- 検証コマンド（node scripts/test.mjs → node scripts/build.mjs）は必ず実行。実行できない検証は PR の「未検証項目」に列挙し、それを理由に停止しない。
- UI 実機確認は Playwright MCP の代わりに node scripts/verify-ui-remote.mjs <URL...>（同梱 Chromium 使用）。
- secrets（Doppler / .env）はこの環境に無い。env 必須の検証・デプロイ後疎通（vercel.app 等）は CI / オーナーに委ねる。`);
process.exit(0);
