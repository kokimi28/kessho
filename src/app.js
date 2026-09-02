"use strict";
/* KESSHO app 層 — 描画・入力・画面。純ロジックは lib.mjs（ビルドで同一スコープに連結される） */
const STREAM = __DATA__;

/* ===== データ準備 ===== */
const S = prepStream(STREAM);
const { firstDay, lastDay, nDays, totalLines, cumByDay, nights } = S;
const ageOf = (e) => (toMs(lastDay) - toMs(e.d)) / DAY_MS;
const lastNight = nights[nights.length - 1];
const weekCount = STREAM.filter((e) => ageOf(e) < 7).length;

const SECTOR = {}; LINE_ORDER.forEach((l, i) => { SECTOR[l] = -Math.PI / 2 + (i * 2 * Math.PI) / LINE_ORDER.length; });
const crystal = buildRing(STREAM, 20260729, LINE_ORDER);
const STATIONS = crystal.stations, RING = crystal.RING, POD = crystal.POD; // 環状線: 駅=リポ（均一）
const PTS = crystal.pts, N = PTS.length, CR = crystal.clusterR, F = CR * 1.7;
const parentIdx = crystal.parent; // 同リポの直前コミット（螺旋の並び＝年表）。※ window.parent を隠す名前にしない: count.js のフレーム判定が誤作動する（DESIGN §14）
const neighbors = computeNeighbors(PTS, 30);
/* 駅ごとの陳列サマリ（バッジ・グロー用に前計算） */
const NIGHT_REPOS = new Map(); // 昨夜更新のあった駅 → 粒数
for (const e of STREAM) if (e.d === STREAM[STREAM.length - 1].d) NIGHT_REPOS.set(e.r, (NIGHT_REPOS.get(e.r) ?? 0) + 1);
const WEEK_REPOS = new Set(STREAM.filter((e) => (toMs(STREAM[STREAM.length - 1].d) - toMs(e.d)) / DAY_MS < 7).map((e) => e.r));
// 共鳴用: 親子隣接（結晶脈のツリー）
const children = Array.from({ length: N }, () => []);
for (let i = 1; i < N; i++) children[parentIdx[i]].push(i);
const phase = new Array(N);
{ const rnd = mulberry32(7); for (let i = 0; i < N; i++) phase[i] = rnd() * Math.PI * 2; }
/* ライン錨点（弧の中央角）: 星雲・ライン名・line 飛行に使う */
const centroids = [];
for (const l of LINE_ORDER) {
  const sts = STATIONS.filter((st) => st.l === l);
  if (!sts.length) continue;
  const am = (sts[0].a + sts[sts.length - 1].a) / 2;
  centroids.push({ l, a: am, a0: sts[0].a, a1: sts[sts.length - 1].a, x: Math.cos(am) * RING, y: Math.sin(am) * RING, z: 0 });
}

/* ===== 意味ズームの地名（県=事業ライン / 市=リポ / 駅=大きな差分） ===== */
const LINE_SHORT = { saas: "SaaS", toolfactory: "税ツール", explp: "実験LP", data: "規制データ", idol: "アイドル", foundation: "基盤" };
const repoCent = STATIONS.map((st) => ({ r: st.r, l: st.l, n: st.count, x: st.cx, y: st.cy, z: 0 }));

/* ===== カメラ（焦点＝地図の中心・ズーム＝縮尺） ===== */
const cam = { fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, zoomT: 1, ent: { type: "root" } };
function flyTo(ent) {
  if (mode !== "idle") return;
  cam.ent = ent;
  if (ent.type === "root") { cam.tx = 0; cam.ty = 0; cam.tz = 0; cam.zoomT = 1; }
  else if (ent.type === "line") {
    const c = centroids.find((x) => x.l === ent.key);
    if (c) { cam.tx = c.x; cam.ty = c.y; cam.tz = c.z; cam.zoomT = 2.2; }
  } else if (ent.type === "repo") {
    const c = repoCent.find((x) => x.r === ent.key);
    if (c) { cam.tx = c.x; cam.ty = c.y; cam.tz = c.z; cam.zoomT = 3.8; }
  }
}
function zoomOutStep() {
  if (diveAlpha > 0.3) { cam.zoomT = 2.6; return; } // まず部屋から外へ
  flyTo({ type: "root" }); // 環状線は2階層: 全景 ⇄ 駅の中
}
function crumbText() {
  if (cam.ent.type === "line") return "全景 › " + LINE_SHORT[cam.ent.key];
  if (cam.ent.type === "repo") {
    const c = repoCent.find((x) => x.r === cam.ent.key);
    return "全景 › " + (c ? LINE_SHORT[c.l] : "") + " › " + cam.ent.key;
  }
  return "全景";
}
const pfP = { x: 0, y: 0, k: 1, d: 0 };
const labelHits = [];

/* ===== 突入（結晶の中に入る・ズーム深度に連動） ===== */
let diveAlpha = 0, diveRepo = null;
function renderDive(key) {
  diveRepo = key;
  const idxs = [];
  for (let i = N - 1; i >= 1; i--) if (PTS[i].e.r === key) idxs.push(i);
  const st = repoStats(STREAM, key, lastDay);
  document.getElementById("dive-title").textContent = key;
  document.getElementById("dive-meta").textContent = LINE_SHORT[PTS[idxs[0]].e.l] + " ／ 初仕事 " + (st.first || "—").replaceAll("-", ".");
  /* 陳列: まず数字、次に構成と律動、最後に全仕事の一覧 */
  const tiles = [
    { num: "+" + st.lastCount, unit: "粒", cap: "最新の夜（" + (st.lastD || "—").slice(5).replace("-", ".") + "・+" + st.lastLines.toLocaleString() + "行）" },
    { num: "+" + st.week, unit: "粒", cap: "直近7日の更新" },
    { num: st.total, unit: "粒", cap: "通算（" + st.lines.toLocaleString() + "行・稼働" + st.activeDays + "夜）" },
    { num: "—", unit: "", cap: "アクセス（計測接続後に点灯）", dim: true },
  ];
  document.getElementById("dive-stats").innerHTML = tiles.map((x) =>
    "<div class=\"tile" + (x.dim ? " dim" : "") + "\"><div class=\"num\">" + x.num + (x.unit ? "<small>" + x.unit + "</small>" : "") + "</div><div class=\"cap\">" + x.cap + "</div></div>").join("");
  const bar = TYPE_ORDER.filter((t) => st.byType[t]).map((t) =>
    "<i style=\"background:" + TYPE_COLOR[t] + ";flex:" + st.byType[t] + "\"></i>").join("");
  const wmax = Math.max(...st.weekly, 1);
  document.getElementById("dive-viz").innerHTML =
    "<div class=\"dive-bar\">" + bar + "</div><div class=\"dive-cap\">仕事の構成</div>" +
    "<div class=\"dive-week\">" + st.weekly.map((v) => "<i style=\"height:" + Math.max((v / wmax) * 100, 4) + "%\"" + (v === 0 ? " class=\"z\"" : "") + "></i>").join("") + "</div><div class=\"dive-cap\">8週の律動（右端=今週）</div>";
  const ol = document.getElementById("dive-list");
  ol.innerHTML = "";
  for (const i of idxs) {
    const e = PTS[i].e;
    const li = document.createElement("li");
    li.innerHTML = "<i style=\"background:" + TYPE_COLOR[e.t] + "\"></i><span class=\"dv-date\">" + e.d.slice(5).replace("-", ".") +
      "</span><span class=\"dv-n\">+" + e.n.toLocaleString() + "</span><span class=\"dv-s\">" + e.s.replace(/</g, "&lt;") + "</span>";
    li.addEventListener("click", () => {
      const nowT = performance.now();
      resonate(i, nowT);
      caption(captionFor(e) + "　" + e.s.slice(0, 34), nowT, 2600);
      if (reduced) staticRender();
    });
    ol.appendChild(li);
  }
}
function updateDive(instant) {
  const target = cam.ent.type === "repo" ? Math.min(Math.max((userZoom - 4.2) / 1.2, 0), 1) : 0;
  diveAlpha = instant ? target : diveAlpha + (target - diveAlpha) * 0.12;
  if (target > 0 && diveRepo !== cam.ent.key) renderDive(cam.ent.key);
  const el = document.getElementById("dive");
  el.style.opacity = diveAlpha.toFixed(3);
  el.style.pointerEvents = diveAlpha > 0.5 ? "auto" : "none";
  el.setAttribute("aria-hidden", String(diveAlpha <= 0.5));
  /* 現在地ピン留め（部屋にいる間、上部に駅の素性を固定表示） */
  const pin = document.getElementById("dive-pin");
  if (diveAlpha > 0.35 && cam.ent.type === "repo") {
    pin.hidden = false;
    pin.classList.add("on");
    if (pin.dataset.repo !== cam.ent.key) {
      pin.dataset.repo = cam.ent.key;
      const st = STATIONS.find((x) => x.r === cam.ent.key);
      document.getElementById("pin-dot").style.background = st ? LINE_COLOR[st.l] : "#666";
      document.getElementById("pin-name").textContent = cam.ent.key;
      document.getElementById("pin-line").textContent = st ? LINE_LABEL[st.l] : "";
      const bd = document.getElementById("pin-badge");
      const nT = NIGHT_REPOS.get(cam.ent.key);
      bd.hidden = !nT;
      if (nT) bd.textContent = "昨夜 +" + nT;
    }
  } else {
    pin.classList.remove("on");
    if (diveAlpha < 0.05) pin.hidden = true;
  }
}

