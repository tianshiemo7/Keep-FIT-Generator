// ==================== Keep-FIT-Generator v1.0.0 ====================
// Amap tiles, Draw/Pan toggle, Closed curve, Random sampling,
// Pace range, Time range, Consecutive days, GPS locate, Batch gen

const PI = Math.PI;

// ==== WGS84 ↔ GCJ02 (Amap tile alignment) ====
// Record in GCJ-02 (aligns with tiles); export back to WGS-84 (GPS accurate)
const GCJ_A = 6378245.0, GCJ_EE = 0.00669342162296594323;
function _gcj_dlat(x, y) {
  let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  r += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
  r += (20*Math.sin(y*PI) + 40*Math.sin(y/3*PI))*2/3;
  r += (160*Math.sin(y/12*PI) + 320*Math.sin(y*PI/30))*2/3;
  return r;
}
function _gcj_dlng(x, y) {
  let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  r += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
  r += (20*Math.sin(x*PI) + 40*Math.sin(x/3*PI))*2/3;
  r += (150*Math.sin(x/12*PI) + 300*Math.sin(x/30*PI))*2/3;
  return r;
}
function wgsToGcj(lng, lat) {
  if (lng < 72 || lng > 138 || lat < 0.8 || lat > 56) return {lng, lat};
  const x = lng - 105, y = lat - 35;
  const dLat = _gcj_dlat(x, y), dLng = _gcj_dlng(x, y);
  const rad = lat*PI/180, m = 1 - GCJ_EE*Math.sin(rad)**2;
  return {
    lng: lng + (dLng*180)/(GCJ_A/Math.sqrt(m)*Math.cos(rad)*PI),
    lat: lat + (dLat*180)/(GCJ_A*(1-GCJ_EE)/(m*Math.sqrt(m))*PI),
  };
}
function gcjToWgs(lng, lat) {
  if (lng < 72 || lng > 138 || lat < 0.8 || lat > 56) return {lng, lat};
  let wl = lng, wb = lat;
  for (let i = 0; i < 4; i++) {
    const g = wgsToGcj(wl, wb);
    wl += lng - g.lng; wb += lat - g.lat;
  }
  return {lng: wl, lat: wb};
}
function gcjArrToWgs(pts) { return pts.map(p => gcjToWgs(p.lng, p.lat)); }


// ====== Map: 高德 (EPSG:3857 native) ======
const map = L.map("map", { attributionControl: false, zoomControl: true }).setView([39.905, 116.397], 14);

const gaodeRoad = L.tileLayer(
  "http://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
  { subdomains: ["1","2","3","4"], maxZoom: 18, maxNativeZoom: 18 }
).addTo(map);

const gaodeSatellite = L.tileLayer(
  "http://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
  { subdomains: ["1","2","3","4"], maxZoom: 18, maxNativeZoom: 18 }
);

const gaodeLabels = L.tileLayer(
  "http://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}",
  { subdomains: ["1","2","3","4"], maxZoom: 18, maxNativeZoom: 18 }
).addTo(map);

L.control.layers(
  { "🗺️ 标准": gaodeRoad, "🛰️ 卫星": gaodeSatellite },
  { "🏷️ 路网": gaodeLabels },
  { position: "topright" }
).addTo(map);

// ====== State ======
let routePoints = [];
let basePolyline = null, samplePolyline = null;
let isDrawing = false, drawMode = false;
let generatedSamples = null;
let consecutiveDays = false;
let paceChart = null, hrChart = null, altChart = null;
let previewCursor = null; // GCJ-02 dot during drawing

// ====== DOM ======
const $drawToggle = document.getElementById("drawToggleBtn");
const $drawHint = document.getElementById("drawHint");
const $baseDist = document.getElementById("baseDistance");
const $totalDist = document.getElementById("totalDistance");
const $sampleCount = document.getElementById("sampleCount");
const $message = document.getElementById("message");
const $modeInd = document.getElementById("modeIndicator");
const $charts = document.getElementById("chartsSection");
const $exportList = document.getElementById("exportList");
const $map = document.getElementById("map");
const $consBtn = document.getElementById("consecutiveBtn");

