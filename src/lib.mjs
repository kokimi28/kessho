// KESSHO 純ロジック層 — DOM/canvas に依存しない（node:test で検証する）
// ここに置くのは「答えが一意に決まる計算」だけ。描画・イベントは app.js。

export const TYPE_ORDER = ["feat", "fix", "docs", "test", "refactor", "other"];
export const TYPE_COLOR = { feat: "#17a398", docs: "#7a87e8", fix: "#d66a88", test: "#c08420", refactor: "#64708a", other: "#454d5e" };
export const TYPE_LABEL = { feat: "feat 新機能", docs: "docs 記事・文書", fix: "fix 修正", test: "test/ci 検証", refactor: "refactor 整備", other: "その他" };
export const LINE_ORDER = ["saas", "toolfactory", "explp", "data", "idol", "foundation"];
export const LINE_COLOR = { saas: "#17a398", toolfactory: "#c08420", explp: "#7a87e8", data: "#4f9dd1", idol: "#d66a88", foundation: "#64708a" };
export const LINE_LABEL = { saas: "SaaS（brypo）", toolfactory: "Tool Factory（税）", explp: "実験LP（補助金）", data: "データ（規制）", idol: "AIアイドル", foundation: "基盤・統治" };

export const DAY_MS = 86400000;
export const toMs = (d) => Date.parse(d + "T00:00:00Z");
export const jpDate = (d) => { const [, m, dd] = d.split("-").map(Number); return m + "月" + dd + "日"; };

/* ---------- 決定論 PRNG ---------- */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 粒の物性 ---------- */
export const radiusOf = (n) => Math.min(1.5 + 0.55 * Math.log2(1 + n), 8);
export const heatTier = (age) => (age < 1 ? 0 : age < 7 ? 1 : age < 30 ? 2 : 3);

/* ---------- 日次集計（前置換表と夜報） ---------- */
export function prepStream(stream) {
  const firstDay = stream[0].d, lastDay = stream[stream.length - 1].d;
  const nDays = Math.round((toMs(lastDay) - toMs(firstDay)) / DAY_MS) + 1;
  const dayIdxOf = (e) => Math.round((toMs(e.d) - toMs(firstDay)) / DAY_MS);
  const totalLines = stream.reduce((s, e) => s + e.n, 0);
  // cumByDay[v] = スクラブ値 v（1..nDays）のときの可視粒数（seed 粒込み）
  const cumByDay = new Array(nDays + 1).fill(1);
  { let vi = 0;
    for (let v = 1; v <= nDays; v++) {
      while (vi < stream.length && dayIdxOf(stream[vi]) <= v - 1) vi++;
      cumByDay[v] = vi + 1;
    } }
  // 夜報: 稼働夜ごとの束（base = その夜の先頭イベントの stream index）
  const nights = [];
  for (let i = 0; i < stream.length; i++) {
    const e = stream[i];
    if (!nights.length || nights[nights.length - 1].d !== e.d) {
      nights.push({ d: e.d, base: i, count: 0, lines: 0, byType: {} });
    }
    const nt = nights[nights.length - 1];
    nt.count++; nt.lines += e.n;
    nt.byType[e.t] = (nt.byType[e.t] ?? 0) + 1;
  }
  return { firstDay, lastDay, nDays, totalLines, cumByDay, nights, dayIdxOf };
}

/* ---------- 枝配置: 各リポ = 年代順の連なり（意味のある位置） ----------
 * 粒の位置がすべて構造を語る: 方位=事業ライン、枝=リポ、枝に沿った順序=時間。
 * 隣り合う粒は時間的に隣のコミットで、今夜の仕事は必ず枝の先端に付く。
 * 返り値の parent[i] は「同じリポの直前のコミット」（リポ最初の粒は 0=幹）。 */
