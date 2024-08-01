import * as L from 'leaflet';
import { getDistance, getDistanceFromLine, getRhumbLineBearing, getCenter, computeDestinationPoint } from 'geolib';

import IPSMeters from './ipsmeters.csv';


interface Node {
  id: number;
  lat: number;
  lon: number;
}

interface Way {
  nodes: number[];
  id: number;

  tags: {
    highway?: string;
    name?: string;
  };
}

interface RoadSegment {
  p0: Node;
  p1: Node;
  way: Way;
}

interface RoadSegmentChain {
  segments: RoadSegment[];
}

const enum Parity {
  EVEN,
  ODD
}
const enum PerpendicularDirection {
  CLOCKWISE,
  COUNTERCLOCKWISE
}
interface Blockface {
  roadSegmentChain: RoadSegmentChain;
  sideOfStreetParity: Parity;
  perpendicularOffset: number;
  perpendicularDirection: PerpendicularDirection;
  startOffset: number;
  endOffset: number;
}



const starting_lat = 37.87; // hard-coded for now
const starting_lng = -122.3;
const bbox: [number, number][] = [  // bounding box for Berkeley
  [37.895988598965666, -122.23663330078126],
  [37.84178360198902, -122.3052978515625],
];

let possibleMeterRoadSegments: RoadSegment[] = [];
let possibleMeterRoadSegmentsByName: { [key: string]: RoadSegment[] } = {};
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
  input = input.toUpperCase().replace("9TH", "NINTH");
  // List of street types to remove
  const streetTypes = [
    "STREET", "ST", "AVENUE", "AVE", "ROAD", "RD", "BOULEVARD", "BLVD",
    "LANE", "LN", "DRIVE", "DR", "COURT", "CT", "PLACE", "PL", "TERRACE", "TER",
    "WAY", "CIRCLE", "CIR", "ALLEY", "ALY", "PARKWAY", "PKWY"
  ];

  // Convert to uppercase and remove numbers
  let result = input.replace(/\d+/g, "");

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

