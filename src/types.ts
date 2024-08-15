
export interface Node {
    id: number;
    lat: number;
    lon: number;
}

export interface Way {
    nodes: number[];
    id: number;

    tags: {
        highway?: string;
        name?: string;
    };
}

export interface RoadSegment {
    p0: Node;
    p1: Node;
    way: Way;
    nodeIndex: number;  // index of p0 in way.nodes
}

export interface RoadSegmentChain {
    segments: RoadSegment[];
}

export const enum Parity {
    EVEN,
    ODD
}
// 90 degree angle from the road. The direction of the road segment is from the first node to the last node. The perpendicular is eitehr clockwise or counter-clockwise to this direction.
export const enum PerpendicularDirection {
    CLOCKWISE,
    COUNTERCLOCKWISE
}
export interface Blockface {
    roadSegmentChain: RoadSegmentChain;
    sideOfStreetParity: Parity;
    perpendicularOffset: number;
    perpendicularDirection: PerpendicularDirection;
    startOffset: number;
    endOffset: number;
}
