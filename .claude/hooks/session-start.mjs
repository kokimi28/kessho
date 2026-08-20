#!/usr/bin/env node
// SessionStart hook — リモート（claude.ai/code クラウド）セッションの環境自己診断（preflight）。
// ローカル実行では何もしない（即 exit 0）。クロスプラットフォーム。
// ベストエフォート: 失敗してもセッションを止めない（常に exit 0）。
// stdout はセッション冒頭のコンテキストに注入される＝エージェントが「何ができる環境か」を最初から知る。
// 本リポは依存パッケージゼロ（Node >= 22 のみ）のため依存導入は不要。

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.env.CLAUDE_CODE_REMOTE !== 'true') process.exit(0);

const chromium = existsSync('/opt/pw-browsers/chromium') ? 'あり' : 'なし';
// fetch はプロキシ env を見ないため curl で疎通確認する（この環境の HTTPS はプロキシ経由）
const probe = spawnSync(
  'curl',
  ['-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-m', '4', '-w', '%{http_code}', 'https://kokimi28.github.io/kessho/'],
  { encoding: 'utf8' }
);
const pages = (probe.stdout || '').trim() || '000';

console.log(`[remote-preflight] クラウドコンテナ（Linux）で実行中。環境診断:
- node ${process.version}（本リポは依存ゼロ・これだけで検証可能） / 同梱 Chromium: ${chromium}
- 公開ページ（kokimi28.github.io/kessho）疎通: HTTP ${pages}（000=遮断）
この環境での動き方（CLAUDE.md「リモート/クラウドセッション運用」節が正）:
- 検証コマンド（node scripts/test.mjs → node scripts/build.mjs）は必ず実行。実行できない検証は PR の「未検証項目」に列挙し、それを理由に停止しない。
- 見た目確認は node scripts/verify-ui-remote.mjs "file://$PWD/dist/index.html"（同梱 Chromium 使用）。
- nightly.yml の PAT（KESSHO_READ_TOKEN）はこの環境に無い。実データ採取の検証は CI / オーナーに委ねる。`);
process.exit(0);
