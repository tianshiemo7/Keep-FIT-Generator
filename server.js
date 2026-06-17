import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Encoder, Profile } from "@garmin/fitsdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ==================== Utility Functions ====================

function toSemicircles(deg) {
  return Math.round((deg * 2147483648) / 180);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function offsetPointMeters(point, offsetLatMeters, offsetLonMeters) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((point.lat * Math.PI) / 180);
  return {
    lat: point.lat + offsetLatMeters / metersPerDegLat,
    lng: point.lng + offsetLonMeters / metersPerDegLon,
  };
}

function simulateCadence(speed) {
  const base = 170;
  const speedEffect = (speed - 2.5) * 8;
  const noise = (Math.random() - 0.5) * 6;
  return Math.max(150, Math.min(200, Math.round(base + speedEffect + noise)));
}

function simulateElevation(frac, baseAltitude, variation) {
  const hill1 = Math.sin(frac * Math.PI * 1.5) * 0.6;
  const hill2 = Math.sin(frac * Math.PI * 3.7 + 1.2) * 0.3;
  const hill3 = Math.sin(frac * Math.PI * 7.1 + 2.8) * 0.1;
  return baseAltitude + (hill1 + hill2 + hill3) * variation;
}

function estimatePower(speed, grade, weightKg) {
  const flatPower = weightKg * speed * 1.05;
  const gradeAdjustment = weightKg * speed * grade * 9.8;
  return Math.round(Math.max(50, flatPower + gradeAdjustment));
}

// ==================== Core computation ====================

function computeSamples(allPoints, distances, totalDist, config) {
  const {
    paceSecondsPerKm, hrRest, hrMax,
    baseAltitude, altitudeVariation, weightKg,
  } = config;

  const totalDistanceKm = totalDist / 1000;
  const targetDurationSec = totalDistanceKm * paceSecondsPerKm;
  const avgSpeedTarget = totalDist / targetDurationSec;
  const baseSpeedFactor = 0.98 + Math.random() * 0.06;
  const phase1 = Math.random() * Math.PI * 2;
  const phase2 = Math.random() * Math.PI * 2;

  const n = allPoints.length;
  const instSpeedRaw = new Array(n);
  const hrValues = new Array(n);
  const altitudes = new Array(n);
  const grades = new Array(n);
  let currentHr = hrRest;

  for (let i = 0; i < n; i++) {
    const frac = distances[i] / totalDist;

    // Speed with natural variation
    const longWave = 0.04 * Math.sin(frac * Math.PI * 2 + phase1);
    const shortWave = 0.02 * Math.sin(frac * Math.PI * 6 + phase2);
    instSpeedRaw[i] = avgSpeedTarget * baseSpeedFactor * (1 + longWave + shortWave);

    // Altitude
    altitudes[i] = simulateElevation(frac, baseAltitude, altitudeVariation);

    // Grade
    if (i > 0) {
      const dh = altitudes[i] - altitudes[i - 1];
      const ds = distances[i] - distances[i - 1];
      grades[i] = ds > 0 ? dh / ds : 0;
    } else {
      grades[i] = 0;
    }

    // Heart rate (3-phase: warmup → steady → push)
    const effort = Math.min(1, Math.max(0, instSpeedRaw[i] / (avgSpeedTarget || 1e-6)));
    let intensityBase;
    if (frac < 0.1) {
      intensityBase = 0.4 + 0.4 * (frac / 0.1);
    } else if (frac < 0.8) {
      intensityBase = 0.8 + 0.05 * Math.sin(((frac - 0.1) / 0.7) * Math.PI * 2);
    } else {
      intensityBase = 0.85 + 0.1 * ((frac - 0.8) / 0.2);
    }
    const gradeEffort = Math.max(0, grades[i] * 5);
    const intensity = Math.min(1, Math.max(0, 0.7 * intensityBase + 0.3 * effort + gradeEffort));
    const hrTarget = hrRest + (hrMax - hrRest) * intensity;
    currentHr += (hrTarget - currentHr) * 0.15;
    const hrJitter = (Math.random() - 0.5) * 3;
    hrValues[i] = Math.round(Math.min(hrMax, Math.max(hrRest, currentHr + hrJitter)));
  }

  // Segment durations
  const segDurationsRaw = [];
  let rawDuration = 0;
  for (let i = 1; i < n; i++) {
    const ds = distances[i] - distances[i - 1];
    const v = instSpeedRaw[i] > 0 ? instSpeedRaw[i] : avgSpeedTarget;
    const dt = ds / v;
    segDurationsRaw.push(dt);
    rawDuration += dt;
  }

  const timeScale = rawDuration > 0 ? targetDurationSec / rawDuration : 1;

  // Build samples
  const samples = [];
  let t = 0;

  samples.push(makeSample(0, 0));
  for (let i = 1; i < n; i++) {
    t += segDurationsRaw[i - 1] * timeScale;
    samples.push(makeSample(i, t));
  }

  function makeSample(idx, time) {
    const speed = instSpeedRaw[idx] / timeScale;
    const grade = grades[idx];
    const cadence = simulateCadence(speed);
    const strideLen = speed / (cadence / 60);
    const power = estimatePower(speed, grade, weightKg);

    return {
      timeSec: time,
      distance: distances[idx],
      speed,
      heartRate: hrValues[idx],
      altitude: altitudes[idx],
      grade,
      cadence,
      strideLength: strideLen,
      power,
      lat: allPoints[idx].lat,
      lng: allPoints[idx].lng,
    };
  }

  const totalDurationSec = samples[n - 1].timeSec;
  return { samples, totalDurationSec };
}

