// KESSHO ビルド — src + data を単一 HTML に連結（実行時依存ゼロ）
// 出力: dist/index.html（完全なドキュメント）/ dist/artifact.html（claude.ai Artifact 用ボディのみ）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const css = read("src/style.css");
const body = read("src/body.html");
const lib = read("src/lib.mjs").replace(/^export /gm, "");
const app = read("src/app.js");
const stream = JSON.parse(read("data/stream.json"));
// 埋め込みは表示に使うフィールドのみ（h はコミット照合用に保持）
const slim = JSON.stringify(stream.map(({ d, r, l, t, n, s, h }) => ({ d, r, l, t, n, s, h })));

const script = lib + "\n" + app.replace("__DATA__", slim);
const TITLE = "結晶 — 夜業の観測所";

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
</head>
<body>
${body}
<script>
${script}
</script>
</body>
</html>
`;

const artifact = `<title>${TITLE}</title>
<style>
${css}</style>
${body}
<script>
${script}
</script>
`;

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/index.html"), full);
writeFileSync(join(root, "dist/artifact.html"), artifact);
console.log("built: dist/index.html", full.length, "bytes / dist/artifact.html", artifact.length, "bytes");
