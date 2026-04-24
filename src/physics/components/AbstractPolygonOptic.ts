import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { HitRecord, InteractionResult, Ray, childRay } from '../types';
import { OpticMesh, NormalFn } from '../OpticMesh';
import { reflectVector } from '../math_solvers';

type AxisIndex = 0 | 1 | 2;

export type PolygonFaceMode = 'refractive' | 'reflective' | 'absorbing';

interface PolygonOpticOptions {
    name: string;
    width: number;
    ior?: number;
    profileAxes: [AxisIndex, AxisIndex];
    extrusionAxis: AxisIndex;
    defaultFaceMode?: PolygonFaceMode;
}

function rotatePoint([a, b]: [number, number], angle: number): [number, number] {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [a * c - b * s, a * s + b * c];
}

function polygonCentroid(vertices: readonly [number, number][]): [number, number] {
    if (vertices.length === 0) return [0, 0];
    let sumA = 0;
    let sumB = 0;
    for (const [a, b] of vertices) {
        sumA += a;
        sumB += b;
    }
    return [sumA / vertices.length, sumB / vertices.length];
}

function normalizeVertices(vertices: readonly [number, number][]): [number, number][] {
    const [ca, cb] = polygonCentroid(vertices);
    return vertices.map(([a, b]) => [a - ca, b - cb] as [number, number]);
}

export abstract class AbstractPolygonOptic extends OpticalComponent {
    public vertices: [number, number][];
    public width: number;
    public ior: number;
    public faceROC: number[];
    public faceModes: PolygonFaceMode[];
    public scanAngle = 0;

    private readonly profileAxes: [AxisIndex, AxisIndex];
    private readonly extrusionAxis: AxisIndex;
    private readonly defaultFaceMode: PolygonFaceMode;
    private _mesh: OpticMesh | null = null;

    protected constructor(options: PolygonOpticOptions) {
        super(options.name);
        this.width = options.width;
        this.ior = options.ior ?? 1.5168;
        this.profileAxes = options.profileAxes;
        this.extrusionAxis = options.extrusionAxis;
        this.defaultFaceMode = options.defaultFaceMode ?? 'refractive';
        this.vertices = [];
        this.faceROC = [];
        this.faceModes = [];
        this.updateLocalBounds();
    }

    get numFaces(): number {
        return this.vertices.length;
    }

    public setVertices(vertices: [number, number][]): void {
        this.vertices = normalizeVertices(vertices);
        this.resizeFaceArrays(this.vertices.length);
        this.invalidateMesh();
    }

    public setRegularPolygon(numSides: number, inscribedRadius: number): void {
        const sides = Math.max(3, Math.round(numSides));
        const circumRadius = inscribedRadius / Math.cos(Math.PI / sides);
        const vertices: [number, number][] = [];
        for (let i = 0; i < sides; i++) {
            const angle = (2 * Math.PI * i) / sides;
            vertices.push([circumRadius * Math.cos(angle), circumRadius * Math.sin(angle)]);
        }
        this.setVertices(vertices);
    }

    /** Approximate inscribed radius (distance from center to nearest edge midpoint). */
    get inscribedRadius(): number {
        const verts = this.vertices;
        if (verts.length < 3) return 0;
        let minDist = Infinity;
        for (let i = 0; i < verts.length; i++) {
            const [ax, ay] = verts[i];
            const [bx, by] = verts[(i + 1) % verts.length];
            const mx = (ax + bx) / 2;
            const my = (ay + by) / 2;
            const dist = Math.sqrt(mx * mx + my * my);
            if (dist < minDist) minDist = dist;
        }
        return minDist;
    }

    public getProfileVertices(): [number, number][] {
        return this.vertices.map((vertex) => rotatePoint(vertex, this.scanAngle));
    }

    public getEditorProfileVertices(): [number, number][] {
        return this.getProfileVertices().map((vertex) => rotatePoint(vertex, this.getEditorDisplayRotation()));
    }

