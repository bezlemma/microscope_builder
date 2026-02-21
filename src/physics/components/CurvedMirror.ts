import { Vector3, BufferGeometry, Float32BufferAttribute } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { reflectVector } from '../math_solvers';

/**
 * CurvedMirror — a spherical concave or convex mirror.
 *
 * radiusOfCurvature > 0 → concave (focuses light)
 * radiusOfCurvature < 0 → convex (diverges light)
 * |radiusOfCurvature| >= 1e8 → flat (behaves like a flat mirror)
 *
 * The reflective surface is a spherical cap at the front (w = -thickness/2).
 * The back face is flat at w = +thickness/2.
 * Aperture is circular with the given diameter.
 */
export class CurvedMirror extends OpticalComponent {
    diameter: number;           // mm — circular aperture diameter
    radiusOfCurvature: number;  // mm — positive=concave, negative=convex
    thickness: number;          // mm — mirror body thickness

    private _geometry: BufferGeometry | null = null;

    constructor(
        diameter: number = 25.4,
        radiusOfCurvature: number = 100,
        thickness: number = 3,
        name: string = "Curved Mirror"
    ) {
        super(name);
        this.diameter = diameter;
        this.radiusOfCurvature = radiusOfCurvature;
        this.thickness = thickness;
    }

    /** Sag depth of the spherical surface at distance r from axis */
    private sag(r: number): number {
        const R = this.radiusOfCurvature;
        if (Math.abs(R) >= 1e8) return 0;
        const val = R * R - r * r;
        if (val < 0) return 0;
        return R - Math.sign(R) * Math.sqrt(val);
    }

