// This file contains all the drawing functions for the tool
import * as L from 'leaflet';
import { getDistance, getDistanceFromLine, getRhumbLineBearing, getCenter, computeDestinationPoint } from 'geolib';

import { Blockface, Node, RoadSegment, PerpendicularDirection } from './types';
import { toLatLon, toLatLonFromObject } from './utils';

let map: L.Map;
let nodeLayer: L.LayerGroup;
let blockfaceLayer: L.LayerGroup;
let roadSegmentLayer: L.LayerGroup;
let meterLayer: L.LayerGroup;

export function hideNodes() {
    map.removeLayer(nodeLayer);
}
export function showNodes() {
    map.addLayer(nodeLayer);
}

export function hideRoadSegments() {
    map.removeLayer(roadSegmentLayer);
}
export function showRoadSegments() {
    map.addLayer(roadSegmentLayer);
}

export function hideBlockfaces() {
    map.removeLayer(blockfaceLayer);
}
export function showBlockfaces() {
    map.addLayer(blockfaceLayer);
}
export function hideMeters() {
    map.removeLayer(meterLayer);
}
export function showMeters() {
    map.addLayer(meterLayer);
}


export function setupMap() {
    const starting_lat = 37.87; // hard-coded for now
    const starting_lng = -122.3;
    map = L.map("map", { attributionControl: false }).setView([starting_lat, starting_lng], 17);
    const savedPosition = loadMapPosition();
    if (savedPosition) {
        map.setView([savedPosition.lat, savedPosition.lng], savedPosition.zoom);
    }
    map.on('moveend', () => saveMapPosition(map));

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 99,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
}
export function drawMeters(meters: Record<string, string>[]) {
    if (meterLayer) {
        return;
    }
    meterLayer = L.layerGroup().addTo(map);

    meters.forEach((meter) => {
        if (!meter.Latitude || !meter.Longitude) {
            console.log("Skipping meter with missing lat/long: ", meter);
            return;
        }
        L.circle([parseFloat(meter.Latitude), parseFloat(meter.Longitude)], {
            color: "#ff7800",
            weight: 1,
            radius: 2,
        }).addTo(meterLayer).bindTooltip(`SubArea: ${meter.SubArea} Pole: ${meter.Pole}`);
    });
}
export function drawBlockfaces(blockfaces: Blockface[]) {
    if (blockfaceLayer) {
        return;
    }
    blockfaceLayer = L.layerGroup().addTo(map);
    for (const blockface of blockfaces) {
        drawBlockface(blockfaceLayer, blockface);
    }
}


function drawBlockface(layer: L.LayerGroup, blockface: Blockface) {
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
        // console.log("Blockface too short", totalDistance, startOffset, endOffset);
        return;
    }
    let distanceDrawn = 0;

    for (let segment of segments) {
        const bearing = getRhumbLineBearing(segment.p0, segment.p1);
        const perpendicularBearing = bearing + (blockface.perpendicularDirection === PerpendicularDirection.CLOCKWISE ? 90 : -90);
        const perpendicularOffset = blockface.perpendicularOffset;
        const segmentLength = getDistance(segment.p0, segment.p1);
        // console.log("Segment length: ", segmentLength);
        if (distanceDrawn + segmentLength < startOffset) {
            // console.log("Skipping segment", distanceDrawn, segmentLength, startOffset);
            distanceDrawn += segmentLength;
            continue;
        }
        if (distanceDrawn < startOffset) {

            const startFraction = (startOffset - distanceDrawn) / segmentLength;
            // console.log("Drawing partial start", startFraction);
            const startPt = computeDestinationPoint(segment.p0, startFraction * segmentLength, bearing);
            polyLineFront.push(toLatLonFromObject(computeDestinationPoint(startPt, perpendicularOffset, perpendicularBearing)));
            polyLineBack.push(toLatLonFromObject(computeDestinationPoint(startPt, perpendicularOffset + BLOCKFACE_WIDTH, perpendicularBearing)));
        } else {

            // console.log("Drawing p0");
            polyLineFront.push(toLatLonFromObject(computeDestinationPoint(segment.p0, perpendicularOffset, perpendicularBearing)));
            polyLineBack.push(toLatLonFromObject(computeDestinationPoint(segment.p0, perpendicularOffset + BLOCKFACE_WIDTH, perpendicularBearing)));
        }

        if (distanceDrawn + segmentLength > totalDistance - endOffset) {
            // console.log("Drawing partial end", distanceDrawn, segmentLength, totalDistance, endOffset);
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
    }).addTo(layer).bindTooltip(`Blockface- Street: ${blockface.roadSegmentChain.segments[0].way.tags.name}<br/> 
        Parity: ${blockface.sideOfStreetParity === 0 ? "EVEN" : "ODD"}<br/>`);


}

export function drawRoadSegments(roadSegments: RoadSegment[]) {
    if (roadSegmentLayer) {
        return;
    }
    roadSegmentLayer = L.layerGroup().addTo(map);
    roadSegments.forEach((roadSegment: RoadSegment) => {
        let tagString = Object.entries(roadSegment.way.tags)
            .map(([key, value]) => `${key}: ${value}`)
            .join('<br/>');
        L.polyline([toLatLon(roadSegment.p0), toLatLon(roadSegment.p1)], {
            color: "#00ff00",
            weight: 4,
        }).addTo(roadSegmentLayer).bindTooltip(`#${roadSegment.nodeIndex}->${(roadSegment.nodeIndex + 1)}<br/>${roadSegment.way.id}<br/>` + tagString);
    });
}
export function drawNodes(nodes: Node[]) {
    if (nodeLayer) {
        return;
    }
    nodeLayer = L.layerGroup().addTo(map);
    nodes.forEach((coord: Node) => {
        L.circle([coord.lat, coord.lon], {
            color: "#000000",
            weight: 1,
            radius: 1,
        }).addTo(nodeLayer).bindTooltip(`Node: ${coord.id}`);
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

// map.on("click", onMapClick);
// function onMapClick(e: L.LeafletMouseEvent) {
//   // addBlockForMeter(e.latlng.lat, e.latlng.lng);
//   // show current bounding box in console
//   console.log(map.getBounds().toBBoxString());
// }