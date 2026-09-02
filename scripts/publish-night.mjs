#!/usr/bin/env node
// 夜報の放送 — data/stream.json の「前回投稿以降の差分」から機械の一文を組み立て、X（API v2）へ 1 本投稿する。
// 認証・エンドポイントは brypo-landing functions/api/_publish.ts の OAuth 1.0a（HMAC-SHA1）→
// POST https://api.twitter.com/2/tweets をそのまま Node 22 に移植（新方式は設計しない）。設計: docs/DESIGN.md §15。
//
// 使い方（既定は dry-run: 本文をログに出して送信しない）:
//   node scripts/publish-night.mjs                          # dry-run
//   PUBLISH_DRY_RUN=false node scripts/publish-night.mjs    # 本番送信（明示の上書き・手元や CI では使わない）
//   node scripts/publish-night.mjs --verify                 # 鍵の検証のみ（GET /2/users/me・投稿しない）
// nightly.yml からは KESSHO_EVENT / KESSHO_REF / KESSHO_LIVE_INPUT / PUBLISH_ENABLED（Variables）を受け取り、
// kessho.config.json の publish.schedule_live と合わせて resolveMode() が dry/live を決める（優先順は関数のコメント参照）。
// 必要 secret（brypo-landing と同名・値はログに出さない）: X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET
// 冪等性: 投稿した夜（JST 06:00 境界の日付）を data/last-post.json に記録し、同じ夜に 2 回走っても 2 本目は出ない（1 日 1 本）。
// マーカーの置き場所は env KESSHO_MARKER_PATH で差し替え可能（nightly.yml は live main の最新版を一時ファイルで渡す）。
// 依存ゼロ（Node 22 標準の fetch / WebCrypto のみ）。純関数部分は scripts/test.mjs が検証する。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { jpDate, typeMix, toMs, DAY_MS } from "../src/lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG_PATH = join(root, "kessho.config.json");
/** 公開値だけの設定ファイル。無い／壊れているときは空扱い。 */
export function readConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

/* ========== dry-run / live の決定（純関数） ==========
 * 優先順:
 *  1. PUBLISH_DRY_RUN が "true"/"false" なら明示の上書き（それ以外の値は無視）
 *  2. main 以外の ref では常に dry-run（誤爆防止）
 *  3. workflow_dispatch の live=true → live（明示操作・Variables では止めない）
 *  4. schedule 実行: Variables PUBLISH_ENABLED が "true" → live／"false" → dry-run（オーナーのキルスイッチ・設定ファイルより強い）
 *     未設定なら kessho.config.json の publish.schedule_live に従う（AI が PR で切り替えられる側）
 *  5. それ以外（手元・CI・入力なし）は dry-run */
export function resolveMode({ dryRunEnv, event, ref, liveInput, enabledVar, scheduleLive } = {}) {
  if (dryRunEnv === "false") return { dry: false, reason: "PUBLISH_DRY_RUN=false（明示の上書き）" };
  if (dryRunEnv === "true") return { dry: true, reason: "PUBLISH_DRY_RUN=true（明示の上書き）" };
  if (ref && ref !== "refs/heads/main") return { dry: true, reason: "main 以外の ref（" + ref + "）では送らない" };
  if (liveInput === "true") return ref ? { dry: false, reason: "workflow_dispatch live=true" } : { dry: true, reason: "live=true だが ref 不明（Actions 外）" };
  if (event === "schedule") {
    if (enabledVar === "true") return { dry: false, reason: "Variables PUBLISH_ENABLED=true" };
    if (enabledVar === "false") return { dry: true, reason: "Variables PUBLISH_ENABLED=false（キルスイッチ）" };
    if (scheduleLive === true) return { dry: false, reason: "kessho.config.json publish.schedule_live=true" };
    return { dry: true, reason: "schedule だが本番化されていない（既定 dry-run）" };
  }
  return { dry: true, reason: "既定 dry-run" };
}
export const SITE_URL = "https://kokimi28.github.io/kessho/";
export const STREAM_PATH = join(root, "data/stream.json");
export const MARKER_PATH = process.env.KESSHO_MARKER_PATH || join(root, "data/last-post.json");
export const X_TWEETS_URL = "https://api.twitter.com/2/tweets";
export const X_ME_URL = "https://api.twitter.com/2/users/me";