function toLatLonFromObject(obj: { latitude: number, longitude: number }): [number, number] {
  return [obj.latitude, obj.longitude];
}
async function main() {
  const nodeToRoadSegmentMap = new Map<number, RoadSegment[]>();
  function addNodeToRoadSegmentMap(node: Node, roadSegment: RoadSegment) {
    if (!nodeToRoadSegmentMap.has(node.id)) {
      nodeToRoadSegmentMap.set(node.id, []);
    }
    nodeToRoadSegmentMap.get(node.id)?.push(roadSegment);
  }

  await fetchDataInBoundingBox(bbox)
    .then((data) => {
      data.nodes.forEach((coord: Node) => {
        // L.circle([coord.lat, coord.lon], {
        //   color: "#000000",
        //   weight: 1,
        //   radius: 1,
        // }).addTo(map).bindTooltip(`Node: ${coord.id}`);
      });

      data.ways.forEach((way: Way) => {
        let coords: Node[] = [];
        way.nodes.forEach((nodeId) => {
          const coord = data.nodes.find((coord: Node) => coord.id === nodeId);
          if (coord) {
            coords.push(coord);
          }
        });


        const couldHaveMeters = !way.tags.name || SubAreasWithMeters.has(stripStreetName(way.tags.name));

        if (coords.length > 1 && way.tags.highway != 'footway' && way.tags.highway != 'service'
          && way.tags.highway != 'path' && way.tags.highway != 'cycleway') {


          let tagString = Object.entries(way.tags)
            .map(([key, value]) => `${key}: ${value}`)
            .join('<br/>');

          for (let i = 0; i < coords.length - 1; i++) {
            let roadSegment = { way: way, p0: coords[i], p1: coords[i + 1] };
            if (couldHaveMeters) {
              possibleMeterRoadSegments.push(roadSegment);
              // L.polyline([toLatLon(coords[i]), toLatLon(coords[i + 1])], {
              //   color: "#00ff00",
              //   weight: 4,
              // }).addTo(map).bindTooltip(`#${i}->${(i + 1)}<br/>${way.id}<br/>` + tagString);
            }

            addNodeToRoadSegmentMap(coords[i], roadSegment);
            addNodeToRoadSegmentMap(coords[i + 1], roadSegment);

          }
        }
      });
    })
    .catch((error) => console.error(error));

  // Build a map of road segments by name
  possibleMeterRoadSegments.forEach((roadSegment) => {
    const name = stripStreetName(roadSegment.way.tags.name || "");
    if (!possibleMeterRoadSegmentsByName[name]) {
      possibleMeterRoadSegmentsByName[name] = [];
    }
    possibleMeterRoadSegmentsByName[name].push(roadSegment);
  });


  const targetPole = "";  // for debugging purposes, leave empty if you want to see all meters
  const meterRoadSegments = new Set<RoadSegment>();
  const meterSegmentPairs: [any, RoadSegment][] = [];

  // find closest segments for each meter
  for (const targetMeter of meters) {
    if (targetPole.length > 0 && targetMeter.Pole !== targetPole) {
      continue;
    }
    if (targetMeter && targetMeter.SubArea) {
      const targetSubArea = stripStreetName(targetMeter.SubArea);
      //console.log("Target subarea: ", targetSubArea);
      const roadSegments = possibleMeterRoadSegmentsByName[targetSubArea];
      //console.log("Road segments: ", roadSegments);
      if (roadSegments) {
        let closestSegment: RoadSegment | null = null;
        let closestDist = -1;
        let centerOfSegment: { latitude: number, longitude: number } = { latitude: 0, longitude: 0 };

        roadSegments.forEach(roadSegment => {
          let center = getCenter([roadSegment.p0, roadSegment.p1]);
          if (center) {
            const dist = getDistanceFromLine(meterToGeoLib(targetMeter), roadSegment.p0, roadSegment.p1);
            if (closestDist < 0 || dist < closestDist) {
              closestDist = dist;
              closestSegment = roadSegment;
              centerOfSegment = getCenter([roadSegment.p0, roadSegment.p1]) || centerOfSegment;
            }

          }
        });
        if (closestSegment && centerOfSegment.latitude != 0 && closestDist < 100) {
          meterRoadSegments.add(closestSegment);
          meterSegmentPairs.push([targetMeter, closestSegment]);
          // L.polyline([meterToLatLon(targetMeter), [centerOfSegment.latitude, centerOfSegment.longitude]], {
          //   color: "#ff0000",
          //   weight: 4,
          // }).addTo(map);
        }
      }
    }
  }

  // create road segment chains
  const chainSegmentMap = new Map<RoadSegment, RoadSegmentChain>();
  for (const segment of meterRoadSegments) {
    if (chainSegmentMap.has(segment)) { // chain already exists
      continue;
    }
    const chain = createRoadSegmentChain(segment, nodeToRoadSegmentMap);
    console.log("Chain: ", chain);
    chainSegmentMap.set(segment, chain);
  }

  const blockfaces: Blockface[] = [];
  // create blockfaces
  for (const [meter, segment] of meterSegmentPairs) {
    const poleName = meter.Pole;
    // determine if pole name is even or odd based on last character in polename
    const lastChar = poleName[poleName.length - 1];
    const parity = lastChar % 2 == 0 ? Parity.EVEN : Parity.ODD;
    const chain = chainSegmentMap.get(segment);
    if (!chain) {
      console.log("No chain for segment", segment);
      continue;
    }
    // see if blockface exists with same chain and parity
    const existingBlockface = blockfaces.find(blockface => blockface.roadSegmentChain === chain && blockface.sideOfStreetParity === parity);
    if (existingBlockface) {
      continue;
    }
    const roadBearing = getRhumbLineBearing(segment.p0, segment.p1);
    const meterBearing = getRhumbLineBearing(segment.p0, meterToGeoLib(meter));
    // Calculate the difference
    let diff = meterBearing - roadBearing;

    // Normalize the difference to be between -180 and 180
    if (diff > 180) {
      diff -= 360;
    } else if (diff < -180) {
      diff += 360;
    }

    // create new blockface
    blockfaces.push({
      roadSegmentChain: chain,
      sideOfStreetParity: parity,
      perpendicularDirection: diff > 0 ? PerpendicularDirection.CLOCKWISE : PerpendicularDirection.COUNTERCLOCKWISE,
      perpendicularOffset: 3,
      startOffset: 8,
      endOffset: 8
    });
  }

  for (const blockface of blockfaces) {
    drawBlockface(map, blockface);
  }

}