/* ===== 突入スピードライン（PS2 的なトンネル潜行の演出） ===== */
const streaks = [];
{ const rnd = mulberry32(777);
  for (let i = 0; i < 26; i++) streaks.push({ a: rnd() * 2 * Math.PI, r0: 0.16 + rnd() * 0.2, r1: 0.45 + rnd() * 0.45, ph: rnd() * 7 }); }
let prevZoomF = 1;

/* ===== 遠景の星層（視差で奥行きを出す） ===== */
const stars = [];
{ const rnd = mulberry32(123);
  for (let i = 0; i < 80; i++) {
    const u = rnd() * 2 - 1;
    stars.push({ az: rnd() * 2 * Math.PI, el: Math.asin(u), d: (1.5 + rnd() * 1.3) * CR, r: 0.4 + rnd() * 0.9, a: 0.05 + rnd() * 0.12 });
  } }

/* ===== 色 ===== */
function hex2rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mixc(c1, c2, t) { return "rgb(" + c1.map((v, i) => Math.round(v + (c2[i] - v) * t)).join(",") + ")"; }
const WHITE = [242, 239, 230];
const RGB = { type: {}, line: {} };
for (const k of TYPE_ORDER) RGB.type[k] = hex2rgb(TYPE_COLOR[k]);
for (const k of LINE_ORDER) RGB.line[k] = hex2rgb(LINE_COLOR[k]);
let colorMode = "type";
const rgbOf = (e) => (colorMode === "type" ? RGB.type[e.t] : RGB.line[e.l]);

/* ===== 観測記録（localStorage） ===== */
const STORE = "kessho:v1";
function todayLocal() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
let visit = { first: todayLocal(), last: todayLocal(), visits: 1, streak: 1 };
let catchup = null;
let obsEvent = observationEvent(null); // 計測ビーコンの経路（記録が読めなければ初観測扱い）
try {
  const prev = JSON.parse(localStorage.getItem(STORE) || "null");
  obsEvent = observationEvent(prev);
  const r = updateVisitState(prev, todayLocal(), STREAM.length, totalLines);
  visit = r.state; catchup = r.catchup;
  localStorage.setItem(STORE, JSON.stringify(visit));
} catch (e) { /* private mode 等では記録なしで動く */ }

/* ===== 計測ビーコン（GoatCounter・DESIGN.md §14「計測の例外」） =====
 * 初期化時に 1 回だけ event/first または event/return を送る。描画には一切関与しない:
 * ビーコン未注入（GOATCOUNTER_CODE 未設定）なら何もしない。count.js は async 読込のため、
 * まだ無ければ script の load を一度だけ待つ。どの経路でも例外は外に出さない。 */
(function sendObservationEvent(path) {
  let sent = false;
  const fire = () => {
    if (sent) return;
    try {
      const gc = window.goatcounter;
      if (!gc || typeof gc.count !== "function") return;
      sent = true;
      gc.count({ path, event: true });
    } catch (err) { /* 計測失敗は無視 */ }
  };
  try {
    fire();
    if (!sent) {
      const s = document.querySelector("script[data-goatcounter]");
      if (s) s.addEventListener("load", fire, { once: true });
    }
  } catch (err) { /* 計測失敗は無視 */ }
})(obsEvent);

/* ===== 検分ミッション（昨夜の粒を全部タップする） ===== */
const MSTORE = "kessho:mission", DSTORE = "kessho:inspectdays";
const mission = missionTargets(nights);
let mstate = { date: mission.date, done: [] };
let inspectDays = 0;
try {
  mstate = loadMission(JSON.parse(localStorage.getItem(MSTORE) || "null"), mission.date, mission.targets);
  inspectDays = JSON.parse(localStorage.getItem(DSTORE) || "0") | 0;
} catch (e) { /* 記録なしで動く */ }
const missionRemain = () => mission.targets.filter((i) => !mstate.done.includes(i));

/* ===== 共鳴（タップで枝を伝う光の連鎖） ===== */
let resQueue = []; // {i, t}
function resonate(idx, now) {
  const seen = new Set([idx]);
  let frontier = [idx], hop = 0, count = 1;
  nglow[idx] = 1;
  while (frontier.length && hop < 14) {
    hop++;
    const next = [];
    for (const i of frontier) {
      for (const j of [parentIdx[i], ...children[i]]) {
        if (j === 0 || seen.has(j) || j >= visible) continue;
        seen.add(j);
        next.push(j);
        resQueue.push({ i: j, t: now + hop * 85 });
        count++;
      }
    }
    frontier = next;
  }
  return count;
}

/* ===== canvas スタック ===== */
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const trailCv = document.createElement("canvas");
const bloomCv = document.createElement("canvas");
const bgCv = document.createElement("canvas");
let W = 0, H = 0, DPR = 1, SCALE = 1;
const fitScale = (cr) => Math.min(W, H) / 2 / (cr * 1.18 + 14);

let sprites = [];
function buildSprites() {
  sprites = new Array(N);
  for (let i = 1; i < N; i++) {
    const p = PTS[i];
    const rgb = rgbOf(p.e);
    const tier = heatTier(ageOf(p.e));
    const rp = Math.max(p.r * SCALE, 0.8) * DPR;
    const R = Math.ceil(rp * 2.3);
    const c = document.createElement("canvas");
    c.width = c.height = R * 2;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    const NIGHT = [10, 13, 19];
    const coreCol = tier === 0 ? mixc(rgb, WHITE, 0.8) : tier === 1 ? mixc(rgb, WHITE, 0.42) : tier === 2 ? mixc(rgb, WHITE, 0.1) : mixc(rgb, NIGHT, 0.22);
    const glowA = [0.5, 0.26, 0.1, 0.06][tier];
    grad.addColorStop(0, coreCol);
    grad.addColorStop(rp / R * 0.72, tier <= 1 ? mixc(rgb, WHITE, 0.12) : "rgb(" + rgb.join(",") + ")");
    grad.addColorStop(rp / R, "rgba(" + rgb.join(",") + ",0.96)");
    grad.addColorStop(Math.min(rp / R * 1.35, 0.9), "rgba(" + rgb.join(",") + "," + glowA + ")");
    grad.addColorStop(1, "rgba(" + rgb.join(",") + ",0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, R * 2, R * 2);
    g.fillStyle = "rgba(255,255,255," + (tier <= 1 ? 0.85 : 0.4) + ")";
    g.beginPath();
    g.arc(R - rp * 0.34, R - rp * 0.34, Math.max(rp * 0.2, 0.6), 0, 7);
    g.fill();
    sprites[i] = { c, R, tier, alpha: [1, 0.97, 0.88, 0.78][tier] };
  }
}
function buildBg() {
  bgCv.width = Math.max(W * DPR, 1); bgCv.height = Math.max(H * DPR, 1);
  const g = bgCv.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = "#0c0f16";
  g.fillRect(0, 0, W, H);
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, "rgba(4,6,10,0)");
  v.addColorStop(1, "rgba(4,6,10,0.5)");
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}
function layout() {
  W = cv.clientWidth || 1; H = cv.clientHeight || 1;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = W * DPR; cv.height = H * DPR;
  trailCv.width = W * DPR; trailCv.height = H * DPR;
  bloomCv.width = Math.max(1, Math.round(W * DPR / 4)); bloomCv.height = Math.max(1, Math.round(H * DPR / 4));
  SCALE = fitScale(CR);
  buildSprites();
  buildBg();
}