// ====== GPS Locate ======
let locationMarker = null;

function showLocatedPosition(wgsLat, wgsLng, detail = "") {
  const gcj = wgsToGcj(wgsLng, wgsLat);

  if (locationMarker) map.removeLayer(locationMarker);
  locationMarker = L.circleMarker([gcj.lat, gcj.lng], {
    radius: 8, color: "#58a6ff", fillColor: "#58a6ff",
    fillOpacity: 0.4, weight: 2,
  }).bindPopup(`<b>当前位置</b>${detail ? `<br>${detail}` : ""}`).addTo(map);
  locationMarker.openPopup();
  map.setView([gcj.lat, gcj.lng], 16);
}

document.getElementById("locateBtn").addEventListener("click", () => {
  const btn = document.getElementById("locateBtn");
  btn.textContent = "⏳..."; btn.disabled = true;
  const secureContext = window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!navigator.geolocation) {
    updateMsg("浏览器不支持 GPS 定位，请手动拖动地图到目标位置", "error");
    btn.textContent = "📍 定位"; btn.disabled = false;
    return;
  }
  if (!secureContext) {
    updateMsg("当前页面不是 HTTPS，浏览器可能禁止 GPS 定位，请手动拖动地图到目标位置", "error");
    btn.textContent = "📍 定位"; btn.disabled = false;
    return;
  }
  // Wrapper to handle both Chrome (max 60s timeout) and Firefox
  const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 };
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: wgsLat, longitude: wgsLng } = pos.coords;
      showLocatedPosition(wgsLat, wgsLng, `精度: ±${pos.coords.accuracy.toFixed(0)}m`);
      updateMsg(`GPS 定位成功 精度±${pos.coords.accuracy.toFixed(0)}m`, "success");
      btn.textContent = "📍 定位"; btn.disabled = false;
    },
    (err) => {
      console.error("Geolocation error:", err.code, err.message);
      const msgs = {
        1: "权限被拒绝，请在浏览器设置中允许定位",
        2: "无法获取位置信息，请检查 GPS/网络",
        3: "定位超时，请重试",
      };
      updateMsg("GPS 定位失败: " + (msgs[err.code] || err.message) + "，请手动拖动地图到目标位置", "error");
      btn.textContent = "📍 定位"; btn.disabled = false;
    },
    opts
  );
});

// ====== Draw Mode Toggle ======
$drawToggle.addEventListener("click", () => {
  drawMode = !drawMode;
  if (drawMode) {
    $drawToggle.textContent = "🔴 停止绘制"; $drawToggle.classList.add("active");
    $drawHint.textContent = "绘制模式 · 按住左键拖动画路线";
    $modeInd.innerHTML = "🟢 <strong>绘制中</strong> · 按住左键拖动，松开完成";
    $modeInd.classList.add("drawing");
    map.dragging.disable(); map.doubleClickZoom.disable(); map.scrollWheelZoom.disable();
    $map.style.cursor = "crosshair";
  } else { exitDrawMode(); }
});

function exitDrawMode() {
  drawMode = false; isDrawing = false;
  $drawToggle.textContent = "✏️ 开始绘制"; $drawToggle.classList.remove("active");
  $drawHint.textContent = "浏览模式 · 可自由拖拽地图";
  $modeInd.innerHTML = "🗺️ <strong>浏览模式</strong> · 点击「开始绘制」进入绘制模式";
  $modeInd.classList.remove("drawing");
  map.dragging.enable(); map.doubleClickZoom.enable(); map.scrollWheelZoom.enable();
  $map.style.cursor = "grab";
  if (previewCursor) { map.removeLayer(previewCursor); previewCursor = null; }
  if (isDrawing) { isDrawing = false; onDrawFinish(); }
}