    /** Get the focal length (f = R/2) */
    get focalLength(): number {
        return this.radiusOfCurvature / 2;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const radius = this.diameter / 2;
        const halfT = this.thickness / 2;
        const R = this.radiusOfCurvature;
        const isFlat = Math.abs(R) >= 1e8;
        const RIM_NORMAL = new Vector3(999, 0, 0); // sentinel for absorption

        let bestT = Infinity;
        let bestHit: HitRecord | null = null;

        // ── Front face: curved spherical surface at x ≈ -halfT ──
        if (isFlat) {
            const dw = rayLocal.direction.x;
            if (Math.abs(dw) > 1e-6) {
                const t = (-halfT - rayLocal.origin.x) / dw;
                if (t > 0.001 && t < bestT) {
                    const hp = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                    const ru = hp.y, rv = hp.z;
                    if (ru * ru + rv * rv <= radius * radius) {
                        const outward = new Vector3(-1, 0, 0);
                        bestT = t;
                        bestHit = outward.dot(rayLocal.direction) >= 0
                            ? { t, point: hp, normal: RIM_NORMAL.clone(), localPoint: hp.clone() }
                            : { t, point: hp, normal: outward, localPoint: hp.clone() };
                    }
                }
            }
        } else {
            const cx = -halfT + R;
            const oc = rayLocal.origin.clone().sub(new Vector3(cx, 0, 0));
            const d = rayLocal.direction;
            const a = d.dot(d);
            const b2 = 2 * oc.dot(d);
            const c = oc.dot(oc) - R * R;
            const disc = b2 * b2 - 4 * a * c;

            if (disc >= 0) {
                const sqrtDisc = Math.sqrt(disc);
                for (const t of [(-b2 - sqrtDisc) / (2 * a), (-b2 + sqrtDisc) / (2 * a)]) {
                    if (t < 0.001 || t >= bestT) continue;
                    const hp = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                    const ru = hp.y, rv = hp.z;
                    if (ru * ru + rv * rv > radius * radius) continue;

                    const sagAtR = this.sag(Math.sqrt(ru * ru + rv * rv));
                    const expectedX = -halfT + sagAtR;
                    if (Math.abs(hp.x - expectedX) > 1.0) continue;

                    const geoNormal = hp.clone().sub(new Vector3(cx, 0, 0)).normalize();
                    // Front face outward direction is -x
                    const outward = geoNormal.x <= 0 ? geoNormal : geoNormal.clone().negate();

                    bestT = t;
                    bestHit = outward.dot(rayLocal.direction) >= 0
                        ? { t, point: hp, normal: RIM_NORMAL.clone(), localPoint: hp.clone() }
                        : { t, point: hp, normal: outward, localPoint: hp.clone() };
                }
            }
        }

        // ── Back face: curved at x ≈ +halfT (same R, offset by thickness) ──
        if (isFlat) {
            const dw = rayLocal.direction.x;
            if (Math.abs(dw) > 1e-6) {
                const t = (halfT - rayLocal.origin.x) / dw;
                if (t > 0.001 && t < bestT) {
                    const hp = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                    const ru = hp.y, rv = hp.z;
                    if (ru * ru + rv * rv <= radius * radius) {
                        const outward = new Vector3(1, 0, 0);
                        bestT = t;
                        bestHit = outward.dot(rayLocal.direction) >= 0
                            ? { t, point: hp, normal: RIM_NORMAL.clone(), localPoint: hp.clone() }
                            : { t, point: hp, normal: outward, localPoint: hp.clone() };
                    }
                }
            }
        } else {
            const cxBack = halfT + R;
            const ocBack = rayLocal.origin.clone().sub(new Vector3(cxBack, 0, 0));
            const d = rayLocal.direction;
            const a = d.dot(d);
            const b2 = 2 * ocBack.dot(d);
            const c = ocBack.dot(ocBack) - R * R;
            const disc = b2 * b2 - 4 * a * c;

            if (disc >= 0) {
                const sqrtDisc = Math.sqrt(disc);
                for (const t of [(-b2 - sqrtDisc) / (2 * a), (-b2 + sqrtDisc) / (2 * a)]) {
                    if (t < 0.001 || t >= bestT) continue;
                    const hp = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                    const ru = hp.y, rv = hp.z;
                    if (ru * ru + rv * rv > radius * radius) continue;

                    const sagAtR = this.sag(Math.sqrt(ru * ru + rv * rv));
                    const expectedX = halfT + sagAtR;
                    if (Math.abs(hp.x - expectedX) > 1.0) continue;

                    const geoNormal = hp.clone().sub(new Vector3(cxBack, 0, 0)).normalize();
                    // Back face outward direction is +x
                    const outward = geoNormal.x >= 0 ? geoNormal : geoNormal.clone().negate();

                    bestT = t;
                    bestHit = outward.dot(rayLocal.direction) >= 0
                        ? { t, point: hp, normal: RIM_NORMAL.clone(), localPoint: hp.clone() }
                        : { t, point: hp, normal: outward, localPoint: hp.clone() };
                }
            }
        }

        // ── Cylinder rim at r = radius (catches angled edge rays) ──
        {
            const oy = rayLocal.origin.y, oz = rayLocal.origin.z;
            const dy = rayLocal.direction.y, dz = rayLocal.direction.z;
            const a = dy * dy + dz * dz;
            if (a > 1e-12) {
                const b2 = 2 * (oy * dy + oz * dz);
                const c = oy * oy + oz * oz - radius * radius;
                const disc = b2 * b2 - 4 * a * c;
                if (disc >= 0) {
                    const sqrtDisc = Math.sqrt(disc);
                    for (const t of [(-b2 - sqrtDisc) / (2 * a), (-b2 + sqrtDisc) / (2 * a)]) {
                        if (t < 0.001 || t >= bestT) continue;
                        const hp = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                        if (hp.x >= -halfT - 0.5 && hp.x <= halfT + 0.5) {
                            bestT = t;
                            bestHit = { t, point: hp, normal: RIM_NORMAL.clone(), localPoint: hp.clone() };
                        }
                    }
                }
            }
        }

        return bestHit;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Rim/edge hit — absorb (opaque edge)
        // Check localNormal because hit.normal is rotated to world space by chkIntersection()
        const ln = hit.localNormal;
        if (ln && Math.abs(ln.x - 999) < 1) {
            return { rays: [] };
        }

        // Reflect off the curved surface
        const reflectedDir = reflectVector(ray.direction, hit.normal);

        // Mirror reflection: π phase shift
        const polX = ray.polarization.x;
        const polY = ray.polarization.y;

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: reflectedDir,
                polarization: {
                    x: { re: -polX.re, im: -polX.im },
                    y: { re: -polY.re, im: -polY.im }
                },
                opticalPathLength: ray.opticalPathLength + hit.t
            })]
        };
    }

    /**
     * ABCD matrix for Solver 2: curved mirror focusing.
     * [[1, 0], [-2/R, 1]] for reflection from spherical mirror.
     */
    getABCD(): [number, number, number, number] {
        const R = this.radiusOfCurvature;
        if (Math.abs(R) >= 1e8) return [1, 0, 0, 1]; // flat
        return [1, 0, -2 / R, 1];
    }

    getApertureRadius(): number {
        return this.diameter / 2;
    }

    /** Build a visual geometry: meniscus shell with uniform wall thickness */
    buildGeometry(): BufferGeometry {
        const angSegs = 48;
        const radSegs = 12;
        const radius = this.diameter / 2;
        const halfT = this.thickness / 2;
        const positions: number[] = [];
        const indices: number[] = [];

        // ── Front (reflective) surface: spherical cap ──
        const frontStart = 0;
        positions.push(-halfT + this.sag(0), 0, 0); // center

        for (let ri = 1; ri <= radSegs; ri++) {
            const r = (ri / radSegs) * radius;
            const sagR = this.sag(r);
            for (let ai = 0; ai < angSegs; ai++) {
                const angle = (ai / angSegs) * Math.PI * 2;
                positions.push(-halfT + sagR, Math.cos(angle) * r, Math.sin(angle) * r);
            }
        }

        // Front face triangles: center fan
        for (let ai = 0; ai < angSegs; ai++) {
            const next = (ai + 1) % angSegs;
            indices.push(frontStart, frontStart + 1 + ai, frontStart + 1 + next);
        }
        // Front face quads: ring to ring
        for (let ri = 2; ri <= radSegs; ri++) {
            const prev = frontStart + 1 + (ri - 2) * angSegs;
            const curr = frontStart + 1 + (ri - 1) * angSegs;
            for (let ai = 0; ai < angSegs; ai++) {
                const next = (ai + 1) % angSegs;
                indices.push(prev + ai, curr + ai, curr + next);
                indices.push(prev + ai, curr + next, prev + next);
            }
        }


        // ── Back surface: offset by thickness (uniform wall) ──
        const backStart = positions.length / 3;
        positions.push(halfT + this.sag(0), 0, 0); // center (offset by thickness)

        for (let ri = 1; ri <= radSegs; ri++) {
            const r = (ri / radSegs) * radius;
            const sagR = this.sag(r);
            for (let ai = 0; ai < angSegs; ai++) {
                const angle = (ai / angSegs) * Math.PI * 2;
                positions.push(halfT + sagR, Math.cos(angle) * r, Math.sin(angle) * r);
            }
        }

        // Back face triangles: reversed winding
        for (let ai = 0; ai < angSegs; ai++) {
            const next = (ai + 1) % angSegs;
            indices.push(backStart, backStart + 1 + next, backStart + 1 + ai);
        }
        for (let ri = 2; ri <= radSegs; ri++) {
            const prev = backStart + 1 + (ri - 2) * angSegs;
            const curr = backStart + 1 + (ri - 1) * angSegs;
            for (let ai = 0; ai < angSegs; ai++) {
                const next = (ai + 1) % angSegs;
                indices.push(prev + ai, curr + next, curr + ai);
                indices.push(prev + ai, prev + next, curr + next);
            }
        }
        const frontEdge = frontStart + 1 + (radSegs - 1) * angSegs;
        const backEdge = backStart + 1 + (radSegs - 1) * angSegs;

        // ── Rim: connect front edge to back edge ──
        for (let ai = 0; ai < angSegs; ai++) {
            const next = (ai + 1) % angSegs;
            indices.push(frontEdge + ai, frontEdge + next, backEdge + next);
            indices.push(frontEdge + ai, backEdge + next, backEdge + ai);
        }

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
    }

    invalidateMesh(): void {
        this._geometry = null;
        this.version++;
    }

    get geometry(): BufferGeometry {
        if (!this._geometry) {
            this._geometry = this.buildGeometry();
        }
        return this._geometry;
    }
}
