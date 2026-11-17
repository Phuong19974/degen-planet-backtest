(() => {
const $ = id => document.getElementById(id);
const META = window.DP_META, K = window.DP_KEYS;
const TR = window.DP_TRADES.map(r => { const o = {}; K.forEach((k, i) => o[k] = r[i]); o.tm = Date.parse(o.t); o.xm = Date.parse(o.x); return o; });
const START = META.start;
const qs = new URLSearchParams(location.search);

// ---------- formatting (Europe/Monaco, auto DST) ----------
const TZ = "Europe/Monaco";
const tzParts = (ms, opts) => {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", ...opts }).formatToParts(new Date(ms))) {
    if (x.type !== "literal") p[x.type] = x.value;
  }
  return p;
};
const fDT = ms => { const p = tzParts(ms, { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
const fD = ms => { const p = tzParts(ms, { year:"numeric", month:"short", day:"2-digit" }); return `${p.day} ${p.month} ${p.year}`; };
const money = (v, dp = 2) => (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const smoney = (v, dp = 0) => (v >= 0 ? "+" : "") + money(v, dp);
const px = v => v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(4) : v.toPrecision(4);
const tfL = tf => tf.toUpperCase();

// ---------- precomputed full-period stats (from data) ----------
const byExit = [...TR].sort((a, b) => a.xm - b.xm);
const FULL = (() => {
  let eq = START, pk = START, dd = 0, ddp = 0;
  for (const t of byExit) { eq += t.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); ddp = Math.min(ddp, (eq - pk) / pk); }
  const wins = TR.filter(t => t.pnl > 0).length;
  const best = TR.reduce((a, b) => b.pnl > a.pnl ? b : a), worst = TR.reduce((a, b) => b.pnl < a.pnl ? b : a);
  return { end: eq, n: TR.length, wins, losses: TR.length - wins, dd, ddp, best, worst, pairs: new Set(TR.map(t => t.s)).size };
})();
const T0 = Math.min(...TR.map(t => t.tm)), T1 = Math.max(...TR.map(t => t.xm));

// events
const EV = [];
for (const t of TR) { EV.push({ m: t.tm, k: 0, t }); EV.push({ m: t.xm, k: 1, t }); }
EV.sort((a, b) => a.m - b.m || a.k - b.k);

// ---------- footnote / modal text ----------
const periodTxt = `${fD(T0)} – ${fD(T1)}`;
$("foot").textContent = `Strategy · ${periodTxt} · ${FULL.n} trades on ${FULL.pairs} Bitunix perps · start ${money(START,0)}, risk 1% (${money(META.risk,0)}) per trade, 0.06% taker fees both sides included · times Monaco.`;
$("cPeriod").textContent = periodTxt; $("cStart").textContent = money(START, 0); $("cRisk").textContent = `1% · ${money(META.risk,0)} max loss`;

// ---------- ticker ----------
function renderTicker(list, live) {
  const html = list.map(x => { const ch = (x.p - x.o) / x.o * 100; const c = ch >= 0 ? "g" : "r";
    return `<span>${x.s.replace("USDT","")}/USDT <b>${px(x.p)}</b> <span class="${c}">${ch >= 0 ? "▲" : "▼"}${Math.abs(ch).toFixed(2)}%</span></span>`; }).join("");
  const tag = `<span class="dim">BITUNIX</span>`;
  $("tickerTrack").innerHTML = tag + html + tag + html;
}
renderTicker(window.DP_TICKER, false);
// Bitunix public API sends no CORS headers, so the ticker is a snapshot taken when the site was built.

// ---------- boot ----------
const BOOT = [
  ["$ ssh vip@degenplanet --mode=strategy", ""],
  ["$ loading strategies…", ""],
  ["  ✓ HTF Trend Engine  [4H · 1H · 30M]", "ok"],
  ["  ✓ Range / Sideway   [fake-breakout]", "ok"],
  ["  ✓ Bitunix data feed [" + FULL.pairs + " pairs traded]", "ok"],
  ["  ✓ Risk manager      [1% / trade, fees on]", "ok"],
  [`$ stream ${FULL.n} trades · ${periodTxt}`, ""],
  ["> ready.", "ok"],
];
async function boot(fast) {
  const box = $("bootlines"); box.innerHTML = "";
  const total = BOOT.reduce((a, b) => a + b[0].length, 0); let done = 0;
  for (const [txt, cls] of BOOT) {
    const el = document.createElement("div"); el.className = (cls || "") + " cursor"; box.appendChild(el);
    for (let i = 1; i <= txt.length; i++) {
      el.textContent = txt.slice(0, i); done++;
      const p = Math.round(done / total * 100); $("bootbar").style.width = p + "%"; $("bootpct").textContent = p + "%";
      if (!fast) await sleep(txt[i-1] === " " ? 8 : 22);
    }
    el.classList.remove("cursor"); if (!fast) await sleep(260);
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- connect ----------
function showConnect() { $("connect").classList.add("show"); }
$("btnConnect").onclick = async () => {
  const b = $("btnConnect"); if (b.dataset.busy) return; b.dataset.busy = 1;
  for (const s of ["CONNECTING", "CONNECTING.", "CONNECTING..", "CONNECTING..."]) { b.textContent = s; await sleep(280); }
  b.textContent = "CONNECTED ✓"; b.classList.add("done"); await sleep(800);
  $("connect").classList.remove("show"); showDash(); await sleep(500); start();
};
function showDash() { $("boot").classList.remove("active"); $("dash").classList.add("active"); resize(); draw(); drawLogChart(true); }

// ---------- replay state ----------
// ~30s at 1x for the full session (~43ms/trade); 0.5x/2x/4x stay relative.
const DUR = 30000;
const KEYS = (() => {
  const out = [], seen = new Set();
  for (const e of EV) { if (!seen.has(e.m)) { seen.add(e.m); out.push(e.m); } }
  if (!out.length || out[0] > T0) out.unshift(T0);
  if (out[out.length - 1] < T1) out.push(T1);
  return out;
})();
function simAt(playMs) {
  if (KEYS.length <= 1) return T0;
  const n = KEYS.length - 1;
  const x = Math.max(0, Math.min(1, playMs / DUR)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  return KEYS[i] + (KEYS[i + 1] - KEYS[i]) * f;
}
let speed = 1, playing = false, sim = T0, playMs = 0, playOrigin = 0, last = 0, ei = 0, raf = 0, shown = START;
let S;
function reset() {
  S = { eq: START, pk: START, ddp: 0, n: 0, w: 0, open: 0, pts: [[T0, START]],
        st: { HTF: { n: 0, w: 0, p: new Set(), pnl: 0 }, RANGE: { n: 0, w: 0, p: new Set(), pnl: 0 } } };
  sim = T0; playMs = 0; playOrigin = 0; ei = 0; shown = START; $("log").innerHTML = ""; logN = 0; $("recap").classList.remove("show");
  chartTrade = null; openStack = []; lastSyncKey = ""; lastChartDraw = 0;
}
let logN = 0;
function log(html) {
  const el = document.createElement("div"); el.innerHTML = html; const L = $("log"); L.appendChild(el);
  while (L.children.length > 40) L.removeChild(L.firstChild); logN++;
}
function apply(e) {
  const t = e.t, c = S.st[t.st];
  if (e.k === 0) {
    S.open++; c.p.add(t.s);
    const buy = t.sd === "LONG";
    log(`<span class="t">${fDT(t.tm)}</span> <span class="${buy ? "buy" : "sell"}">${buy ? "BUY " : "SELL"}</span> ${t.s} ${tfL(t.tf)} @${px(t.e)} <span class="dim">SL ${px(t.sl)}</span>`);
    setLogTrade(t, true);
  } else {
    S.open--; S.n++; c.n++; c.pnl += t.pnl; if (t.pnl > 0) { S.w++; c.w++; }
    setLogTrade(t, false);
    S.eq += t.pnl; S.pk = Math.max(S.pk, S.eq); S.ddp = Math.min(S.ddp, (S.eq - S.pk) / S.pk);
    S.pts.push([t.xm, S.eq]);
    const lab = { sl: ["SL  ✗", "sl"], breakeven: ["TP1 ✓ BE+", "be"], trailing: ["TP2 ✓ TRAIL", "tp"], tp2: ["TP2 ✓", "tp"], expiry: ["EXPIRY", "ex"] }[t.rs] || [t.rs, "ex"];
    const cls = t.pnl > 0 ? lab[1] === "sl" ? "tp" : lab[1] : "sl";
    log(`<span class="t">${fDT(t.xm)}</span> <span class="${cls}">${lab[0]}</span> ${t.s} <span class="${t.pnl > 0 ? "tp" : "sl"}">${smoney(t.pnl)}</span> <span class="dim">${t.R >= 0 ? "+" : ""}${t.R.toFixed(2)}R</span>`);
  }
}
function step(now) {
  const dt = Math.min(100, now - (last || now)); last = now;
  if (playing) {
    if (!playOrigin) playOrigin = now - playMs / speed;
    playMs = (now - playOrigin) * speed;
    sim = simAt(playMs);
    while (ei < EV.length && EV[ei].m <= sim) apply(EV[ei++]);
    if (playMs >= DUR) { playMs = DUR; sim = T1; shown = S.eq; playing = false; playOrigin = 0; setStatus(); drawLogChart(true); setTimeout(showRecap, 1200); }
  } else {
    playOrigin = 0;
  }
  shown += (S.eq - shown) * Math.min(1, dt / 160);
  if (Math.abs(S.eq - shown) < 0.5) shown = S.eq;
  ui(); draw(); drawLogChart();
  raf = requestAnimationFrame(step);
}
function setStatus() {
  $("dot").className = "dot" + (playing ? " on" : "");
  $("statusTxt").textContent = playing ? "RUN " + speed + "x" : (ei >= EV.length ? "DONE" : "PAUSED");
  $("btnPause").textContent = playing ? "❚❚" : "▶";
}
function ui() {
  const pnl = shown - START;
  $("equity").textContent = money(shown); $("equity").classList.toggle("neg", shown < START);
  const pc = $("pnl"), pp = $("pnlpct"); pc.textContent = smoney(pnl, 2); pp.textContent = `(${pnl >= 0 ? "+" : ""}${(pnl / START * 100).toFixed(2)}%)`;
  pc.className = pp.className = pnl >= 0 ? "g" : "r";
  $("mult").textContent = (shown / START).toFixed(2) + "x";
  $("clock").textContent = fD(Math.min(sim, T1));
  for (const k of ["HTF", "RANGE"]) {
    const c = S.st[k], el = $("card" + k);
    el.querySelector(".n").textContent = c.n;
    el.querySelector(".w").textContent = c.n ? (c.w / c.n * 100).toFixed(1) + "%" : "–";
    el.querySelector(".p").textContent = c.p.size;
    const pl = el.querySelector(".pl"); pl.textContent = smoney(c.pnl); pl.className = "pl " + (c.pnl >= 0 ? "g" : "r");
  }
  $("sTrades").textContent = S.n; $("sWin").textContent = S.n ? (S.w / S.n * 100).toFixed(1) + "%" : "–";
  $("sOpen").textContent = S.open; $("sDD").textContent = (S.ddp * 100).toFixed(1) + "%";
  $("logcount").textContent = `${Math.round(Math.min(playMs, DUR) / DUR * 100)}%`;
}

// ---------- decision-log candlestick (real prefetched OHLC only; never synthesize) ----------
const KL_PACK = window.DP_KLINES || null;
const KL = (KL_PACK && KL_PACK.k) || {};
const KL_IV = (KL_PACK && KL_PACK.iv) || { "30m": 1800000, "1h": 3600000, "4h": 14400000 };
const klCache = Object.create(null);
function getSeries(sym, tf) {
  const key = sym + "|" + tf;
  if (key in klCache) return klCache[key];
  const segs = KL[key];
  klCache[key] = segs && segs.length ? { iv: KL_IV[tf], segs } : null;
  return klCache[key];
}
let chartTrade = null, openStack = [];
function setLogTrade(t, opening) {
  if (opening) {
    if (!getSeries(t.s, t.tf)) return; // hold previous chart
    openStack.push(t);
    chartTrade = t;
    return;
  }
  openStack = openStack.filter(x => x !== t);
  if (chartTrade !== t || !openStack.length) return;
  for (let i = openStack.length - 1; i >= 0; i--) {
    if (getSeries(openStack[i].s, openStack[i].tf)) { chartTrade = openStack[i]; return; }
  }
}
function priceFmt(p) {
  const a = Math.abs(p) || 1;
  const prec = a >= 100 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.1 ? 5 : a >= 0.01 ? 5 : a >= 0.001 ? 6 : a >= 0.0001 ? 7 : 8;
  return { type: "price", precision: prec, minMove: Math.pow(10, -prec) };
}
function monacoTick(time, type) {
  const LC = window.LightweightCharts;
  const ms = (typeof time === "number" ? time : 0) * 1000;
  if (type === LC.TickMarkType.Year) return tzParts(ms, { year: "numeric" }).year;
  if (type === LC.TickMarkType.Month) return tzParts(ms, { month: "short" }).month;
  if (type === LC.TickMarkType.DayOfMonth) {
    const p = tzParts(ms, { day: "2-digit", month: "short" });
    return `${p.day} ${p.month}`;
  }
  const p = tzParts(ms, { hour: "2-digit", minute: "2-digit" });
  return `${p.hour}:${p.minute}`;
}
function monacoTimeLabel(time) {
  const ms = (typeof time === "number" ? time : 0) * 1000;
  const p = tzParts(ms, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
function candlesUntil(series, tEnd) {
  const out = [], iv = series.iv;
  for (const seg of series.segs) {
    const t0 = seg[0], rows = seg[1];
    for (let i = 0; i < rows.length; i++) {
      const t = t0 + i * iv;
      if (t > tEnd) return out;
      const r = rows[i];
      out.push({ t, o: r[0], h: r[1], l: r[2], c: r[3], v: r.length > 4 ? r[4] : 0 });
    }
  }
  return out;
}

let lwChart = null, candleSeries = null, volSeries = null, priceLines = [], lastSyncKey = "";
function clearPriceLines() {
  if (candleSeries) priceLines.forEach(l => { try { candleSeries.removePriceLine(l); } catch (e) {} });
  priceLines = [];
}
function ensureLogChart() {
  if (lwChart || !window.LightweightCharts) return;
  const el = $("logChart");
  if (!el || el.clientWidth < 2 || el.clientHeight < 2) return;
  const LC = LightweightCharts;
  lwChart = LC.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: {
      background: { type: LC.ColorType ? LC.ColorType.Solid : "solid", color: "#000000" },
      textColor: "#4f7a5c",
      fontSize: 11,
      fontFamily: "SF Mono, ui-monospace, Menlo, Consolas, Roboto Mono, monospace",
      attributionLogo: false
    },
    grid: {
      vertLines: { color: "rgba(0,255,102,0.08)" },
      horzLines: { color: "rgba(0,255,102,0.08)" }
    },
    crosshair: {
      mode: LC.CrosshairMode.Normal,
      vertLine: { color: "rgba(0,255,102,0.35)", width: 1, style: LC.LineStyle.SparseDotted, labelBackgroundColor: "#03100a" },
      horzLine: { color: "rgba(0,255,102,0.35)", width: 1, style: LC.LineStyle.SparseDotted, labelBackgroundColor: "#03100a" }
    },
    rightPriceScale: {
      borderColor: "#0f2a18",
      scaleMargins: { top: 0.06, bottom: 0.22 }
    },
    timeScale: {
      borderColor: "#0f2a18",
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 3,
      tickMarkFormatter: monacoTick
    },
    localization: { timeFormatter: monacoTimeLabel },
    watermark: {
      visible: false,
      text: "",
      fontSize: 22,
      fontFamily: "SF Mono, ui-monospace, Menlo, Consolas, monospace",
      color: "rgba(0,255,102,0.10)",
      horzAlign: "center",
      vertAlign: "center"
    },
    handleScroll: { vertTouchDrag: false },
    kineticScroll: { touch: false }
  });
  candleSeries = lwChart.addCandlestickSeries({
    upColor: "#00ff66", downColor: "#ff3b4f",
    borderUpColor: "#00ff66", borderDownColor: "#ff3b4f",
    wickUpColor: "#00ff66", wickDownColor: "#ff3b4f",
    borderVisible: true,
    priceLineVisible: false,
    lastValueVisible: true
  });
  volSeries = lwChart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "vol",
    lastValueVisible: false,
    priceLineVisible: false
  });
  lwChart.priceScale("vol").applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
    visible: false
  });
}
function resizeLogChart() {
  if (!lwChart) return;
  const el = $("logChart");
  if (!el) return;
  lwChart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
}
const nowChart = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
let lastChartDraw = 0;
function drawLogChart(force) {
  if (!force && playing) {
    if (nowChart() - lastChartDraw < 100) return; // at most ~10 updates/s while running
  }
  lastChartDraw = nowChart();
  ensureLogChart();
  if (!lwChart) return;
  const t = chartTrade;
  if (!t) {
    if (lastSyncKey) {
      candleSeries.setData([]);
      volSeries.setData([]);
      candleSeries.setMarkers([]);
      clearPriceLines();
      lastSyncKey = "";
    }
    return;
  }
  const series = getSeries(t.s, t.tf);
  if (!series) return;
  const iv = series.iv;
  const tRight = Math.min(sim, t.xm + 12 * iv);
  const barOpen = tRight - (tRight % iv);
  const tradeKey = t.s + "|" + t.tf + "|" + t.tm;
  const key = tradeKey + "|" + barOpen + "|" + (sim >= t.xm ? "x" : "o");
  if (key === lastSyncKey) return;
  const tradeChanged = lastSyncKey.split("|").slice(0, 3).join("|") !== tradeKey;
  lastSyncKey = key;

  const ctxBars = 72;
  const tFrom = t.tm - ctxBars * iv;
  const all = candlesUntil(series, tRight);
  const vis = all.filter(c => c.t >= tFrom);
  if (!vis.length) return;

  const candles = vis.map(c => ({ time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c }));
  const volumes = vis.map(c => ({
    time: Math.floor(c.t / 1000),
    value: c.v,
    color: c.c >= c.o ? "rgba(0,255,102,0.40)" : "rgba(255,59,79,0.40)"
  }));
  candleSeries.applyOptions({ priceFormat: priceFmt(t.e) });
  candleSeries.setData(candles);
  volSeries.setData(volumes);

  if (tradeChanged) {
    clearPriceLines();
    const dashed = LightweightCharts.LineStyle.Dashed;
    priceLines.push(candleSeries.createPriceLine({
      price: t.e, color: "#8fb89a", lineWidth: 1, lineStyle: dashed, axisLabelVisible: true, title: "E"
    }));
    priceLines.push(candleSeries.createPriceLine({
      price: t.sl, color: "#ff3b4f", lineWidth: 1, lineStyle: dashed, axisLabelVisible: true, title: "SL"
    }));
    if (Math.abs(t.xp - t.sl) > Math.max(Math.abs(t.sl), 1e-12) * 1e-8) {
      priceLines.push(candleSeries.createPriceLine({
        price: t.xp, color: "#00ff66", lineWidth: 1, lineStyle: dashed, axisLabelVisible: true, title: "TP"
      }));
    }
    lwChart.applyOptions({
      watermark: { visible: true, text: `${t.s}  ${tfL(t.tf)}`, color: "rgba(0,255,102,0.12)", fontSize: 22 }
    });
  }

  const snap = ms => {
    const want = Math.floor((ms - (ms % iv)) / 1000);
    if (candles.some(c => c.time === want)) return want;
    const hit = candles.find(c => ms >= c.time * 1000 && ms < c.time * 1000 + iv);
    return hit ? hit.time : null;
  };
  const marks = [];
  const isLong = t.sd === "LONG";
  const et = snap(t.tm);
  if (et != null) {
    marks.push({
      time: et,
      position: isLong ? "belowBar" : "aboveBar",
      color: isLong ? "#00ff66" : "#ff3b4f",
      shape: isLong ? "arrowUp" : "arrowDown",
      text: isLong ? "BUY" : "SELL"
    });
  }
  if (sim >= t.xm) {
    const xt = snap(t.xm);
    if (xt != null && xt !== et) {
      const win = t.pnl >= 0;
      marks.push({
        time: xt,
        position: isLong ? "aboveBar" : "belowBar",
        color: win ? "#00ff66" : "#ff3b4f",
        shape: isLong ? "arrowDown" : "arrowUp",
        text: ""
      });
    }
  }
  candleSeries.setMarkers(marks);

  try {
    lwChart.timeScale().setVisibleRange({
      from: candles[0].time,
      to: candles[candles.length - 1].time
    });
  } catch (e) {
    lwChart.timeScale().fitContent();
  }
}

// chart
const cv = $("chart"), cx = cv.getContext("2d");
function resize() {
  const d = devicePixelRatio || 1;
  const r = cv.getBoundingClientRect(); cv.width = r.width * d; cv.height = r.height * d; cx.setTransform(d, 0, 0, d, 0, 0);
  resizeLogChart();
}
addEventListener("resize", () => { resize(); draw(); drawLogChart(true); });
function draw() {
  if (!S) return; const W = cv.clientWidth, H = cv.clientHeight; cx.clearRect(0, 0, W, H);
  const pts = S.pts.concat([[Math.min(sim, T1), S.eq]]);
  let lo = START, hi = START; for (const p of pts) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
  const span = Math.max(hi - lo, START * 0.02); lo -= span * 0.12; hi += span * 0.12;
  const X = m => (m - T0) / (T1 - T0) * (W - 4) + 2, Y = v => H - 4 - (v - lo) / (hi - lo) * (H - 8);
  cx.strokeStyle = "rgba(0,255,102,.08)"; cx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { cx.beginPath(); cx.moveTo(0, H * i / 4); cx.lineTo(W, H * i / 4); cx.stroke(); }
  cx.setLineDash([3, 4]); cx.strokeStyle = "rgba(255,255,255,.25)"; cx.beginPath(); cx.moveTo(0, Y(START)); cx.lineTo(W, Y(START)); cx.stroke(); cx.setLineDash([]);
  const up = S.eq >= START, col = up ? "#00ff66" : "#ff3b4f";
  const g = cx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, up ? "rgba(0,255,102,.35)" : "rgba(255,59,79,.3)"); g.addColorStop(1, "rgba(0,0,0,0)");
  cx.beginPath(); pts.forEach((p, i) => i ? cx.lineTo(X(p[0]), Y(p[1])) : cx.moveTo(X(p[0]), Y(p[1])));
  const lx = X(pts[pts.length - 1][0]);
  cx.lineTo(lx, H); cx.lineTo(X(T0), H); cx.closePath(); cx.fillStyle = g; cx.fill();
  cx.beginPath(); pts.forEach((p, i) => i ? cx.lineTo(X(p[0]), Y(p[1])) : cx.moveTo(X(p[0]), Y(p[1])));
  cx.strokeStyle = col; cx.lineWidth = 1.8; cx.shadowColor = col; cx.shadowBlur = 8; cx.stroke(); cx.shadowBlur = 0;
  cx.fillStyle = col; cx.beginPath(); cx.arc(lx, Y(S.eq), 3, 0, 7); cx.fill();
}
// recap
function showRecap() {
  $("rMult").textContent = (FULL.end / START).toFixed(2) + "x";
  $("rStart").textContent = money(START, 0); $("rEnd").textContent = money(FULL.end, 0);
  $("rPnl").textContent = `${smoney(FULL.end - START)} (${((FULL.end - START) / START * 100).toFixed(1)}%)`;
  $("rTrades").textContent = FULL.n; $("rWL").innerHTML = `<span class="g">${FULL.wins}</span> / <span class="r">${FULL.losses}</span>`;
  $("rWin").textContent = (FULL.wins / FULL.n * 100).toFixed(1) + "%";
  $("rBest").textContent = `${smoney(FULL.best.pnl)} ${FULL.best.s.replace("USDT","")} ${tfL(FULL.best.tf)}`;
  $("rWorst").textContent = `${smoney(FULL.worst.pnl)} ${FULL.worst.s.replace("USDT","")}`;
  $("rDD").textContent = `${(FULL.ddp * 100).toFixed(1)}% (${money(FULL.dd, 0)})`;
  $("rNote").textContent = `${periodTxt} · 1% risk/trade, fees incl.`;
  $("recap").classList.add("show");
}
// controls
function start() { reset(); playing = true; last = 0; setStatus(); }
$("btnPause").onclick = () => { if (ei >= EV.length) return start(); playing = !playing; setStatus(); };
$("btnReplay").onclick = start; $("btnAgain").onclick = start;
document.querySelectorAll(".speeds button").forEach(b => b.onclick = () => {
  speed = +b.dataset.s; playOrigin = 0; document.querySelectorAll(".speeds button").forEach(x => x.classList.toggle("sel", x === b)); setStatus(); });
// jump helper (used for screenshots / testing): ?screen=connect|dash|recap&at=0.6
function jumpTo(frac) { reset(); playMs = DUR * Math.max(0, Math.min(1, frac)); sim = simAt(playMs); while (ei < EV.length && EV[ei].m <= sim) apply(EV[ei++]); shown = S.eq; playing = false; setStatus(); draw(); drawLogChart(true); }

// CTA link: set JOIN_URL below, or pass ?join=https://t.me/yourchannel
const JOIN_URL = qs.get("join") || "https://t.me/SignalVipdegen_Bot";
if (JOIN_URL) { const c = $("cta"); c.href = JOIN_URL; c.target = "_blank"; c.removeAttribute("onclick"); }
reset(); raf = requestAnimationFrame(step);
const scr = qs.get("screen");
if (scr === "connect") { boot(true).then(showConnect); }
else if (scr === "dash") { showDash(); jumpTo(+(qs.get("at") || 0.6)); if (qs.get("play")) { playing = true; setStatus(); } }
else if (scr === "recap") { showDash(); jumpTo(1); sim = T1; showRecap(); }
else if (scr === "bootmid") { boot(false); }
else { boot(false).then(() => sleep(500)).then(showConnect); }
})();