// ====== Drawing ======
map.on("mousedown", (e) => {
  if (!drawMode || e.originalEvent.button !== 0) return;
  isDrawing = true;
  routePoints = [];
  if (basePolyline) { map.removeLayer(basePolyline); basePolyline = null; }
  if (samplePolyline) { map.removeLayer(samplePolyline); samplePolyline = null; }
  if (previewCursor) { map.removeLayer(previewCursor); previewCursor = null; }
  generatedSamples = null; $charts.style.display = "none";
  routePoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
  previewCursor = L.circleMarker([e.latlng.lat, e.latlng.lng], {
    radius: 5, color: "#ff6b35", fillColor: "#ff6b35", fillOpacity: 0.6, weight: 2,
  }).addTo(map);
  refreshUI(); updateMsg("🟢 绘制中...", "info");
});

map.on("mousemove", (e) => {
  if (!isDrawing) return;
  if (previewCursor) previewCursor.setLatLng([e.latlng.lat, e.latlng.lng]);
  const last = routePoints[routePoints.length - 1];
  if (haversine(last.lat, last.lng, e.latlng.lat, e.latlng.lng) < 3) return;
  routePoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
  drawBaseLine(); refreshUI();
});

map.on("mouseup", () => { if (isDrawing) { isDrawing = false; onDrawFinish(); } });
map.on("mouseleave", () => { if (isDrawing) { isDrawing = false; onDrawFinish(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawMode) exitDrawMode(); });

function onDrawFinish() {
  if (previewCursor) { map.removeLayer(previewCursor); previewCursor = null; }
  if (routePoints.length < 3) { updateMsg("路线太短，至少3个点", "error"); routePoints = []; drawBaseLine(); refreshUI(); return; }
  autoClosePath(); drawBaseLine(); generateSamples();
  updateMsg(`✅ 闭合路线 · ${generatedSamples ? generatedSamples.length : 0} 采样点`, "success");
}

// ====== Helpers ======
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * PI / 180, dLng = (lng2 - lng1) * PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*PI/180)*Math.cos(lat2*PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function totalDist(pts) {
  if (!pts || pts.length < 2) return 0;
  let t = 0; for (let i = 1; i < pts.length; i++) t += haversine(pts[i-1].lat, pts[i-1].lng, pts[i].lat, pts[i].lng);
  return t;
}
function drawBaseLine() {
  if (basePolyline) map.removeLayer(basePolyline);
  if (routePoints.length >= 2) basePolyline = L.polyline(routePoints, { color: "#ff6b35", weight: 3, opacity: 0.8, dashArray: drawMode ? "" : "10 5" }).addTo(map);
}
function drawSampleLine(pts) {
  if (samplePolyline) map.removeLayer(samplePolyline);
  samplePolyline = L.polyline(pts, { color: "#3fb950", weight: 3, opacity: 0.9 }).addTo(map);
  if (pts.length > 0) map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [40, 40] });
}
function autoClosePath() {
  if (routePoints.length < 2) return;
  const d = haversine(routePoints[0].lat, routePoints[0].lng, routePoints[routePoints.length-1].lat, routePoints[routePoints.length-1].lng);
  if (d > 5) routePoints.push({ lat: routePoints[0].lat, lng: routePoints[0].lng });
}
function updateMsg(txt, type) { $message.textContent = txt; $message.className = "message " + (type || ""); }

