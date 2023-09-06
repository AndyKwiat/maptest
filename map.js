let allRoads = [];
let allMeters = [];
let parkingBlocks = {};
let starting_lat = 43.53255820104378; // hard-coded for now
let starting_lng = -80.23672699928285;

// Latitude: 1 deg = 110.574 km. Longitude: 1 deg = 111.320*cos(latitude) km.
const latkm = 110.574;
const lngkm = 111.32 * Math.cos((starting_lat * Math.PI) / 180);

let lngRatio = lngkm / latkm;
lngRatio *= lngRatio; // hack
const invLngRatio = latkm / lngkm;

const map = L.map("map").setView([starting_lat, starting_lng], 17);
const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 99,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// button handler for make blocks
document
  .getElementById("make-blocks-button")
  .addEventListener("click", OnMakeBlocksButton_Clicked);

function OnMakeBlocksButton_Clicked() {
  // clear all blocks
  for (let key in parkingBlocks) {
    map.removeLayer(parkingBlocks[key]);
  }
  parkingBlocks = {};

  allMeters.forEach((meter) => {
    addBlockForMeter(meter.coords[0], meter.coords[1]);
  });
}

function addBlockForMeter(lat, lng) {
  let meterLocation = { x: lat, y: lng };
  // find closest road
  let closestRoad = allRoads.reduce((prev, curr) => {
    const prevDist = distancePointToLineSegment(meterLocation, prev);
    const currDist = distancePointToLineSegment(meterLocation, curr);
    return prevDist < currDist ? prev : curr;
  });

  let dist = distancePointToLineSegment(meterLocation, closestRoad);
  let roadDirection = vecSubtract(closestRoad[1], closestRoad[0]);
  roadDirection = vecNormalize(roadDirection);

  // get normal vector

  let normal = vecNormalize({
    x: -roadDirection.y * lngRatio,
    y: roadDirection.x,
  });

  let diff = vecSubtract(meterLocation, closestRoad[0]);
  diff.y = diff.y * lngRatio; // hack

  diff = vecNormalize(diff);

  let dot = vecDot(diff, normal);

  console.log(
    `normal: ${normal.x}, ${normal.y} dot: ${dot} diff: ${diff.x}, ${diff.y}`
  );
  let reversed = false;
  if (dot < 0) {
    normal = vecScale(normal, -1);
    reversed = true;
  }

  let key = `${closestRoad[0].x},${closestRoad[0].y},${closestRoad[1].x}, ${closestRoad[1].y} :${reversed}`;
  if (key in parkingBlocks) {
    return;
  }

  const blockSize = 11.5 / 111139; // 2.5 meters in degrees
  // block starts at the meter and goes blockSize meters in the normal direction (away from the road)
  let start = vecAdd(
    closestRoad[0],
    vecAdd(vecScale(normal, dist), vecScale(roadDirection, dist))
  );
  let start2 = vecAdd(start, vecScale(normal, blockSize));
  let end = vecAdd(
    closestRoad[1],
    vecAdd(vecScale(normal, dist), vecScale(roadDirection, -dist))
  );
  let end2 = vecAdd(end, vecScale(normal, blockSize));

  // draw the block
  const polygon = L.polygon(
    [
      [start.x, start.y],
      [end.x, end.y],
      [end2.x, end2.y],
      [start2.x, start2.y],
    ],
    {
      color: "#ff7800",
      weight: 2,
      fill: true,
      fillColor: "#ff0000",
      fillOpacity: 0.9,
    }
  ).addTo(map);
  parkingBlocks[key] = polygon;
}
function fetchWithCaching(url) {
  // Check if the response is already in the cache
  if ("caches" in window) {
    return caches.match(url).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse.json();
      } else {
        // If the response is not in the cache, fetch it and add it to the cache
        return fetch(url).then((response) => {
          const clonedResponse = response.clone();
          caches.open("osm-cache").then((cache) => {
            cache.put(url, clonedResponse);
          });
          return response.json();
        });
      }
    });
  } else {
    // If the browser does not support the Cache API, fetch the response normally
    return fetch(url).then((response) => response.json());
  }
}
// Retrieve data in a bounding box using the Overpass API
function fetchDataInBoundingBox(bbox) {
  const url = `https://overpass-api.de/api/interpreter?data=[out:json];(way["highway"](${bbox});>;);out;`;
  return fetchWithCaching(url).then((data) => {
    // filter out all nodes
    let returnData = {};
    returnData.nodes = data.elements.filter(
      (element) => element.type === "node"
    );
    // filter out all ways
    returnData.ways = data.elements.filter((element) => element.type === "way");
    // filter out all relations
    returnData.relations = data.elements.filter(
      (element) => element.type === "relation"
    );

    return returnData;
  });
}