/* ===== 塵（3D 殻・視差） ===== */
const motes = [];
{ const rnd = mulberry32(99);
  for (let i = 0; i < 46; i++) {
    const u = rnd() * 2 - 1;
    motes.push({ az: rnd() * 2 * Math.PI, el: Math.asin(u) * 0.7, d: (0.5 + rnd() * 0.9) * CR, sp: 0.3 + rnd() * 0.9, ph: rnd() * 2 * Math.PI, r: 0.5 + rnd() * 1.1, al: 0.04 + rnd() * 0.07 });
  } }

/* ===== HUD（canvas 内描画） ===== */
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
let hudTick = "", hudTally = "";
function setHud(i) {
  const p = PTS[Math.max(1, i) - 1];
  hudTick = (p.e ? p.e.d : firstDay).replaceAll("-", ".");
  const lines = PTS.slice(1, i).reduce((s, q) => s + q.e.n, 0);
  hudTally = "粒子 " + (i - 1) + " ／ " + lines.toLocaleString() + " 行";
}
let capText = "", capT0 = 0, capUntil = 0;
function caption(text, now, hold) { capText = text; capT0 = now; capUntil = now + (hold || 1400); }
let sum = null;
function showSummary(now, lines, count, label) { sum = { t0: now, lines, count, label }; }

/* ===== アニメーション状態 ===== */
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let mode = "idle";
let visible = N;
let camScale = null;
let comets = [];
let impacts = [];
let sparks = [];
let nglow = new Float32Array(N);
let glints = [];
let finaleT = 0;
let seq = null;
let rep = null;
let lastFrame = 0;
const rndFx = mulberry32(4242);
const SPD = { idle: 0, landing: 0, replay: 0.42, finale: 0.12 };

/* 関与レイヤー */
let userZoom = 1;
let scrubVal = nDays;
let scrubbing = false;
let focusKey = null;
const matchFocus = (e) => !focusKey || (focusKey.kind === "type" ? e.t === focusKey.key : e.l === focusKey.key);
const drag = { active: false, id: -1, lx: 0, moved: 0, vel: 0, lastT: 0 };
const pinch = new Map();
let pinchD0 = 0, zoom0 = 1, lastTapT = 0;

/* ===== 投影 ===== */
const P = new Array(N); for (let i = 0; i < N; i++) P[i] = { x: 0, y: 0, k: 1, d: 0 };
const order = Array.from({ length: N }, (_, i) => i);
let rot = 0.6, rotSpeed = 0;
let proj = makeProjector(rot, tiltForZoom(1), F);
function setCam(now) { proj = makeProjector(rot, tiltForZoom(userZoom) + Math.sin(now * 0.00006) * 0.04, F); }
const tmpP = { x: 0, y: 0, k: 1, d: 0 };

/* ===== 彗星・衝撃 ===== */
function launchComet(i, t0, dur) {
  const p = PTS[i];
  const az = Math.atan2(p.y, p.x) + (rndFx() - 0.5) * 0.9;
  const el = (rndFx() - 0.5) * 1.1;
  const far = CR + 150 + rndFx() * 60;
  const x0 = Math.cos(az) * Math.cos(el) * far, y0 = Math.sin(az) * Math.cos(el) * far, z0 = Math.sin(el) * far;
  const bend = (rndFx() - 0.5) * 120;
  const perp = az + Math.PI / 2;
  comets.push({ i, t0, dur, x0, y0, z0, cx: (x0 + p.x) / 2 + Math.cos(perp) * bend, cy: (y0 + p.y) / 2 + Math.sin(perp) * bend, cz: (z0 + p.z) / 2 + (rndFx() - 0.5) * 80 });
}
const bz = (a, c, b, u) => { const v = 1 - u; return v * v * a + 2 * v * u * c + u * u * b; };
function impactAt(i, now) {
  const p = PTS[i];
  const rgb = rgbOf(p.e);
  impacts.push({ i, t0: now, big: p.r > 4 });
  const nSp = p.r > 4 ? 12 : 7;
  for (let k = 0; k < nSp; k++) {
    const u = rndFx() * 2 - 1, th = rndFx() * 2 * Math.PI, sxy = Math.sqrt(Math.max(0, 1 - u * u));
    const sp = (0.9 + rndFx() * 1.7) * (p.r > 4 ? 1.5 : 1);
    sparks.push({ x: p.x, y: p.y, z: p.z, vx: sxy * Math.cos(th) * sp, vy: sxy * Math.sin(th) * sp, vz: u * sp, t0: now, life: 500 + rndFx() * 380, rgb });
  }
  for (const j of neighbors[i]) if (j < visible) nglow[j] = 1;
  caption(captionFor(p.e), now);
}

