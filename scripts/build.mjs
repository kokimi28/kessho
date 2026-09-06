// KESSHO ビルド — src + data を単一 HTML に連結（実行時依存ゼロ）
// 出力: dist/index.html（完全なドキュメント）/ dist/artifact.html（claude.ai Artifact 用ボディのみ）
//
// 計測（GoatCounter）: 環境変数 GOATCOUNTER_CODE が設定されているときだけ、index.html の
// </head> 直前にビーコン script を注入する（DESIGN.md §14「計測の例外」）。未設定なら注入しない。
// 値の出どころは 2 つ: 環境変数 GOATCOUNTER_CODE（Actions の Variables・優先）→ 無ければ kessho.config.json の goatcounter_code。
// どちらも公開値（HTML に出る）。secret ではない。設定ファイルにあるのは AI が PR で投入できるようにするため（DESIGN §14）。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

export const TITLE = "結晶 — 夜業の観測所";
export const CONFIG_PATH = join(root, "kessho.config.json");
/** 公開値だけの設定ファイル。無い／壊れているときは空扱い（ビルドは止めない）。 */
export function readConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}
// GoatCounter のサイトコード（<code>.goatcounter.com）。属性値に入るので文字種を厳格に制限する。
export const GOATCOUNTER_CODE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

/** ビーコン snippet（唯一の許可された外部参照 = gc.zgo.at）。 */
export function goatcounterSnippet(code) {
  return `<script data-goatcounter="https://${code}.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`;
}

/**
 * src + data → { full, artifact } の純関数（ファイルは書かない・test.mjs から両方の変種を検査する）。
 * goatcounterCode: 環境変数由来の値（優先）。空なら config.goatcounter_code を使う。どちらも空なら注入なし。
 * 不正な形式は黙ってスキップせず例外（typo で計測が静かに死ぬのを防ぐ）。config を渡すとファイルを読まない（テスト用）。
 */
export function render({ goatcounterCode = "", config } = {}) {
  const cfg = config ?? readConfig();
  const code = String(goatcounterCode ?? "").trim() || String(cfg?.goatcounter_code ?? "").trim();
  if (code && !GOATCOUNTER_CODE_RE.test(code)) {
    throw new Error("GOATCOUNTER_CODE の形式が不正（英数字とハイフンのみ）: " + JSON.stringify(code));
  }
  const css = read("src/style.css");
  const body = read("src/body.html");
  const lib = read("src/lib.mjs").replace(/^export /gm, "");
  const app = read("src/app.js");
  const stream = JSON.parse(read("data/stream.json"));
  // 埋め込みは表示に使うフィールドのみ（h はコミット照合用に保持）
  // "<" は \u003c にエスケープ（コミット件名に "</script>" が来ても script を閉じられない。JS 文字列としては同値）
  const slim = JSON.stringify(stream.map(({ d, r, l, t, n, s, h }) => ({ d, r, l, t, n, s, h }))).replace(/</g, "\\u003c");

  const script = lib + "\n" + app.replace("__DATA__", slim);
  const beacon = code ? goatcounterSnippet(code) + "\n" : "";

  const full = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0a0d13">
<meta name="description" content="AIが毎晩書いたコード差分が、粒子として一つの結晶に堆積していく。夜業の観測所。">
<title>${TITLE}</title>
<style>
${css}</style>
${beacon}</head>
<body>
${body}
<script>
${script}
</script>
</body>
</html>
`;

  // Artifact 版は claude.ai 内表示専用（外部 script は CSP で落ちる）— 計測は注入しない
  const artifact = `<title>${TITLE}</title>
<style>
${css}</style>
${body}
<script>
${script}
</script>
`;
  // dataJson: 埋め込んだデータ本体（test.mjs が外部参照検査から除外するため。コミット件名は外部入力）
  return { full, artifact, goatcounterCode: code, dataJson: slim };
}

function main() {
  const { full, artifact, goatcounterCode } = render({ goatcounterCode: process.env.GOATCOUNTER_CODE });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist/index.html"), full);
  writeFileSync(join(root, "dist/artifact.html"), artifact);
  console.log(
    "built: dist/index.html", full.length, "bytes / dist/artifact.html", artifact.length, "bytes",
    goatcounterCode ? "/ goatcounter: on" : "/ goatcounter: off（GOATCOUNTER_CODE も kessho.config.json の goatcounter_code も空）",
  );
}

// 直接実行のときだけ書き出す（test.mjs からの import では何もしない）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
