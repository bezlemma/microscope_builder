import { AbstractPolygonOptic } from './AbstractPolygonOptic';

/**
 * PrismLens - Refractive polygon optic with editable vertices and per-face curvature.
 *
 * Backward-compatible API:
 * - constructor(apexAngle, height, width, name, ior)
 * - vApex / vBaseLeft / vBaseRight aliases for the 3-sided case
 * - apexAngle / height derived from the editable vertex positions
 */
export class PrismLens extends AbstractPolygonOptic {
    constructor(
        apexAngle: number = Math.PI / 3,
        height: number = 20,
        width: number = 20,
        name: string = 'Prism',
        ior: number = 1.5168,
    ) {
        super({
            name,
            width,
            ior,
            profileAxes: [1, 2],
            extrusionAxis: 0,
            defaultFaceMode: 'refractive',
        });
        this.setTriangleFromParams(apexAngle, height);
    }

    get vApex(): [number, number] {
        return this.vertices[0] ?? [0, 0];
    }

    set vApex(vertex: [number, number]) {
        const next = this.vertices.map((entry) => [...entry] as [number, number]);
        next[0] = vertex;
        this.setVertices(next);
    }

    get vBaseLeft(): [number, number] {
        return this.vertices[1] ?? [0, 0];
    }

    set vBaseLeft(vertex: [number, number]) {
        const next = this.vertices.map((entry) => [...entry] as [number, number]);
        next[1] = vertex;
        this.setVertices(next);
    }

    get vBaseRight(): [number, number] {
        return this.vertices[2] ?? [0, 0];
    }

    set vBaseRight(vertex: [number, number]) {
        const next = this.vertices.map((entry) => [...entry] as [number, number]);
        next[2] = vertex;
        this.setVertices(next);
    }

    get apexAngle(): number {
        const left = [this.vBaseLeft[0] - this.vApex[0], this.vBaseLeft[1] - this.vApex[1]];
        const right = [this.vBaseRight[0] - this.vApex[0], this.vBaseRight[1] - this.vApex[1]];
        const dot = left[0] * right[0] + left[1] * right[1];
        const lenL = Math.hypot(left[0], left[1]);
        const lenR = Math.hypot(right[0], right[1]);
        if (lenL < 1e-10 || lenR < 1e-10) return Math.PI / 3;
        return Math.acos(Math.max(-1, Math.min(1, dot / (lenL * lenR))));
    }

    set apexAngle(angle: number) {
        this.setTriangleFromParams(angle, this.height);
    }

    get height(): number {
        const baseMid: [number, number] = [
            (this.vBaseLeft[0] + this.vBaseRight[0]) / 2,
            (this.vBaseLeft[1] + this.vBaseRight[1]) / 2,
        ];
        return Math.hypot(this.vApex[0] - baseMid[0], this.vApex[1] - baseMid[1]);
    }

    set height(value: number) {
        this.setTriangleFromParams(this.apexAngle, value);
    }

    getTriangleVertices(): { apex: [number, number]; baseLeft: [number, number]; baseRight: [number, number] } {
        return {
            apex: this.vApex,
            baseLeft: this.vBaseLeft,
            baseRight: this.vBaseRight,
        };
    }

    override classifyFace(faceIndex: number): string {
        const polygonFace = this.classifyFaceIndex(faceIndex);
        const name = this.name || 'Prism';
        if (polygonFace >= this.numFaces) return `${name}:endcap`;
        if (this.numFaces === 3) {
            const labels = ['front', 'base', 'back'];
            return `${name}:${labels[polygonFace]}`;
        }
        return `${name}:face${polygonFace}`;
    }

    private setTriangleFromParams(apexAngle: number, height: number): void {
        const halfAngle = apexAngle / 2;
        const baseHalfWidth = height * Math.tan(halfAngle);
        const centroidOffset = height / 3;
        this.setVertices([
            [height - centroidOffset, 0],
            [-centroidOffset, -baseHalfWidth],
            [-centroidOffset, baseHalfWidth],
        ]);
    }

    protected override getEditorDisplayRotation(): number {
        return Math.PI / 2;
    }
}