function drawBlockface(map: L.Map, blockface: Blockface) {
  const segments = blockface.roadSegmentChain.segments;
  const BLOCKFACE_WIDTH = 5;
  const polyLineFront = [];
  const polyLineBack = [];
  const lastSegment = segments[segments.length - 1];
  let startOffset = blockface.startOffset;
  let endOffset = blockface.endOffset;
  let totalDistance = 0;
  for (let segment of segments) {
    totalDistance += getDistance(segment.p0, segment.p1);
  }
  if (totalDistance < startOffset + endOffset) {
    console.log("Blockface too short", totalDistance, startOffset, endOffset);
    return;
  }
  let distanceDrawn = 0;

  for (let segment of segments) {
    const bearing = getRhumbLineBearing(segment.p0, segment.p1);
    const perpendicularBearing = bearing + (blockface.perpendicularDirection === PerpendicularDirection.CLOCKWISE ? 90 : -90);
    const perpendicularOffset = blockface.perpendicularOffset;
    const segmentLength = getDistance(segment.p0, segment.p1);
    console.log("Segment length: ", segmentLength);
    if (distanceDrawn + segmentLength < startOffset) {
      console.log("Skipping segment", distanceDrawn, segmentLength, startOffset);
      distanceDrawn += segmentLength;
      continue;
    }
    if (distanceDrawn < startOffset) {

      const startFraction = (startOffset - distanceDrawn) / segmentLength;
      console.log("Drawing partial start", startFraction);
      const startPt = computeDestinationPoint(segment.p0, startFraction * segmentLength, bearing);
      polyLineFront.push(toLatLonFromObject(computeDestinationPoint(startPt, perpendicularOffset, perpendicularBearing)));
      polyLineBack.push(toLatLonFromObject(computeDestinationPoint(startPt, perpendicularOffset + BLOCKFACE_WIDTH, perpendicularBearing)));
    } else {

      console.log("Drawing p0");
      polyLineFront.push(toLatLonFromObject(computeDestinationPoint(segment.p0, perpendicularOffset, perpendicularBearing)));
      polyLineBack.push(toLatLonFromObject(computeDestinationPoint(segment.p0, perpendicularOffset + BLOCKFACE_WIDTH, perpendicularBearing)));
    }

    if (distanceDrawn + segmentLength > totalDistance - endOffset) {
      console.log("Drawing partial end", distanceDrawn, segmentLength, totalDistance, endOffset);
      const endFraction = (totalDistance - endOffset - distanceDrawn) / segmentLength;
      const endPt = computeDestinationPoint(segment.p0, endFraction * segmentLength, bearing);
      polyLineFront.push(toLatLonFromObject(computeDestinationPoint(endPt, perpendicularOffset, perpendicularBearing)));
      polyLineBack.push(toLatLonFromObject(computeDestinationPoint(endPt, perpendicularOffset + BLOCKFACE_WIDTH, perpendicularBearing)));
      break;
    }
    distanceDrawn += segmentLength;

  }

  // merge the two arrays with the back array reversed
  const polyLine = polyLineFront.concat(polyLineBack.reverse());


  L.polygon(polyLine, {
    color: "#0000ff",
    weight: 2,
    fill: true,
    fillColor: "#00ffff",
    fillOpacity: 0.8,
  }).addTo(map);


}