// ==================== FIT Encoding ====================

function encodeFit(startDate, allPoints, distances, totalDist, samples, totalDurationSec, config) {
  const encoder = new Encoder();
  const weightKg = config.weightKg;
  const avgSpeed = totalDist / totalDurationSec;
  const calories = Math.round(weightKg * (totalDist / 1000) * 1.036);
  const sessionEnd = new Date(startDate.getTime() + totalDurationSec * 1000);

  // Aggregates
  const cadences = samples.map((s) => s.cadence);
  const avgRunningCadence = Math.round(cadences.reduce((a, b) => a + b, 0) / cadences.length);
  const maxRunningCadence = Math.max(...cadences);
  const avgHr = Math.round(samples.reduce((a, b) => a + b.heartRate, 0) / samples.length);
  const maxHr = Math.max(...samples.map((s) => s.heartRate));
  const maxSpeed = Math.max(...samples.map((s) => s.speed));
  const powers = samples.map((s) => s.power);
  const avgPower = Math.round(powers.reduce((a, b) => a + b, 0) / powers.length);
  const maxPower = Math.max(...powers);
  const strides = samples.filter((s) => s.strideLength > 0).map((s) => s.strideLength);
  const avgStrideLength = strides.length ? strides.reduce((a, b) => a + b, 0) / strides.length : 0;

  // Total ascent/descent
  let totalAscent = 0, totalDescent = 0;
  for (let i = 1; i < samples.length; i++) {
    const dh = samples[i].altitude - samples[i - 1].altitude;
    if (dh > 0) totalAscent += dh;
    else totalDescent += Math.abs(dh);
  }

  // Training load
  const hrIntensity = config.hrMax > config.hrRest
    ? (avgHr - config.hrRest) / (config.hrMax - config.hrRest)
    : 0.5;
  const trainingStressScore = Math.round(hrIntensity * hrIntensity * (totalDurationSec / 36));
  const totalTrainingEffect = Math.min(5, Math.round((hrIntensity * 5 + (totalDurationSec / 3600) * 1.5) * 10) / 10);

  // Total work
  let totalWork = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].timeSec - samples[i - 1].timeSec;
    totalWork += samples[i].power * dt;
  }

  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    manufacturer: "development",
    product: 1,
    timeCreated: startDate,
    type: "activity",
  });

  encoder.onMesg(Profile.MesgNum.DEVICE_INFO, {
    timestamp: startDate,
    manufacturer: "development",
    product: 1,
    serialNumber: 1,
  });

  encoder.onMesg(Profile.MesgNum.SESSION, {
    timestamp: sessionEnd,
    startTime: startDate,
    // Basic
    totalElapsedTime: totalDurationSec,
    totalTimerTime: totalDurationSec,
    totalDistance: totalDist,
    totalCalories: calories,
    sport: "running",
    subSport: "generic",
    // Speed
    avgSpeed,
    maxSpeed,
    enhancedAvgSpeed: avgSpeed,
    enhancedMaxSpeed: maxSpeed,
    // Heart rate
    avgHeartRate: avgHr,
    maxHeartRate: maxHr,
    // Elevation
    totalAscent: Math.round(totalAscent),
    totalDescent: Math.round(totalDescent),
    // Cadence
    avgCadence: Math.round(avgRunningCadence / 2),
    avgRunningCadence,
    maxRunningCadence,
    // Power
    avgPower,
    maxPower,
    totalWork: Math.round(totalWork),
    // Stride
    avgStrideLength: Math.round(avgStrideLength * 1000) / 1000,
    // Training
    trainingStressScore,
    totalTrainingEffect,
    // Grade
    avgGrade: 0,
    // Laps
    numLaps: config.lapCount,
  });

  encoder.onMesg(Profile.MesgNum.ACTIVITY, {
    timestamp: sessionEnd,
    totalTimerTime: totalDurationSec,
    numSessions: 1,
    type: "manual",
  });

  // LAP messages
  const pointsPerLap = Math.floor(samples.length / config.lapCount);
  for (let lap = 0; lap < config.lapCount; lap++) {
    const start = lap * pointsPerLap;
    const end = Math.min((lap + 1) * pointsPerLap, samples.length - 1);
    const lapDuration = samples[end].timeSec - samples[start].timeSec;
    const lapDistance = samples[end].distance - samples[start].distance;
    const lapStartTime = new Date(startDate.getTime() + samples[start].timeSec * 1000);
    const lapEndTime = new Date(startDate.getTime() + samples[end].timeSec * 1000);

    encoder.onMesg(Profile.MesgNum.LAP, {
      timestamp: lapEndTime,
      startTime: lapStartTime,
      totalElapsedTime: lapDuration,
      totalTimerTime: lapDuration,
      totalDistance: lapDistance,
      totalCalories: Math.round(calories / config.lapCount),
      sport: "running",
      avgSpeed: lapDistance / lapDuration,
      avgHeartRate: avgHr,
      maxHeartRate: maxHr,
      totalAscent: Math.round(totalAscent / config.lapCount),
      totalDescent: Math.round(totalDescent / config.lapCount),
      avgRunningCadence,
      messageIndex: lap,
    });
  }

  // RECORD messages
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const ts = new Date(startDate.getTime() + s.timeSec * 1000);

    encoder.onMesg(Profile.MesgNum.RECORD, {
      timestamp: ts,
      positionLat: toSemicircles(s.lat),
      positionLong: toSemicircles(s.lng),
      distance: s.distance,
      speed: s.speed,
      enhancedSpeed: s.speed,
      heartRate: s.heartRate,
      altitude: s.altitude,
      enhancedAltitude: s.altitude,
      cadence: Math.round(s.cadence / 2),
      runningCadence: s.cadence,
      power: s.power,
      stepLength: Math.round(s.strideLength * 1000) / 1000,
      grade: Math.round(s.grade * 10000) / 100,
    });
  }

  const buffer = Buffer.from(encoder.close());

  return {
    buffer,
    stats: {
      totalDistance: totalDist,
      totalDurationSec,
      calories,
      avgHr,
      maxHr,
      maxSpeed,
      totalAscent: Math.round(totalAscent),
      totalDescent: Math.round(totalDescent),
      avgRunningCadence,
      maxRunningCadence,
      avgPower,
      maxPower,
      avgStrideLength: Math.round(avgStrideLength * 1000) / 1000,
      trainingStressScore,
      totalTrainingEffect,
    },
  };
}

