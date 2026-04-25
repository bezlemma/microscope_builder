import type { KernelTraceComponent } from './kernelTypes';
import type { HitRecord, Ray } from './types';

interface Bounds {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

interface Item extends Bounds {
    componentIndex: number;
    cx: number;
    cy: number;
    cz: number;
}

interface Node extends Bounds {
    left: number;
    right: number;
    start: number;
    count: number;
}

export interface AcceleratedHit {
    nearestT: number;
    nearestHit: HitRecord | null;
    nearestComponent: KernelTraceComponent | null;
    nearestComponentIndex: number;
    testedComponentIndices: Set<number>;
}

const LEAF_SIZE = 4;

function emptyBounds(): Bounds {
    return {
        minX: Infinity, minY: Infinity, minZ: Infinity,
        maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
    };
}

function expandBounds(target: Bounds, bounds: Bounds): void {
    if (bounds.minX < target.minX) target.minX = bounds.minX;
    if (bounds.minY < target.minY) target.minY = bounds.minY;
    if (bounds.minZ < target.minZ) target.minZ = bounds.minZ;
    if (bounds.maxX > target.maxX) target.maxX = bounds.maxX;
    if (bounds.maxY > target.maxY) target.maxY = bounds.maxY;
    if (bounds.maxZ > target.maxZ) target.maxZ = bounds.maxZ;
}

function rayAabbTNear(ray: Ray, bounds: Bounds, maxDistance: number): number | null {
    let tMin = -Infinity;
    let tMax = Math.min(maxDistance, Infinity);

    const axes = [
        [ray.origin.x, ray.direction.x, bounds.minX, bounds.maxX],
        [ray.origin.y, ray.direction.y, bounds.minY, bounds.maxY],
        [ray.origin.z, ray.direction.z, bounds.minZ, bounds.maxZ],
    ] as const;

    for (const [origin, direction, min, max] of axes) {
        if (Math.abs(direction) < 1e-12) {
            if (origin < min || origin > max) return null;
            continue;
        }
        const inv = 1 / direction;
        let t1 = (min - origin) * inv;
        let t2 = (max - origin) * inv;
        if (t1 > t2) {
            const tmp = t1;
            t1 = t2;
            t2 = tmp;
        }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return null;
    }

    if (tMax <= 0.001) return null;
    return Math.max(0, tMin);
}

export class TraceSceneAccelerator {
    private readonly items: Item[];
    private readonly nodes: Node[] = [];

    constructor(private readonly components: KernelTraceComponent[]) {
        this.items = components.map((component, componentIndex) => {
            const b = component.worldBounds;
            return {
                componentIndex,
                minX: b.minX,
                minY: b.minY,
                minZ: b.minZ,
                maxX: b.maxX,
                maxY: b.maxY,
                maxZ: b.maxZ,
                cx: (b.minX + b.maxX) * 0.5,
                cy: (b.minY + b.maxY) * 0.5,
                cz: (b.minZ + b.maxZ) * 0.5,
            };
        });
        if (this.items.length > 0) this.buildNode(0, this.items.length);
    }

    findNearest(
        ray: Ray,
        originatorId?: string,
        maxDistance: number = Infinity,
        skipComponentIndices?: Set<number>,
    ): AcceleratedHit {
        let nearestT = maxDistance;
        let nearestHit: HitRecord | null = null;
        let nearestComponent: KernelTraceComponent | null = null;
        let nearestComponentIndex = -1;
        const testedComponentIndices = new Set<number>();

        if (this.nodes.length === 0) {
            return { nearestT, nearestHit, nearestComponent, nearestComponentIndex, testedComponentIndices };
        }

        const stack: { nodeIndex: number; tNear: number }[] = [{ nodeIndex: 0, tNear: 0 }];
        while (stack.length > 0) {
            const entry = stack.pop()!;
            if (entry.tNear > nearestT) continue;
            const node = this.nodes[entry.nodeIndex];
            const nodeT = rayAabbTNear(ray, node, nearestT);
            if (nodeT === null || nodeT > nearestT) continue;

            if (node.count > 0) {
                for (let i = node.start; i < node.start + node.count; i++) {
                    const item = this.items[i];
                    if (skipComponentIndices?.has(item.componentIndex)) continue;
                    const component = this.components[item.componentIndex];
                    if (component.id === originatorId) continue;
                    const itemT = rayAabbTNear(ray, item, nearestT);
                    if (itemT === null || itemT > nearestT) continue;
                    testedComponentIndices.add(item.componentIndex);
                    const hit = component.chkIntersection(ray, nearestT);
                    if (hit && hit.t < nearestT && hit.t > 0.001) {
                        nearestT = hit.t;
                        nearestHit = hit;
                        nearestComponent = component;
                        nearestComponentIndex = item.componentIndex;
                    }
                }
                continue;
            }

            const left = this.nodes[node.left];
            const right = this.nodes[node.right];
            const leftT = rayAabbTNear(ray, left, nearestT);
            const rightT = rayAabbTNear(ray, right, nearestT);

            if (leftT !== null && rightT !== null) {
                if (leftT < rightT) {
                    stack.push({ nodeIndex: node.right, tNear: rightT });
                    stack.push({ nodeIndex: node.left, tNear: leftT });
                } else {
                    stack.push({ nodeIndex: node.left, tNear: leftT });
                    stack.push({ nodeIndex: node.right, tNear: rightT });
                }
            } else if (leftT !== null) {
                stack.push({ nodeIndex: node.left, tNear: leftT });
            } else if (rightT !== null) {
                stack.push({ nodeIndex: node.right, tNear: rightT });
            }
        }

        return { nearestT, nearestHit, nearestComponent, nearestComponentIndex, testedComponentIndices };
    }

    private buildNode(start: number, end: number): number {
        const nodeBounds = emptyBounds();
        const centroidBounds = emptyBounds();
        for (let i = start; i < end; i++) {
            const item = this.items[i];
            expandBounds(nodeBounds, item);
            if (item.cx < centroidBounds.minX) centroidBounds.minX = item.cx;
            if (item.cy < centroidBounds.minY) centroidBounds.minY = item.cy;
            if (item.cz < centroidBounds.minZ) centroidBounds.minZ = item.cz;
            if (item.cx > centroidBounds.maxX) centroidBounds.maxX = item.cx;
            if (item.cy > centroidBounds.maxY) centroidBounds.maxY = item.cy;
            if (item.cz > centroidBounds.maxZ) centroidBounds.maxZ = item.cz;
        }

        const nodeIndex = this.nodes.length;
        const count = end - start;
        this.nodes.push({ ...nodeBounds, left: -1, right: -1, start, count: 0 });

        if (count <= LEAF_SIZE) {
            this.nodes[nodeIndex].start = start;
            this.nodes[nodeIndex].count = count;
            return nodeIndex;
        }

        const spanX = centroidBounds.maxX - centroidBounds.minX;
        const spanY = centroidBounds.maxY - centroidBounds.minY;
        const spanZ = centroidBounds.maxZ - centroidBounds.minZ;
        const axis = spanX >= spanY && spanX >= spanZ ? 'cx' : spanY >= spanZ ? 'cy' : 'cz';
        this.items.slice(start, end).sort((a, b) => a[axis] - b[axis]).forEach((item, offset) => {
            this.items[start + offset] = item;
        });

        const mid = start + Math.floor(count / 2);
        const left = this.buildNode(start, mid);
        const right = this.buildNode(mid, end);
        this.nodes[nodeIndex].left = left;
        this.nodes[nodeIndex].right = right;
        return nodeIndex;
    }
}