    public setDisplayedVertex(index: number, displayedVertex: [number, number]): void {
        if (index < 0 || index >= this.vertices.length) return;
        const unrotated = rotatePoint(displayedVertex, -this.scanAngle);
        const nextVertices = this.vertices.map((vertex, i) => (
            i === index ? unrotated : vertex
        ));
        this.setVertices(nextVertices);
    }

    public setEditorDisplayedVertex(index: number, displayedVertex: [number, number]): void {
        this.setDisplayedVertex(index, rotatePoint(displayedVertex, -this.getEditorDisplayRotation()));
    }

    public setFaceCurvature(index: number, radius: number): void {
        if (index < 0 || index >= this.faceROC.length) return;
        this.faceROC[index] = radius;
        this.invalidateMesh();
    }

    public applyScanAngle(angle: number): void {
        this.scanAngle = angle;
        this.invalidateMesh();
    }

    public buildDisplayGeometry(): BufferGeometry {
        const geometry = this.mesh.builtGeometry;
        return geometry ? geometry.clone() : this.buildGeometry();
    }

    public invalidateMesh(): void {
        this._mesh = null;
        this.updateLocalBounds();
        this.version++;
    }

    public get mesh(): OpticMesh {
        if (!this._mesh) {
            this._mesh = new OpticMesh();
            this._mesh.build(this.buildGeometry(), this.buildNormalFunction());
        }
        return this._mesh;
    }

    public intersect(rayLocal: Ray): HitRecord | null {
        const meshHit = this.mesh.intersectRay(rayLocal.origin, rayLocal.direction);
        if (!meshHit) return null;
        return {
            t: meshHit.t,
            point: meshHit.point,
            normal: meshHit.normal,
            localPoint: meshHit.point.clone(),
            surfaceIndex: meshHit.faceIndex,
        };
    }

    public interact(ray: Ray, hit: HitRecord): InteractionResult {
        const faceIdx = hit.surfaceIndex !== undefined ? this.classifyFaceIndex(hit.surfaceIndex) : -1;
        const faceMode = faceIdx >= 0 && faceIdx < this.faceModes.length ? this.faceModes[faceIdx] : this.defaultFaceMode;

        if (faceMode === 'reflective') {
            const reflectedDir = reflectVector(ray.direction, hit.normal);
            return {
                rays: [childRay(ray, {
                    origin: hit.point,
                    direction: reflectedDir,
                    polarization: {
                        x: { re: -ray.polarization.x.re, im: -ray.polarization.x.im },
                        y: { re: -ray.polarization.y.re, im: -ray.polarization.y.im },
                    },
                    opticalPathLength: ray.opticalPathLength + hit.t,
                })],
            };
        }

        if (faceMode === 'absorbing') {
            return { rays: [] };
        }

        const dirIn = hit.localDirection?.clone().normalize()
            ?? ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const normalIn = hit.localNormal?.clone().normalize()
            ?? hit.normal.clone().transformDirection(this.worldToLocal).normalize();

        return this.mesh.interact(
            normalIn,
            dirIn,
            hit.localPoint!,
            this.getIOR(ray.wavelength),
            this.localToWorld,
            hit.point,
            ray,
            true,
            (triangleIndex) => this.classifyFace(triangleIndex),
        );
    }

    public classifyFace(faceIndex: number): string {
        const polygonFace = this.classifyFaceIndex(faceIndex);
        const name = this.name || 'Polygon';
        if (polygonFace >= this.numFaces) return `${name}:endcap`;
        return `${name}:face${polygonFace}`;
    }

    public classifyFaceIndex(faceIndex: number): number {
        const segs = 12;
        const vertsPerFace = (segs + 1) * 2;
        const geometry = this.mesh.builtGeometry;
        if (!geometry?.index) return 0;
        const vertexIndex = geometry.index.getX(faceIndex * 3);
        if (vertexIndex >= this.numFaces * vertsPerFace) return this.numFaces;
        return Math.floor(vertexIndex / vertsPerFace);
    }