// X の上限は 280「重み」（CJK・かな・絵文字=2、URL=23）。brypo-landing と同じ計り方。
export const TWEET_WEIGHTED_MAX = 280;
// 前回投稿の「見た粒」を記録する窓（日）。bot コミットは UTC 日付で前日に付くため、
// upTo と同日の粒が後から増える。窓内はキーで、窓の外は日付で新旧を判定する。
export const SEEN_WINDOW_DAYS = 3;
// 「夜」の境界は JST 06:00。nightly（23:45 JST）は GitHub の schedule 遅延で 00:00 JST を越えることがある
// （実績: 03:53 JST 開始）。壁時計の日付を鍵にすると翌夜の投稿が「既投稿」で飛ぶため、06:00 までは前日の夜として扱う。
export const NIGHT_BOUNDARY_H = 6;

/* ========== 日付（JST の夜）・キー ========== */
export const jstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
/** 実行時刻が属する「夜」（JST 06:00 境界の日付）。 */
export const nightOf = (ms) => jstDate(ms - NIGHT_BOUNDARY_H * 3600 * 1000);
export const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY_MS);
export const shiftDay = (d, n) => new Date(toMs(d) + n * DAY_MS).toISOString().slice(0, 10);
export const eventKey = (e) => e.r + "@" + e.h;
const fmt = (n) => n.toLocaleString("en-US");

/* ========== 差分の決定（純関数） ========== */
/** マーカーの「見た粒」を { key: 日付 } に正規化（旧形式の配列も受ける・日付不明は null）。 */
export function seenEntries(marker) {
  const s = marker?.seen;
  if (Array.isArray(s)) return s.map((k) => [k, null]);
  if (s && typeof s === "object") return Object.entries(s);
  return [];
}
/** 今夜の対象になる粒: 夜の日付より未来の日付（時計異常）は対象外。 */
const inScope = (stream, night) => stream.filter((e) => e.d <= night);

/** 前回投稿以降に増えた粒。マーカーが無い初回は前夜ぶんから（UTC 日付のズレで前日に付く夜業を落とさない）。 */
export function freshEvents(stream, marker, night) {
  const scope = inScope(stream, night);
  if (!marker || !marker.upTo) {
    const from = shiftDay(night, -1);
    return scope.filter((e) => e.d >= from);
  }
  const seen = new Set(seenEntries(marker).map(([k]) => k));
  const winStart = shiftDay(marker.upTo, -SEEN_WINDOW_DAYS);
  return scope.filter((e) => e.d > marker.upTo || (e.d >= winStart && !seen.has(eventKey(e))));
}

/** 今夜の投稿計画: 本文・数字・次のマーカー・冪等スキップ判定。副作用なし。 */
export function planNightPost(stream, marker, night) {
  const fresh = freshEvents(stream, marker, night);
  const count = fresh.length;
  const lines = fresh.reduce((s, e) => s + e.n, 0);
  const repos = new Set(fresh.map((e) => e.r)).size;
  const byType = {};
  for (const e of fresh) byType[e.t] = (byType[e.t] ?? 0) + 1;
  const totalEvents = stream.length;
  const totalLines = stream.reduce((s, e) => s + e.n, 0);
  const scope = inScope(stream, night);
  const lastDay = scope.reduce((m, e) => (e.d > m ? e.d : m), "");
  // upTo は後退しない（前回値と今回の最終日付の大きい方）
  const upTo = [marker?.upTo, lastDay].filter(Boolean).sort().pop() ?? night;
  const winStart = shiftDay(upTo, -SEEN_WINDOW_DAYS);
  // 見た粒 = 前回の記録（窓内のもの）＋ 今回の窓内の粒。前回分を引き継ぐのは、clone 失敗などで
  // 一時的にリポが stream から欠けても、既に放送した粒を「未見」に戻さないため。
  const seen = {};
  for (const [k, d] of seenEntries(marker)) if (d === null || d >= winStart) seen[k] = d ?? upTo;
  for (const e of scope) if (e.d >= winStart) seen[eventKey(e)] = e.d;
  // 「n 夜ぶん」は前回の放送からの夜数（粒の日付数ではない: 通常の夜でも UTC 日付は 2 日にまたがる）
  const nightsSince = marker?.night ? Math.max(1, daysBetween(marker.night, night)) : 1;
  const text = composeNightPost({ night, count, lines, repos, nightsSince, byType, totalEvents, totalLines });
  return {
    night, count, lines, repos, nightsSince, byType, upTo, text,
    skip: Boolean(marker && marker.night && marker.night >= night), // 同じ夜（または時計異常で先の夜）に 2 本目は出さない
    nextMarker: { night, upTo, events: count, lines, repos, seen },
  };
}