//   const marker = L.marker([51.5, -0.09])
//     .addTo(map)
//     .bindPopup("<b>Hello world!</b><br />I am a popup.")
//     .openPopup();

//   const circle = L.circle([51.508, -0.11], {
//     color: "red",
//     fillColor: "#f03",
//     fillOpacity: 0.5,
//     radius: 500,
//   })
//     .addTo(map)
//     .bindPopup("I am a circle.");

//   const polygon = L.polygon([
//     [51.509, -0.08],
//     [51.503, -0.06],
//     [51.51, -0.047],
//   ])
//     .addTo(map)
//     .bindPopup("I am a polygon.");

const popup = L.popup();
let allCoords = [];
function onMapClick(e) {
  let c = L.circle([e.latlng.lat, e.latlng.lng], {
    color: "green",
    weight: 10,
    radius: 1,
  }).addTo(map);

  allMeters.push({ coords: [e.latlng.lat, e.latlng.lng], gfx: c });
}

map.on("click", onMapClick);
const bbox = [
  [43.543523, -80.225332],
  [43.511111, -80.250074],
];
// sort bbox coordinates by latitude
bbox.sort((a, b) => a[0] - b[0]);

// draw bbox using leaflet
//   L.rectangle(bbox, { color: "#ff7800", weight: 1 }).addTo(map);

fetchDataInBoundingBox(bbox)
  .then((data) => {
    data.nodes.forEach((coord) => {
      L.circle([coord.lat, coord.lon], {
        color: "#ff7800",
        weight: 1,
        radius: 5,
      }).addTo(map);
    });
    // draw each "way"
    data.ways.forEach((way) => {
      // get all coords for this way
      let coords = way.nodes.map((node) => {
        const coord = data.nodes.find((coord) => coord.id === node);
        if (!coord) {
          //   console.log(`Could not find coord for node ${node}`);
          return [null, null];
        }
        return [coord.lat, coord.lon];
      });
      // filter out all coords with null values
      coords = coords.filter((coord) => coord[0] !== null);

      // draw the way
      if (coords.length > 1 && way.tags.highway) {
        // push every line segment into allWays
        for (let i = 0; i < coords.length - 1; i++) {
          allRoads.push([arrayToVec(coords[i]), arrayToVec(coords[i + 1])]);
          L.polyline([coords[i], coords[i + 1]], {
            color: "#00ff00",
            weight: 1,
          }).addTo(map);
        }
      }
    });
  })
  .catch((error) => console.error(error));

function distancePointToLineSegment(point, segment) {
  const [p1, p2] = segment;

  const diff = vecSubtract(p2, p1);

  const dot = vecDot(diff, vecSubtract(point, p1));

  const lenSq = diff.x * diff.x + diff.y * diff.y;
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let nearestPt;
  if (param < 0) {
    nearestPt = p1;
  } else if (param > 1) {
    nearestPt = p2;
  } else {
    nearestPt = { x: p1.x + param * diff.x, y: p1.y + param * diff.y };
  }
  // hack to account for lngtiude
  let diff2 = vecSubtract(point, nearestPt);
  diff2.y *= lngRatio;
  return vecLength(diff2);
}

// substracts two vectors
function vecSubtract(v1, v2) {
  return { x: v1.x - v2.x, y: v1.y - v2.y };
}

function vecAdd(v1, v2) {
  return { x: v1.x + v2.x, y: v1.y + v2.y };
}
function vecNormalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return { x: v.x / len, y: v.y / len };
}

function arrayToVec(arr) {
  return { x: arr[0], y: arr[1] };
}

// dot product of two vectors
function vecDot(v1, v2) {
  return v1.x * v2.x + v1.y * v2.y;
}

function vecLength(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function vecScale(v, s) {
  return { x: v.x * s, y: v.y * s };
}