// ====== Catmull-Rom ======
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t*t, t3 = t2*t;
  return {
    lat: 0.5*((2*p1.lat)+(-p0.lat+p2.lat)*t+(2*p0.lat-5*p1.lat+4*p2.lat-p3.lat)*t2+(-p0.lat+3*p1.lat-3*p2.lat+p3.lat)*t3),
    lng: 0.5*((2*p1.lng)+(-p0.lng+p2.lng)*t+(2*p0.lng-5*p1.lng+4*p2.lng-p3.lng)*t2+(-p0.lng+3*p1.lng-3*p2.lng+p3.lng)*t3),
  };
}
function smoothCurve(pts, nSamples) {
  const n = pts.length; if (n < 3) return pts.slice();
  const wrap = i => ((i%n)+n)%n;
  let totalC = 0; const chords = [];
  for (let i = 0; i < n; i++) {
    const d = haversine(pts[i].lat, pts[i].lng, pts[wrap(i+1)].lat, pts[wrap(i+1)].lng);
    chords.push({ cum: totalC, len: d }); totalC += d;
  }
  const res = [];
  for (let s = 0; s < nSamples; s++) {
    const target = (s/nSamples)*totalC;
    let seg = 0; while (seg < n-1 && chords[seg+1].cum <= target) seg++;
    const t = chords[seg].len > 0 ? (target - chords[seg].cum)/chords[seg].len : 0;
    res.push(catmullRom(pts[wrap(seg-1)], pts[wrap(seg)], pts[wrap(seg+1)], pts[wrap(seg+2)], Math.max(0,Math.min(1,t))));
  }
  return res;
}
function perturb(pt, sigma) {
  if (sigma <= 0) return { ...pt };
  const g = () => { let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*PI*v); };
  const mlat = 111320, mlng = 111320*Math.cos(pt.lat*PI/180);
  return { lat: pt.lat + g()*sigma/mlat, lng: pt.lng + g()*sigma/mlng };
}

// ====== Generate Samples ======
function generateSamples() {
  const sigma = parseFloat(document.getElementById("maxSigma")?.value) || 2;
  const density = parseInt(document.getElementById("sampleDensity")?.value, 10) || 15;
  const laps = Math.max(1, parseInt(document.getElementById("lapCount")?.value, 10) || 1);
  const perimeter = totalDist(routePoints);
  const nPerLap = Math.max(routePoints.length, Math.round((perimeter/1000)*density));
  const smooth = smoothCurve(routePoints, nPerLap);
  const all = [];
  for (let lap = 0; lap < laps; lap++) for (const pt of smooth) all.push(perturb(pt, sigma));
  generatedSamples = all; drawSampleLine(all);
  $baseDist.textContent = (perimeter/1000).toFixed(2)+" km";
  $totalDist.textContent = ((perimeter*laps)/1000).toFixed(2)+" km";
  $sampleCount.textContent = all.length;
  return all;
}

// ====== Random-start variant ======
function generateVariant(seed, sigma) {
  const density = parseInt(document.getElementById("sampleDensity")?.value, 10) || 15;
  const laps = Math.max(1, parseInt(document.getElementById("lapCount")?.value, 10) || 1);
  const perimeter = totalDist(routePoints);
  const nPerLap = Math.max(routePoints.length, Math.round((perimeter/1000)*density));
  const smooth = smoothCurve(routePoints, nPerLap);
  // Seeded RNG
  let s = seed; const sr = () => { s = (s*16807+0)%2147483647; return s/2147483647; };
  const startIdx = Math.floor(sr() * smooth.length);
  const rotated = smooth.slice(startIdx).concat(smooth.slice(0, startIdx));
  const all = [];
  for (let lap = 0; lap < laps; lap++) {
    for (const pt of rotated) {
      const g = () => { let u=0,v=0; while(u===0)u=sr(); while(v===0)v=sr(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*PI*v); };
      const mlat = 111320, mlng = 111320*Math.cos(pt.lat*PI/180);
      all.push({ lat: pt.lat + g()*sigma/mlat, lng: pt.lng + g()*sigma/mlng });
    }
  }
  return all;
}

// ====== Random value in range ======
function randBetween(min, max) { return min + Math.random()*(max-min); }
function randInt(min, max) { return Math.floor(randBetween(min, max+1)); }

