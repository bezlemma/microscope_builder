import { AbstractPolygonOptic } from './AbstractPolygonOptic';

/**
 * PolygonScanner — Reflective polygon optic used for beam scanning.
 *
 * Geometry is shared with the abstract polygon model:
 * - editable vertices in the XY plane
 * - per-face curvature
 * - reflective side faces
 * - extrusion along local Z (spin axis / face height)
 */
export class PolygonScanner extends AbstractPolygonOptic {
    constructor({
        numFaces = 6,
        inscribedRadius = 10,
        faceHeight = 10,
        scanAngle = 0,
        name = 'Polygon Scanner',
    }: {
        numFaces?: number;
        inscribedRadius?: number;
        faceHeight?: number;
        scanAngle?: number;
        name?: string;
    } = {}) {
        super({
            name,
            width: faceHeight,
            ior: 1.5168,
            profileAxes: [0, 1],
            extrusionAxis: 2,
            defaultFaceMode: 'reflective',
        });
        this.setRegularPolygon(Math.max(3, Math.round(numFaces)), inscribedRadius);
        this.applyScanAngle(scanAngle);
    }

    override get numFaces(): number {
        return super.numFaces;
    }

    set numFaces(value: number) {
        this.setRegularPolygon(Math.max(3, Math.round(value)), this.inscribedRadius);
    }

    get inscribedRadius(): number {
        if (this.vertices.length < 2) return 10;
        const first = this.vertices[0];
        const second = this.vertices[1];
        const midpoint: [number, number] = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
        return Math.hypot(midpoint[0], midpoint[1]);
    }

    set inscribedRadius(value: number) {
        this.setRegularPolygon(this.numFaces, value);
    }

    get faceHeight(): number {
        return this.width;
    }

    set faceHeight(value: number) {
        this.width = value;
        this.invalidateMesh();
    }

    get circumRadius(): number {
        return this.inscribedRadius / Math.cos(Math.PI / this.numFaces);
    }

    get faceHalfWidth(): number {
        return this.circumRadius * Math.sin(Math.PI / this.numFaces);
    }

    recalculate(): void {
        this.invalidateMesh();
    }

    override getApertureRadius(): number {
        return this.circumRadius;
    }

    get label(): string {
        return `${this.numFaces}-face polygon`;
    }
}
