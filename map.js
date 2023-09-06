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
function vecSubtract(v1, v2) {
  return [v1[0] - v2[0], v1[1] - v2[1]];
}
function vecNormalize(v) {
  let len = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  return [v[0] / len, v[1] / len];
}

function addBlockForMeter(lat, lng) {
  // find closest road
  let closestRoad = allRoads.reduce((prev, curr) => {
    const prevDist = distancePointToLineSegment([lat, lng], prev);
    const currDist = distancePointToLineSegment([lat, lng], curr);
    return prevDist < currDist ? prev : curr;
  });

  let dist = distancePointToLineSegment([lat, lng], closestRoad);
  let roadDirection = vecSubtract(closestRoad[1], closestRoad[0]);
  roadDirection = vecNormalize(roadDirection);

  const blockSize = 11.5 / 111139; // 2.5 meters in degrees
  // get normal vector

  let normalX = -roadDirection[1] * lngRatio; // hack
  let normalY = roadDirection[0];

  // normalize normal
  let normalLen = Math.sqrt(normalX * normalX + normalY * normalY);
  normalX /= normalLen;
  normalY /= normalLen;

  let diffX = lat - closestRoad[0][0];
  let diffY = lng - closestRoad[0][1];
  diffY = diffY * lngRatio; // hack
  //normalize diff
  let diffLen = Math.sqrt(diffX * diffX + diffY * diffY);
  diffX /= diffLen;
  diffY /= diffLen;
  let dot = diffX * normalX + diffY * normalY;

  console.log(
    `normal: ${normalX}, ${normalY} dot: ${dot} diff: ${diffX}, ${diffY}`
  );
  let reversed = false;
  if (dot < 0) {
    normalX *= -1;
    normalY *= -1;
    reversed = true;
  }

  let key = `${closestRoad.join(",")}:${reversed}`;
  if (key in parkingBlocks) {
    return;
  }

  let startX = closestRoad[0][0] + normalX * dist - wayDirX * dist;
  let startY = closestRoad[0][1] + normalY * dist - wayDirY * dist;
  let sx2 = startX + normalX * blockSize;
  let sy2 = startY + normalY * blockSize;

  let endX = closestRoad[1][0] + normalX * dist + wayDirX * dist;
  let endY = closestRoad[1][1] + normalY * dist + wayDirY * dist;
  let ex2 = endX + normalX * blockSize;
  let ey2 = endY + normalY * blockSize;
  // const p = L.polyline(
  //   [
  //     [lat, lng],
  //     [lat + wayDirX * blockSize, lng + wayDirY * blockSize],
  //     [lat, lng],
  //     [lat + normalX * blockSize, lng + normalY * blockSize],
  //   ],
  //   { color: "#ff7800", weight: 2 }
  // ).addTo(map);

  const polygon = L.polygon(
    [
      [startX, startY],
      [endX, endY],
      [ex2, ey2],
      [sx2, sy2],
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
  console.log("closest way");
  console.log(closestRoad);
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
  // popup
  //   .setLatLng(e.latlng)
  //   .setContent(`You clicked the map at ${e.latlng.toString()}`)
  //   .openOn(map);

  // // find closes coord and display tags
  // const closestCoord = allCoords.reduce((prev, curr) => {
  //   const prevDist = Math.sqrt(
  //     Math.pow(prev.lat - e.latlng.lat, 2) +
  //       Math.pow(prev.lon - e.latlng.lng, 2)
  //   );
  //   const currDist = Math.sqrt(
  //     Math.pow(curr.lat - e.latlng.lat, 2) +
  //       Math.pow(curr.lon - e.latlng.lng, 2)
  //   );
  //   return prevDist < currDist ? prev : curr;
  // });
  // console.log(closestCoord);
  // let tags = closestCoord.tags;
  // // display popup with tags
  // popup
  //   .setLatLng(e.latlng)
  //   .setContent(`Tags: ${JSON.stringify(tags)}`)
  //   .openOn(map);
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

//   43.533523, -80.240074
//   43.531111, -80.235332
// sort bbox coordinates by latitude
bbox.sort((a, b) => a[0] - b[0]);

//   // draw bbox using leaflet
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
          allRoads.push([coords[i], coords[i + 1]]);
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
  const [x, y] = point;

  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dot = dx * (x - p1[0]) + dy * (y - p1[1]);
  const lenSq = dx * dx + dy * dy;
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let nearestX, nearestY;
  if (param < 0) {
    nearestX = p1[0];
    nearestY = p1[1];
  } else if (param > 1) {
    nearestX = p2[0];
    nearestY = p2[1];
  } else {
    nearestX = p1[0] + param * dx;
    nearestY = p1[1] + param * dy;
  }

  const dx2 = x - nearestX;
  const dy2 = (y - nearestY) * lngRatio; // hack to account for lngitude;
  return Math.sqrt(dx2 * dx2 + dy2 * dy2);
}
