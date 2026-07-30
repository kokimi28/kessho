// KESSHO 純ロジックのユニットテスト — 依存ゼロ・ネットワーク不要
// 実行: node --test scripts/test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mulberry32, radiusOf, heatTier, prepStream, buildCluster, buildBranches, computeParents,
  computeNeighbors, makeProjector, fogOf, typeMix, captionFor, nightlyPost,
  updateVisitState, missionTargets, loadMission, inspectMark, lodBand, tiltForZoom, repoStats,
  buildStation, buildRing, LINE_ORDER, TYPE_ORDER,
} from "../src/lib.mjs";

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

test("ビルド成果物: 自己完結（外部参照なし・データ埋め込み済み）", () => {
  const distPath = join(root, "dist/index.html");
  if (!existsSync(distPath)) { console.log("dist 未ビルドのためスキップ"); return; }
  const html = readFileSync(distPath, "utf8");
  assert.ok(!/src="http|href="http|url\(http|@import/.test(html), "外部リソース参照が混入");
  assert.ok(!html.includes("__DATA__"), "データ未注入");
  assert.ok(html.includes("prepStream"), "lib 未連結");
  assert.ok(html.includes("tabbar"), "アプリ骨格欠落");
  for (const t of TYPE_ORDER) assert.ok(html.includes(t));
});