export function buildBranches(events, seed, sectors) {
  const rnd = mulberry32(seed);
  const pts = [{ x: 0, y: 0, z: 0, r: 2.2, seed: true, cr: 3 }];
  const parent = [0];
  // リポの登場順グルーピング（角度割当のため）
  const groups = new Map();
  for (const e of events) { if (!groups.has(e.r)) groups.set(e.r, e.l); }
  const repoAngle = new Map();
  if (sectors) {
    const byLine = new Map();
    for (const [r, l] of groups) { if (!byLine.has(l)) byLine.set(l, []); byLine.get(l).push(r); }
    const sectorW = (2 * Math.PI / Math.max(Object.keys(sectors).length, 1)) * 0.82;
    for (const [l, rs] of byLine) {
      rs.forEach((r, k) => repoAngle.set(r, sectors[l] + (rs.length === 1 ? 0 : (k / (rs.length - 1) - 0.5) * sectorW)));
    }
  } else {
    const rs = [...groups.keys()];
    rs.forEach((r, k) => repoAngle.set(r, -Math.PI / 2 + (k * 2 * Math.PI) / Math.max(rs.length, 1)));
  }
  // 各枝はシダの若葉のように、固有の巻き癖を持って伸びる
  const state = new Map();
  let clusterR = 3;
  for (const e of events) {
    const r = radiusOf(e.n);
    let st = state.get(e.r);
    if (!st) {
      const a = repoAngle.get(e.r) + (rnd() - 0.5) * 0.12;
      st = { x: Math.cos(a) * 14, y: Math.sin(a) * 14, z: (rnd() - 0.5) * 6, dir: a, curl: (rnd() < 0.5 ? -1 : 1) * (0.015 + rnd() * 0.035), lastR: 2, lastIdx: 0 };
      state.set(e.r, st);
    }
    st.dir += st.curl + (rnd() - 0.5) * 0.16;
    const step = st.lastR + r + 1.6;
    st.x += Math.cos(st.dir) * step;
    st.y += Math.sin(st.dir) * step;
    st.z = Math.max(-40, Math.min(40, st.z + (rnd() - 0.5) * 7));
    const dist = Math.hypot(st.x, st.y, st.z);
    if (dist + r > clusterR) clusterR = dist + r;
    pts.push({ x: st.x, y: st.y, z: st.z, r, e, cr: clusterR });
    parent.push(st.lastIdx);
    st.lastIdx = pts.length - 1;
    st.lastR = r;
  }
  return { pts, clusterR, parent };
}

/* ---------- ステーション配置: モジュール=リポ・窓=コミット（人工衛星の連結） ----------
 * 中央ハブから放射するトラスに、カプセル型モジュール（=リポ）がドッキングする。
 * モジュール長=歴史量・幅=規模。コミットは船体に時系列順で並ぶ「窓明かり」になる。
 * parent[i] は同リポの直前コミット（窓の並び=年表）。 */
export function buildStation(stream, seed, sectors) {
  const rnd = mulberry32(seed);
  // リポ登場順と角度（ライン扇割り or 全周等配）
  const lineOf = new Map();
  for (const e of stream) if (!lineOf.has(e.r)) lineOf.set(e.r, e.l);
  const repoAngle = new Map();
  if (sectors) {
    const byLine = new Map();
    for (const [r, l] of lineOf) { if (!byLine.has(l)) byLine.set(l, []); byLine.get(l).push(r); }
    const sectorW = (2 * Math.PI / Math.max(Object.keys(sectors).length, 1)) * 0.8;
    for (const [l, rs] of byLine) {
      rs.forEach((r, k) => repoAngle.set(r, sectors[l] + (rs.length === 1 ? 0 : (k / (rs.length - 1) - 0.5) * sectorW)));
    }
  } else {
    const rs = [...lineOf.keys()];
    rs.forEach((r, k) => repoAngle.set(r, -Math.PI / 2 + (k * 2 * Math.PI) / Math.max(rs.length, 1)));
  }
  // モジュール寸法（長さ=コミット数・幅=行数の log。すべて決定論）
  const counts = new Map(), sums = new Map();
  for (const e of stream) {
    counts.set(e.r, (counts.get(e.r) ?? 0) + 1);
    sums.set(e.r, (sums.get(e.r) ?? 0) + e.n);
  }
  const D0 = 70;
  const modules = [];
  const modByRepo = new Map();
  for (const [r, l] of lineOf) {
    const m = {
      r, l,
      a: repoAngle.get(r),
      d0: D0,
      len: Math.min(34 + counts.get(r) * 4.6, 150),
      w: Math.min(15 + Math.log2(1 + sums.get(r)) * 1.3, 30),
      z: (rnd() - 0.5) * 28,
      count: counts.get(r),
    };
    modules.push(m);
    modByRepo.set(r, m);
  }
  // 窓（=コミット）: 船体軸に沿って時系列順・千鳥配置
  const pts = [{ x: 0, y: 0, z: 0, r: 2.2, seed: true, cr: 3 }];
  const parent = [0];
  const prog = new Map(), lastIdx = new Map();
  let clusterR = 3;
  for (const e of stream) {
    const m = modByRepo.get(e.r);
    const k = prog.get(e.r) ?? 0;
    prog.set(e.r, k + 1);
    const t = (k + 0.5) / m.count;
    const along = m.d0 + m.len * t;
    const perp = ((k % 2) - 0.5) * m.w * 0.34;
    const x = Math.cos(m.a) * along - Math.sin(m.a) * perp;
    const y = Math.sin(m.a) * along + Math.cos(m.a) * perp;
    const z = m.z + (rnd() - 0.5) * 5;
    const r = radiusOf(e.n) * 0.8;
    const dist = Math.hypot(x, y, z);
    if (dist + r > clusterR) clusterR = dist + r;
    pts.push({ x, y, z, r, e, cr: clusterR });
    parent.push(lastIdx.get(e.r) ?? 0);
    lastIdx.set(e.r, pts.length - 1);
  }
  for (const m of modules) clusterR = Math.max(clusterR, m.d0 + m.len + 24);
  return { pts, parent, clusterR, modules };
}

