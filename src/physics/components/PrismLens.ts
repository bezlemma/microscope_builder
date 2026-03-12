import { Vector3 } from 'three';
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

    getParaxialTransformsForRay(worldDir: Vector3, wavelengthSI?: number): {
        tangentialTransform: [number, number, number, number];
        sagittalTransform: [number, number, number, number];
    } {
        const identity: [number, number, number, number] = [1, 0, 0, 1];
        const localDir = worldDir.clone().transformDirection(this.worldToLocal).normalize();

        const { apex, baseLeft, baseRight } = this.getTriangleVertices();
        const frontEdge = new Vector3(0, baseLeft[0] - apex[0], baseLeft[1] - apex[1]);
        const frontNormal = new Vector3(0, -frontEdge.z, frontEdge.y).normalize();
        const backEdge = new Vector3(0, baseRight[0] - apex[0], baseRight[1] - apex[1]);
        const backNormal = new Vector3(0, backEdge.z, -backEdge.y).normalize();

        const frontDot = localDir.dot(frontNormal);
        const backDot = localDir.dot(backNormal);
        const entryNormal = frontDot < backDot ? frontNormal : backNormal;
        const exitNormal = frontDot < backDot ? backNormal : frontNormal;

        const cosTheta1 = Math.abs(localDir.dot(entryNormal));
        if (cosTheta1 < 0.01) return { tangentialTransform: identity, sagittalTransform: identity };

        const sinTheta1 = Math.sqrt(1 - cosTheta1 * cosTheta1);
        const ior = wavelengthSI ? this.getIOR(wavelengthSI) : this.ior;
        const sinTheta2 = sinTheta1 / ior;
        if (sinTheta2 >= 1) return { tangentialTransform: identity, sagittalTransform: identity };
        const cosTheta2 = Math.sqrt(1 - sinTheta2 * sinTheta2);

        const n = entryNormal.clone().multiplyScalar(-Math.sign(localDir.dot(entryNormal)));
        const internalDir = localDir.clone().multiplyScalar(1 / ior)
            .add(n.clone().multiplyScalar(cosTheta1 / ior - cosTheta2))
            .normalize();

        const cosTheta3 = Math.abs(internalDir.dot(exitNormal));
        if (cosTheta3 < 0.01) return { tangentialTransform: identity, sagittalTransform: identity };

        const sinTheta3 = Math.sqrt(1 - cosTheta3 * cosTheta3);
        const sinTheta4 = sinTheta3 * ior;
        if (sinTheta4 >= 1) return { tangentialTransform: identity, sagittalTransform: identity };
        const cosTheta4 = Math.sqrt(1 - sinTheta4 * sinTheta4);

        const d = this.height * 0.6;

        return {
            tangentialTransform: [
                (cosTheta4 * cosTheta2) / (cosTheta3 * cosTheta1),
                d * cosTheta4 * cosTheta1 / (ior * cosTheta3 * cosTheta2),
                0,
                (cosTheta3 * cosTheta1) / (cosTheta4 * cosTheta2),
            ],
            sagittalTransform: [1, d / ior, 0, 1],
        };
    }

    override getParaxialProfile(rayDirection?: Vector3, wavelengthSI?: number): {
        transformX: [number, number, number, number];
        transformY: [number, number, number, number];
        apertureRadius: number;
    } {
        if (!rayDirection) {
            return { transformX: [1, 0, 0, 1], transformY: [1, 0, 0, 1], apertureRadius: 0 };
        }
        const { tangentialTransform, sagittalTransform } = this.getParaxialTransformsForRay(rayDirection, wavelengthSI);
        return { transformX: sagittalTransform, transformY: tangentialTransform, apertureRadius: 0 };
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