/* ========== 本文（機械の一文 ＋ 数字 ＋ URL・280 重み以内・ハッシュタグなし） ========== */
export function composeNightPost({ night, count, lines, repos, nightsSince = 1, byType, totalEvents, totalLines }) {
  const total = "結晶は通算 " + fmt(totalEvents) + " 粒・" + fmt(totalLines) + " 行";
  const head = jpDate(night);
  let variants;
  if (count === 0) {
    // 静かな夜も細い糸で正直に描く（STRATEGY §5）
    variants = [
      head + "、静かな夜。新しいかけらは 0 粒。" + total + "のまま。観測所は明日も開いている。",
      head + "、静かな夜。" + total + "のまま。",
    ];
  } else {
    const span = nightsSince > 1 ? nightsSince + " 夜ぶんのかけら" : "今夜のかけら";
    const nums = "+" + fmt(count) + " 粒・+" + fmt(lines) + " 行・" + repos + " リポ";
    variants = [
      head + "の夜業、終了。" + span + " " + nums + "（" + typeMix(byType) + "）。" + total + "。今夜も人間は書いていない。",
      head + "の夜業、終了。" + span + " " + nums + "。" + total + "。今夜も人間は書いていない。",
      head + "の夜業、終了。" + span + " " + nums + "。" + total + "。",
    ];
  }
  for (const v of variants) {
    const t = v + "\n" + SITE_URL;
    if (weightedLength(t) <= TWEET_WEIGHTED_MAX) return t;
  }
  // 最終手段: 本文を切り詰める（URL は必ず残す）
  const budget = TWEET_WEIGHTED_MAX - URL_WEIGHT - 1 /* \n */ - 2 /* … */;
  return trimToWeight(variants[variants.length - 1], budget).trimEnd() + "…\n" + SITE_URL;
}

/* ========== X の重み付き文字数（brypo-landing _publish.ts 移植） ========== */
// 重み 2 の範囲（twitter-text 設定の近似。迷ったら 2 に倒す＝短くなる側に誤る）
function charWeight(cp) {
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals … CJK symbols
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana, Katakana … CJK compat
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xa960 && cp <= 0xa97f) || // Hangul Jamo Ext A
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms (excl. halfwidth kana)
    (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth signs
    cp >= 0x1f000 // emoji & supplementary symbols
  ) return 2;
  return 1;
}
export const URL_WEIGHT = 23;
const URL_RE = /https?:\/\/\S+/g;

function atomize(text) {
  const atoms = [];
  const pushChars = (s) => { for (const ch of s) atoms.push({ s: ch, w: charWeight(ch.codePointAt(0)) }); };
  let last = 0;
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(text)) !== null) {
    pushChars(text.slice(last, m.index));
    atoms.push({ s: m[0], w: URL_WEIGHT }); // URL は 1 原子・重み 23（t.co 短縮）
    last = m.index + m[0].length;
  }
  pushChars(text.slice(last));
  return atoms;
}
/** X 重み付き長さ（CJK/絵文字=2・URL=23・それ以外 1）。 */
export function weightedLength(text) {
  return atomize(text).reduce((s, a) => s + a.w, 0);
}
/** 重み maxW 以内に収まる最長の先頭部分。 */
export function trimToWeight(text, maxW) {
  let out = "", w = 0;
  for (const ch of text) {
    const cw = charWeight(ch.codePointAt(0));
    if (w + cw > maxW) break;
    out += ch; w += cw;
  }
  return out;
}

