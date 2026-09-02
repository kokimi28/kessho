// KESSHO 純ロジックのユニットテスト — 依存ゼロ・ネットワーク不要
// 実行: node --test scripts/test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";
import {
  mulberry32, radiusOf, heatTier, prepStream, buildCluster, buildBranches, computeParents,
  computeNeighbors, makeProjector, fogOf, typeMix, captionFor, nightlyPost,
  updateVisitState, missionTargets, loadMission, inspectMark, lodBand, tiltForZoom, repoStats,
  buildStation, buildRing, observationEvent, LINE_ORDER, TYPE_ORDER,
} from "../src/lib.mjs";
import { render, goatcounterSnippet, GOATCOUNTER_CODE_RE } from "./build.mjs";
import {
  weightedLength, trimToWeight, percentEncode, buildOAuth1Header, composeNightPost, planNightPost, freshEvents, seenEntries, resolveMode,
  jstDate, nightOf, daysBetween, shiftDay, eventKey, postTweet, postTweetWithRetry, verifyXCredentials, readCreds, credsComplete,
  SITE_URL, TWEET_WEIGHTED_MAX, SEEN_WINDOW_DAYS, NIGHT_BOUNDARY_H, URL_WEIGHT, X_TWEETS_URL, X_ME_URL,
} from "./publish-night.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STREAM = JSON.parse(readFileSync(join(root, "data/stream.json"), "utf8"));
const SECTOR = {}; LINE_ORDER.forEach((l, i) => { SECTOR[l] = -Math.PI / 2 + (i * 2 * Math.PI) / LINE_ORDER.length; });

