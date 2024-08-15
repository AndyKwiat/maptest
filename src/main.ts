
import { getDistance, getDistanceFromLine, getRhumbLineBearing, getCenter, computeDestinationPoint } from 'geolib';

import IPSMeters from './ipsmeters.csv';
import {
  drawMeters, drawNodes, drawRoadSegments, drawBlockfaces, setupMap,
  showNodes, hideNodes, showRoadSegments, hideRoadSegments, showBlockfaces, hideBlockfaces, showMeters, hideMeters
} from './gfx';

import { RoadSegment, RoadSegmentChain, Parity, PerpendicularDirection, Node, Blockface, Way } from './types';
import { statusLog, toLatLon } from './utils';



const bbox: [number, number][] = [  // bounding box for Berkeley
  [37.895988598965666, -122.23663330078126],
  [37.84178360198902, -122.3052978515625],
];
statusLog("setting up map");
setupMap();

let possibleMeterRoadSegments: RoadSegment[] = [];
let possibleMeterRoadSegmentsByName: { [key: string]: RoadSegment[] } = {};

statusLog("adding meters");
const meters = convertToObjectArray(IPSMeters);
drawMeters(meters);

function stripStreetName(input: string): string {
  input = input.toUpperCase();
  input = input.replace("9TH", "NINTH");
  input = input.replace("- GB", "").replace("MS1", "").replace(" GB", "");
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


// General handler for all checkboxes
function checkboxHandler(event: Event) {
  const target = event.target as HTMLInputElement;
  const isChecked = target.checked;

  switch (target.value) {
    case "Nodes":
      isChecked ? showNodes() : hideNodes();
      break;
    case "RoadSegments":
      isChecked ? showRoadSegments() : hideRoadSegments();
      break;
    case "Meters":
      isChecked ? showMeters() : hideMeters();
      break;
    case "Blockfaces":
      isChecked ? showBlockfaces() : hideBlockfaces();
      break;
  }
}

// Attach the handler to all checkboxes
document.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
  checkbox.addEventListener("change", checkboxHandler);
});



async function main() {

  const nodeToRoadSegmentMap = new Map<number, RoadSegment[]>();
  function addNodeToRoadSegmentMap(node: Node, roadSegment: RoadSegment) {
    if (!nodeToRoadSegmentMap.has(node.id)) {
      nodeToRoadSegmentMap.set(node.id, []);
    }
    nodeToRoadSegmentMap.get(node.id)?.push(roadSegment);
  }

  statusLog("fetching open street map data");
  await fetchDataInBoundingBox(bbox)
    .then((data) => {
      statusLog("drawing nodes");
      drawNodes(data.nodes);


      console.log("Data: ", data);

      statusLog("calculating road segments");
      data.ways.forEach((way: Way) => {
        let coords: Node[] = [];
        way.nodes.forEach((nodeId) => {
          const coord = data.nodes.find((coord: Node) => coord.id === nodeId);
          if (coord) {
            coords.push(coord);
          }
        });


        const couldHaveMeters = !way.tags.name || SubAreasWithMeters.has(stripStreetName(way.tags.name));
        const excludedHighways = ['footway', 'service', 'path', 'cycleway', 'steps', 'pedestrian', 'corridor']; //, 'track', 'bridleway', 'corridor', 'elevator', 'escalator', 'proposed', 'construction', 'bus_guideway', 'raceway', 'rest_area', 'services', 'unclassified', 'residential', 'living_street', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'road', 'crossing', 'platform', 'path', 'cycleway', 'footway', 'bridleway', 'steps', 'pedestrian', 'track', 'corridor', 'elevator', 'escalator', 'proposed', 'construction'];
        //const excludedHighways = ['test'];

        if (coords.length > 1
          && way.tags.highway && !excludedHighways.includes(way.tags.highway)
        ) {

          let tagString = Object.entries(way.tags)
            .map(([key, value]) => `${key}: ${value}`)
            .join('<br/>');

          for (let i = 0; i < coords.length - 1; i++) {
            let roadSegment = { way: way, p0: coords[i], p1: coords[i + 1], nodeIndex: i };
            if (couldHaveMeters) {
              possibleMeterRoadSegments.push(roadSegment);
            }

            addNodeToRoadSegmentMap(coords[i], roadSegment);
            addNodeToRoadSegmentMap(coords[i + 1], roadSegment);

          }
        }
      });
    })
    .catch((error) => console.error(error));

  drawRoadSegments(possibleMeterRoadSegments);

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

  statusLog("finding closest road segments to each meter");
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

  statusLog("creating road segment chains");
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

  statusLog("creating blockfaces");
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

  drawBlockfaces(blockfaces);
  statusLog("done");

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