// ====== Refresh basic UI ======
function refreshUI() {
  const d = totalDist(routePoints);
  const laps = Math.max(1, parseInt(document.getElementById("lapCount")?.value, 10) || 1);
  $baseDist.textContent = (d/1000).toFixed(2)+" km";
  $totalDist.textContent = ((d*laps)/1000).toFixed(2)+" km";
  $sampleCount.textContent = generatedSamples ? generatedSamples.length : 0;
}
["lapCount","sampleDensity","maxSigma"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", () => {
    if (routePoints.length >= 3) generateSamples();
    refreshUI();
  });
});

// ====== Consecutive Days Toggle ======
$consBtn.addEventListener("click", () => {
  consecutiveDays = !consecutiveDays;
  $consBtn.textContent = consecutiveDays ? "🔗 连续日期: 开" : "🔗 连续日期: 关";
  $consBtn.classList.toggle("on", consecutiveDays);
  if (consecutiveDays) rebuildExports(); // resync dates
});

// ====== Date helpers ======
function fmtTime(h, m) { return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0"); }

// ====== Build Export List ======
function rebuildExports() {
  const count = Math.max(1, Math.min(20, parseInt(document.getElementById("exportCount")?.value, 10) || 1));
  const maxSigma = parseFloat(document.getElementById("maxSigma")?.value) || 2;
  const now = new Date();
  $exportList.innerHTML = "";
  const ratios = [0.25,0.4,0.6,0.15,0.5,0.35,0.75,0.2,0.45,0.3,0.55,0.25,0.4,0.65,0.2,0.35,0.5,0.3,0.45,0.6];

  // Read global pace range (seconds)
  const pMin = (parseInt(document.getElementById("paceMinMin")?.value,10)||4)*60 + (parseInt(document.getElementById("paceMinSec")?.value,10)||30);
  const pMax = (parseInt(document.getElementById("paceMaxMin")?.value,10)||7)*60 + (parseInt(document.getElementById("paceMaxSec")?.value,10)||0);
  // Read global time range (hours/minutes)
  const tMinH = parseInt(document.getElementById("timeMinH")?.value,10)||6;
  const tMinM = parseInt(document.getElementById("timeMinM")?.value,10)||0;
  const tMaxH = parseInt(document.getElementById("timeMaxH")?.value,10)||9;
  const tMaxM = parseInt(document.getElementById("timeMaxM")?.value,10)||0;

  for (let i = 0; i < count; i++) {
    const d = new Date(now.getTime() + i*86400000);
    const sigma = (maxSigma * ratios[i%ratios.length]).toFixed(1);
    // Random pace within range
    const paceSec = Math.round(randBetween(pMin, pMax));
    const pm = Math.floor(paceSec/60), ps = paceSec%60;

    const div = document.createElement("div");
    div.className = "export-item";
    div.dataset.index = i;
    div.innerHTML = `
      <div class="export-header">
        <span class="export-title">📄 第${i+1}份</span>
        <span class="export-seed">种子:${randInt(100000,999999)}</span>
      </div>
      <div class="export-body">
        <div class="fg">
          <label>日期</label>
          <input type="date" class="exp-date" value="${d.toISOString().slice(0,10)}" />
        </div>
        <div class="fg">
          <label>时间</label>
          <input type="time" class="exp-time" value="${fmtTime(randInt(tMinH,tMaxH),randInt(tMinM,tMaxM))}" />
        </div>
        <div class="fg">
          <label>偏移m</label>
          <input type="number" class="exp-sigma" value="${sigma}" min="0" max="${maxSigma}" step="0.1" />
        </div>
        <div class="fg" style="grid-column:1/-1">
          <label>配速 (分:秒/km)</label>
          <div class="pace-inputs">
            <input type="number" class="exp-pmin" value="${pm}" min="2" max="15" style="flex:1" />
            <span>:</span>
            <input type="number" class="exp-psec" value="${ps}" min="0" max="59" style="flex:1" />
          </div>
        </div>
      </div>
    `;
    $exportList.appendChild(div);
  }
}

// ====== Global time/pace range → per-item randomization ======
// These are attached ONCE, not inside rebuildExports

function randomizeAllTimes() {
  const hMin = parseInt(document.getElementById("timeMinH")?.value,10)||6;
  const mMin = parseInt(document.getElementById("timeMinM")?.value,10)||0;
  const hMax = parseInt(document.getElementById("timeMaxH")?.value,10)||9;
  const mMax = parseInt(document.getElementById("timeMaxM")?.value,10)||0;
  const tMin = hMin*60 + mMin;
  const tMax = Math.max(tMin, hMax*60 + mMax);
  $exportList.querySelectorAll(".exp-time").forEach(inp => {
    const t = Math.round(randBetween(tMin, tMax));
    inp.value = fmtTime(Math.floor(t/60)%24, t%60);
  });
  updateMsg("时间已按范围随机化", "info");
}

function randomizeAllPaces() {
  const pMin = (parseInt(document.getElementById("paceMinMin")?.value,10)||4)*60 + (parseInt(document.getElementById("paceMinSec")?.value,10)||30);
  const pMax = Math.max(pMin, (parseInt(document.getElementById("paceMaxMin")?.value,10)||7)*60 + (parseInt(document.getElementById("paceMaxSec")?.value,10)||0));
  $exportList.querySelectorAll(".export-item").forEach(item => {
    const pm = item.querySelector(".exp-pmin");
    const ps = item.querySelector(".exp-psec");
    if (pm && ps) {
      const sec = Math.round(randBetween(pMin, pMax));
      pm.value = Math.floor(sec/60);
      ps.value = sec%60;
    }
  });
  updateMsg("配速已按范围随机化", "info");
}

// Attach once at init — use 'input' for real-time response
["timeMinH","timeMinM","timeMaxH","timeMaxM"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", randomizeAllTimes);
});
["paceMinMin","paceMinSec","paceMaxMin","paceMaxSec"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", randomizeAllPaces);
});

