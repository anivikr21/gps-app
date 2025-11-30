// ===== CONFIG =====
const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjcxMWQ3ZTYwZjg4ZTQzYjZiNjM0YmVjMjkxNjU5ZjNjIiwiaCI6Im11cm11cjY0In0="; // <- put your free ORS key here

// ===== GLOBALS =====
let map;
let routeLayer = null;
let startMarker = null;
let endMarker = null;
let stopMarkers = [];

// ===== INIT MAP =====
document.addEventListener("DOMContentLoaded", () => {
  initMap();

  const form = document.getElementById("trip-form");
  form.addEventListener("submit", handlePlanTrip);
});

function initMap() {
  // Rough center of US
  map = L.map("map").setView([39.8283, -98.5795], 4);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors',
    maxZoom: 19
  }).addTo(map);
}

// ===== UI HELPERS =====
function setPlanning(isPlanning) {
  const btn = document.getElementById("plan-btn");
  btn.disabled = isPlanning;
  btn.textContent = isPlanning ? "Planning..." : "Plan gas stops";
}

function showError(message) {
  const el = document.getElementById("error");
  el.textContent = message || "";
}

function clearError() {
  showError("");
}

function clearResults() {
  document.getElementById("results").innerHTML = "";
}

function clearMapLayers() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  if (startMarker) {
    map.removeLayer(startMarker);
    startMarker = null;
  }
  if (endMarker) {
    map.removeLayer(endMarker);
    endMarker = null;
  }
  stopMarkers.forEach((m) => map.removeLayer(m));
  stopMarkers = [];
}

// ===== MAIN HANDLER =====
async function handlePlanTrip(event) {
  event.preventDefault();
  clearError();
  clearResults();
  clearMapLayers();

  const originText = document.getElementById("origin").value.trim();
  const destinationText = document.getElementById("destination").value.trim();
  const rangeMiles = Number(document.getElementById("range").value);
  const reserveMiles = Number(document.getElementById("reserve").value || 0);

  if (!originText || !destinationText || !rangeMiles || rangeMiles <= 0) {
    showError("Please fill in origin, destination, and a valid range.");
    return;
  }

  if (reserveMiles >= rangeMiles) {
    showError("Reserve buffer must be less than the range per tank.");
    return;
  }

  const usableRange = rangeMiles - reserveMiles;
  if (usableRange < 30) {
    showError("Usable range is too small. Increase range or decrease reserve.");
    return;
  }

  setPlanning(true);

  try {
    // 1) Geocode origin/destination
    const [origin, destination] = await Promise.all([
      geocodePlace(originText),
      geocodePlace(destinationText),
    ]);

    // 2) Get route
    const route = await getRoute(origin, destination);

    // 3) Draw route and markers
    routeLayer = L.geoJSON(route.geojson, {
      style: {
        weight: 4,
      },
    }).addTo(map);

    const bounds = routeLayer.getBounds();
    map.fitBounds(bounds, { padding: [40, 40] });

    startMarker = L.marker([origin.lat, origin.lon], { title: "Start" })
      .addTo(map)
      .bindPopup(`<strong>Start</strong><br>${origin.label || originText}`);

    endMarker = L.marker([destination.lat, destination.lon], { title: "Destination" })
      .addTo(map)
      .bindPopup(`<strong>Destination</strong><br>${destination.label || destinationText}`);

    // 4) Compute stop points along the route
    const totalDistanceMiles = route.distMeters / 1609.344;
    const stopPoints = computeStopPoints(route.coords, usableRange);

    if (stopPoints.length === 0) {
      renderResultsNoStops(totalDistanceMiles, rangeMiles);
      return;
    }

    // 5) For each stop point, find nearby gas station with Overpass
    const gasStops = await findGasStationsForStops(stopPoints);

    // 6) Show markers & results
    addStopMarkers(gasStops);
    renderResultsWithStops(totalDistanceMiles, rangeMiles, gasStops);
  } catch (err) {
    console.error(err);
    showError(err.message || "Failed to plan trip. Try again.");
  } finally {
    setPlanning(false);
  }
}

// ===== GEOCODING & ROUTING (OpenRouteService) =====
async function geocodePlace(text) {
  const url =
    "https://api.openrouteservice.org/geocode/search" +
    "?api_key=" +
    encodeURIComponent(ORS_API_KEY) +
    "&text=" +
    encodeURIComponent(text) +
    "&size=1";

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Geocoding failed for: " + text);
  }

  const data = await res.json();
  if (!data.features || !data.features.length) {
    throw new Error("Location not found: " + text);
  }

  const feature = data.features[0];
  const [lon, lat] = feature.geometry.coordinates;
  const label = feature.properties.label;

  return { lat, lon, label };
}

async function getRoute(origin, destination) {
  const url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
  const body = {
    coordinates: [
      [origin.lon, origin.lat],
      [destination.lon, destination.lat],
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: ORS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error("Routing failed. Check locations and try again.");
  }

  const data = await res.json();
  if (!data.features || !data.features.length) {
    throw new Error("No route found.");
  }

  const feature = data.features[0];
  const coords = feature.geometry.coordinates.map(([lon, lat]) => ({ lon, lat }));
  const distMeters = feature.properties.summary.distance;

  return {
    coords,
    distMeters,
    geojson: feature,
  };
}

// ===== ROUTE PROCESSING / STOP PLACEMENT =====
function distanceInMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Given route coordinates (array of {lat, lon}) and usable range in miles,
 * returns an array of stop points:
 *   [{ lat, lon, distanceFromStartMiles }, ...]
 */
function computeStopPoints(coords, usableRangeMiles) {
  const stops = [];
  if (coords.length < 2) return stops;

  let distanceSinceLastStop = 0;
  let cumulativeDistance = 0;

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const segDist = distanceInMiles(prev.lat, prev.lon, curr.lat, curr.lon);

    distanceSinceLastStop += segDist;
    cumulativeDistance += segDist;

    if (distanceSinceLastStop >= usableRangeMiles) {
      // Place a stop at the current point on the route
      stops.push({
        lat: curr.lat,
        lon: curr.lon,
        distanceFromStartMiles: cumulativeDistance,
      });
      distanceSinceLastStop = 0;
    }
  }

  return stops;
}