// Live Monaco clock + background music (separate from the replay)
(() => {
  const TZ = "Europe/Monaco";
  function tickLive() {
    const p = {};
    for (const x of new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hourCycle: "h23",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).formatToParts(new Date())) {
      if (x.type !== "literal") p[x.type] = x.value;
    }
    const text = `${p.hour}:${p.minute}:${p.second} Monaco`;
    document.querySelectorAll(".live-clock").forEach(el => { el.textContent = text; });
  }
  tickLive();
  setInterval(tickLive, 1000);

  const TRACKS = [
    "audio/tech-house-vibes.mp3",
    "audio/house-02.mp3",
    "audio/techno-fest-vibes.mp3"
  ];
  let audio = null, idx = 0;

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = 0.4;
    audio.playsInline = true;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.src = TRACKS[idx];
    audio.addEventListener("ended", () => {
      idx = (idx + 1) % TRACKS.length;
      audio.src = TRACKS[idx];
      playNow();
    });
    return audio;
  }

  function playNow() {
    const a = ensureAudio();
    a.muted = false;
    a.volume = 0.4;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
    return p;
  }

  async function tryAutoplay() {
    const a = ensureAudio();
    // Muted-then-unmute helps on some desktop browsers; iOS will still block until a gesture.
    try {
      a.muted = true;
      a.volume = 0.4;
      await a.play();
      a.muted = false;
      a.volume = 0.4;
    } catch (e) {
      a.muted = false;
      a.volume = 0.4;
    }
  }

  function onGesture() { playNow(); }

  ["touchstart", "pointerdown", "click", "scroll"].forEach(t =>
    document.addEventListener(t, onGesture, { capture: true, passive: true }));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") playNow();
  });
  window.addEventListener("pageshow", playNow);
  window.addEventListener("focus", playNow);

  try { localStorage.removeItem("dp-music"); } catch (e) {}
  tryAutoplay();
})();