// ====== Listeners ======
document.getElementById("exportCount")?.addEventListener("change", rebuildExports);
document.getElementById("maxSigma")?.addEventListener("change", () => {
  const max = parseFloat(document.getElementById("maxSigma")?.value) || 2;
  $exportList.querySelectorAll(".exp-sigma").forEach(inp => {
    inp.max = max;
    if (parseFloat(inp.value) > max) inp.value = max;
  });
  if (routePoints.length >= 3) generateSamples();
});
document.getElementById("maxSigma")?.addEventListener("input", () => {
  const max = parseFloat(document.getElementById("maxSigma")?.value) || 2;
  $exportList.querySelectorAll(".exp-sigma").forEach(inp => { inp.max = max; if (parseFloat(inp.value)>max) inp.value = max; });
});

// Clear
document.getElementById("clearBtn").addEventListener("click", () => {
  routePoints = []; generatedSamples = null;
  if (basePolyline) { map.removeLayer(basePolyline); basePolyline = null; }
  if (samplePolyline) { map.removeLayer(samplePolyline); samplePolyline = null; }
  if (previewCursor) { map.removeLayer(previewCursor); previewCursor = null; }
  $charts.style.display = "none"; refreshUI(); updateMsg("已清除", "");
});

// Load saved weight
const savedW = localStorage.getItem("fit_weight_v2");
if (savedW) document.getElementById("weight").value = savedW;
document.getElementById("weight").addEventListener("change", function() { localStorage.setItem("fit_weight_v2", this.value); });