/* ===== メインフレーム ===== */
let rafId = 0, running = false;
function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) || 16, 50) / 1000;
  lastFrame = now;

  const target = SPD[mode] ?? SPD.idle;
  rotSpeed += (target - rotSpeed) * 0.05;
  if (!drag.active) rot += rotSpeed * dt;
  setCam(now);
  /* カメラ: 焦点とズームを目標へ滑らかに寄せる */
  cam.fx += (cam.tx - cam.fx) * 0.07;
  cam.fy += (cam.ty - cam.fy) * 0.07;
  cam.fz += (cam.tz - cam.fz) * 0.07;
  if (pinch.size < 2) userZoom += (cam.zoomT - userZoom) * 0.07;
  if (userZoom < 1.2 && cam.ent.type !== "root") { cam.ent = { type: "root" }; cam.tx = 0; cam.ty = 0; cam.tz = 0; }
  updateDive(false);
  const s = (mode === "replay" && camScale ? camScale : SCALE) * userZoom;
  proj(cam.fx, cam.fy, cam.fz, pfP);

  if (mode === "landing" && seq) {
    while (seq.launched < seq.count && now >= seq.t0 + seq.launched * seq.per) {
      launchComet(seq.base + seq.launched, seq.t0 + seq.launched * seq.per, seq.flight);
      seq.launched++;
    }
    if (seq.launched >= seq.count && comets.length === 0 && now > seq.t0 + seq.count * seq.per + seq.flight + 400) {
      const lines = PTS.slice(seq.base, seq.base + seq.count).reduce((sm, q) => sm + q.e.n, 0);
      showSummary(now, lines, seq.count, seq.label);
      endSequence();
    }
  }
  if (mode === "replay" && rep) {
    const u = Math.min((now - rep.t0) / rep.dur, 1);
    const ease = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const targetN = Math.max(2, Math.round(N * ease));
    while (visible < targetN) {
      const p = PTS[visible];
      impacts.push({ i: visible, t0: now, big: p.r > 5 });
      if (p.e.n > 1200) caption(p.e.d.replaceAll("-", ".") + "　" + p.e.r + " +" + p.e.n.toLocaleString() + "行", now, 900);
      visible++;
    }
    camScale += (fitScale(PTS[Math.max(1, visible - 1)].cr + 26) - camScale) * 0.055;
    setHud(visible);
    if (u >= 1) { finaleT = now; mode = "finale"; showSummary(now, totalLines, N - 1, nDays + "日の創世"); }
  }
  if (mode === "finale") {
    camScale += (SCALE - camScale) * 0.05;
    if (now - finaleT > 2400) { mode = "idle"; camScale = null; enableBtns(); }
  }

  /* 共鳴の伝播（予約時刻に達した粒を発光させる） */
  if (resQueue.length) {
    const rest = [];
    for (const q of resQueue) {
      if (q.t <= now) nglow[q.i] = 1;
      else rest.push(q);
    }
    resQueue = rest;
  }

  for (let i = 0; i < N; i++) proj(PTS[i].x, PTS[i].y, PTS[i].z, P[i]);
  order.sort((a, b) => P[b].d - P[a].d);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bgCv, 0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2 - pfP.x * s, H / 2 - pfP.y * s);

  /* 遠景の星層（結晶より奥・視差の基準） */
  ctx.fillStyle = "#e9e4d8";
  for (const st of stars) {
    proj(Math.cos(st.az) * Math.cos(st.el) * st.d, Math.sin(st.az) * Math.cos(st.el) * st.d, Math.sin(st.el) * st.d, tmpP);
    if (tmpP.d < 0) continue; // 手前側の星は描かない（結晶の後ろだけ）
    ctx.globalAlpha = st.a;
    ctx.beginPath(); ctx.arc(tmpP.x * s, tmpP.y * s, st.r * tmpP.k, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* 地の光（枝ごとの星雲・回転に追随） */
  for (const c of centroids) {
    proj(c.x, c.y, c.z, tmpP);
    const rgb = colorMode === "type" ? [110, 118, 148] : RGB.line[c.l];
    const rad = CR * s * 0.7 * tmpP.k;
    const g = ctx.createRadialGradient(tmpP.x * s, tmpP.y * s, 0, tmpP.x * s, tmpP.y * s, rad);
    g.addColorStop(0, "rgba(" + rgb.join(",") + ",0.05)");
    g.addColorStop(1, "rgba(" + rgb.join(",") + ",0)");
    ctx.fillStyle = g;
    ctx.fillRect(-W / 2, -H / 2, W, H);
  }

  /* 環状線ダイアグラム（路線・駅・バッジ・ハブの今夜数字） */
  drawRing(s, now);

  /* 窓の並びを繋ぐ淡い年表線 */
  for (const i of order) {
    if (i === 0 || i >= visible) continue;
    const pp = P[i];
    const isChain = parentIdx[i] !== 0;
    const rgb = rgbOf(PTS[i].e);
    const fa = (isChain ? 0.34 : 0.06) * (matchFocus(PTS[i].e) ? 1 : 0.15);
    let va = fa * fogOf(pp.d, CR);
    if (diveAlpha > 0.02 && PTS[i].e.r !== cam.ent.key) va *= 1 - diveAlpha * 0.85;
    if (va < 0.01) continue;
    ctx.strokeStyle = "rgba(" + rgb.join(",") + "," + (va * 0.5).toFixed(3) + ")";
    ctx.lineWidth = Math.max(0.5, Math.min(0.5 * s * pp.k, 2));
    ctx.beginPath();
    ctx.moveTo(P[parentIdx[i]].x * s, P[parentIdx[i]].y * s);
    ctx.lineTo(pp.x * s, pp.y * s);
    ctx.stroke();
  }

  /* 粒（奥→手前） */
  for (const i of order) {
    if (i === 0 || i >= visible) continue;
    const sp = sprites[i];
    if (!sp) continue;
    const pp = P[i];
    let size = (sp.R * 2) / DPR * (s / SCALE) * pp.k;
    let al = sp.alpha * fogOf(pp.d, CR);
    if (sp.tier <= 1 && mode !== "replay") {
      const w = Math.sin(now / 640 + phase[i]);
      size *= 1 + 0.05 * w;
      al *= 0.9 + 0.1 * w;
    }
    if (nglow[i] > 0.02) { al = Math.min(1, al + nglow[i] * 0.6); nglow[i] *= 0.93; }
    if (!matchFocus(PTS[i].e)) al *= 0.1;
    /* 突入: カメラ極近の粒は巨大化しつつ後方へ流れ去る／部屋の外は霧に沈む */
    if (pp.k > 2.1) al *= Math.max(0, (3.4 - pp.k) / 1.3);
    if (diveAlpha > 0.02 && PTS[i].e.r !== cam.ent.key) al *= 1 - diveAlpha * 0.85;
    if (al < 0.012) continue;
    ctx.globalAlpha = al;
    ctx.drawImage(sp.c, pp.x * s - size / 2, pp.y * s - size / 2, size, size);
  }
  ctx.globalAlpha = 1;

  /* 検分ミッションの標的マーカー（未検分の昨夜の粒） */
  if (mode === "idle") {
    for (const idx of missionRemain()) {
      if (idx >= visible) continue;
      const pp = P[idx];
      const pr = Math.max(PTS[idx].r * s * pp.k, 3);
      const pulse = 1 + 0.16 * Math.sin(now / 260 + idx);
      ctx.globalAlpha = 0.75 * fogOf(pp.d, CR);
      ctx.strokeStyle = "#f2d98a";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -now / 60;
      ctx.beginPath();
      ctx.arc(pp.x * s, pp.y * s, pr + 7 * pulse, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  /* 彗星 */
  const keep = [];
  for (const c of comets) {
    const u = Math.min((now - c.t0) / c.dur, 1);
    if (u < 0) { keep.push(c); continue; }
    const eu = u * u;
    const p = PTS[c.i];
    proj(bz(c.x0, c.cx, p.x, eu), bz(c.y0, c.cy, p.y, eu), bz(c.z0, c.cz, p.z, eu), tmpP);
    const rgb = rgbOf(p.e);
    trailDot((tmpP.x - pfP.x) * s, (tmpP.y - pfP.y) * s, rgb, (1.6 + p.r * 0.3) * tmpP.k);
    const hx = tmpP.x * s, hy = tmpP.y * s;
    const hr = (2.2 + p.r * 0.35 * s) * tmpP.k;
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr * 3);
    g.addColorStop(0, "rgba(242,239,230,0.95)");
    g.addColorStop(0.35, "rgba(" + rgb.join(",") + ",0.7)");
    g.addColorStop(1, "rgba(" + rgb.join(",") + ",0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(hx, hy, hr * 3, 0, 7); ctx.fill();
    if (u >= 1) { visible = Math.max(visible, c.i + 1); impactAt(c.i, now); setHud(visible); }
    else keep.push(c);
  }
  comets = keep;

  /* 衝撃波 */
  impacts = impacts.filter((im) => now - im.t0 < 800);
  for (const im of impacts) {
    const u = (now - im.t0) / 800;
    const pp = P[im.i];
    const rgb = rgbOf(PTS[im.i].e);
    const rad = (3 + u * (im.big ? 46 : 26)) * (s / SCALE) * pp.k;
    ctx.globalAlpha = 0.55 * (1 - u) * fogOf(pp.d, CR);
    ctx.strokeStyle = "rgba(" + rgb.join(",") + ",1)";
    ctx.lineWidth = im.big ? 1.8 : 1.2;
    ctx.beginPath(); ctx.arc(pp.x * s, pp.y * s, rad, 0, 7); ctx.stroke();
    if (im.big) {
      ctx.globalAlpha = 0.3 * (1 - u);
      ctx.strokeStyle = "#f2efe6";
      ctx.beginPath(); ctx.arc(pp.x * s, pp.y * s, rad * 0.6, 0, 7); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  /* 火花 */
  sparks = sparks.filter((k) => now - k.t0 < k.life);
  for (const k of sparks) {
    const u = (now - k.t0) / k.life;
    const ep = 1 - Math.pow(1 - u, 2);
    proj(k.x + k.vx * ep * 26, k.y + k.vy * ep * 26, k.z + k.vz * ep * 26, tmpP);
    const hx = tmpP.x * s, hy = tmpP.y * s;
    proj(k.x + k.vx * ep * 26 * 0.82, k.y + k.vy * ep * 26 * 0.82, k.z + k.vz * ep * 26 * 0.82, tmpP);
    ctx.globalAlpha = (1 - u) * 0.85;
    ctx.strokeStyle = "rgba(" + k.rgb.join(",") + ",1)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tmpP.x * s, tmpP.y * s); ctx.lineTo(hx, hy); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* 硝子のきらめき */
  if (mode === "idle" && glints.length < 2 && rndFx() < 0.012) {
    const cand = 1 + Math.floor(rndFx() * (N - 1));
    if (sprites[cand] && sprites[cand].tier >= 2) glints.push({ i: cand, t0: now });
  }
  glints = glints.filter((g) => now - g.t0 < 700);
  for (const g of glints) {
    const u = (now - g.t0) / 700;
    const pp = P[g.i];
    const len = Math.sin(u * Math.PI) * (PTS[g.i].r * s * pp.k * 2.6 + 4);
    ctx.globalAlpha = Math.sin(u * Math.PI) * 0.8 * fogOf(pp.d, CR);
    ctx.strokeStyle = "#f2efe6";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(pp.x * s - len, pp.y * s); ctx.lineTo(pp.x * s + len, pp.y * s);
    ctx.moveTo(pp.x * s, pp.y * s - len * 0.7); ctx.lineTo(pp.x * s, pp.y * s + len * 0.7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* 塵 */
  for (const m of motes) {
    const az = m.az + now * 0.00001 * m.sp;
    const wob = Math.sin(now / 4000 * m.sp + m.ph);
    const d = m.d + wob * 10;
    proj(Math.cos(az) * Math.cos(m.el) * d, Math.sin(az) * Math.cos(m.el) * d, Math.sin(m.el) * d, tmpP);
    ctx.globalAlpha = m.al * (0.7 + 0.3 * wob) * fogOf(tmpP.d, CR);
    ctx.fillStyle = "#e9e4d8";
    ctx.beginPath(); ctx.arc(tmpP.x * s, tmpP.y * s, m.r * tmpP.k, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  /* 残光 */
  const tctx = trailCv.getContext("2d");
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.globalCompositeOperation = "destination-out";
  tctx.fillStyle = "rgba(0,0,0,0.10)";
  tctx.fillRect(0, 0, trailCv.width, trailCv.height);
  tctx.globalCompositeOperation = "source-over";
  ctx.globalCompositeOperation = "lighter";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(trailCv, 0, 0);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  /* ブルーム */
  const bctx = bloomCv.getContext("2d");
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, bloomCv.width, bloomCv.height);
  bctx.drawImage(cv, 0, 0, bloomCv.width, bloomCv.height);
  let bloomA = 0.26;
  if (mode === "finale") bloomA += 0.5 * Math.exp(-(now - finaleT) / 700) * (0.6 + 0.4 * Math.sin((now - finaleT) / 110));
  ctx.globalAlpha = bloomA;
  ctx.drawImage(bloomCv, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  /* 突入スピードライン（ズーム速度に連動） */
  const zv = Math.abs(userZoom - prevZoomF);
  prevZoomF = userZoom;
  if (zv > 0.012) {
    const base = Math.min(zv * 4.5, 0.42);
    const mR = Math.min(W, H);
    ctx.strokeStyle = "#b9c2ea";
    ctx.lineWidth = 1.2;
    for (const st of streaks) {
      ctx.globalAlpha = base * (0.45 + 0.55 * Math.sin(now / 55 + st.ph));
      const c = Math.cos(st.a), sn = Math.sin(st.a);
      ctx.beginPath();
      ctx.moveTo(W / 2 + c * mR * st.r0, H / 2 + sn * mR * st.r0);
      ctx.lineTo(W / 2 + c * mR * st.r1, H / 2 + sn * mR * st.r1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawHUD(now);
}
function trailDot(sx, sy, rgb, r) {
  const t = trailCv.getContext("2d");
  t.setTransform(DPR, 0, 0, DPR, 0, 0);
  t.fillStyle = "rgba(" + rgb.join(",") + ",0.5)";
  t.beginPath();
  t.arc(W / 2 + sx, H / 2 + sy, r, 0, 7);
  t.fill();
}

/* ===== 環状線ダイアグラム描画（translate 済み ctx 内で呼ぶ） =====
 * ベックの路線図原理: 均一な駅・規則的な弧・データはバッジと数字で語る */
const tmpA = { x: 0, y: 0, k: 1, d: 0 };
const SERIF_C = "'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif";
const stationScreen = []; // タップ判定用（画面座標）
function ringPath(a0, a1, seg) {
  ctx.beginPath();
  for (let t = 0; t <= seg; t++) {
    const a = a0 + ((a1 - a0) * t) / seg;
    proj(Math.cos(a) * RING, Math.sin(a) * RING, 0, tmpA);
    if (t === 0) ctx.moveTo(tmpA.x * curS, tmpA.y * curS);
    else ctx.lineTo(tmpA.x * curS, tmpA.y * curS);
  }
}
let curS = 1;
function drawRing(s, now) {
  curS = s;
  stationScreen.length = 0;
  const remainRepos = new Set(missionRemain().map((i) => PTS[i].e.r));
  const offX = W / 2 - pfP.x * s, offY = H / 2 - pfP.y * s;
  const outDim = diveAlpha > 0.02 ? 1 - diveAlpha * 0.85 : 1;
  const halfStep = Math.PI / Math.max(STATIONS.length, 1);
  /* 環の下地 */
  ctx.strokeStyle = "rgba(140,150,180," + (0.14 * outDim).toFixed(3) + ")";
  ctx.lineWidth = 2;
  ringPath(0, 2 * Math.PI, 72);
  ctx.stroke();
  /* ライン色の弧（路線） */
  ctx.lineCap = "round";
  for (const c of centroids) {
    let dim = outDim;
    if (focusKey && focusKey.kind === "line" && c.l !== focusKey.key) dim *= 0.15;
    ctx.strokeStyle = "rgba(" + RGB.line[c.l].join(",") + "," + (0.85 * dim).toFixed(3) + ")";
    ctx.lineWidth = 4.5;
    ringPath(c.a0 - halfStep * 0.62, c.a1 + halfStep * 0.62, 24);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
  /* 駅ポッド（全て同径・均一） */
  ctx.textBaseline = "middle";
  for (const st of STATIONS) {
    proj(st.cx, st.cy, 0, tmpA);
    const x = tmpA.x * s, y = tmpA.y * s, pr = Math.max(POD * s * tmpA.k, 10);
    let dim = outDim;
    if (diveAlpha > 0.02 && st.r === cam.ent.key) dim = 1;
    if (focusKey && focusKey.kind === "line" && st.l !== focusKey.key) dim *= 0.2;
    if (dim < 0.03) continue;
    /* ポッド本体 */
    ctx.fillStyle = "rgba(13,17,25," + (0.92 * dim).toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(x, y, pr, 0, 7); ctx.fill();
    if (WEEK_REPOS.has(st.r)) {
      ctx.strokeStyle = "rgba(" + RGB.line[st.l].join(",") + "," + (0.25 * dim).toFixed(3) + ")";
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, y, pr - 4, 0, 7); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(" + RGB.line[st.l].join(",") + "," + (0.95 * dim).toFixed(3) + ")";
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(x, y, pr, 0, 7); ctx.stroke();
    /* 昨夜更新バッジ（琥珀・脈動） */
    const nToday = NIGHT_REPOS.get(st.r);
    if (nToday) {
      const bx = x + pr * 0.78, by = y - pr * 0.78;
      if (remainRepos.has(st.r)) {
        const pu = 0.6 + 0.4 * Math.sin(now / 260);
        ctx.strokeStyle = "rgba(242,217,138," + (0.9 * pu * dim).toFixed(3) + ")";
        ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(bx, by, 11 + 2.5 * pu, 0, 7); ctx.stroke();
      }
      ctx.fillStyle = "rgba(242,217,138," + (0.95 * dim).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(bx, by, 10, 0, 7); ctx.fill();
      ctx.fillStyle = "#0a0d13";
      ctx.font = "700 11px " + MONO;
      ctx.textAlign = "center";
      ctx.fillText("+" + nToday, bx, by + 0.5);
    }
    /* 駅名（常時・明るく）。横方向の駅は上下に置いて画面外へのはみ出しを防ぐ（路線図の流儀） */
    const cs = Math.cos(st.a), sn = Math.sin(st.a);
    ctx.font = "13.5px " + MONO;
    ctx.shadowColor = "rgba(5,7,11,0.95)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "rgba(233,228,216," + (0.95 * dim).toFixed(3) + ")";
    if (Math.abs(cs) > 0.55) {
      ctx.textAlign = "center";
      ctx.fillText(st.r, x, y + (sn >= 0 ? pr + 18 : -(pr + 12)));
    } else {
      proj(Math.cos(st.a) * (RING + POD + 12), Math.sin(st.a) * (RING + POD + 12), 0, tmpA);
      ctx.textAlign = "center";
      ctx.fillText(st.r, tmpA.x * s, tmpA.y * s + (sn > 0 ? 10 : -6));
    }
    ctx.shadowBlur = 0;
    stationScreen.push({ x: offX + x, y: offY + y, r: pr + 18, repo: st.r });
  }
  /* ライン名（弧の外側） */
  ctx.font = "600 15px " + SERIF_C;
  for (const c of centroids) {
    let dim = outDim;
    if (focusKey && focusKey.kind === "line" && c.l !== focusKey.key) dim *= 0.25;
    proj(Math.cos(c.a) * (RING + POD + 44), Math.sin(c.a) * (RING + POD + 44), 0, tmpA);
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(5,7,11,0.95)";
    ctx.shadowBlur = 6;
    const rgb = RGB.line[c.l];
    ctx.fillStyle = "rgba(" + rgb.join(",") + "," + (0.9 * dim).toFixed(3) + ")";
    ctx.fillText(LINE_LABEL[c.l], tmpA.x * s, tmpA.y * s);
    ctx.shadowBlur = 0;
  }
  /* ハブ = 今夜のヒーロー数字（面白いポイントを最前面に） */
  const hubA = Math.max(0.15, 1 - diveAlpha);
  const hubR = Math.max(46 * s, 30);
  ctx.fillStyle = "rgba(12,15,22," + (0.85 * hubA).toFixed(3) + ")";
  ctx.beginPath(); ctx.arc(0, 0, hubR, 0, 7); ctx.fill();
  ctx.strokeStyle = "rgba(150,160,190," + (0.45 * hubA).toFixed(3) + ")";
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, hubR, 0, 7); ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(168,162,148," + (0.9 * hubA).toFixed(3) + ")";
  ctx.font = "11px " + MONO;
  ctx.fillText(jpDate(lastDay) + " の夜業", 0, -20);
  ctx.fillStyle = "rgba(242,239,230," + hubA.toFixed(3) + ")";
  ctx.font = "700 24px " + MONO;
  ctx.fillText("+" + lastNight.count + " 粒", 0, 2);
  ctx.fillStyle = "rgba(168,162,148," + (0.9 * hubA).toFixed(3) + ")";
  ctx.font = "12px " + MONO;
  ctx.fillText("+" + lastNight.lines.toLocaleString() + " 行", 0, 22);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

/* ===== HUD 描画 ===== */
function drawHUD(now) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.textBaseline = "top";
  ctx.font = "14px " + MONO;
  ctx.fillStyle = "rgba(210,204,190,0.95)";
  ctx.textAlign = "right";
  ctx.fillText(hudTick, W - 14, 14);
  /* パンくず（地図の現在地） */
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(240,236,226,0.95)";
  ctx.fillText(crumbText() + (diveAlpha > 0.5 ? " › 仕事一覧" : ""), W / 2, 14);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(210,204,190,0.9)";
  ctx.fillText(hudTally, 14, H - 48);
  const remain = missionRemain();
  if (remain.length && mode === "idle") {
    const inTargetRoom = diveAlpha > 0.5 && cam.ent.type === "repo" && remain.some((i) => PTS[i].e.r === cam.ent.key);
    const guide = inTargetRoom ? "光る枠の窓をタップして検分" : "琥珀バッジの駅に昨夜の仕事 ── 入って検分";
    ctx.fillStyle = "rgba(242,217,138,0.95)";
    ctx.font = "14px " + MONO;
    ctx.fillText("検分 " + mstate.done.length + "/" + mission.targets.length + " ── " + guide, 14, diveAlpha > 0.35 ? 98 : 38);
  }
  const sx0 = 14, sx1 = W - 14, sy = H - 18;
  ctx.strokeStyle = "rgba(74,84,112,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(sx0, sy); ctx.lineTo(sx1, sy); ctx.stroke();
  const px = sx0 + ((scrubVal - 1) / (nDays - 1)) * (sx1 - sx0);
  ctx.strokeStyle = "rgba(122,135,232,0.75)";
  ctx.beginPath(); ctx.moveTo(sx0, sy); ctx.lineTo(px, sy); ctx.stroke();
  ctx.fillStyle = mode === "idle" ? "#e9e4d8" : "rgba(233,228,216,0.25)";
  ctx.beginPath(); ctx.arc(px, sy, 6.5, 0, 7); ctx.fill();
  if (capUntil) {
    if (now > capUntil + 300) { capUntil = 0; }
    else {
      const a = Math.max(0, Math.min(1, (now - capT0) / 150, (capUntil + 300 - now) / 300));
      ctx.globalAlpha = a;
      ctx.textAlign = "center";
      ctx.font = "15px " + MONO;
      ctx.fillStyle = "#f2efe6";
      ctx.fillText(capText, W / 2, diveAlpha > 0.5 ? Math.round(H * 0.30) : H - 80);
      ctx.globalAlpha = 1;
    }
  }
  if (sum) {
    const el = now - sum.t0;
    if (el > 4200) { sum = null; }
    else {
      const a = el < 300 ? el / 300 : el > 3300 ? Math.max(0, 1 - (el - 3300) / 900) : 1;
      const u = Math.min(1, el / 1100);
      const shown = Math.round(sum.lines * u * u * (3 - 2 * u));
      ctx.globalAlpha = a;
      ctx.textAlign = "center";
      ctx.font = "600 " + Math.round(Math.min(52, W * 0.08)) + "px " + MONO;
      ctx.fillStyle = "#f2efe6";
      ctx.shadowColor = "rgba(122,135,232,0.6)";
      ctx.shadowBlur = 24;
      ctx.fillText("+" + shown.toLocaleString() + " 行", W / 2, H / 2 - 44);
      ctx.shadowBlur = 0;
      ctx.font = "14px " + MONO;
      ctx.fillStyle = "#a8a294";
      ctx.fillText(sum.label + " ／ " + sum.count + " 粒", W / 2, H / 2 + 22);
      ctx.globalAlpha = 1;
    }
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

/* ===== 静止レンダリング（reduced-motion） ===== */
function staticRender() {
  rot = 0.6; rotSpeed = 0;
  setCam(0);
  cam.fx = cam.tx; cam.fy = cam.ty; cam.fz = cam.tz;
  userZoom = cam.zoomT;
  updateDive(true);
  const sv = SCALE * userZoom;
  for (let i = 0; i < N; i++) proj(PTS[i].x, PTS[i].y, PTS[i].z, P[i]);
  proj(cam.fx, cam.fy, cam.fz, pfP);
  order.sort((a, b) => P[b].d - P[a].d);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bgCv, 0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2 - pfP.x * sv, H / 2 - pfP.y * sv);
  drawRing(sv, 0);
  for (const i of order) {
    if (i === 0 || i >= visible) continue;
    const pp = P[i];
    const rgb = rgbOf(PTS[i].e);
    const isChain = parentIdx[i] !== 0;
    const fa = (isChain ? 0.34 : 0.06) * (matchFocus(PTS[i].e) ? 1 : 0.15) * 0.5;
    ctx.strokeStyle = "rgba(" + rgb.join(",") + "," + (fa * fogOf(pp.d, CR)).toFixed(3) + ")";
    ctx.lineWidth = Math.max(0.5, Math.min(0.5 * sv * pp.k, 2));
    ctx.beginPath();
    ctx.moveTo(P[parentIdx[i]].x * sv, P[parentIdx[i]].y * sv);
    ctx.lineTo(pp.x * sv, pp.y * sv);
    ctx.stroke();
  }
  for (const i of order) {
    if (i === 0 || i >= visible) continue;
    const sp = sprites[i], pp = P[i];
    const size = (sp.R * 2) / DPR * userZoom * pp.k;
    ctx.globalAlpha = sp.alpha * fogOf(pp.d, CR) * (matchFocus(PTS[i].e) ? 1 : 0.1);
    ctx.drawImage(sp.c, pp.x * sv - size / 2, pp.y * sv - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.globalAlpha = 1;
  const bctx = bloomCv.getContext("2d");
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, bloomCv.width, bloomCv.height);
  bctx.drawImage(cv, 0, 0, bloomCv.width, bloomCv.height);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.26;
  ctx.drawImage(bloomCv, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  drawHUD(0);
}

/* ===== シーケンス ===== */
const btns = ["play-night", "play-week", "play-all"].map((id) => document.getElementById(id));
function enableBtns() { for (const b of btns) b.disabled = false; scrubVal = nDays; }
function disableBtns() { for (const b of btns) b.disabled = true; scrubVal = nDays; }
function clearTrails() {
  const t = trailCv.getContext("2d");
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.clearRect(0, 0, trailCv.width, trailCv.height);
}
function startLanding(basePts, count, label) {
  if (reduced || count <= 0 || mode !== "idle") return;
  closeDrawer();
  disableBtns();
  mode = "landing";
  clearTrails();
  visible = basePts;
  seq = { base: basePts, count, label, per: Math.min(Math.max(2800 / count, 55), 700), flight: 1150, t0: performance.now() + 350, launched: 0 };
}
function endSequence() { seq = null; mode = "idle"; visible = N; setHud(N); enableBtns(); }
function startReplay() {
  if (reduced || mode !== "idle") return;
  closeDrawer();
  disableBtns();
  mode = "replay";
  clearTrails();
  visible = 2;
  camScale = fitScale(60);
  rep = { t0: performance.now() + 250, dur: 15000 };
}
btns[0].textContent = "昨夜（" + jpDate(lastDay) + "・" + lastNight.count + "粒）▶";
btns[1].textContent = "一週間（" + weekCount + "粒）▶";
btns[0].addEventListener("click", () => startLanding(N - lastNight.count, lastNight.count, "昨夜の夜業"));
btns[1].addEventListener("click", () => startLanding(N - weekCount, weekCount, "この一週間の夜業"));
btns[2].addEventListener("click", () => startReplay());

/* ===== 入力（回転・ズーム・スクラブ・検分） ===== */
function setScrub(v) {
  scrubVal = Math.max(1, Math.min(nDays, Math.round(v)));
  if (mode === "idle") { visible = cumByDay[scrubVal]; setHud(visible); }
}
function scrubFromX(x) { setScrub(1 + ((x - 14) / Math.max(W - 28, 1)) * (nDays - 1)); }
function pickAt(ev) {
  const rect = cv.getBoundingClientRect();
  const s = (mode === "replay" && camScale ? camScale : SCALE) * userZoom;
  const mx = ev.clientX - rect.left - (W / 2 - pfP.x * s);
  const my = ev.clientY - rect.top - (H / 2 - pfP.y * s);
  let best = -1, bd = Infinity;
  for (let i = 1; i < visible; i++) {
    const d = Math.hypot(P[i].x * s - mx, P[i].y * s - my) - PTS[i].r * s * P[i].k;
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, d: bd };
}
function actOn(best) {
  const nowT = performance.now();
  const cnt = resonate(best, nowT);
  const e = PTS[best].e;
  const r = inspectMark(mstate, best, mission.targets);
  let head;
  if (r.changed) {
    mstate = r.m;
    try { localStorage.setItem(MSTORE, JSON.stringify(mstate)); } catch (err) { /* 無記録で続行 */ }
    head = "検分 " + mstate.done.length + "/" + mission.targets.length + " ◆ ";
    if (r.complete) {
      inspectDays++;
      try { localStorage.setItem(DSTORE, JSON.stringify(inspectDays)); } catch (err) { /* 無記録で続行 */ }
      showSummary(nowT, lastNight.lines, lastNight.count, "本夜の検分 完了");
    }
  } else {
    head = "共鳴 " + cnt + " 粒 ── ";
  }
  caption(head + captionFor(e) + "　" + e.s.slice(0, 34), nowT, 2800);
  if (reduced) staticRender();
}
function enterRepo(key) {
  if (mode !== "idle") return;
  flyTo({ type: "repo", key });
  cam.zoomT = 5.6;
  caption(key + " に入る", performance.now(), 1600);
}
cv.addEventListener("pointerdown", (ev) => {
  cv.setPointerCapture(ev.pointerId);
  const rct = cv.getBoundingClientRect();
  if (ev.clientY - rct.top > H - 32 && pinch.size === 0 && mode === "idle") {
    scrubbing = true;
    scrubFromX(ev.clientX - rct.left);
    if (reduced) staticRender();
    return;
  }
  pinch.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch.size === 2) {
    const [a, b] = [...pinch.values()];
    pinchD0 = Math.hypot(a.x - b.x, a.y - b.y);
    zoom0 = userZoom;
    drag.active = false;
    cv.classList.remove("dragging");
    return;
  }
  drag.active = true; drag.id = ev.pointerId;
  drag.lx = ev.clientX; drag.moved = 0; drag.vel = 0; drag.lastT = performance.now();
  cv.classList.add("dragging");
});
cv.addEventListener("pointermove", (ev) => {
  if (scrubbing) { scrubFromX(ev.clientX - cv.getBoundingClientRect().left); if (reduced) staticRender(); return; }
  if (pinch.has(ev.pointerId)) pinch.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch.size === 2) {
    const [a, b] = [...pinch.values()];
    userZoom = Math.min(7, Math.max(0.6, zoom0 * Math.hypot(a.x - b.x, a.y - b.y) / (pinchD0 || 1)));
    cam.zoomT = userZoom;
    return;
  }
  if (!drag.active || ev.pointerId !== drag.id) return;
  const dx = ev.clientX - drag.lx;
  drag.lx = ev.clientX;
  drag.moved += Math.abs(dx) + Math.abs(ev.movementY || 0);
  const nowT = performance.now();
  rot -= dx * 0.005; // 指の向きに手前の面が付いてくる（掴んで回す感覚）
  drag.vel = -dx * 0.005 / (Math.max(nowT - drag.lastT, 1) / 1000);
  drag.lastT = nowT;
  if (reduced) { setCam(0); staticRender(); }
});
function endPointer(ev) {
  if (scrubbing) { scrubbing = false; return; }
  pinch.delete(ev.pointerId);
  if (drag.active && ev.pointerId === drag.id) {
    cv.classList.remove("dragging");
    drag.active = false;
    if (drag.moved < 6) {
      const nowT = performance.now();
      if (nowT - lastTapT < 300) {
        zoomOutStep(); // ダブルタップ = 地図の一段引き
      } else {
        /* タップの優先順位: ①窓の精密タップ=検分/共鳴（ズーム中のみ有効域）②駅ポッド=入場 */
        const rect = cv.getBoundingClientRect();
        const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
        const pick = pickAt(ev);
        if (pick.i > 0 && pick.d < (userZoom > 2.2 ? 12 : 5)) {
          actOn(pick.i);
        } else if (mode === "idle") {
          let hit = null, hd = Infinity;
          for (const st of stationScreen) {
            const d = Math.hypot(st.x - px, st.y - py);
            if (d < st.r && d < hd) { hd = d; hit = st; }
          }
          if (hit) enterRepo(hit.repo);
          else if (pick.i > 0 && pick.d < 16) actOn(pick.i);
        }
      }
      lastTapT = nowT;
    } else {
      rotSpeed = Math.max(-1.4, Math.min(1.4, drag.vel));
    }
  }
}
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);
cv.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  userZoom = Math.min(7, Math.max(0.6, userZoom * Math.exp(-ev.deltaY * 0.0012)));
  cam.zoomT = userZoom;
}, { passive: false });

/* ===== ドロワー・凡例・彩色 ===== */
const drawer = document.getElementById("drawer");
document.getElementById("btn-drawer").addEventListener("click", () => { drawer.hidden = !drawer.hidden; });
document.getElementById("pin-exit").addEventListener("click", () => { flyTo({ type: "root" }); });
function closeDrawer() { drawer.hidden = true; }
function renderLegend() {
  const counts = {};
  for (const e of STREAM) { const k = colorMode === "type" ? e.t : e.l; counts[k] = (counts[k] ?? 0) + 1; }
  const orderL = colorMode === "type" ? TYPE_ORDER : LINE_ORDER;
  const colors = colorMode === "type" ? TYPE_COLOR : LINE_COLOR;
  const labels = colorMode === "type" ? TYPE_LABEL : LINE_LABEL;
  const el = document.getElementById("legend");
  el.innerHTML = orderL.filter((k) => counts[k]).map((k) =>
    "<button data-k=\"" + k + "\" aria-pressed=\"" + String(!!(focusKey && focusKey.key === k)) + "\"><i style=\"background:" + colors[k] + "\"></i>" + labels[k] + "・" + counts[k] + "</button>").join("");
  for (const b of el.querySelectorAll("button")) {
    b.addEventListener("click", () => {
      const k = b.getAttribute("data-k");
      focusKey = focusKey && focusKey.key === k ? null : { kind: colorMode, key: k };
      renderLegend();
      if (reduced) staticRender();
    });
  }
}
function setMode(m) {
  colorMode = m;
  focusKey = null;
  document.getElementById("mode-type").setAttribute("aria-pressed", String(m === "type"));
  document.getElementById("mode-line").setAttribute("aria-pressed", String(m === "line"));
  renderLegend();
  buildSprites();
  nightsRendered = false;
  if (currentView === "nights") renderNights();
  if (reduced) staticRender();
}
document.getElementById("mode-type").addEventListener("click", () => setMode("type"));
document.getElementById("mode-line").addEventListener("click", () => setMode("line"));

/* ===== 夜報 ===== */
let nightsRendered = false;
function drawShard(c, night) {
  const events = STREAM.slice(night.base, night.base + night.count);
  const cluster = buildBranches(events, parseInt(night.d.replaceAll("-", ""), 10), null);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = 64, h = 52;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0a0d13"; g.fillRect(0, 0, w, h);
  const s = Math.min(w, h) / 2 / (cluster.clusterR + 8);
  g.translate(w / 2, h / 2);
  for (let i = 1; i < cluster.pts.length; i++) {
    if (cluster.parent[i] === 0) continue;
    const p = cluster.pts[i], q = cluster.pts[cluster.parent[i]];
    const rgb = colorMode === "type" ? RGB.type[p.e.t] : RGB.line[p.e.l];
    g.strokeStyle = "rgba(" + rgb.join(",") + ",0.45)";
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(q.x * s, q.y * s); g.lineTo(p.x * s, p.y * s); g.stroke();
  }
  for (const p of cluster.pts) {
    if (p.seed) continue;
    const rgb = colorMode === "type" ? RGB.type[p.e.t] : RGB.line[p.e.l];
    const x = p.x * s, y = p.y * s, r = Math.max(p.r * s, 1);
    const grad = g.createRadialGradient(x, y, 0, x, y, r * 1.9);
    grad.addColorStop(0, mixc(rgb, WHITE, 0.35));
    grad.addColorStop(0.5, "rgb(" + rgb.join(",") + ")");
    grad.addColorStop(1, "rgba(" + rgb.join(",") + ",0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r * 1.9, 0, 7); g.fill();
  }
}
function renderNights() {
  if (nightsRendered) return;
  nightsRendered = true;
  const ol = document.getElementById("night-list");
  ol.innerHTML = "";
  for (let i = nights.length - 1; i >= 0; i--) {
    const nt = nights[i];
    const li = document.createElement("li");
    li.className = "night";
    const row = document.createElement("div");
    row.className = "night-row";
    const c = document.createElement("canvas");
    const info = document.createElement("div");
    const d1 = document.createElement("div");
    d1.className = "night-date"; d1.textContent = jpDate(nt.d) + " のかけら";
    const d2 = document.createElement("div");
    d2.className = "night-meta"; d2.textContent = nt.count + " 粒 ／ " + nt.lines.toLocaleString() + " 行 ／ " + typeMix(nt.byType);
    info.appendChild(d1); info.appendChild(d2);
    row.appendChild(c); row.appendChild(info);
    li.appendChild(row);
    const actions = document.createElement("div");
    actions.className = "night-actions";
    const play = document.createElement("button");
    play.className = "btn";
    play.textContent = "着弾を再生 ▶";
    play.addEventListener("click", () => {
      setView("crystal");
      requestAnimationFrame(() => startLanding(nt.base + 1, nt.count, jpDate(nt.d) + "の夜業"));
    });
    actions.appendChild(play);
    li.appendChild(actions);
    const det = document.createElement("details");
    const sm = document.createElement("summary");
    sm.textContent = "コミット " + nt.count + " 件";
    det.appendChild(sm);
    const ul = document.createElement("ul");
    for (const e of STREAM.slice(nt.base, nt.base + nt.count)) {
      const liE = document.createElement("li");
      liE.innerHTML = "<b>" + e.r + "</b> " + e.t + " +" + e.n.toLocaleString() + "行 — " + e.s.replace(/</g, "&lt;");
      ul.appendChild(liE);
    }
    det.appendChild(ul);
    li.appendChild(det);
    ol.appendChild(li);
    drawShard(c, nt);
  }
}

/* ===== 記録 ===== */
function renderRecord() {
  const t = document.getElementById("record-tiles");
  const tiles = [
    { num: visit.streak, unit: "日", cap: "連続観測" },
    { num: visit.visits, unit: "回", cap: "通算観測" },
    { num: inspectDays, unit: "夜", cap: "検分を完了した夜" },
    { num: (visit.first || "—").replaceAll("-", "."), unit: "", cap: "初観測日" },
    catchup
      ? { num: "+" + catchup.events, unit: "粒", cap: "前回からの差分（+" + catchup.lines.toLocaleString() + "行）" }
      : { num: "±0", unit: "", cap: "前回からの差分" },
  ];
  t.innerHTML = tiles.map((x) =>
    "<div class=\"tile\"><div class=\"num\">" + x.num + (x.unit ? "<small>" + x.unit + "</small>" : "") + "</div><div class=\"cap\">" + x.cap + "</div></div>").join("");
  const b = document.getElementById("btn-catchup");
  if (catchup && !reduced) {
    b.hidden = false;
    b.textContent = "前回からの着弾を再生（+" + catchup.events + "粒）▶";
    b.onclick = () => {
      const cnt = Math.min(catchup.events, N - 1);
      setView("crystal");
      requestAnimationFrame(() => startLanding(N - cnt, cnt, "前回からの差分"));
    };
  } else {
    b.hidden = true;
  }
}

/* ===== 画面遷移 ===== */
const viewEls = {
  crystal: document.getElementById("view-crystal"),
  nights: document.getElementById("view-nights"),
  record: document.getElementById("view-record"),
};
let currentView = "crystal";
function setView(name) {
  if (!viewEls[name]) name = "crystal";
  currentView = name;
  for (const k of Object.keys(viewEls)) viewEls[k].hidden = k !== name;
  for (const b of document.querySelectorAll("#tabbar button")) {
    b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === name));
  }
  closeDrawer();
  document.getElementById("btn-drawer").hidden = name !== "crystal";
  if (name === "nights") renderNights();
  if (name === "record") renderRecord();
  if (name === "crystal") { layout(); ensureLoop(); } else { stopLoop(); }
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
}
for (const b of document.querySelectorAll("#tabbar button")) {
  b.addEventListener("click", () => setView(b.getAttribute("data-view")));
}

/* ===== about ===== */
const about = document.getElementById("about");
document.getElementById("btn-about").addEventListener("click", () => { about.hidden = false; closeDrawer(); });
document.getElementById("about-close").addEventListener("click", () => { about.hidden = true; });

/* ===== ループ管理 ===== */
function ensureLoop() {
  if (reduced) { staticRender(); return; }
  if (running) return;
  running = true;
  lastFrame = performance.now();
  rafId = requestAnimationFrame(frame);
}
function stopLoop() {
  if (running) { cancelAnimationFrame(rafId); running = false; }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopLoop();
  else if (currentView === "crystal") ensureLoop();
});
let rT;
window.addEventListener("resize", () => {
  clearTimeout(rT);
  rT = setTimeout(() => { if (currentView === "crystal") { layout(); if (reduced) staticRender(); } }, 150);
});

/* ===== オープニング ===== */
function autoLanding() {
  if (currentView !== "crystal") return;
  const cnt = catchup ? Math.min(catchup.events, N - 1) : weekCount;
  startLanding(N - cnt, cnt, catchup ? "前回からの差分" : "この一週間の夜業");
}
function runOpening() {
  const wrap = document.getElementById("opening");
  /* 同日再訪（差分なし）は儀式を省き即入場 — 儀式は反復で価値が減る */
  if (!catchup && visit.visits > 1 && !reduced) {
    wrap.classList.add("done");
    setTimeout(() => wrap.remove(), 750);
    setTimeout(() => startLanding(N - lastNight.count, lastNight.count, "昨夜の夜業"), 350);
    return;
  }
  const box = document.getElementById("opening-lines");
  const lines = [
    { t: "夜 業 観 測 所", cls: "" },
    catchup
      ? { t: "前回の観測から +" + catchup.events + " 粒 ／ +" + catchup.lines.toLocaleString() + " 行", cls: "big" }
      : { t: "観測 " + nDays + " 日目 — " + (N - 1) + " 粒 ／ " + totalLines.toLocaleString() + " 行", cls: "big" },
    { t: "今夜も人間は書いていない。", cls: "" },
  ];
  box.innerHTML = lines.map((l) => "<div class=\"l " + l.cls + "\">" + l.t + "</div>").join("");
  const els = box.querySelectorAll(".l");
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    wrap.classList.add("done");
    setTimeout(() => { wrap.remove(); }, 750);
    setTimeout(() => autoLanding(), 400);
  }
  if (reduced) {
    els.forEach((el) => el.classList.add("on"));
    setTimeout(() => { wrap.classList.add("done"); setTimeout(() => wrap.remove(), 50); }, 1400);
    return;
  }
  els.forEach((el, i) => setTimeout(() => el.classList.add("on"), 250 + i * 620));
  setTimeout(finish, 250 + lines.length * 620 + 900);
  wrap.addEventListener("click", finish);
  /* 初回訪問のみ、最初の一手を一度だけ案内 */
  if (visit.visits === 1) {
    setTimeout(() => {
      if (mode === "idle" && currentView === "crystal") caption("駅をタップすると中に入れる", performance.now(), 3400);
    }, 7000);
  }
}

/* ===== boot ===== */
renderLegend();
setHud(N);
const initView = location.hash.slice(1);
setView(viewEls[initView] ? initView : "crystal");
if (currentView === "crystal") { layout(); ensureLoop(); }
runOpening();