    public getIOR(wavelengthMeters: number): number {
        const wlNm = wavelengthMeters * 1e9;
        const b = 12000;
        const a = this.ior - b / (589 * 589);
        return a + b / (wlNm * wlNm);
    }

    protected getProfileFaceLabel(faceIndex: number): string {
        return `face${faceIndex}`;
    }

    protected getEditorDisplayRotation(): number {
        return 0;
    }

    private resizeFaceArrays(count: number): void {
        const nextROC = new Array(count).fill(Infinity);
        const nextModes = new Array<PolygonFaceMode>(count).fill(this.defaultFaceMode);
        for (let i = 0; i < count; i++) {
            if (i < this.faceROC.length) nextROC[i] = this.faceROC[i];
            if (i < this.faceModes.length) nextModes[i] = this.faceModes[i];
        }
        this.faceROC = nextROC;
        this.faceModes = nextModes;
    }

    public getOutlineData(): { frontCap: Vector3[]; backCap: Vector3[]; corners: [Vector3, Vector3][] } {
        const displayed = this.getProfileVertices();
        const halfWidth = this.width / 2;
        const segs = 12;
        const faceData = this.computeFaceData(displayed);

        const perimeter: [number, number][] = [];
        for (const face of faceData) {
            for (let i = 0; i <= segs; i++) {
                if (i === segs) continue;
                const t = i / segs;
                const a = face.v0[0] + t * (face.v1[0] - face.v0[0]);
                const b = face.v0[1] + t * (face.v1[1] - face.v0[1]);
                if (!face.canCurve || !face.center) {
                    perimeter.push([a, b]);
                    continue;
                }
                const radial = Math.hypot(a - face.midpoint[0], b - face.midpoint[1]);
                const sagSq = face.absRadius * face.absRadius - radial * radial;
                const sag = sagSq > 0 ? Math.sign(face.roc) * (Math.sqrt(sagSq) - face.chordToCenter) : 0;
                perimeter.push([
                    a + face.outwardNormal[0] * sag,
                    b + face.outwardNormal[1] * sag,
                ]);
            }
        }

        const frontCap = perimeter.map(([a, b]) => this.mapToLocal(a, b, -halfWidth));
        const backCap = perimeter.map(([a, b]) => this.mapToLocal(a, b, halfWidth));
        const corners: [Vector3, Vector3][] = displayed.map(([a, b]) => [
            this.mapToLocal(a, b, -halfWidth),
            this.mapToLocal(a, b, halfWidth),
        ]);

        return { frontCap, backCap, corners };
    }

    private updateLocalBounds(): void {
        const displayed = this.getProfileVertices();
        if (displayed.length === 0) {
            this.bounds.min.set(-1, -1, -1);
            this.bounds.max.set(1, 1, 1);
            return;
        }

        const halfWidth = this.width / 2;
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];

        for (const [a, b] of displayed) {
            for (const axial of [-halfWidth, halfWidth]) {
                const point = this.mapToLocal(a, b, axial);
                const coords = [point.x, point.y, point.z];
                for (let axis = 0; axis < 3; axis++) {
                    min[axis] = Math.min(min[axis], coords[axis]);
                    max[axis] = Math.max(max[axis], coords[axis]);
                }
            }
        }