// ====== Preview ======
document.getElementById("previewBtn").addEventListener("click", async () => {
  const pts = generatedSamples || routePoints;
  if (!pts || pts.length < 3) { updateMsg("请先绘制路线", "error"); return; }

  const items = $exportList.querySelectorAll(".export-item");
  if (!items.length) { updateMsg("请设置导出份数", "error"); return; }

  const first = items[0];
  const dateVal = first.querySelector(".exp-date")?.value;
  const timeVal = first.querySelector(".exp-time")?.value;
  const start = new Date(dateVal + "T" + (timeVal || "07:00") + ":00");
  if (isNaN(start.getTime())) { updateMsg("时间无效", "error"); return; }

  const pm = parseInt(first.querySelector(".exp-pmin")?.value,10)||6;
  const ps = parseInt(first.querySelector(".exp-psec")?.value,10)||0;
  const pace = pm*60 + ps;
  const hrR = parseInt(document.getElementById("hrRest")?.value,10)||60;
  const hrM = parseInt(document.getElementById("hrMax")?.value,10)||180;
  const laps = Math.max(1, parseInt(document.getElementById("lapCount")?.value,10)||1);
  const wkg = parseInt(document.getElementById("weight")?.value,10)||65;
  const bAlt = parseInt(document.getElementById("baseAltitude")?.value,10)||50;
  const vAlt = parseInt(document.getElementById("altitudeVariation")?.value,10)||15;

  updateMsg("📊 生成预览...", "info");
  try {
    const res = await fetch("/api/preview", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ startTime: start.toISOString(), points: gcjArrToWgs(pts), paceSecondsPerKm: pace, hrRest: hrR, hrMax: hrM, lapCount: 1, weightKg: wkg, baseAltitude: bAlt, altitudeVariation: vAlt }),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); updateMsg(e.error||"预览失败","error"); return; }
    const data = await res.json();
    renderCharts(data);
    const km = (data.totalDistanceMeters/1000).toFixed(2);
    const min = Math.floor(data.totalDurationSec/60);
    updateMsg(`✅ ${km} km / ${min}分${Math.round(data.totalDurationSec%60)}秒`, "success");
  } catch(e) { console.error(e); updateMsg("网络错误","error"); }
});

function renderCharts(data) {
  $charts.style.display = "block";
  const samples = data.samples || [];
  if (!samples.length) return;
  const labels = samples.map(s => (s.timeSec/60).toFixed(1));
  const paceData = samples.map(s => s.speed>0 ? (1000/s.speed)/60 : 10);
  const hrData = samples.map(s => s.heartRate);
  const altData = samples.map(s => s.altitude||50);

  const def = {
    type:"line",
    options:{ responsive:true, maintainAspectRatio:true, animation:false,
      plugins:{legend:{display:false}},
      scales:{ x:{display:false}, y:{ticks:{font:{size:9},color:"#959da5"},grid:{color:"#333842"}} },
      layout:{padding:{top:5,bottom:5}} },
  };
  [paceChart,hrChart,altChart].forEach(c=>{if(c)c.destroy();});

  paceChart = new Chart(document.getElementById("paceChart"), { ...def, data:{labels,datasets:[{data:paceData,borderColor:"#58a6ff",tension:.3,pointRadius:0,borderWidth:1.5,fill:false}]} });
  paceChart.options.scales.y.reverse = true; paceChart.update();
  hrChart = new Chart(document.getElementById("hrChart"), { ...def, data:{labels,datasets:[{data:hrData,borderColor:"#f85149",tension:.3,pointRadius:0,borderWidth:1.5,fill:false}]} });
  hrChart.update();
  altChart = new Chart(document.getElementById("altChart"), { ...def, data:{labels,datasets:[{data:altData,borderColor:"#3fb950",tension:.3,pointRadius:0,borderWidth:1.5,fill:false}]} });
  altChart.update();
}

