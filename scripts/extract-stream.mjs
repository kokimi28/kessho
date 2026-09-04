// 全ローカルリポの git 履歴 → data/stream.json（差分粒子ストリーム）
// 使い方: node scripts/extract-stream.mjs [リポ親ディレクトリ]（既定 /home/user）
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = process.argv[2] || "/home/user";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const STREAM_PATH = join(OUT, "stream.json");

// 観測できなかったリポを「無かったこと」にしない。nightly は clone 失敗を `|| echo skip` で
// 握りつぶすため、ここで落とすとストリームが黙って縮み、その夜の放送が
// 「結晶は通算 N 粒」を前夜より小さい数で公言する（静かな夜は「のまま」と付くので自己矛盾になる）。
// 読めなかったリポは前回の粒をそのまま引き継ぎ、通算が後退しないようにする。
// 全リポが読めた通常の夜は prev を一切使わないので、出力は従来と同一（形の凍結に影響しない）。
const prevEvents = existsSync(STREAM_PATH) ? JSON.parse(readFileSync(STREAM_PATH, "utf8")) : [];
const carried = [];

const LINES = {
  "dev-env": "foundation", "claude-ops": "foundation", "ops-cockpit": "foundation",
  "template-nextjs": "foundation", "template-python": "foundation",
  "tedori-calc": "toolfactory", "retirement-tax-sim": "toolfactory", "ideco-tax-sim": "toolfactory",
  "brypo": "saas", "brypo-landing": "saas",
  "hojokin-antenna": "explp",
  "reg-monitor": "data",
  "distributed-ai-idol": "idol",
};

const SKIP_FILE = /(package-lock\.json|pnpm-lock\.yaml|\.lock$|\.png$|\.jpg$|\.ico$|\.woff2?$)/;
const TYPE_RE = /^(feat|fix|docs|test|ci|chore|refactor|perf|style|build)(\(.+?\))?!?:/i;

const events = [];
for (const repo of Object.keys(LINES)) {
  let out;
  try {
    out = execSync(
      `git -C ${ROOT}/${repo} log --no-merges --reverse --date=short --pretty=format:'@C|%h|%ad|%s' --numstat`,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    const keep = prevEvents.filter((e) => e.r === repo);
    if (keep.length) {
      events.push(...keep);
      carried.push(`${repo}(${keep.length})`);
    }
    continue;
  }
  let cur = null;
  const flush = () => { if (cur && cur.n > 0) events.push(cur); cur = null; };
  for (const line of out.split("\n")) {
    if (line.startsWith("@C|")) {
      flush();
      const [, hash, date, ...rest] = line.split("|");
      const subject = rest.join("|");
      const m = subject.match(TYPE_RE);
      let t = m ? m[1].toLowerCase() : "other";
      if (t === "perf" || t === "style" || t === "build" || t === "chore") t = "refactor";
      if (t === "ci") t = "test";
      cur = { d: date, r: repo, l: LINES[repo], t, n: 0, s: subject.slice(0, 60), h: hash };
    } else if (cur && /^\d+\t\d+\t/.test(line)) {
      const [ins, del, path] = line.split("\t");
      if (SKIP_FILE.test(path)) continue;
      cur.n += parseInt(ins, 10) + parseInt(del, 10);
    }
  }
  flush();
}
events.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.r < b.r ? -1 : 1));
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "stream.json"), JSON.stringify(events));
if (carried.length) console.log("carried (読めなかったリポは前回の粒を引き継いだ): " + carried.join(" "));
if (events.length < prevEvents.length) {
  console.log(`::warning::粒が減った（${prevEvents.length} → ${events.length}）。履歴の書き換えか対象リポの変更でなければ調査すること`);
}
console.log("events=" + events.length, "range", events[0]?.d, "..", events[events.length - 1]?.d);