// ==================== API Routes ====================

app.post("/api/preview", (req, res) => {
  try {
    const body = req.body || {};
    const { startTime, points, paceSecondsPerKm, hrRest, hrMax, lapCount, weightKg, baseAltitude, altitudeVariation } = body;

    if (!startTime || !points || !Array.isArray(points) || points.length < 2) {
      return res.status(400).json({ error: "需要 startTime 和至少两个轨迹点" });
    }

    const startDate = new Date(startTime);
    if (Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "startTime 格式不正确" });
    }

    const config = {
      paceSecondsPerKm: Number(paceSecondsPerKm) > 0 ? Number(paceSecondsPerKm) : 360,
      hrRest: Number.isFinite(Number(hrRest)) ? Number(hrRest) : 60,
      hrMax: Number.isFinite(Number(hrMax)) ? Number(hrMax) : 180,
      lapCount: Number.isFinite(Number(lapCount)) && Number(lapCount) > 0 ? Math.floor(Number(lapCount)) : 1,
      weightKg: Number.isFinite(Number(weightKg)) && weightKg > 30 && weightKg < 150 ? Number(weightKg) : 65,
      baseAltitude: Number.isFinite(Number(baseAltitude)) ? Number(baseAltitude) : 50,
      altitudeVariation: Number.isFinite(Number(altitudeVariation)) ? Number(altitudeVariation) : 15,
    };

    // Build all points with lap offsets
    const allPoints = [];
    for (let lap = 0; lap < config.lapCount; lap++) {
      const radiusMeters = 5 + Math.random() * 10;
      const angle = Math.random() * Math.PI * 2;
      for (const p of points) {
        if (config.lapCount === 1) {
          allPoints.push({ ...p });
        } else {
          allPoints.push(offsetPointMeters(p, radiusMeters * Math.cos(angle), radiusMeters * Math.sin(angle)));
        }
      }
    }

    // Compute distances
    const distances = [0];
    let totalDist = 0;
    for (let i = 1; i < allPoints.length; i++) {
      const d = haversineDistance(allPoints[i - 1].lat, allPoints[i - 1].lng, allPoints[i].lat, allPoints[i].lng);
      totalDist += d;
      distances.push(totalDist);
    }

    if (totalDist === 0) {
      return res.status(400).json({ error: "轨迹距离为 0，请绘制更长的路线" });
    }

    const { samples, totalDurationSec } = computeSamples(allPoints, distances, totalDist, config);

    return res.json({
      totalDistanceMeters: totalDist,
      totalDurationSec,
      samples,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "预览生成失败" });
  }
});

