import * as L from 'leaflet';

interface Node {
  id: number;
  lat: number;
  lon: number;
}

interface Way {
  nodes: number[];
  tags: {
    highway?: string;
  };
}

interface OverpassResponse {
  elements: (Node | Way | any)[];
}

let allRoads: [Vec, Vec][] = [];
let allMeters: { coords: [number, number]; gfx: L.Circle }[] = [];
let parkingBlocks: { [key: string]: L.Polygon } = {};

const starting_lat = 43.53255820104378; // hard-coded for now
const starting_lng = -80.23672699928285;

const bbox: [number, number][] = [
  [43.543523, -80.225332],
  [43.511111, -80.250074],
];

const latkm = 110.574;
const lngkm = 111.32 * Math.cos((starting_lat * Math.PI) / 180);
const conversionFactor = lngkm / latkm;

const map = L.map("map", { attributionControl: false }).setView([starting_lat, starting_lng], 17);
const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 99,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

map.on("click", onMapClick);
document.getElementById("make-blocks-button")?.addEventListener("click", onMakeBlocksButton_Clicked);

fetchDataInBoundingBox(bbox)
  .then((data) => {
    data.nodes.forEach((coord: Node) => {
      L.circle([coord.lat, coord.lon], {
        color: "#ff7800",
        weight: 1,
        radius: 5,
      }).addTo(map);
    });

    data.ways.forEach((way: Way) => {
      let coords = way.nodes.map((nodeId) => {
        const coord = data.nodes.find((coord: Node) => coord.id === nodeId);
        if (!coord) {
          return [-1, -1] as [number, number];
        }
        return [coord.lat, coord.lon] as [number, number];
      });

      coords = coords.filter((coord) => coord[0] !== null) as [number, number][];

      if (coords.length > 1 && way.tags.highway) {
        for (let i = 0; i < coords.length - 1; i++) {
          allRoads.push([
            convertMapToVec(coords[i]),
            convertMapToVec(coords[i + 1]),
          ]);
          L.polyline([coords[i], coords[i + 1]], {
            color: "#00ff00",
            weight: 1,
          }).addTo(map);
        }
      }
    });
  })
  .catch((error) => console.error(error));

function onMapClick(e: L.LeafletMouseEvent) {
  let c = L.circle([e.latlng.lat, e.latlng.lng], {
    color: "green",
    weight: 10,
    radius: 1,
  }).addTo(map);

  allMeters.push({ coords: [e.latlng.lat, e.latlng.lng], gfx: c });
}

function onMakeBlocksButton_Clicked() {
  for (let key in parkingBlocks) {
    map.removeLayer(parkingBlocks[key]);
  }
  parkingBlocks = {};

  allMeters.forEach((meter) => {
    addBlockForMeter(meter.coords[0], meter.coords[1]);
  });
}

function addBlockForMeter(lat: number, lng: number) {
  let meterLocation = convertMapToVec([lat, lng]);

  let closestRoad = allRoads.reduce((prev, curr) => {
    const prevDist = distancePointToLineSegment(meterLocation, prev);
    const currDist = distancePointToLineSegment(meterLocation, curr);
    return prevDist < currDist ? prev : curr;
  });
  let distanceToRoad = distancePointToLineSegment(meterLocation, closestRoad);

  let roadDirection = vecSubtract(closestRoad[1], closestRoad[0]);
  roadDirection = vecNormalize(roadDirection);

  let normal = vecNormalize({ x: -roadDirection.y, y: roadDirection.x });

  let diff = vecSubtract(meterLocation, closestRoad[0]);
  let dot = vecDot(diff, normal);
  let reversed = dot < 0;
  if (reversed) {
    normal = vecScale(normal, -1);
  }

  let key = `${closestRoad[0].x},${closestRoad[0].y},${closestRoad[1].x}, ${closestRoad[1].y} :${reversed}`;
  if (key in parkingBlocks) {
    return;
  }

  const blockSize = 10 / 111139;

  let start = vecAdd(
    closestRoad[0],
    vecAdd(
      vecScale(normal, distanceToRoad),
      vecScale(roadDirection, distanceToRoad)
    )
  );
  let start2 = vecAdd(start, vecScale(normal, blockSize));
  let end = vecAdd(
    closestRoad[1],
    vecAdd(
      vecScale(normal, distanceToRoad),
      vecScale(roadDirection, -distanceToRoad)
    )
  );
  let end2 = vecAdd(end, vecScale(normal, blockSize));

  const polygon = L.polygon(
    [
      convertVecToMap(start),
      convertVecToMap(end),
      convertVecToMap(end2),
      convertVecToMap(start2),
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

function fetchDataInBoundingBox(bbox: [number, number][]) {
  bbox.sort((a, b) => a[0] - b[0]);
  const url = `https://overpass-api.de/api/interpreter?data=[out:json];(way["highway"](${bbox});>;);out;`;

  return fetchWithCaching(url).then((data) => {
    let returnData: { nodes: Node[]; ways: Way[]; relations: any[] } = {
      nodes: data.elements.filter((element: any) => element.type === "node"),
      ways: data.elements.filter((element: any) => element.type === "way"),
      relations: data.elements.filter(
        (element: any) => element.type === "relation"
      ),
    };

    return returnData;
  });
}

function fetchWithCaching(url: string) {
  if ("caches" in window && false) {
    return caches.match(url).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse.json();
      } else {
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
    return fetch(url).then((response) => response.json());
  }
}

function distancePointToLineSegment(point: Vec, segment: [Vec, Vec]): number {
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

  let diff2 = vecSubtract(point, nearestPt);
  return vecLength(diff2);
}

interface Vec {
  x: number;
  y: number;
}

function vecSubtract(v1: Vec, v2: Vec): Vec {
  return { x: v1.x - v2.x, y: v1.y - v2.y };
}

function vecAdd(v1: Vec, v2: Vec): Vec {
  return { x: v1.x + v2.x, y: v1.y + v2.y };
}

function vecNormalize(v: Vec): Vec {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return { x: v.x / len, y: v.y / len };
}

function arrayToVec(arr: [number, number]): Vec {

  return { x: arr[0], y: arr[1] };
}

function vecDot(v1: Vec, v2: Vec): number {
  return v1.x * v2.x + v1.y * v2.y;
}

function vecLength(v: Vec): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function vecScale(v: Vec, s: number): Vec {
  return { x: v.x * s, y: v.y * s };
}

function convertMapToVec([lat, lng]: [number, number]): Vec {
  return { x: lat, y: lng * conversionFactor };
}

function convertVecToMap({ x, y }: Vec): [number, number] {
  return [x, y / conversionFactor];
}