test("PRNG は決定論（同 seed → 同列・異 seed → 異列）", () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = Array.from({ length: 8 }, a), sb = Array.from({ length: 8 }, b), sc = Array.from({ length: 8 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test("radiusOf は単調非減少・上限つき・誇張なし", () => {
  assert.ok(radiusOf(1) < radiusOf(100));
  assert.ok(radiusOf(100) < radiusOf(10000));
  assert.equal(radiusOf(1e9), 8);
  assert.ok(radiusOf(0) >= 1.5);
});

test("heatTier の境界", () => {
  assert.equal(heatTier(0), 0);
  assert.equal(heatTier(0.99), 0);
  assert.equal(heatTier(1), 1);
  assert.equal(heatTier(6.99), 1);
  assert.equal(heatTier(7), 2);
  assert.equal(heatTier(29.99), 2);
  assert.equal(heatTier(30), 3);
});

test("prepStream: 前置換表と夜報の整合", () => {
  const S = prepStream(STREAM);
  assert.ok(S.nDays > 0);
  assert.equal(S.cumByDay[S.nDays], STREAM.length + 1); // 最終日はシード粒込み全量
  for (let v = 1; v < S.cumByDay.length; v++) assert.ok(S.cumByDay[v] >= S.cumByDay[v - 1]); // 単調
  const nightsCount = S.nights.reduce((s, n) => s + n.count, 0);
  const nightsLines = S.nights.reduce((s, n) => s + n.lines, 0);
  assert.equal(nightsCount, STREAM.length);
  assert.equal(nightsLines, S.totalLines);
  // 夜報の base + count が stream の連続区間を指す
  for (const nt of S.nights) {
    for (let i = nt.base; i < nt.base + nt.count; i++) assert.equal(STREAM[i].d, nt.d);
  }
});

test("buildCluster: 決定論・全粒配置・奥行き上限", () => {
  const c1 = buildCluster(STREAM, 20260729, SECTOR, 0.22);
  const c2 = buildCluster(STREAM, 20260729, SECTOR, 0.22);
  assert.equal(c1.pts.length, STREAM.length + 1); // 全イベントが必ず粒になる
  assert.equal(c1.clusterR, c2.clusterR);
  const sum1 = c1.pts.reduce((s, p) => s + p.x + p.y + p.z, 0);
  const sum2 = c2.pts.reduce((s, p) => s + p.x + p.y + p.z, 0);
  assert.equal(sum1, sum2); // 座標まで完全一致（定点観測の成立条件）
  const amp = Math.max(c1.clusterR * 0.30, 24);
  for (const p of c1.pts) assert.ok(Math.abs(p.z) <= amp + 1e-9);
  // cr（成長半径の履歴）は単調非減少
  for (let i = 2; i < c1.pts.length; i++) assert.ok(c1.pts[i].cr >= c1.pts[i - 1].cr - 1e-9);
});

test("computeParents: 親は常に先行粒", () => {
  const c = buildCluster(STREAM.slice(0, 60), 1, SECTOR, 0.22);
  const par = computeParents(c.pts);
  for (let i = 1; i < c.pts.length; i++) assert.ok(par[i] < i);
});

test("computeNeighbors: 対称半径条件", () => {
  const c = buildCluster(STREAM.slice(0, 40), 1, SECTOR, 0.22);
  const nb = computeNeighbors(c.pts, 30);
  nb.forEach((list, i) => {
    for (const j of list) {
      const d = Math.hypot(c.pts[i].x - c.pts[j].x, c.pts[i].y - c.pts[j].y, c.pts[i].z - c.pts[j].z);
      assert.ok(d < 30);
    }
  });
});

test("makeProjector: 中心不動・k の正値・霧の範囲", () => {
  const F = 500;
  const proj = makeProjector(0.7, -0.78, F);
  const o = {};
  proj(0, 0, 0, o);
  assert.ok(Math.abs(o.x) < 1e-9 && Math.abs(o.y) < 1e-9 && Math.abs(o.k - 1) < 1e-9);
  for (const [x, y, z] of [[100, 50, 20], [-200, 10, -40], [0, 250, 0]]) {
    proj(x, y, z, o);
    assert.ok(o.k > 0 && Number.isFinite(o.x) && Number.isFinite(o.y));
    const f = fogOf(o.d, 250);
    assert.ok(f >= 0.42 - 1e-9 && f <= 1.0 + 1e-9);
  }
});

test("lodBand: 台形の出入り（地図の縮尺別ラベル）", () => {
  // ライン名: 遠景で 1 → z=1.35 から減衰 → 1.85 で消滅
  assert.equal(lodBand(1.0, -1, 0, 1.35, 1.85), 1);
  assert.ok(lodBand(1.6, -1, 0, 1.35, 1.85) > 0 && lodBand(1.6, -1, 0, 1.35, 1.85) < 1);
  assert.equal(lodBand(1.85, -1, 0, 1.35, 1.85), 0);
  // リポ名: z=1.35 から現れ 1.8 で全開 → 3.8 で消滅
  assert.equal(lodBand(1.0, 1.35, 1.8, 3.1, 3.8), 0);
  assert.equal(lodBand(2.5, 1.35, 1.8, 3.1, 3.8), 1);
  assert.equal(lodBand(3.8, 1.35, 1.8, 3.1, 3.8), 0);
  // 端の単調性
  assert.ok(lodBand(1.5, 1.35, 1.8, 3.1, 3.8) < lodBand(1.7, 1.35, 1.8, 3.1, 3.8));
});

test("文言生成: 内訳・字幕・夜報投稿", () => {
  assert.equal(typeMix({ feat: 2, fix: 1 }), "feat 2・fix 1");
  const e = { r: "brypo", t: "fix", n: 1234, d: "2026-07-01", l: "saas", s: "x" };
  assert.equal(captionFor(e), "brypo ← fix +1,234行");
  const S = prepStream(STREAM);
  const post = nightlyPost(S.nights[S.nights.length - 1], STREAM.length, S.totalLines);
  assert.ok(post.includes("夜業"));
  assert.ok(post.includes(String(S.nights[S.nights.length - 1].count) + " 粒"));
  assert.ok(post.includes("今夜も人間は書いていない"));
});

test("観測記録: 初回・同日・連続・途切れ・差分", () => {
  const r1 = updateVisitState(null, "2026-07-30", 100, 5000);
  assert.deepEqual(r1.state, { first: "2026-07-30", last: "2026-07-30", visits: 1, streak: 1, seenEvents: 100, seenLines: 5000 });
  assert.equal(r1.catchup, null);
  // 同日再訪: streak 維持・visits 増
  const r2 = updateVisitState(r1.state, "2026-07-30", 100, 5000);
  assert.equal(r2.state.streak, 1);
  assert.equal(r2.state.visits, 2);
  assert.equal(r2.catchup, null);
  // 翌日 + 差分あり
  const r3 = updateVisitState(r2.state, "2026-07-31", 108, 6200);
  assert.equal(r3.state.streak, 2);
  assert.deepEqual(r3.catchup, { events: 8, lines: 1200 });
  // 3日空き → streak リセット・差分は保持
  const r4 = updateVisitState(r3.state, "2026-08-03", 120, 9000);
  assert.equal(r4.state.streak, 1);
  assert.deepEqual(r4.catchup, { events: 12, lines: 2800 });
  assert.equal(r4.state.first, "2026-07-30"); // 初観測日は不変
});

test("検分ミッション: 対象生成・復元・進行・完了", () => {
  const S = prepStream(STREAM);
  const m = missionTargets(S.nights);
  const nt = S.nights[S.nights.length - 1];
  assert.equal(m.date, nt.d);
  assert.equal(m.targets.length, nt.count);
  // 対象は最新夜の pts index（stream index + 1）
  assert.equal(m.targets[0], nt.base + 1);
  // 復元: 日付一致なら done を対象で濾過、別日なら白紙
  const st0 = loadMission(null, m.date, m.targets);
  assert.deepEqual(st0, { date: m.date, done: [] });
  const stale = loadMission({ date: "2000-01-01", done: [m.targets[0]] }, m.date, m.targets);
  assert.deepEqual(stale.done, []);
  const kept = loadMission({ date: m.date, done: [m.targets[0], 99999] }, m.date, m.targets);
  assert.deepEqual(kept.done, [m.targets[0]]);
  // 進行: 対象外・重複は無変化。全部済んだ一手だけ complete
  let st = st0, completed = 0;
  const miss = inspectMark(st, 99999, m.targets);
  assert.equal(miss.changed, false);
  for (const idx of m.targets) {
    const r = inspectMark(st, idx, m.targets);
    assert.equal(r.changed, true);
    st = r.m;
    if (r.complete) completed++;
  }
  assert.equal(completed, 1);
  assert.equal(st.done.length, m.targets.length);
  const dup = inspectMark(st, m.targets[0], m.targets);
  assert.equal(dup.changed, false);
  assert.equal(dup.complete, false);
});

test("枝配置: 意味のある位置（枝=リポの年表・決定論・全粒配置）", () => {
  const c1 = buildBranches(STREAM, 20260729, SECTOR);
  const c2 = buildBranches(STREAM, 20260729, SECTOR);
  assert.equal(c1.pts.length, STREAM.length + 1);
  assert.equal(
    c1.pts.reduce((s, p) => s + p.x + p.y + p.z, 0),
    c2.pts.reduce((s, p) => s + p.x + p.y + p.z, 0),
  );
  // parent の意味: リポ最初の粒は幹(0)、それ以外は「同じリポの直前のコミット」
  const lastOf = new Map();
  for (let i = 1; i < c1.pts.length; i++) {
    const e = c1.pts[i].e;
    assert.ok(c1.parent[i] < i);
    if (lastOf.has(e.r)) assert.equal(c1.parent[i], lastOf.get(e.r), "枝が年表順に繋がっていない");
    else assert.equal(c1.parent[i], 0, "リポ最初の粒は幹に付く");
    lastOf.set(e.r, i);
  }
  // 奥行きの上限と成長半径の単調性
  for (const p of c1.pts) assert.ok(Math.abs(p.z) <= 40 + 1e-9);
  for (let i = 2; i < c1.pts.length; i++) assert.ok(c1.pts[i].cr >= c1.pts[i - 1].cr - 1e-9);
  // 枝の先端 = 各リポの最新コミット（時間が位置になっている）
  const tip = lastOf.get(STREAM[STREAM.length - 1].r);
  assert.equal(tip, STREAM.length, "最新コミットが最後の粒");
});

test("カメラ: 全景=正面のダイアグラム・潜るほど倒れる（単調・端点）", () => {
  assert.ok(Math.abs(tiltForZoom(1) - -0.08) < 1e-9);
  assert.ok(Math.abs(tiltForZoom(0.6) - -0.08) < 1e-9);
  assert.ok(Math.abs(tiltForZoom(2.65) - -0.55) < 1e-9);
  assert.ok(Math.abs(tiltForZoom(7) - -0.55) < 1e-9);
  assert.ok(tiltForZoom(1.5) > tiltForZoom(2.0)); // 潜るほど倒れる（-0.08 → -0.55）
});

test("陳列統計 repoStats: 合計・最新夜・週次律動の整合", () => {
  const S = prepStream(STREAM);
  const repo = STREAM[STREAM.length - 1].r;
  const st = repoStats(STREAM, repo, S.lastDay);
  const evs = STREAM.filter((e) => e.r === repo);
  assert.equal(st.total, evs.length);
  assert.equal(st.lines, evs.reduce((s, e) => s + e.n, 0));
  assert.equal(st.lastD, evs[evs.length - 1].d);
  assert.equal(st.lastCount, evs.filter((e) => e.d === st.lastD).length);
  assert.ok(st.week <= st.total);
  assert.ok(st.weekly.length === 8);
  assert.ok(st.weekly.reduce((a, b) => a + b, 0) <= st.total);
  assert.equal(Object.values(st.byType).reduce((a, b) => a + b, 0), st.total);
  assert.ok(st.activeDays >= 1 && st.first <= st.lastD);
});

test("ステーション配置: モジュール=リポ・窓=年表・決定論", () => {
  const c1 = buildStation(STREAM, 20260729, SECTOR);
  const c2 = buildStation(STREAM, 20260729, SECTOR);
  const repos = new Set(STREAM.map((e) => e.r));
  assert.equal(c1.modules.length, repos.size, "モジュール数=リポ数");
  assert.equal(c1.pts.length, STREAM.length + 1, "窓=全コミット");
  assert.equal(
    c1.pts.reduce((s, p) => s + p.x + p.y + p.z, 0),
    c2.pts.reduce((s, p) => s + p.x + p.y + p.z, 0),
  );
  // 窓は自分のモジュールの船体上（軸からの距離 ≤ 幅/2 + 誤差、軸方向は d0..d0+len 内）
  const byRepo = new Map(c1.modules.map((m) => [m.r, m]));
  for (let i = 1; i < c1.pts.length; i++) {
    const p = c1.pts[i], m = byRepo.get(p.e.r);
    const alongAxis = p.x * Math.cos(m.a) + p.y * Math.sin(m.a);
    const offAxis = Math.abs(-p.x * Math.sin(m.a) + p.y * Math.cos(m.a));
    assert.ok(alongAxis >= m.d0 - 1 && alongAxis <= m.d0 + m.len + 1, "窓が船体の軸範囲内");
    assert.ok(offAxis <= m.w / 2 + 1, "窓が船体幅の中");
  }
  // parent は同リポの直前コミット
  const lastOf = new Map();
  for (let i = 1; i < c1.pts.length; i++) {
    const e = c1.pts[i].e;
    if (lastOf.has(e.r)) assert.equal(c1.parent[i], lastOf.get(e.r));
    else assert.equal(c1.parent[i], 0);
    lastOf.set(e.r, i);
  }
  // モジュール寸法の妥当域
  for (const m of c1.modules) {
    assert.ok(m.len >= 34 && m.len <= 150);
    assert.ok(m.w >= 15 && m.w <= 30);
  }
});


test("環状線: 駅は均一・窓はポッド内フィロタキシス・年表連結・決定論", () => {
  const c1 = buildRing(STREAM, 20260729, LINE_ORDER);
  const c2 = buildRing(STREAM, 20260729, LINE_ORDER);
  const repos = new Set(STREAM.map((e) => e.r));
  assert.equal(c1.stations.length, repos.size);
  assert.equal(c1.pts.length, STREAM.length + 1);
  assert.equal(
    c1.pts.reduce((s, p) => s + p.x + p.y + p.z, 0),
    c2.pts.reduce((s, p) => s + p.x + p.y + p.z, 0),
  );
  // 全駅が同一半径の環上（均一 = ベックの原理）
  for (const st of c1.stations) {
    assert.ok(Math.abs(Math.hypot(st.cx, st.cy) - c1.RING) < 1e-9, "駅が環上にある");
  }
  // 同ラインの駅は隣接（路線弧が引ける）
  const seq = c1.stations.map((st) => st.l);
  let switches = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) switches++;
  assert.ok(switches <= new Set(seq).size, "ラインが環上で分断されていない");
  // 窓は自駅ポッド内（フィロタキシス半径 ≤ POD*0.8 + 粒半径）
  const byRepo = new Map(c1.stations.map((st) => [st.r, st]));
  for (let i = 1; i < c1.pts.length; i++) {
    const p = c1.pts[i], st = byRepo.get(p.e.r);
    const d = Math.hypot(p.x - st.cx, p.y - st.cy);
    assert.ok(d <= c1.POD * 0.8 + 0.001, "窓がポッド内に収まる");
  }
  // parent は同リポの直前コミット
  const lastOf = new Map();
  for (let i = 1; i < c1.pts.length; i++) {
    const e = c1.pts[i].e;
    if (lastOf.has(e.r)) assert.equal(c1.parent[i], lastOf.get(e.r));
    else assert.equal(c1.parent[i], 0);
    lastOf.set(e.r, i);
  }
});

test("回帰: 本番データの結晶チェックサム（形の凍結）", () => {
  const c = buildRing(STREAM, 20260729, LINE_ORDER);
  let cs = 0;
  for (const p of c.pts) cs = (cs + Math.round((p.x + 1000) * 7 + (p.y + 1000) * 13 + (p.z + 1000) * 17)) % 1000000007;
  const snapPath = join(root, "data/shape-checksum.json");
  if (existsSync(snapPath)) {
    const snap = JSON.parse(readFileSync(snapPath, "utf8"));
    if (snap.events === STREAM.length) {
      assert.equal(cs, snap.checksum, "同一データで結晶の形が変わった（決定論の破れ）");
    }
  }
  console.log("shape checksum:", cs, "events:", STREAM.length, "clusterR:", c.clusterR.toFixed(2));
});

/* ===== ビルド成果物: 外部参照の許可リスト（DESIGN.md §14「計測の例外」） =====
 * 描画は外部に依存しない。許可する外部リソース参照は gc.zgo.at（GoatCounter count.js）のみ。
 * ビーコン送信先 <code>.goatcounter.com/count は data 属性（リソース読込ではない）で、設定ビルドにだけ現れてよい。
 * 検査対象は描画コード（css/html/js）。埋め込みデータ（コミット件名＝外部入力）は除外する。 */
const ALLOWED_HOSTS = ["gc.zgo.at"];
const hostOf = (u) => { const m = /^\s*(?:https?:)?\/\/([^/"'\s?#]+)/i.exec(u); return m ? m[1].toLowerCase() : null; };
// リソース読込になりうる参照: src= / href= / url( / @import のうち、絶対 URL とプロトコル相対 URL
function resourceRefs(html) {
  const out = [];
  const re = /\b(?:src|href)\s*=\s*["']([^"']*)["']|url\(\s*["']?([^"')]*)["']?\s*\)|@import\s+(?:url\()?["']?([^"');\s]+)/gi;
  let m;
  while ((m = re.exec(html))) { const u = m[1] ?? m[2] ?? m[3] ?? ""; const h = hostOf(u); if (h) out.push({ url: u, host: h }); }
  return out;
}
// 文書全体に現れる外部ホスト（http(s):// と //host）— 属性以外（fetch 等）の混入も捕まえる
function urlHosts(html) {
  const out = new Set();
  const re = /(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[/"'\s?#),;:.<`\\]|$)/gi;
  let m;
  while ((m = re.exec(html))) out.add(m[1].toLowerCase());
  return out;
}
const beaconHost = (code) => code + ".goatcounter.com";
// 検査対象 = 描画コードのみ（埋め込みデータを取り除く）
const codeOnly = (html, dataJson) => html.split(dataJson).join("");
const hasBeacon = (h) => /gc\.zgo\.at|data-goatcounter=|\.goatcounter\.com/.test(h);
function assertSelfContained(html, label) {
  assert.ok(!html.includes("__DATA__"), label + ": データ未注入");
  assert.ok(html.includes("prepStream"), label + ": lib 未連結");
  assert.ok(html.includes("tabbar"), label + ": アプリ骨格欠落");
  for (const ty of TYPE_ORDER) assert.ok(html.includes(ty));
}

test("ビルド(a) GOATCOUNTER_CODE 未設定: 外部参照ゼロ・データ埋め込み済み", () => {
  const r = render({});
  const { full, artifact, dataJson } = r;
  assertSelfContained(full, "index");
  assert.ok(full.includes(dataJson), "dataJson が成果物に埋め込まれている");
  const code = codeOnly(full, dataJson);
  assert.deepEqual(resourceRefs(code), [], "外部リソース参照が混入");
  assert.deepEqual([...urlHosts(code)], [], "外部ホストが混入");
  assert.ok(!hasBeacon(full), "未設定なのにビーコンが注入された");
  assert.ok(!hasBeacon(artifact), "artifact にビーコン");
  assert.equal(render({ goatcounterCode: "" }).full, full, "空文字は未設定と同じ");
  assert.equal(render({ goatcounterCode: undefined }).full, full);
  // 埋め込みデータは "<" を含まない（件名で </script> を閉じられない）。JSON としては同値
  assert.ok(!dataJson.includes("<"), "埋め込み JSON に生の < が残っている");
  assert.deepEqual(JSON.parse(dataJson).length, STREAM.length);
  assert.deepEqual(JSON.parse(dataJson).map((e) => e.s), STREAM.map((e) => e.s), "エスケープで件名が変わった");
});

test("ビルド(b) GOATCOUNTER_CODE 設定: 外部参照は gc.zgo.at のみ・</head> 直前に 1 回・artifact には出ない", () => {
  const code = "kessho-test";
  const { full, artifact, dataJson } = render({ goatcounterCode: code });
  assertSelfContained(full, "index");
  const html = codeOnly(full, dataJson);
  const refs = resourceRefs(html);
  assert.deepEqual(refs.map((r) => r.host), ["gc.zgo.at"], "許可リスト外の外部リソース参照: " + JSON.stringify(refs));
  for (const r of refs) assert.ok(ALLOWED_HOSTS.includes(r.host));
  // 文書全体: gc.zgo.at とビーコン送信先以外の外部ホストは存在しない
  const extra = [...urlHosts(html)].filter((h) => !ALLOWED_HOSTS.includes(h) && h !== beaconHost(code));
  assert.deepEqual(extra, [], "想定外の外部ホスト");
  // 送信先は data 属性で厳密一致（script src ではない）
  assert.ok(full.includes('data-goatcounter="https://' + code + '.goatcounter.com/count"'));
  const snippet = goatcounterSnippet(code);
  assert.equal(snippet, '<script data-goatcounter="https://kessho-test.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>', "snippet は仕様どおり");
  assert.equal(full.split(snippet).length - 1, 1, "ビーコンは 1 回だけ");
  assert.ok(full.includes(snippet + "\n</head>"), "</head> 直前に注入");
  assert.ok(!hasBeacon(artifact), "artifact 版には注入しない");
  // 注入は head だけ: body/script 側は未設定ビルドと同一
  const plain = render({}).full;
  assert.equal(full.slice(full.indexOf("<body>")), plain.slice(plain.indexOf("<body>")), "body は不変（描画に影響なし）");
});

test("ビルド(c) GOATCOUNTER_CODE の形式: 英数字とハイフンのみ・不正は黙って落とさず例外", () => {
  assert.ok(GOATCOUNTER_CODE_RE.test("kessho"));
  assert.ok(GOATCOUNTER_CODE_RE.test("kessho-2026"));
  assert.ok(!GOATCOUNTER_CODE_RE.test("bad code"));
  assert.ok(!GOATCOUNTER_CODE_RE.test('x".goatcounter.com/evil?"'));
  assert.ok(!GOATCOUNTER_CODE_RE.test("-lead"));
  assert.throws(() => render({ goatcounterCode: 'a"><script>' }), /形式が不正/);
});

test("設定ファイル kessho.config.json: goatcounter_code から注入・環境変数が優先・空なら注入なし・公開値のみ", () => {
  const viaCfg = render({ config: { goatcounter_code: "kessho" } });
  assert.ok(viaCfg.full.includes(goatcounterSnippet("kessho")), "設定ファイルの code で注入");
  const envWins = render({ goatcounterCode: "from-env", config: { goatcounter_code: "kessho" } });
  assert.ok(envWins.full.includes(goatcounterSnippet("from-env")), "環境変数が優先");
  assert.ok(!envWins.full.includes("kessho.goatcounter.com"));
  assert.ok(!hasBeacon(render({ config: {} }).full), "両方空なら注入なし");
  assert.ok(!hasBeacon(render({ goatcounterCode: "", config: { goatcounter_code: "" } }).full));
  assert.throws(() => render({ config: { goatcounter_code: "bad code" } }), /形式が不正/);
  const cfg = JSON.parse(readFileSync(join(root, "kessho.config.json"), "utf8"));
  assert.equal(typeof cfg.goatcounter_code, "string");
  assert.equal(typeof cfg.publish.schedule_live, "boolean");
  if (cfg.goatcounter_code) assert.ok(GOATCOUNTER_CODE_RE.test(cfg.goatcounter_code));
  // 公開値だけ: 値は短い識別子か真偽値のみ（長い文字列＝鍵らしきものを置かない）
  const walk = (v) => (v && typeof v === "object") ? Object.values(v).every(walk) : (typeof v !== "string" || v.length <= 64 || v.startsWith("公開値"));
  assert.ok(walk(cfg), "設定ファイルに長い文字列を置かない");
});

test("dry/live の決定 resolveMode: 優先順（明示 > main 以外 > live 入力 > Variables > 設定ファイル > 既定）", () => {
  const dry = (o) => resolveMode(o).dry;
  assert.equal(dry({}), true, "何も無ければ dry-run");
  assert.equal(dry({ dryRunEnv: "false" }), false, "明示の上書き");
  assert.equal(dry({ dryRunEnv: "true", event: "schedule", ref: "refs/heads/main", enabledVar: "true" }), true);
  assert.equal(dry({ dryRunEnv: "maybe", event: "schedule", ref: "refs/heads/main", enabledVar: "true" }), false, "不正値は無視して次へ");
  assert.equal(dry({ event: "workflow_dispatch", ref: "refs/heads/feature", liveInput: "true" }), true, "main 以外では送らない");
  assert.equal(dry({ event: "workflow_dispatch", ref: "refs/heads/main", liveInput: "true", enabledVar: "false" }), false, "live=true は Variables で止めない");
  assert.equal(dry({ event: "workflow_dispatch", ref: "refs/heads/main", liveInput: "false" }), true);
  assert.equal(dry({ event: "schedule", ref: "refs/heads/main", enabledVar: "true", scheduleLive: false }), false);
  assert.equal(dry({ event: "schedule", ref: "refs/heads/main", enabledVar: "false", scheduleLive: true }), true, "Variables=false は設定ファイルより強い（キルスイッチ）");
  assert.equal(dry({ event: "schedule", ref: "refs/heads/main", enabledVar: "", scheduleLive: true }), false, "Variables 未設定なら設定ファイル");
  assert.equal(dry({ event: "schedule", ref: "refs/heads/main", scheduleLive: true }), false);
  assert.equal(dry({ event: "schedule", ref: "refs/heads/main", scheduleLive: false }), true);
  assert.equal(dry({ event: "schedule", ref: "refs/heads/main", scheduleLive: "true" }), true, "boolean の true 以外は本番化しない");
  assert.equal(dry({ event: "push", ref: "refs/heads/main", scheduleLive: true }), true, "schedule 以外の自動実行は送らない");
  assert.equal(dry({ liveInput: "true" }), true, "Actions 外の live 入力は無効");
  for (const o of [{}, { event: "schedule", ref: "refs/heads/main" }, { dryRunEnv: "false" }]) {
    const m = resolveMode(o); assert.ok(typeof m.reason === "string" && m.reason.length > 0);
  }
});

test("ビルド(d) dist/index.html（コミット済み成果物）も許可リストを満たす", () => {
  const distPath = join(root, "dist/index.html");
  if (!existsSync(distPath)) { console.log("dist 未ビルドのためスキップ"); return; }
  const html0 = readFileSync(distPath, "utf8");
  assertSelfContained(html0, "dist");
  const html = codeOnly(html0, render({}).dataJson);
  for (const r of resourceRefs(html)) assert.ok(ALLOWED_HOSTS.includes(r.host), "dist に許可外の外部参照: " + r.url);
  for (const h of urlHosts(html)) assert.ok(ALLOWED_HOSTS.includes(h) || h.endsWith(".goatcounter.com"), "dist に想定外の外部ホスト: " + h);
});

test("外部参照スキャナ自体の感度（すり抜けの回帰）", () => {
  assert.deepEqual([...urlHosts('<img srcset="https://cdn.example.com/a.png 2x">')], ["cdn.example.com"]);
  assert.deepEqual([...urlHosts("fetch(`https://api.example.org:8443/x`)")], ["api.example.org"]);
  assert.deepEqual([...urlHosts("see //static.example.net.")], ["static.example.net"]);
  assert.deepEqual([...urlHosts('<link rel=preload href=//fonts.example.com/f.woff2>')], ["fonts.example.com"]);
  assert.deepEqual([...urlHosts("url(HTTPS://X.Example.com/bg.png)")], ["x.example.com"]);
  assert.deepEqual(resourceRefs("@import url('https://a.example.com/s.css');").map((r) => r.host), ["a.example.com"]);
  assert.deepEqual(resourceRefs('<iframe src="//b.example.com/">').map((r) => r.host), ["b.example.com"]);
  assert.deepEqual([...urlHosts("// ふつうのコメント。http:// だけの断片や相対 /path は外部ではない")], []);
});

test("バンドルのトップレベル宣言が window のプロパティを隠さない（count.js のフレーム判定を壊さない）", () => {
  // 単一 <script> のトップレベル const/let/function はページ全体のグローバル環境に入り、同名の window プロパティを
  // 全スクリプトから隠す。count.js は `location !== parent.location` でフレーム内を除外するため、`parent` を
  // 宣言すると何も計測されない（実物の count.js で再現済み）。
  const src = readFileSync(join(root, "src/lib.mjs"), "utf8").replace(/^export /gm, "") + "\n" + readFileSync(join(root, "src/app.js"), "utf8");
  const names = new Set();
  for (const m of src.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^(?:const|let|var)\s+\{([^}]*)\}/gm)) {
    for (const n of m[1].split(",")) { const k = n.split(":").pop().split("=")[0].trim(); if (k) names.add(k); }
  }
  const reserved = ["parent", "top", "self", "window", "document", "location", "navigator", "screen", "history",
    "localStorage", "sessionStorage", "Image", "encodeURIComponent", "setTimeout", "addEventListener", "performance",
    "console", "name", "status", "event", "frames", "origin", "fetch", "Date", "Math", "JSON"];
  const clash = reserved.filter((r) => names.has(r));
  assert.deepEqual(clash, [], "window のプロパティを隠すトップレベル宣言: " + clash.join(", "));
  assert.ok(names.has("parentIdx"), "改名後の識別子 parentIdx が見当たらない");
  assert.ok(names.size > 100, "宣言の抽出が動いていない");
});

test("計測イベント: 観測記録の有無で first / return（純関数）", () => {
  assert.equal(observationEvent(null), "event/first");
  assert.equal(observationEvent(undefined), "event/first");
  assert.equal(observationEvent({}), "event/first");
  assert.equal(observationEvent({ first: "2026-07-30", last: "2026-07-30", visits: 1, streak: 1 }), "event/return");
  // app.js は初期化時に 1 回だけ送り、goatcounter 未注入なら何もしない（例外なし）
  const app = readFileSync(join(root, "src/app.js"), "utf8");
  assert.ok(app.includes("script[data-goatcounter]"), "count.js の load 待ちが無い");
  assert.ok(app.includes("gc.count({ path, event: true })"), "イベント送信の形が仕様と違う");
});

/* ===== 放送（X 自動投稿・DESIGN.md §15） ===== */
test("JST の夜（06:00 境界）・日付シフト・粒キー", () => {
  assert.equal(jstDate(Date.UTC(2026, 8, 2, 14, 45)), "2026-09-02");
  assert.equal(jstDate(Date.UTC(2026, 8, 2, 15, 30)), "2026-09-03");
  assert.equal(NIGHT_BOUNDARY_H, 6);
  assert.equal(nightOf(Date.UTC(2026, 8, 2, 14, 45)), "2026-09-02"); // 23:45 JST（nightly の予定時刻）
  assert.equal(nightOf(Date.UTC(2026, 8, 2, 18, 53)), "2026-09-02"); // 03:53 JST 翌日（schedule 遅延の実績）→ 同じ夜
  assert.equal(nightOf(Date.UTC(2026, 8, 2, 20, 59)), "2026-09-02"); // 05:59 JST → まだ同じ夜
  assert.equal(nightOf(Date.UTC(2026, 8, 2, 21, 0)), "2026-09-03"); // 06:00 JST → 次の夜
  assert.equal(nightOf(Date.UTC(2026, 8, 3, 1, 0)), "2026-09-03"); // 10:00 JST の手動実行 → その日の夜として数える
  assert.equal(nightOf(Date.UTC(2026, 11, 31, 20, 0)), "2026-12-31"); // 05:00 JST 1/1 → 12/31 の夜
  assert.equal(shiftDay("2026-09-01", -1), "2026-08-31");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  assert.equal(daysBetween("2026-09-03", "2026-09-06"), 3);
  assert.equal(daysBetween("2026-09-06", "2026-09-06"), 0);
  assert.equal(eventKey({ r: "brypo", h: "abc1234" }), "brypo@abc1234");
});

test("重み付き文字数（X 仕様: CJK/絵文字=2・URL=23）と切り詰め", () => {
  assert.equal(weightedLength("hello world"), 11);
  assert.equal(weightedLength("あいう"), 6);
  assert.equal(weightedLength("日本語"), 6);
  assert.equal(weightedLength("가나"), 4);
  assert.equal(weightedLength("https://example.com/a-very-long-path-that-exceeds-23-characters"), URL_WEIGHT);
  assert.equal(weightedLength("see https://x.com/x"), 4 + URL_WEIGHT);
  assert.equal(weightedLength("hi 😀"), 3 + 2);
  assert.equal(weightedLength("結晶\n" + SITE_URL), 4 + 1 + URL_WEIGHT);
  assert.equal(trimToWeight("日本語abc", 5), "日本");
  assert.equal(trimToWeight("abcdef", 3), "abc");
});

const ev = (d, r, h, n = 10, t = "docs") => ({ d, r, l: "foundation", t, n, s: "subject", h });

test("本文: 機械の一文＋数字＋URL・280 重み以内・ハッシュタグなし・静かな夜", () => {
  const active = composeNightPost({ night: "2026-09-02", count: 31, lines: 168, repos: 1, nightsSince: 1, byType: { docs: 26, refactor: 4, other: 1 }, totalEvents: 1003, totalLines: 254825 });
  assert.ok(active.startsWith("9月2日の夜業、終了。今夜のかけら"));
  assert.ok(active.includes("+31 粒・+168 行・1 リポ"));
  assert.ok(active.includes("docs 26・refactor 4・other 1"));
  assert.ok(active.includes("結晶は通算 1,003 粒・254,825 行"));
  assert.ok(active.includes("今夜も人間は書いていない。"));
  assert.ok(active.endsWith("\n" + SITE_URL), "末尾は公開 URL");
  assert.ok(!active.includes("#"), "ハッシュタグなし");
  assert.ok(weightedLength(active) <= TWEET_WEIGHTED_MAX);
  // 放送が止まっていた後の再開は「n 夜ぶん」（前回の放送からの夜数で決める）
  const multi = composeNightPost({ night: "2026-09-05", count: 40, lines: 900, repos: 4, nightsSince: 3, byType: { feat: 40 }, totalEvents: 1100, totalLines: 300000 });
  assert.ok(multi.includes("3 夜ぶんのかけら +40 粒・+900 行・4 リポ"));
  // 静かな夜（差分 0）も投稿する
  const quiet = composeNightPost({ night: "2026-09-03", count: 0, lines: 0, repos: 0, nightsSince: 1, byType: {}, totalEvents: 1003, totalLines: 254825 });
  assert.ok(quiet.startsWith("9月3日、静かな夜。"));
  assert.ok(quiet.includes("0 粒"));
  assert.ok(quiet.includes("結晶は通算 1,003 粒・254,825 行のまま"));
  assert.ok(quiet.endsWith("\n" + SITE_URL));
  assert.ok(!quiet.includes("#"));
  assert.ok(weightedLength(quiet) <= TWEET_WEIGHTED_MAX);
  // 極端な数字・全種別でも上限を超えない（段階的に短くする・URL は必ず残る）
  const extreme = composeNightPost({ night: "2026-12-31", count: 99999, lines: 99999999, repos: 13, nightsSince: 365, byType: { feat: 9999, fix: 9999, docs: 9999, test: 9999, refactor: 9999, other: 9999 }, totalEvents: 9999999, totalLines: 9999999999 });
  assert.ok(weightedLength(extreme) <= TWEET_WEIGHTED_MAX, "weighted=" + weightedLength(extreme));
  assert.ok(extreme.endsWith("\n" + SITE_URL));
  assert.ok(extreme.includes("+99,999 粒"));
});

test("差分の決定: 初回は前夜ぶん・以降は前回投稿以降（窓内はキー・窓外は日付）・seen の引き継ぎ・未来日付・1 日 1 本", () => {
  const S1 = [ev("2026-08-28", "a", "h1"), ev("2026-08-31", "a", "h2"), ev("2026-09-01", "a", "h3", 100, "feat"), ev("2026-09-01", "b", "h4", 5, "fix")];
  // 初回（マーカーなし・night=09-01）: 前夜 08-31 から → h2,h3,h4。UTC 日付が 2 日にまたがっても「今夜のかけら」
  const p1 = planNightPost(S1, null, "2026-09-01");
  assert.deepEqual(freshEvents(S1, null, "2026-09-01").map((e) => e.h), ["h2", "h3", "h4"]);
  assert.equal(p1.count, 3); assert.equal(p1.lines, 115); assert.equal(p1.repos, 2); assert.equal(p1.nightsSince, 1);
  assert.equal(p1.skip, false);
  assert.equal(p1.upTo, "2026-09-01");
  assert.ok(p1.text.includes("今夜のかけら +3 粒・+115 行・2 リポ"), p1.text);
  assert.ok(!p1.text.includes("夜ぶん"));
  assert.deepEqual(p1.byType, { docs: 1, feat: 1, fix: 1 });
  assert.equal(p1.nextMarker.night, "2026-09-01");
  assert.deepEqual(Object.keys(p1.nextMarker.seen).sort(), ["a@h2", "a@h3", "b@h4"], "窓（upTo-3 日以降）の粒キーを日付付きで記録");
  assert.equal(p1.nextMarker.seen["a@h2"], "2026-08-31");
  assert.equal(p1.nextMarker.events, 3);
  // 翌夜: 09-02 の粒(h5) と、09-01 に後から付いた粒(h6・bot の UTC 日付) と、窓外の古い粒(h0・08-20) が増えた
  const S2 = [ev("2026-08-20", "c", "h0", 999), ...S1, ev("2026-09-01", "a", "h6", 3, "test"), ev("2026-09-02", "b", "h5", 7, "test")];
  const p2 = planNightPost(S2, p1.nextMarker, "2026-09-02");
  assert.deepEqual(freshEvents(S2, p1.nextMarker, "2026-09-02").map((e) => e.h).sort(), ["h5", "h6"], "同日の未見粒は新規・窓外の古い粒は新規扱いしない");
  assert.equal(p2.count, 2); assert.equal(p2.lines, 10); assert.equal(p2.repos, 2); assert.equal(p2.nightsSince, 1);
  assert.equal(p2.upTo, "2026-09-02");
  assert.equal(p2.skip, false);
  assert.ok(p2.text.startsWith("9月2日の夜業、終了。今夜のかけら"));
  assert.ok(!("a@h1" in p2.nextMarker.seen) && !("c@h0" in p2.nextMarker.seen), "窓外は記録しない");
  for (const k of ["a@h2", "a@h3", "b@h4", "a@h6", "b@h5"]) assert.ok(k in p2.nextMarker.seen, k);
  // 同じ夜に 2 回目: skip=true（1 日 1 本）・差分は 0。時計異常で先の夜が記録されていても出さない
  const again = planNightPost(S2, p2.nextMarker, "2026-09-02");
  assert.equal(again.skip, true);
  assert.equal(again.count, 0);
  assert.equal(planNightPost(S2, { ...p2.nextMarker, night: "2026-09-09" }, "2026-09-03").skip, true);
  // 静かな夜: 新しい粒なし → 「静かな夜」・upTo は据え置き・skip ではない
  const p3 = planNightPost(S2, p2.nextMarker, "2026-09-03");
  assert.equal(p3.skip, false);
  assert.equal(p3.count, 0);
  assert.equal(p3.upTo, "2026-09-02");
  assert.ok(p3.text.startsWith("9月3日、静かな夜。"));
  assert.equal(p3.nextMarker.night, "2026-09-03");
  // seen の引き継ぎ: リポ b が一時的に stream から消えても（clone 失敗）、戻ってきた粒を再報しない
  const S2noB = S2.filter((e) => e.r !== "b");
  const pq = planNightPost(S2noB, p3.nextMarker, "2026-09-04");
  assert.equal(pq.count, 0);
  assert.ok("b@h4" in pq.nextMarker.seen && "b@h5" in pq.nextMarker.seen, "欠けたリポの既報粒を忘れない");
  const pback = planNightPost(S2, pq.nextMarker, "2026-09-05");
  assert.equal(pback.count, 0, "戻ってきた粒を再報しない");
  assert.equal(pback.upTo, "2026-09-02");
  // 放送が数日止まっても、再開時は upTo 以降を全部拾い「n 夜ぶん」（前回の放送 09-03 → 09-06 = 3 夜）
  const S3 = [...S2, ev("2026-09-04", "a", "h7"), ev("2026-09-06", "b", "h8")];
  const p4 = planNightPost(S3, p3.nextMarker, "2026-09-06");
  assert.deepEqual(freshEvents(S3, p3.nextMarker, "2026-09-06").map((e) => e.h), ["h7", "h8"]);
  assert.equal(p4.nightsSince, 3);
  assert.ok(p4.text.includes("3 夜ぶんのかけら +2 粒"), p4.text);
  assert.equal(p4.upTo, "2026-09-06");
  // 未来日付の粒（時計異常）は対象外で、upTo を引っ張らない
  const S4 = [...S3, ev("2027-01-01", "a", "hz", 50)];
  const pf = planNightPost(S4, p4.nextMarker, "2026-09-07");
  assert.equal(pf.count, 0);
  assert.equal(pf.upTo, "2026-09-06");
  assert.ok(pf.text.startsWith("9月7日、静かな夜。"));
  assert.ok(!("a@hz" in pf.nextMarker.seen));
  // 壊れたマーカー（seen 欠落）: 日付基準に退避し、窓内（upTo-3 日以降）は一度だけ再報される（許容）
  const p5 = planNightPost(S3, { night: "2026-09-05", upTo: "2026-09-04" }, "2026-09-06");
  assert.deepEqual(freshEvents(S3, { night: "2026-09-05", upTo: "2026-09-04" }, "2026-09-06").map(eventKey).sort(), ["a@h3", "a@h6", "a@h7", "b@h4", "b@h5", "b@h8"]);
  assert.equal(p5.count, 6);
  // 旧形式（配列）の seen も受ける
  const legacy = { night: "2026-09-05", upTo: "2026-09-04", seen: ["a@h3", "a@h6", "b@h4", "a@h7"] };
  assert.deepEqual(seenEntries(legacy).map(([k, d]) => k + ":" + d), ["a@h3:null", "a@h6:null", "b@h4:null", "a@h7:null"]);
  const p6 = planNightPost(S3, legacy, "2026-09-06");
  assert.deepEqual(freshEvents(S3, legacy, "2026-09-06").map((e) => e.h), ["h5", "h8"], "配列 seen に無い窓内の粒(h5)と upTo 以降(h8)");
  assert.ok("a@h3" in p6.nextMarker.seen && typeof p6.nextMarker.seen["a@h3"] === "string");
  assert.equal(SEEN_WINDOW_DAYS, 3);
});

test("本番データ: 今夜の計画が組める（初回・280 重み以内・URL 付き）", () => {
  const S = prepStream(STREAM);
  const plan = planNightPost(STREAM, null, S.lastDay);
  assert.ok(weightedLength(plan.text) <= TWEET_WEIGHTED_MAX);
  assert.ok(plan.text.endsWith(SITE_URL));
  assert.equal(plan.upTo, S.lastDay);
  const nSeen = Object.keys(plan.nextMarker.seen).length;
  assert.ok(nSeen >= 1 && nSeen < STREAM.length);
  // 2 夜目は同じ数字を二度言わない
  const next = planNightPost(STREAM, plan.nextMarker, shiftDay(S.lastDay, 1));
  assert.equal(next.count, 0);
  assert.equal(next.skip, false);
});

test("OAuth 1.0a: percentEncode（RFC 3986）", () => {
  assert.equal(percentEncode("a!b*c'd(e)f"), "a%21b%2Ac%27d%28e%29f");
  assert.equal(percentEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assert.equal(percentEncode("日本"), "%E6%97%A5%E6%9C%AC");
});

test("OAuth 1.0a: X 公式ドキュメントの既知解を再現（署名の移植が正しい）", async () => {
  // https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature の公開例（実在の鍵ではない）。
  // 秘密検知ツール（GitGuardian 等）がトークンの形（数字-英数字40）に反応するため、文字列は分割して保持し実行時に連結する。
  const j = (...parts) => parts.join("");
  const creds = {
    consumerKey: j("xvz1evFS4w", "EEPTGEFPHBog"),
    consumerSecret: j("kAcSOqF21F", "u85e7zjz7Z", "N2U4ZRhfV3", "WpwPAoE3Z7kBw"),
    accessToken: j("370773112", "-", "GmHxMAgYyL", "bNEtIKZeRN", "FsMKPR9EyM", "ZeS9weJAEb"),
    accessTokenSecret: j("LswwdoUaIv", "S8ltyTt5jk", "Rh4J50vUPV", "VHtR2YPi5kE"),
  };
  const h = await buildOAuth1Header(
    "POST", "https://api.twitter.com/1.1/statuses/update.json", creds,
    j("kYjzVBB8Y0", "ZFabxSWbWo", "vY3uYSQ2pT", "gmZeNu2VS4cg"), 1318622958,
    { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
  );
  const sig = decodeURIComponent(/oauth_signature="([^"]+)"/.exec(h)[1]);
  assert.equal(sig, "hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  assert.ok(h.startsWith("OAuth "));
  assert.ok(!/include_entities|status=/.test(h), "クエリはヘッダに出ない");
});

test("OAuth 1.0a: 本番エンドポイントの署名を独立実装（node:crypto）で照合・決定論・メソッド依存・secret 非漏洩", async () => {
  const creds = { consumerKey: "ck", consumerSecret: "SECRET-CONSUMER-7f3a", accessToken: "at", accessTokenSecret: "SECRET-TOKEN-9c1e" };
  const h1 = await buildOAuth1Header("POST", X_TWEETS_URL, creds, "abc123", 1710000000);
  const h2 = await buildOAuth1Header("POST", X_TWEETS_URL, creds, "abc123", 1710000000);
  assert.equal(h1, h2, "nonce/timestamp 固定なら決定論");
  // RFC 5849 §3.4.1 を手で組み立てる（JSON ボディは基底文字列に入らない）
  const params = "oauth_consumer_key=ck&oauth_nonce=abc123&oauth_signature_method=HMAC-SHA1&oauth_timestamp=1710000000&oauth_token=at&oauth_version=1.0";
  const base = ["POST", encodeURIComponent(X_TWEETS_URL), encodeURIComponent(params)].join("&");
  const expected = createHmac("sha1", "SECRET-CONSUMER-7f3a&SECRET-TOKEN-9c1e").update(base).digest("base64");
  assert.equal(decodeURIComponent(/oauth_signature="([^"]+)"/.exec(h1)[1]), expected);
  for (const k of ['oauth_consumer_key="ck"', 'oauth_nonce="abc123"', 'oauth_signature_method="HMAC-SHA1"', 'oauth_timestamp="1710000000"', 'oauth_token="at"', 'oauth_version="1.0"']) assert.ok(h1.includes(k), k);
  assert.notEqual(await buildOAuth1Header("POST", X_TWEETS_URL, creds, "other", 1710000000), h1, "nonce が変われば署名も変わる");
  assert.notEqual(await buildOAuth1Header("GET", X_ME_URL, creds, "n1", 1710000000), await buildOAuth1Header("POST", X_ME_URL, creds, "n1", 1710000000), "メソッドは基底文字列の一部");
  assert.ok(!h1.includes("SECRET-CONSUMER-7f3a") && !h1.includes("SECRET-TOKEN-9c1e"), "secret がヘッダに漏れている");
});

const fakeResponse = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body });

test("X 投稿: 署名ヘッダ・JSON ボディ・応答の解釈（成功/失敗/欠落/ネットワーク）・503 のみ 1 回再試行", async () => {
  const creds = { consumerKey: "ck", consumerSecret: "cs", accessToken: "at", accessTokenSecret: "ats" };
  const calls = [];
  const okFetch = async (url, init) => { calls.push({ url, init }); return fakeResponse(201, { data: { id: "1234567890", text: "x" } }); };
  const r = await postTweet(creds, "こんばんは\n" + SITE_URL, { fetchImpl: okFetch, now: () => 1710000000000 });
  assert.deepEqual(r, { ok: true, id: "1234567890" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, X_TWEETS_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.headers.Authorization.startsWith("OAuth "));
  assert.ok(calls[0].init.headers.Authorization.includes('oauth_timestamp="1710000000"'));
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: "こんばんは\n" + SITE_URL });
  // 失敗: X のエラー本文を短く返す
  const bad = await postTweet(creds, "x", { fetchImpl: async () => fakeResponse(403, { title: "Forbidden", detail: "You are not permitted to perform this action." }) });
  assert.deepEqual(bad, { ok: false, status: 403, detail: "Forbidden" });
  const noId = await postTweet(creds, "x", { fetchImpl: async () => fakeResponse(200, { data: {} }) });
  assert.equal(noId.ok, false); assert.match(noId.detail, /missing tweet id/);
  const net = await postTweet(creds, "x", { fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  assert.deepEqual(net, { ok: false, status: 0, detail: "network error or timeout" });
  // 再試行: 503 → 成功。429/500/timeout は再試行しない（二重投稿の恐れ）
  const seq = [fakeResponse(503, {}), fakeResponse(201, { data: { id: "2" } })];
  const slept = [];
  const rr = await postTweetWithRetry(creds, "x", { fetchImpl: async () => seq.shift(), sleepImpl: async (ms) => slept.push(ms) });
  assert.deepEqual(rr, { ok: true, id: "2" }); assert.deepEqual(slept, [1500]);
  let n = 0;
  const r429 = await postTweetWithRetry(creds, "x", { fetchImpl: async () => { n++; return fakeResponse(429, { title: "Too Many Requests" }); }, sleepImpl: async () => {} });
  assert.equal(r429.ok, false); assert.equal(n, 1, "429 は再試行しない");
  let m = 0;
  const rnet = await postTweetWithRetry(creds, "x", { fetchImpl: async () => { m++; throw new Error("timeout"); }, sleepImpl: async () => {} });
  assert.equal(rnet.status, 0); assert.equal(m, 1, "曖昧な失敗（timeout）は再試行しない");
});

test("X 鍵の検証（GET /2/users/me・投稿しない）: handle・読み取り専用の検出・401/403 のヒント", async () => {
  const creds = { consumerKey: "ck", consumerSecret: "cs", accessToken: "at", accessTokenSecret: "ats" };
  const calls = [];
  const ok = await verifyXCredentials(creds, { fetchImpl: async (url, init) => { calls.push({ url, init }); return fakeResponse(200, { data: { username: "kessho_bot" } }, { "x-access-level": "read-write" }); } });
  assert.equal(calls[0].url, X_ME_URL);
  assert.equal(calls[0].init.method ?? "GET", "GET");
  assert.deepEqual({ ok: ok.ok, handle: ok.handle, write: ok.write }, { ok: true, handle: "kessho_bot", write: "yes" });
  const unknown = await verifyXCredentials(creds, { fetchImpl: async () => fakeResponse(200, { data: { username: "u" } }) });
  assert.equal(unknown.ok, true); assert.equal(unknown.write, "unknown");
  const ro = await verifyXCredentials(creds, { fetchImpl: async () => fakeResponse(200, { data: { username: "u" } }, { "x-access-level": "read" }) });
  assert.equal(ro.ok, false); assert.match(ro.detail, /READ-ONLY/);
  const e401 = await verifyXCredentials(creds, { fetchImpl: async () => fakeResponse(401, { title: "Unauthorized" }) });
  assert.equal(e401.ok, false); assert.match(e401.detail, /Unauthorized/); assert.match(e401.detail, /再確認/);
  const e403 = await verifyXCredentials(creds, { fetchImpl: async () => fakeResponse(403, { title: "Forbidden" }) });
  assert.match(e403.detail, /Read\+Write/);
});

test("X 鍵の読み取り: 4 つ揃って初めて完全（値は扱わずキー名のみ）", () => {
  assert.equal(credsComplete(readCreds({})), false);
  assert.equal(credsComplete(readCreds({ X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c" })), false);
  const c = readCreds({ X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_TOKEN_SECRET: "d" });
  assert.equal(credsComplete(c), true);
  assert.deepEqual(c, { consumerKey: "a", consumerSecret: "b", accessToken: "c", accessTokenSecret: "d" });
});