// ===== GAS STATIONS (Overpass API) =====
async function findGasStationsForStops(stops) {
  const radiusMeters = 8000; // ~5 miles

  const promises = stops.map(async (stop, idx) => {
    const gas = await findNearestGasStation(stop.lat, stop.lon, radiusMeters);

    if (!gas) {
      return {
        index: idx + 1,
        name: "Gas station not found nearby",
        address: "Try stopping a bit earlier or later along the route.",
        lat: stop.lat,
        lon: stop.lon,
        distanceFromStartMiles: stop.distanceFromStartMiles,
        distanceOffsetMiles: null,
      };
    }

    return {
      index: idx + 1,
      name: gas.name,
      address: gas.address,
      lat: gas.lat,
      lon: gas.lon,
      distanceFromStartMiles: stop.distanceFromStartMiles,
      distanceOffsetMiles: gas.distanceMiles,
    };
  });

  return Promise.all(promises);
}

async function findNearestGasStation(lat, lon, radiusMeters) {
  // Overpass QL query: find amenity=fuel within radius
  const query = `
[out:json][timeout:25];
(
  node["amenity"="fuel"](around:${radiusMeters},${lat},${lon});
);
out body;
  `;

  const url =
    "https://overpass-api.de/api/interpreter?data=" +
    encodeURIComponent(query);

  const res = await fetch(url);
  if (!res.ok) {
    console.warn("Overpass request failed with status:", res.status);
    return null;
  }

  const data = await res.json();
  if (!data.elements || data.elements.length === 0) {
    return null;
  }

  // Pick the nearest station
  let best = data.elements[0];
  let bestDist = distanceInMiles(lat, lon, best.lat, best.lon);

  for (const el of data.elements) {
    const d = distanceInMiles(lat, lon, el.lat, el.lon);
    if (d < bestDist) {
      best = el;
      bestDist = d;
    }
  }

  const name =
    (best.tags && (best.tags.name || best.tags.brand)) || "Gas station";
  const addressParts = [];
  if (best.tags) {
    if (best.tags["addr:housenumber"] || best.tags["addr:street"]) {
      addressParts.push(
        `${best.tags["addr:housenumber"] || ""} ${best.tags["addr:street"] || ""}`.trim()
      );
    }
    if (best.tags["addr:city"]) addressParts.push(best.tags["addr:city"]);
    if (best.tags["addr:state"]) addressParts.push(best.tags["addr:state"]);
  }
  const address = addressParts.join(", ") || "Address not available";

  return {
    name,
    address,
    lat: best.lat,
    lon: best.lon,
    distanceMiles: bestDist,
  };
}

// ===== MAP MARKERS & RESULTS UI =====
function addStopMarkers(stops) {
  stopMarkers.forEach((m) => map.removeLayer(m));
  stopMarkers = [];

  stops.forEach((stop) => {
    const marker = L.marker([stop.lat, stop.lon], {
      title: `Stop #${stop.index}`,
    }).addTo(map);

    const distFromStart = stop.distanceFromStartMiles.toFixed(1);
    const offset =
      stop.distanceOffsetMiles != null
        ? ` (~${stop.distanceOffsetMiles.toFixed(1)} mi from ideal stop)`
        : "";

    const popupHtml = `
      <strong>Stop #${stop.index}</strong><br/>
      ${stop.name}<br/>
      <small>${stop.address}</small><br/>
      <small>Distance from start: ~${distFromStart} miles${offset}</small>
    `;

    marker.bindPopup(popupHtml);
    stopMarkers.push(marker);
  });
}

function renderResultsNoStops(totalDistanceMiles, rangeMiles) {
  const total = totalDistanceMiles.toFixed(1);
  const results = document.getElementById("results");

  results.innerHTML = `
    <div class="result-summary">
      Total trip distance: <strong>${total} miles</strong><br/>
      With a range of ~${rangeMiles.toFixed(
        0
      )} miles, you <strong>don't need any fuel stops</strong> on this route.
    </div>
  `;
}

function renderResultsWithStops(totalDistanceMiles, rangeMiles, stops) {
  const results = document.getElementById("results");
  const total = totalDistanceMiles.toFixed(1);
  const stopCount = stops.length;

  let html = `
    <div class="result-summary">
      Total trip distance: <strong>${total} miles</strong><br/>
      Estimated fuel stops needed: <strong>${stopCount}</strong> (range ≈ ${rangeMiles.toFixed(
        0
      )} mi)
    </div>
  `;

  stops.forEach((stop) => {
    const dist = stop.distanceFromStartMiles.toFixed(1);
    const offset =
      stop.distanceOffsetMiles != null
        ? ` (~${stop.distanceOffsetMiles.toFixed(1)} mi from ideal point)`
        : "";

    html += `
      <div class="stop-card">
        <div class="stop-title">Stop #${stop.index}: ${stop.name}</div>
        <div class="stop-meta">${stop.address}</div>
        <div class="stop-distance">Distance from start: ~${dist} miles${offset}</div>
      </div>
    `;
  });

  results.innerHTML = html;
}