/* ---------- 旧: DLA（平面凝集）。かけら等の非構造クラスタ用に残置 ---------- */
export function buildCluster(events, seed, sectors, pull) {
  const rnd = mulberry32(seed);
  const pts = [{ x: 0, y: 0, z: 0, r: 2.2, seed: true, cr: 3 }];
  const grid = new Map();
  const CELL = 18;
  const key = (cx, cy) => cx + ":" + cy;
  const put = (p) => { const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL)); (grid.get(k) ?? grid.set(k, []).get(k)).push(p); };
  put(pts[0]);
  let clusterR = 3;
  const near = (x, y, r) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const cell = grid.get(key(cx + i, cy + j));
      if (!cell) continue;
      for (const q of cell) {
        const dx = x - q.x, dy = y - q.y;
        const rr = r + q.r + 0.4;
        if (dx * dx + dy * dy < rr * rr) return true;
      }
    }
    return false;
  };
  for (const e of events) {
    const r = radiusOf(e.n);
    const az0 = sectors ? sectors[e.l] : rnd() * 2 * Math.PI;
    let placed = false;
    for (let attempt = 0; attempt < 12 && !placed; attempt++) {
      const a = az0 + (rnd() - 0.5) * 1.15;
      let x = Math.cos(a) * (clusterR + 22), y = Math.sin(a) * (clusterR + 22);
      for (let step = 0; step < 3500; step++) {
        const wob = rnd() * 2 * Math.PI;
        const d = Math.hypot(x, y) || 1;
        let vx = Math.cos(wob) * 1.65 - (x / d) * 0.85;
        let vy = Math.sin(wob) * 1.65 - (y / d) * 0.85;
        if (pull) {
          const cur = Math.atan2(y, x);
          let da = az0 - cur;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          vx += -Math.sin(cur) * da * pull; vy += Math.cos(cur) * da * pull;
        }
        x += vx; y += vy;
        const dist = Math.hypot(x, y);
        if (dist > clusterR + 90) break;
        if (near(x, y, r)) {
          if (dist + r > clusterR) clusterR = dist + r;
          const p = { x, y, z: 0, r, e, cr: clusterR };
          pts.push(p); put(p);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      clusterR += r;
      const p = { x: Math.cos(az0) * clusterR, y: Math.sin(az0) * clusterR, z: 0, r, e, cr: clusterR };
      pts.push(p); put(p);
    }
  }
  // 奥行き: 最近接の先行粒を親として、枝に沿った酔歩で z を与える
  const zr = mulberry32(seed ^ 0x5f3759df);
  const amp = Math.max(clusterR * 0.30, 24);
  for (let i = 1; i < pts.length; i++) {
    let pj = 0, bd = Infinity;
    for (let j = 0; j < i; j++) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
      const dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; pj = j; }
    }
    const step = (zr() - 0.5) * 16;
    pts[i].z = Math.max(-amp, Math.min(amp, pts[pj].z + step));
  }
  return { pts, clusterR };
}

