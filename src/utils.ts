import { Node } from './types';

export function toLatLon(node: Node): [number, number] {
    return [node.lat, node.lon];
}

export function toLatLonFromObject(obj: { latitude: number, longitude: number }): [number, number] {
    return [obj.latitude, obj.longitude];
}