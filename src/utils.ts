import { Node } from './types';

export function toLatLon(node: Node): [number, number] {
    return [node.lat, node.lon];
}

export function toLatLonFromObject(obj: { latitude: number, longitude: number }): [number, number] {
    return [obj.latitude, obj.longitude];
}

export function statusLog(message: string) {
    const logContainer = document.getElementById('log');

    if (logContainer) {
        const logEntry = document.createElement('div');
        logEntry.textContent = message;
        logContainer.appendChild(logEntry);

        // Automatically scroll to the bottom of the log
        const logBox = document.getElementById('log-container');
        if (logBox) {
            logBox.scrollTop = logBox.scrollHeight;
        }
    }
}