export function computeParents(pts) {
  const parent = new Array(pts.length).fill(0);
  for (let i = 1; i < pts.length; i++) {
    let bd = Infinity;
    for (let j = 0; j < i; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z);
      if (d < bd) { bd = d; parent[i] = j; }
    }
  }
  return parent;
}

export function computeNeighbors(pts, radius = 30) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const list = [];
    for (let j = 1; j < pts.length; j++) {
      if (j === i) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z) < radius) list.push(j);
    }
    out.push(list);
  }
  return out;
}

/* ---------- 投影（銀河式: 面内自転 + 傾きカメラ + 透視） ---------- */
export function makeProjector(rot, tilt, F) {
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
  return function (x, y, z, out) {
    const x1 = x * cosR - y * sinR;
    const y1 = x * sinR + y * cosR;
    const y2 = y1 * cosT - z * sinT;
    const z2 = y1 * sinT + z * cosT;
    // カメラ極近での発散を抑える（突入時、手前の粒は巨大化しつつ有限に留まる）
    const k = F / Math.max(F + z2, F * 0.12);
    out.x = x1 * k; out.y = y2 * k; out.k = k; out.d = z2;
    return out;
  };
}
export const fogOf = (d, CR) => 0.42 + 0.58 * (1 - Math.min(Math.max((d / CR + 1) / 2, 0), 1));

/* ---------- カメラ: 全景=正面のダイアグラム（路線図）→ 潜るほど倒れて奥行きが現れる ---------- */
export const tiltForZoom = (z) => -0.08 - 0.47 * Math.min(Math.max((z - 1.05) / 1.6, 0), 1);

/* ---------- 環状線レイアウト: 均一な駅ポッド＋フィロタキシス充填 ----------
 * ベックの路線図の原理に従う: 比例（大きさ=データ量）を捨て、均一な駅・
 * 規則的な円環でシステム図として読ませる。データは形でなくバッジと数字で語る。
 * 駅=リポ（全て同径）。窓=コミット（ポッド内にひまわり螺旋・年代順）。 */
export function buildRing(stream, seed, lineOrder) {
  const lineOf = new Map();
  for (const e of stream) if (!lineOf.has(e.r)) lineOf.set(e.r, e.l);
  const counts = new Map();
  for (const e of stream) counts.set(e.r, (counts.get(e.r) ?? 0) + 1);
  // 駅の並び: ライン順（環状線をライン色の弧で区切るため隣接させる）
  const order = [];
  for (const l of lineOrder) for (const [r, rl] of lineOf) if (rl === l) order.push(r);
  const nSt = order.length;
  const RING = 150, POD = 26;
  const stations = order.map((r, i) => {
    const a = -Math.PI / 2 + (i / Math.max(nSt, 1)) * 2 * Math.PI;
    return { r, l: lineOf.get(r), a, cx: Math.cos(a) * RING, cy: Math.sin(a) * RING, count: counts.get(r) };
  });
  const stByRepo = new Map(stations.map((st) => [st.r, st]));
  const GA = Math.PI * (3 - Math.sqrt(5)); // 黄金角
  const rnd = mulberry32(seed);
  const pts = [{ x: 0, y: 0, z: 0, r: 2.2, seed: true, cr: 3 }];
  const parent = [0];
  const prog = new Map(), lastIdx = new Map();
  let clusterR = 3;
  for (const e of stream) {
    const st = stByRepo.get(e.r);
    const k = prog.get(e.r) ?? 0;
    prog.set(e.r, k + 1);
    const rr = POD * 0.8 * Math.sqrt((k + 0.5) / st.count);
    const th = k * GA + st.a;
    const x = st.cx + Math.cos(th) * rr;
    const y = st.cy + Math.sin(th) * rr;
    const z = (rnd() - 0.5) * 8;
    const r = Math.min(0.9 + radiusOf(e.n) * 0.32, 3.4);
    const dist = Math.hypot(x, y, z);
    if (dist + r > clusterR) clusterR = dist + r;
    pts.push({ x, y, z, r, e, cr: clusterR });
    parent.push(lastIdx.get(e.r) ?? 0);
    lastIdx.set(e.r, pts.length - 1);
  }
  clusterR = Math.max(clusterR, RING + POD + 36);
  return { pts, parent, clusterR, stations, RING, POD };
}