function createRoadSegmentChain(middleSegment: RoadSegment, nodeToRoadSegmentMap: Map<number, RoadSegment[]>): RoadSegmentChain {

  // go backwards to start of chain
  let backwardSegments = findEndOfChain(middleSegment.p0, middleSegment, true, nodeToRoadSegmentMap);
  let startSegment = backwardSegments[backwardSegments.length - 1];
  let startNode = startSegment.p1;
  // now go forwards to end of chain
  let segments = findEndOfChain(startNode, startSegment, false, nodeToRoadSegmentMap);
  return { segments: segments };
}

function findEndOfChain(startNode: Node, startSegment: RoadSegment, traverseBackwards: boolean, nodeToRoadSegmentMap: Map<number, RoadSegment[]>) {
  let currentNode = startNode;
  let currentSegment = startSegment;
  let segmentChain: RoadSegment[] = [currentSegment];

  while (true) {
    let attachedSegments = nodeToRoadSegmentMap.get(currentNode.id);
    if (attachedSegments?.length !== 2) {
      // console.log("Node has more than 2 segments", currentNode, attachedSegments);
      break;
    }

    let result = attachedSegments.find((attachedSegment) => { // find the other segment
      if (attachedSegment !== currentSegment) {
        if (attachedSegment.way.tags.name !== currentSegment.way.tags.name) {
          console.log("Different street name", attachedSegment.way.tags.name, currentSegment.way.tags.name);
          return false;
        }
        let possibleNextNode = attachedSegment.p0;
        if (!traverseBackwards) {
          possibleNextNode = attachedSegment.p1;
        }

        if (currentNode == possibleNextNode) {
          console.log("Reversed segment-- this should not happen", currentNode, attachedSegment);
          return false;
        }
        currentNode = possibleNextNode;
        currentSegment = attachedSegment;
        segmentChain.push(currentSegment);
        // console.log("Found next segment", currentNode, attachedSegments);
        return true;
      }
      return false;
    });
    if (!result) {
      console.log("Could not find next segment", currentNode, attachedSegments);
      break;
    }
    if (currentNode.id === startNode.id) {
      console.log("Found start node-- probable cycle", currentNode, attachedSegments);
      break;
    }
  }
  return segmentChain;
}

main();
function meterToLatLon(meter: any): [number, number] {
  return [parseFloat(meter.Latitude), parseFloat(meter.Longitude)];
}
function meterToGeoLib(meter: any) {
  return { latitude: parseFloat(meter.Latitude), longitude: parseFloat(meter.Longitude) };
}


function onMakeBlocksButton_Clicked() {
  for (let key in parkingBlocks) {
    map.removeLayer(parkingBlocks[key]);
  }
  parkingBlocks = {};

}

// function addBlockForMeter(lat: number, lng: number) {
//   let meterLocation = { lng: lng, lat: lat };

//   let distanceToRoad = -1;
//   let closestRoad: [Node, Node] | null = null;
//   allRoadSegments.forEach((road) => {
//     let dist = getDistanceFromLine(meterLocation, road[0], road[1]);
//     if (distanceToRoad === -1 || dist < distanceToRoad) {
//       distanceToRoad = dist;
//       closestRoad = road;
//     }
//   });
//   if (closestRoad === null) {
//     return;
//   }

//   let roadDirection = getRhumbLineBearing(closestRoad[0], closestRoad[1]);
//   let meterDirection = getRhumbLineBearing(closestRoad[0], meterLocation);
//   console.log("roadDirection: " + roadDirection + " meterDirection: " + meterDirection);

//   // const polygon = L.polygon(
//   //   [
//   //     convertVecToMap(start),
//   //     convertVecToMap(end),
//   //     convertVecToMap(end2),
//   //     convertVecToMap(start2),
//   //   ],
//   //   {
//   //     color: "#ff7800",
//   //     weight: 2,
//   //     fill: true,
//   //     fillColor: "#ff0000",
//   //     fillOpacity: 0.9,
//   //   }
//   // ).addTo(map);
//   // parkingBlocks[key] = polygon;
// }

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