// ====== Batch Generate FIT ======
document.getElementById("generateBtn").addEventListener("click", async () => {
  if (!generatedSamples || generatedSamples.length < 3) {
    if (routePoints.length < 3) { updateMsg("请先绘制路线","error"); return; }
    generateSamples();
  }
  const items = $exportList.querySelectorAll(".export-item");
  if (!items.length) { updateMsg("请设置导出份数","error"); return; }

  const hrR = parseInt(document.getElementById("hrRest")?.value,10)||60;
  const hrM = parseInt(document.getElementById("hrMax")?.value,10)||180;
  const laps = Math.max(1, parseInt(document.getElementById("lapCount")?.value,10)||1);
  const wkg = parseInt(document.getElementById("weight")?.value,10)||65;
  const bAlt = parseInt(document.getElementById("baseAltitude")?.value,10)||50;
  const vAlt = parseInt(document.getElementById("altitudeVariation")?.value,10)||15;

  const blobs = [];
  const filenames = [];

  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      updateMsg(`📦 生成 ${i+1}/${items.length}...`,"info");

      const dateVal = item.querySelector(".exp-date")?.value;
      const timeVal = item.querySelector(".exp-time")?.value || "07:00";
      const start = new Date(dateVal + "T" + timeVal + ":00");
      if (isNaN(start.getTime())) { updateMsg(`第${i+1}份时间无效`,"error"); return; }

      const pm = parseInt(item.querySelector(".exp-pmin")?.value,10)||6;
      const ps = parseInt(item.querySelector(".exp-psec")?.value,10)||0;
      const pace = pm*60 + ps;
      if (pace <= 0) { updateMsg(`第${i+1}份配速无效`,"error"); return; }

      const sigma = parseFloat(item.querySelector(".exp-sigma")?.value)||2;
      const seedTxt = item.querySelector(".export-seed")?.textContent || "";
      const seed = parseInt(seedTxt.replace(/[^0-9]/g,""),10) || (Math.floor(Math.random()*999999)+i*10000);
      const batchPts = generateVariant(seed, sigma);
      const res = await fetch("/api/generate-fit", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          startTime: start.toISOString(), points: gcjArrToWgs(batchPts),
          paceSecondsPerKm: pace, hrRest: hrR, hrMax: hrM,
          lapCount: 1, weightKg: wkg,
          baseAltitude: bAlt, altitudeVariation: vAlt,
          variantIndex: i+1,
        }),
      });
      if (!res.ok) { const e=await res.json().catch(()=>({})); updateMsg(e.error||"生成失败","error"); return; }
      const blob = await res.blob();
      blobs.push(blob);
      filenames.push(items.length > 1 ? `run_${i+1}.fit` : "run.fit");
    }

    if (blobs.length === 1) {
      // Single file: direct download
      const url = URL.createObjectURL(blobs[0]);
      const a = document.createElement("a"); a.href = url; a.download = filenames[0];
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      updateMsg("✅ 已导出 run.fit","success");
    } else {
      // Multiple files: pack into zip
      updateMsg("📦 正在打包 ZIP...","info");
      const zip = new JSZip();
      blobs.forEach((blob, i) => {
        zip.file(filenames[i], blob, { binary: true });
      });
      const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a"); a.href = url;
      // Timestamped zip name
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}_${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}`;
      a.download = `fit_runs_${ts}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      updateMsg(`✅ 已导出 ZIP (${blobs.length} 个 FIT 文件)`,"success");
    }
  } catch(e) { console.error(e); updateMsg("网络错误","error"); }
});

// ====== Consecutive date delegation (attach ONCE, not in rebuildExports) ======
$exportList.addEventListener("change", function(e) {
  if (!consecutiveDays) return;
  if (!e.target.classList.contains("exp-date")) return;
  const item = e.target.closest(".export-item");
  if (!item) return;
  const idx = parseInt(item.dataset.index, 10);
  const refDate = new Date(e.target.value + "T00:00:00");
  $exportList.querySelectorAll(".exp-date").forEach((di, j) => {
    const nd = new Date(refDate.getTime() + (j - idx)*86400000);
    di.value = nd.toISOString().slice(0, 10);
  });
});

// ====== Init ======
rebuildExports();
refreshUI();
console.log("🏃 Keep-FIT-Generator v1.0.0 就绪");