/* ---------- リポの陳列統計（部屋に入ったとき最初に見るもの） ---------- */
export function repoStats(stream, repo, lastDay) {
  const evs = stream.filter((e) => e.r === repo);
  const total = evs.length;
  const lines = evs.reduce((s, e) => s + e.n, 0);
  const activeDays = new Set(evs.map((e) => e.d)).size;
  const lastD = total ? evs[total - 1].d : null;
  const lastEvs = evs.filter((e) => e.d === lastD);
  const week = evs.filter((e) => (toMs(lastDay) - toMs(e.d)) / DAY_MS < 7).length;
  const byType = {};
  for (const e of evs) byType[e.t] = (byType[e.t] ?? 0) + 1;
  const weekly = new Array(8).fill(0); // 直近8週のリズム（右端=今週）
  for (const e of evs) {
    const w = Math.floor((toMs(lastDay) - toMs(e.d)) / DAY_MS / 7);
    if (w >= 0 && w < 8) weekly[7 - w]++;
  }
  return {
    total, lines, activeDays,
    first: total ? evs[0].d : null,
    lastD, lastCount: lastEvs.length,
    lastLines: lastEvs.reduce((s, e) => s + e.n, 0),
    week, byType, weekly,
  };
}

/* ---------- 意味ズーム（LOD）: ズーム値→ラベル帯域の台形アルファ ---------- */
export function lodBand(z, inStart, inEnd, outStart, outEnd) {
  if (z <= inStart || z >= outEnd) return 0;
  if (z < inEnd) return (z - inStart) / (inEnd - inStart);
  if (z <= outStart) return 1;
  return (outEnd - z) / (outEnd - outStart);
}

/* ---------- 文言生成 ---------- */
export function typeMix(byType) {
  return TYPE_ORDER.filter((t) => byType[t]).map((t) => t + " " + byType[t]).join("・");
}
export function captionFor(e) {
  return e.r + " ← " + e.t + " +" + e.n.toLocaleString("en-US") + "行";
}
export function nightlyPost(night, totalEvents, totalLines) {
  return jpDate(night.d) + "の夜業、終了。今夜のかけらは " + night.count + " 粒（" + typeMix(night.byType) + "）、" +
    night.lines.toLocaleString("en-US") + " 行。結晶は通算 " + totalEvents + " 粒・" +
    totalLines.toLocaleString("en-US") + " 行。今夜も人間は書いていない。";
}

/* ---------- 検分ミッション（毎晩の行動目標・純関数） ---------- */
// 対象 = 最新の夜の粒（pts index = stream index + 1）
export function missionTargets(nights) {
  const nt = nights[nights.length - 1];
  return { date: nt.d, targets: Array.from({ length: nt.count }, (_, k) => nt.base + 1 + k) };
}
// 保存値の復元。日付が変わっていれば新しいミッションとして白紙化
export function loadMission(stored, date, targets) {
  if (!stored || stored.date !== date || !Array.isArray(stored.done)) return { date, done: [] };
  return { date, done: stored.done.filter((i) => targets.includes(i)) };
}
// 検分を1粒記録。complete は「この一手で全対象が済んだ」瞬間のみ true
export function inspectMark(m, idx, targets) {
  if (!targets.includes(idx) || m.done.includes(idx)) return { m, changed: false, complete: false };
  const done = [...m.done, idx];
  return { m: { date: m.date, done }, changed: true, complete: done.length === targets.length };
}

/* ---------- 観測記録（訪問状態機械・純関数） ---------- */
export function updateVisitState(prev, today, eventCount, lineCount) {
  if (!prev || !prev.last) {
    return {
      state: { first: today, last: today, visits: 1, streak: 1, seenEvents: eventCount, seenLines: lineCount },
      catchup: null,
    };
  }
  const gap = Math.round((toMs(today) - toMs(prev.last)) / DAY_MS);
  const streak = gap <= 0 ? prev.streak : gap === 1 ? (prev.streak || 0) + 1 : 1;
  const dEvents = eventCount - (prev.seenEvents ?? eventCount);
  const dLines = lineCount - (prev.seenLines ?? lineCount);
  const catchup = dEvents > 0 ? { events: dEvents, lines: Math.max(dLines, 0) } : null;
  return {
    state: { first: prev.first || today, last: today, visits: (prev.visits || 0) + 1, streak, seenEvents: eventCount, seenLines: lineCount },
    catchup,
  };
}