app.post("/api/generate-fit", (req, res) => {
  try {
    const body = req.body || {};
    const {
      startTime, points, paceSecondsPerKm, hrRest, hrMax,
      lapCount, variantIndex, weightKg,
      baseAltitude, altitudeVariation,
    } = body;

    if (!startTime || !points || !Array.isArray(points) || points.length < 2) {
      return res.status(400).json({ error: "需要 startTime 和至少两个轨迹点" });
    }

    const startDate = new Date(startTime);
    if (Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "startTime 格式不正确" });
    }

    const config = {
      paceSecondsPerKm: Number(paceSecondsPerKm) > 0 ? Number(paceSecondsPerKm) : 360,
      hrRest: Number.isFinite(Number(hrRest)) ? Number(hrRest) : 60,
      hrMax: Number.isFinite(Number(hrMax)) ? Number(hrMax) : 180,
      lapCount: Number.isFinite(Number(lapCount)) && Number(lapCount) > 0 ? Math.floor(Number(lapCount)) : 1,
      weightKg: Number.isFinite(Number(weightKg)) && weightKg > 30 && weightKg < 150 ? Number(weightKg) : 65,
      baseAltitude: Number.isFinite(Number(baseAltitude)) ? Number(baseAltitude) : 50,
      altitudeVariation: Number.isFinite(Number(altitudeVariation)) ? Number(altitudeVariation) : 15,
      variantIndex: Number.isFinite(Number(variantIndex)) && Number(variantIndex) > 0
        ? Math.floor(Number(variantIndex)) : 1,
    };

    // Build points with lap offsets
    const allPoints = [];
    for (let lap = 0; lap < config.lapCount; lap++) {
      const radiusMeters = 5 + Math.random() * 10;
      const angle = Math.random() * Math.PI * 2;
      for (const p of points) {
        if (config.lapCount === 1) {
          allPoints.push({ ...p });
        } else {
          allPoints.push(offsetPointMeters(p, radiusMeters * Math.cos(angle), radiusMeters * Math.sin(angle)));
        }
      }
    }

    // Compute distances
    const distances = [0];
    let totalDist = 0;
    for (let i = 1; i < allPoints.length; i++) {
      const d = haversineDistance(allPoints[i - 1].lat, allPoints[i - 1].lng, allPoints[i].lat, allPoints[i].lng);
      totalDist += d;
      distances.push(totalDist);
    }

    if (totalDist === 0) {
      return res.status(400).json({ error: "轨迹距离为 0，请绘制更长的路线" });
    }

    const { samples, totalDurationSec } = computeSamples(allPoints, distances, totalDist, config);
    const { buffer, stats } = encodeFit(startDate, allPoints, distances, totalDist, samples, totalDurationSec, config);

    res.setHeader("Content-Type", "application/vnd.ant.fit");
    res.setHeader("Content-Disposition", `attachment; filename=run_${config.variantIndex}.fit`);
    return res.send(buffer);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "生成 FIT 文件失败" });
  }
});

// ==================== Start Server ====================

const server = app.listen(PORT, () => {
  console.log(`🏃 Keep-FIT-Generator v1.0.0 已启动: http://localhost:${PORT}`);
  console.log("   - 配速范围/时间范围随机化");
  console.log("   - 连续日期自动联动");
  console.log("   - GPS快速定位");
  console.log("   - 全参数预配置批量导出");
});

server.on("error", (err) => {
  console.error("Server error:", err);
});