/* ========== OAuth 1.0a 署名（brypo-landing _publish.ts 移植・X API v2 user context） ========== */
/** RFC 3986 percent-encoding（encodeURIComponent が残す !*'() も符号化）。 */
export function percentEncode(v) {
  return encodeURIComponent(v).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function base64(bytes) {
  const arr = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}
/**
 * `Authorization: OAuth …` ヘッダを組み立てる。JSON ボディは署名基底文字列に入らない。
 * クエリパラメータを持つ要求は queryParams で渡す（基底文字列には入るがヘッダには出ない）。
 * nonce / timestamp は呼び出し側が注入する（決定論にしてテストできるようにするため）。
 */
export async function buildOAuth1Header(method, url, creds, nonce, timestamp, queryParams = {}) {
  const oauthParams = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const paramString = Object.entries({ ...oauthParams, ...queryParams })
    .map(([k, v]) => [percentEncode(k), percentEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join("&");
  const signingKey = percentEncode(creds.consumerSecret) + "&" + percentEncode(creds.accessTokenSecret);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingKey), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const headerParams = { ...oauthParams, oauth_signature: base64(sig) };
  return "OAuth " + Object.keys(headerParams).sort().map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`).join(", ");
}

/* ========== X API 呼び出し（fetch 注入可・テストではダミーを渡す） ========== */
export function readCreds(env) {
  return {
    consumerKey: env.X_API_KEY ?? "",
    consumerSecret: env.X_API_SECRET ?? "",
    accessToken: env.X_ACCESS_TOKEN ?? "",
    accessTokenSecret: env.X_ACCESS_TOKEN_SECRET ?? "",
  };
}
export const credsComplete = (c) => Boolean(c.consumerKey && c.consumerSecret && c.accessToken && c.accessTokenSecret);
const hex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const tweetUrl = (id) => `https://x.com/i/status/${id}`;

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

/** ツイートを 1 本投稿し id を返す。 */
export async function postTweet(creds, text, { fetchImpl = fetch, now = Date.now } = {}) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const auth = await buildOAuth1Header("POST", X_TWEETS_URL, creds, nonce, Math.floor(now() / 1000));
  let res;
  try {
    res = await fetchImpl(X_TWEETS_URL, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, status: 0, detail: "network error or timeout" };
  }
  const data = await readJson(res);
  if (!res.ok) {
    const detail = (data && (data.title || data.detail || data.error)) || `X API returned ${res.status}`;
    return { ok: false, status: res.status, detail: String(detail).slice(0, 200) };
  }
  const id = data?.data?.id;
  if (typeof id !== "string") return { ok: false, status: res.status, detail: "X API response missing tweet id" };
  return { ok: true, id };
}

/** 503 のときだけ 1 回だけ再試行（brypo-landing と同じ判断: 429/5xx/timeout は二重投稿の恐れがあり再試行しない）。 */
export async function postTweetWithRetry(creds, text, opts = {}) {
  let r = await postTweet(creds, text, opts);
  if (!r.ok && r.status === 503) {
    await (opts.sleepImpl ?? sleep)(1_500);
    r = await postTweet(creds, text, opts);
  }
  return r;
}

/** 投稿せずに鍵を確かめる: 署名付き GET /2/users/me。どのアカウントで出るかと、読み取り専用トークンの誤りを検出。 */
export async function verifyXCredentials(creds, { fetchImpl = fetch, now = Date.now } = {}) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const auth = await buildOAuth1Header("GET", X_ME_URL, creds, nonce, Math.floor(now() / 1000));
  let res;
  try {
    res = await fetchImpl(X_ME_URL, { headers: { Authorization: auth }, signal: AbortSignal.timeout(15_000) });
  } catch {
    return { ok: false, detail: "network error or timeout reaching the X API" };
  }
  const data = await readJson(res);
  if (!res.ok) {
    const upstream = (data && (data.title || data.detail || data.error)) || `X API returned ${res.status}`;
    const hint =
      res.status === 401 ? " — keys/tokens rejected: 4 値を再確認（権限変更後はアクセストークンを再生成）"
        : res.status === 403 ? " — authenticated but forbidden: アプリが Read+Write でないか、API クレジットが無い"
          : "";
    return { ok: false, detail: `${String(upstream).slice(0, 160)}${hint}` };
  }
  const handle = typeof data?.data?.username === "string" ? data.data.username : undefined;
  const accessLevel = res.headers.get("x-access-level") ?? "";
  if (accessLevel === "read") {
    return { ok: false, handle, detail: `authenticated as @${handle ?? "?"} but the access token is READ-ONLY — Read and Write にしてアクセストークンを再生成` };
  }
  const write = accessLevel.includes("write") ? "yes" : "unknown";
  return {
    ok: true, handle, write,
    detail: write === "yes"
      ? `authenticated as @${handle ?? "?"} with write access`
      : `authenticated as @${handle ?? "?"} — keys valid（書き込み権限は実投稿でしか確定しない）`,
  };
}

/* ========== main ========== */
async function main() {
  const args = new Set(process.argv.slice(2));
  const mode = resolveMode({
    dryRunEnv: process.env.PUBLISH_DRY_RUN,
    event: process.env.KESSHO_EVENT,
    ref: process.env.KESSHO_REF,
    liveInput: process.env.KESSHO_LIVE_INPUT,
    enabledVar: process.env.PUBLISH_ENABLED,
    scheduleLive: readConfig()?.publish?.schedule_live === true,
  });
  const dry = mode.dry; // 既定は dry-run
  console.log(`[publish-night] mode=${dry ? "dry-run" : "LIVE"}（${mode.reason}）`);
  const creds = readCreds(process.env);

  if (args.has("--verify")) {
    if (!credsComplete(creds)) {
      console.error("[publish-night] X credentials not configured: X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET");
      process.exit(1);
    }
    const v = await verifyXCredentials(creds);
    console.log(`[publish-night] verify: ${v.ok ? "ok" : "NG"} — ${v.detail}`);
    process.exit(v.ok ? 0 : 1);
  }

  const stream = JSON.parse(readFileSync(STREAM_PATH, "utf8"));
  const marker = existsSync(MARKER_PATH) ? JSON.parse(readFileSync(MARKER_PATH, "utf8")) : null;
  const night = nightOf(Date.now());
  const plan = planNightPost(stream, marker, night);

  console.log(`[publish-night] night=${night}（境界 JST ${String(NIGHT_BOUNDARY_H).padStart(2, "0")}:00） fresh=${plan.count} lines=${plan.lines} repos=${plan.repos} nightsSince=${plan.nightsSince} upTo=${plan.upTo} weighted=${weightedLength(plan.text)}/${TWEET_WEIGHTED_MAX}` +
    (marker ? ` last=${marker.night}` : " last=(none)") + ` marker=${MARKER_PATH}`);
  console.log("----- 本文 -----\n" + plan.text + "\n----------------");

  if (dry) {
    console.log("[publish-night] dry-run: 送信しない" + (plan.skip ? "／本番なら既投稿のためスキップ" : ""));
    return;
  }
  if (plan.skip) {
    console.log(`[publish-night] 既投稿（night=${night}）: 2 本目は出さない`);
    return;
  }
  if (!credsComplete(creds)) {
    console.error("[publish-night] X credentials not configured: X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET");
    process.exit(1);
  }
  const r = await postTweetWithRetry(creds, plan.text);
  if (!r.ok) {
    console.error(`[publish-night] X post failed: HTTP ${r.status} ${r.detail}`);
    process.exit(1);
  }
  const record = { ...plan.nextMarker, id: r.id, url: tweetUrl(r.id), at: new Date().toISOString() };
  writeFileSync(MARKER_PATH, JSON.stringify(record, null, 2) + "\n");
  console.log(`[publish-night] posted: ${record.url}（marker: ${MARKER_PATH}）`);
}

// 直接実行のときだけ main（test.mjs からの import では何もしない）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error("[publish-night] error:", err?.message ?? err); process.exit(1); });
}
