import * as L from 'leaflet';
import { getDistance, getDistanceFromLine, getRhumbLineBearing } from 'geolib';

import IPSMeters from './ipsmeters.csv';



interface Node {
  id: number;
  lat: number;
  lon: number;
}

interface Way {
  nodes: number[];

  tags: {
    highway?: string;
    name?: string;
  };
}





const starting_lat = 37.87; // hard-coded for now
const starting_lng = -122.3;
const bbox: [number, number][] = [
  [37.895988598965666, -122.23663330078126],
  [37.84178360198902, -122.3052978515625],
];

let allRoadSegments: [Node, Node][] = [];
let parkingBlocks: { [key: string]: L.Polygon } = {};
const meters = convertToObjectArray(IPSMeters);
// build meters subarea map


const map = L.map("map", { attributionControl: false }).setView([starting_lat, starting_lng], 17);
// Try to load the saved position

const savedPosition = loadMapPosition();
if (savedPosition) {
  map.setView([savedPosition.lat, savedPosition.lng], savedPosition.zoom);
}
map.on('moveend', () => saveMapPosition(map));

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 99,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

meters.forEach((meter: any) => {
  if (!meter.Latitude || !meter.Longitude) {
    console.log("Skipping meter with missing lat/long: ", meter);
    return;
  }
  L.circle([meter.Latitude, meter.Longitude], {
    color: "#ff7800",
    weight: 1,
    radius: 2,
  }).addTo(map).bindTooltip(`SubArea: ${meter.SubArea} Pole: ${meter.Pole}`);
});
function stripStreetName(input: string): string {
  // List of street types to remove
  const streetTypes = [
    "STREET", "ST", "AVENUE", "AVE", "ROAD", "RD", "BOULEVARD", "BLVD",
    "LANE", "LN", "DRIVE", "DR", "COURT", "CT", "PLACE", "PL", "TERRACE", "TER",
    "WAY", "CIRCLE", "CIR", "ALLEY", "ALY", "PARKWAY", "PKWY"
  ];

  // Convert to uppercase and remove numbers
  let result = input.toUpperCase().replace(/\d+/g, "");

  // Remove street types
  streetTypes.forEach(type => {
    result = result.replace(new RegExp(`\\b${type}\\.?\\b`, "g"), "");
  });

  // Remove extra spaces and trim
  result = result.replace(/\s+/g, " ").trim();

  return result;
}
const SubAreasWithMeters = new Set(
  meters.map(obj =>
    obj.SubArea ? stripStreetName(obj.SubArea)
      : ""
  )
);

console.log(SubAreasWithMeters);

map.on("click", onMapClick);
function onMapClick(e: L.LeafletMouseEvent) {
  // addBlockForMeter(e.latlng.lat, e.latlng.lng);
  // show current bounding box in console
  console.log(map.getBounds().toBBoxString());
}

document.getElementById("make-blocks-button")?.addEventListener("click", onMakeBlocksButton_Clicked);

function toLatLon(node: Node): [number, number] {
  return [node.lat, node.lon];
}

fetchDataInBoundingBox(bbox)
  .then((data) => {
    data.nodes.forEach((coord: Node) => {
      // L.circle([coord.lat, coord.lon], {
      //   color: "#ffff00",
      //   weight: 1,
      //   radius: 3,
      // }).addTo(map);
    });

    data.ways.forEach((way: Way) => {
      let coords: Node[] = [];
      way.nodes.forEach((nodeId) => {
        const coord = data.nodes.find((coord: Node) => coord.id === nodeId);
        if (coord) {
          coords.push(coord);
        }
      });

      if (way.tags.name && !SubAreasWithMeters.has(stripStreetName(way.tags.name))) {
        // console.log("Skipping way with no meters: ", way.tags.name);
        return;
      }

      if (coords.length > 1 && way.tags.highway != 'footway' && way.tags.highway != 'service'
        && way.tags.highway != 'path' && way.tags.highway != 'cycleway') {


        let tagString = Object.entries(way.tags)
          .map(([key, value]) => `${key}: ${value}`)
          .join('<br/>');

        for (let i = 0; i < coords.length - 1; i++) {
          allRoadSegments.push([coords[i], coords[i + 1]]);
          L.polyline([toLatLon(coords[i]), toLatLon(coords[i + 1])], {
            color: "#00ff00",
            weight: 4,
          }).addTo(map).bindTooltip(tagString);
        }
      }
    });
  })
  .catch((error) => console.error(error));



function onMakeBlocksButton_Clicked() {
  for (let key in parkingBlocks) {
    map.removeLayer(parkingBlocks[key]);
  }
  parkingBlocks = {};

}

function addBlockForMeter(lat: number, lng: number) {
  let meterLocation = { lng: lng, lat: lat };

  let distanceToRoad = -1;
  let closestRoad: [Node, Node] | null = null;
  allRoadSegments.forEach((road) => {
    let dist = getDistanceFromLine(meterLocation, road[0], road[1]);
    if (distanceToRoad === -1 || dist < distanceToRoad) {
      distanceToRoad = dist;
      closestRoad = road;
    }
  });
  if (closestRoad === null) {
    return;
  }

  let roadDirection = getRhumbLineBearing(closestRoad[0], closestRoad[1]);
  let meterDirection = getRhumbLineBearing(closestRoad[0], meterLocation);
  console.log("roadDirection: " + roadDirection + " meterDirection: " + meterDirection);

  // const polygon = L.polygon(
  //   [
  //     convertVecToMap(start),
  //     convertVecToMap(end),
  //     convertVecToMap(end2),
  //     convertVecToMap(start2),
  //   ],
  //   {
  //     color: "#ff7800",
  //     weight: 2,
  //     fill: true,
  //     fillColor: "#ff0000",
  //     fillOpacity: 0.9,
  //   }
  // ).addTo(map);
  // parkingBlocks[key] = polygon;
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
  if ("caches" in window) {
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

function convertToObjectArray(csvData: string[][]): Record<string, string>[] {
  const [headers, ...rows] = csvData;

  return rows.map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

function saveMapPosition(map: L.Map) {
  const center = map.getCenter();
  const zoom = map.getZoom();
  localStorage.setItem('mapPosition', JSON.stringify({
    lat: center.lat,
    lng: center.lng,
    zoom: zoom
  }));
}
function loadMapPosition(): { lat: number; lng: number; zoom: number } | null {
  const savedPosition = localStorage.getItem('mapPosition');
  return savedPosition ? JSON.parse(savedPosition) : null;
}