        this.bounds.min.set(min[0], min[1], min[2]);
        this.bounds.max.set(max[0], max[1], max[2]);
    }

    private mapToLocal(profileA: number, profileB: number, axial: number): Vector3 {
        const coords = [0, 0, 0];
        coords[this.profileAxes[0]] = profileA;
        coords[this.profileAxes[1]] = profileB;
        coords[this.extrusionAxis] = axial;
        return new Vector3(coords[0], coords[1], coords[2]);
    }

    private profileFromLocal(point: Vector3): [number, number] {
        const coords = [point.x, point.y, point.z];
        return [coords[this.profileAxes[0]], coords[this.profileAxes[1]]];
    }

    private extrusionNormal(sign: number): Vector3 {
        const coords = [0, 0, 0];
        coords[this.extrusionAxis] = sign;
        return new Vector3(coords[0], coords[1], coords[2]);
    }

    private buildNormalFunction(): NormalFn {
        const displayed = this.getProfileVertices();
        const faceData = this.computeFaceData(displayed);
        const segs = 12;
        const vertsPerFace = (segs + 1) * 2;
        const totalSideVerts = displayed.length * vertsPerFace;

        return (vertex: Vector3, vertexIndex?: number) => {
            if (vertexIndex !== undefined && vertexIndex >= totalSideVerts) {
                const coords = [vertex.x, vertex.y, vertex.z];
                return this.extrusionNormal(coords[this.extrusionAxis] >= 0 ? 1 : -1);
            }

            if (vertexIndex !== undefined && vertexIndex >= 0) {
                const ownedFace = Math.min(faceData.length - 1, Math.floor(vertexIndex / vertsPerFace));
                const face = faceData[ownedFace];
                const [pa, pb] = this.profileFromLocal(vertex);

                if (face.canCurve && face.center) {
                    let na = pa - face.center[0];
                    let nb = pb - face.center[1];
                    const len = Math.hypot(na, nb);
                    if (len > 1e-10) {
                        na /= len;
                        nb /= len;
                        if (na * face.outwardNormal[0] + nb * face.outwardNormal[1] < 0) {
                            na = -na;
                            nb = -nb;
                        }
                        return this.mapToLocal(na, nb, 0).normalize();
                    }
                }

                return this.mapToLocal(face.outwardNormal[0], face.outwardNormal[1], 0).normalize();
            }

            const [pa, pb] = this.profileFromLocal(vertex);
            let bestFace = 0;
            let bestDist = Infinity;

            for (let i = 0; i < faceData.length; i++) {
                const face = faceData[i];
                const edgeA = face.v1[0] - face.v0[0];
                const edgeB = face.v1[1] - face.v0[1];
                const edgeLen2 = edgeA * edgeA + edgeB * edgeB;
                const t = edgeLen2 > 0
                    ? Math.max(0, Math.min(1, ((pa - face.v0[0]) * edgeA + (pb - face.v0[1]) * edgeB) / edgeLen2))
                    : 0;
                const da = pa - (face.v0[0] + t * edgeA);
                const db = pb - (face.v0[1] + t * edgeB);
                const dist = da * da + db * db;
                if (dist < bestDist) {
                    bestDist = dist;
                    bestFace = i;
                }
            }

            const face = faceData[bestFace];
            if (face.canCurve && face.center) {
                let na = pa - face.center[0];
                let nb = pb - face.center[1];
                const len = Math.hypot(na, nb);
                if (len > 1e-10) {
                    na /= len;
                    nb /= len;
                    if (na * face.outwardNormal[0] + nb * face.outwardNormal[1] < 0) {
                        na = -na;
                        nb = -nb;
                    }
                    return this.mapToLocal(na, nb, 0).normalize();
                }
            }

            return this.mapToLocal(face.outwardNormal[0], face.outwardNormal[1], 0).normalize();
        };
    }

    private buildGeometry(): BufferGeometry {
        const displayed = this.getProfileVertices();
        const halfWidth = this.width / 2;
        const segs = 12;
        const faceData = this.computeFaceData(displayed);

        const sampledEdges = faceData.map((face) => {
            const points: [number, number][] = [];
            for (let i = 0; i <= segs; i++) {
                const t = i / segs;
                const a = face.v0[0] + t * (face.v1[0] - face.v0[0]);
                const b = face.v0[1] + t * (face.v1[1] - face.v0[1]);
                if (!face.canCurve || !face.center) {
                    points.push([a, b]);
                    continue;
                }
                const radial = Math.hypot(a - face.midpoint[0], b - face.midpoint[1]);
                const sagSq = face.absRadius * face.absRadius - radial * radial;
                const sag = sagSq > 0 ? Math.sign(face.roc) * (Math.sqrt(sagSq) - face.chordToCenter) : 0;
                points.push([
                    a + face.outwardNormal[0] * sag,
                    b + face.outwardNormal[1] * sag,
                ]);
            }
            return points;
        });

        const positions: number[] = [];
        const indices: number[] = [];

        for (const edge of sampledEdges) {
            const baseIndex = positions.length / 3;
            for (const [a, b] of edge) {
                const near = this.mapToLocal(a, b, -halfWidth);
                const far = this.mapToLocal(a, b, halfWidth);
                positions.push(near.x, near.y, near.z, far.x, far.y, far.z);
            }
            for (let i = 0; i < edge.length - 1; i++) {
                const idx = baseIndex + i * 2;
                indices.push(idx, idx + 2, idx + 1);
                indices.push(idx + 1, idx + 2, idx + 3);
            }
        }

        const perimeter: [number, number][] = [];
        for (const edge of sampledEdges) {
            for (let i = 0; i < edge.length - 1; i++) {
                perimeter.push(edge[i]);
            }
        }

        const [centerA, centerB] = polygonCentroid(perimeter);
        for (const sign of [-1, 1] as const) {
            const axial = halfWidth * sign;
            const capBase = positions.length / 3;
            const center = this.mapToLocal(centerA, centerB, axial);
            positions.push(center.x, center.y, center.z);
            for (const [a, b] of perimeter) {
                const point = this.mapToLocal(a, b, axial);
                positions.push(point.x, point.y, point.z);
            }
            for (let i = 0; i < perimeter.length; i++) {
                const next = (i + 1) % perimeter.length;
                if (sign < 0) {
                    indices.push(capBase, capBase + 1 + next, capBase + 1 + i);
                } else {
                    indices.push(capBase, capBase + 1 + i, capBase + 1 + next);
                }
            }
        }

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        return geometry;
    }

    private computeFaceData(displayedVertices: readonly [number, number][]) {
        const [ca, cb] = polygonCentroid(displayedVertices);
        return displayedVertices.map((vertex, index) => {
            const next = displayedVertices[(index + 1) % displayedVertices.length];
            const edgeA = next[0] - vertex[0];
            const edgeB = next[1] - vertex[1];
            const edgeLen = Math.hypot(edgeA, edgeB);
            let normalA = edgeLen > 0 ? -edgeB / edgeLen : 0;
            let normalB = edgeLen > 0 ? edgeA / edgeLen : 1;
            const midpoint: [number, number] = [(vertex[0] + next[0]) / 2, (vertex[1] + next[1]) / 2];
            if (normalA * (midpoint[0] - ca) + normalB * (midpoint[1] - cb) < 0) {
                normalA = -normalA;
                normalB = -normalB;
            }
            const roc = this.faceROC[index] ?? Infinity;
            const absRadius = Math.abs(roc);
            const halfEdge = edgeLen / 2;
            const canCurve = Number.isFinite(roc) && absRadius >= halfEdge && absRadius < 1e8;
            const chordToCenter = canCurve ? Math.sqrt(absRadius * absRadius - halfEdge * halfEdge) : 0;
            const center = canCurve
                ? [
                    midpoint[0] - normalA * Math.sign(roc) * chordToCenter,
                    midpoint[1] - normalB * Math.sign(roc) * chordToCenter,
                ] as [number, number]
                : null;

            return {
                v0: vertex,
                v1: next,
                roc,
                absRadius,
                midpoint,
                edgeLen,
                outwardNormal: [normalA, normalB] as [number, number],
                canCurve,
                chordToCenter,
                center,
            };
        });
    }
}
