import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(import.meta.dirname, "..");

test("GPS location display converts browser WGS-84 coordinates before showing on Amap", () => {
  const mainJs = fs.readFileSync(path.join(rootDir, "public", "main.js"), "utf8");

  assert.match(mainJs, /function\s+showLocatedPosition\s*\(/, "location display should be centralized in a helper");
  assert.match(mainJs, /wgsToGcj\(wgsLng,\s*wgsLat\)/, "helper should convert WGS-84 browser coordinates to GCJ-02");
  assert.doesNotMatch(mainJs, /map\.setView\(\[lat,\s*lng\]/, "locate flow must not center Amap on raw WGS-84 coordinates");
});

test("GPS location failure asks the user to drag the map manually without IP fallback", () => {
  const mainJs = fs.readFileSync(path.join(rootDir, "public", "main.js"), "utf8");
  const serverJs = fs.readFileSync(path.join(rootDir, "server.js"), "utf8");

  assert.match(mainJs, /手动拖动地图/, "GPS failure should tell the user to drag the map manually");
  assert.doesNotMatch(mainJs, /locateByIp|\/api\/ip-location|IP 粗定位/, "frontend should not call IP fallback after GPS failure");
  assert.doesNotMatch(serverJs, /\/api\/ip-location|IP_LOCATION_PROVIDER_URL|trust proxy/, "server should not expose IP geolocation fallback");
});
