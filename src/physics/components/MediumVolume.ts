import { Box3, Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { HitRecord, InteractionResult, Ray, childRay } from '../types';
import { OpticMesh } from '../OpticMesh';
import { reflectVector } from '../math_solvers';
import { cauchyIorFromReference } from '../dispersion';
import { applyPacketMediumIndex } from '../rayTransport';

/**
 * MediumVolume — a refractive medium volume (water, oil, liquid container).
 *
 * Two visual modes:
 *   - 'box': rectangular volume
 *   - 'bridge': tapered cylinder (for objective immersion bridges)
 *
 * Physics: full refraction/reflection at boundaries using Snell's law.
 */
export class MediumVolume extends OpticalComponent {
    private static readonly EXIT_NUDGE_MM = 1e-3;
    width: number;
    height: number;
    depth: number;
    refractiveIndex: number;
    exteriorRefractiveIndex: number;
    visualMode: 'box' | 'bridge';
    bridgeStartRadius: number;
    bridgeEndRadius: number;

    constructor({
        width = 10,
        height = 10,
        depth = 10,
        refractiveIndex = 1.33,
        exteriorRefractiveIndex = 1.0,
        visualMode = 'box',
        bridgeStartRadius,
        bridgeEndRadius,
        name = 'Medium Volume',
    }: {
        width?: number;
        height?: number;
        depth?: number;
        refractiveIndex?: number;
        exteriorRefractiveIndex?: number;
        visualMode?: 'box' | 'bridge';
        bridgeStartRadius?: number;
        bridgeEndRadius?: number;
        name?: string;
    } = {}) {
        super(name);
        this.width = width;
        this.height = height;
        this.depth = depth;
        this.refractiveIndex = refractiveIndex;
        this.exteriorRefractiveIndex = exteriorRefractiveIndex;
        this.visualMode = visualMode;
        this.bridgeStartRadius = bridgeStartRadius ?? Math.min(width, height) * 0.5;
        this.bridgeEndRadius = bridgeEndRadius ?? Math.min(width, height) * 0.5;
        this.updateBounds();
    }

    updateBounds(): void {
        const bridgeRadius = Math.max(this.bridgeStartRadius, this.bridgeEndRadius, 0.05);
        const halfWidth = this.visualMode === 'bridge' ? bridgeRadius : this.width * 0.5;
        const halfHeight = this.visualMode === 'bridge' ? bridgeRadius : this.height * 0.5;
        this.bounds = new Box3(
            new Vector3(-halfWidth, -halfHeight, -this.depth * 0.5),
            new Vector3(halfWidth, halfHeight, this.depth * 0.5),
        );
        this.version++;
    }

    private bridgeDepth(): number { return Math.max(this.depth, 0.02); }
    private bridgeHalfDepth(): number { return this.bridgeDepth() * 0.5; }

    private bridgeRadiusAtLocalZ(z: number): number {
        const halfDepth = this.bridgeHalfDepth();
        const t = Math.max(0, Math.min(1, (z + halfDepth) / Math.max(this.bridgeDepth(), 1e-9)));
        return Math.max(this.bridgeStartRadius + (this.bridgeEndRadius - this.bridgeStartRadius) * t, 0.05);
    }

    private intersectBox(rayLocal: Ray): HitRecord | null {
        const box = this.bounds;
        const origin = rayLocal.origin;
        const dir = rayLocal.direction;

        let tMin = -Infinity;
        let tMax = Infinity;
        let nearNormal: Vector3 | null = null;
        let farNormal: Vector3 | null = null;

        const updateAxis = (
            originCoord: number, dirCoord: number, minCoord: number, maxCoord: number,
            minNormal: Vector3, maxNormal: Vector3,
        ): boolean => {
            if (Math.abs(dirCoord) < 1e-12) {
                return originCoord >= minCoord && originCoord <= maxCoord;
            }
            let t1 = (minCoord - originCoord) / dirCoord;
            let t2 = (maxCoord - originCoord) / dirCoord;
            let n1 = minNormal; let n2 = maxNormal;
            if (t1 > t2) { [t1, t2] = [t2, t1]; [n1, n2] = [n2, n1]; }
            if (t1 > tMin) { tMin = t1; nearNormal = n1.clone(); }
            if (t2 < tMax) { tMax = t2; farNormal = n2.clone(); }
            return tMin <= tMax;
        };

        if (!updateAxis(origin.x, dir.x, box.min.x, box.max.x, new Vector3(-1, 0, 0), new Vector3(1, 0, 0))) return null;
        if (!updateAxis(origin.y, dir.y, box.min.y, box.max.y, new Vector3(0, -1, 0), new Vector3(0, 1, 0))) return null;
        if (!updateAxis(origin.z, dir.z, box.min.z, box.max.z, new Vector3(0, 0, -1), new Vector3(0, 0, 1))) return null;

        const inside = box.containsPoint(origin);
        const t = inside ? tMax : tMin;
        const normal = (inside ? farNormal : nearNormal) as Vector3 | null;
        if (!normal || !Number.isFinite(t) || t < 0.001) return null;
        const point = origin.clone().addScaledVector(dir, t);
        return { t, point, normal: normal.clone(), localPoint: point.clone(), localNormal: normal.clone() };
    }

    private intersectBridge(rayLocal: Ray): HitRecord | null {
        const origin = rayLocal.origin;
        const dir = rayLocal.direction;
        const depth = this.bridgeDepth();
        const halfDepth = depth * 0.5;
        const startRadius = Math.max(this.bridgeStartRadius, 0.05);
        const endRadius = Math.max(this.bridgeEndRadius, 0.05);
        const slope = (endRadius - startRadius) / depth;
        const radiusBase = startRadius + slope * halfDepth;
        const radiusOffset = radiusBase + slope * origin.z;
        const candidates: { t: number; point: Vector3; normal: Vector3 }[] = [];

        // Cone intersection
        const sideA = dir.x * dir.x + dir.y * dir.y - (slope * dir.z) * (slope * dir.z);
        const sideB = 2 * (origin.x * dir.x + origin.y * dir.y - radiusOffset * slope * dir.z);
        const sideC = origin.x * origin.x + origin.y * origin.y - radiusOffset * radiusOffset;

        const pushSide = (t: number) => {
            if (!Number.isFinite(t) || t < 0.001) return;
            const point = origin.clone().addScaledVector(dir, t);
            if (point.z < -halfDepth - 1e-6 || point.z > halfDepth + 1e-6) return;
            const radius = this.bridgeRadiusAtLocalZ(point.z);
            const radialSq = point.x * point.x + point.y * point.y;
            if (Math.abs(radialSq - radius * radius) > Math.max(radius * 1e-3, 1e-4)) return;
            const normal = new Vector3(point.x, point.y, -slope * radius).normalize();
            candidates.push({ t, point, normal });
        };

        if (Math.abs(sideA) > 1e-12) {
            const disc = sideB * sideB - 4 * sideA * sideC;
            if (disc >= 0) {
                const sqrtDisc = Math.sqrt(disc);
                pushSide((-sideB - sqrtDisc) / (2 * sideA));
                pushSide((-sideB + sqrtDisc) / (2 * sideA));
            }
        } else if (Math.abs(sideB) > 1e-12) {
            pushSide(-sideC / sideB);
        }

        // Cap intersections
        const pushCap = (capZ: number, radius: number, normal: Vector3) => {
            if (Math.abs(dir.z) < 1e-12) return;
            const t = (capZ - origin.z) / dir.z;
            if (!Number.isFinite(t) || t < 0.001) return;
            const point = origin.clone().addScaledVector(dir, t);
            if (point.x * point.x + point.y * point.y > radius * radius + 1e-9) return;
            candidates.push({ t, point, normal: normal.clone() });
        };
        pushCap(-halfDepth, startRadius, new Vector3(0, 0, -1));
        pushCap(halfDepth, endRadius, new Vector3(0, 0, 1));

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => a.t - b.t);

        const inside = (() => {
            if (origin.z < -halfDepth - 1e-9 || origin.z > halfDepth + 1e-9) return false;
            const r = this.bridgeRadiusAtLocalZ(origin.z);
            return origin.x * origin.x + origin.y * origin.y <= r * r + 1e-9;
        })();

        const hit = inside ? candidates.find(c => c.t > 0.001) : candidates[0];
        if (!hit) return null;
        return { t: hit.t, point: hit.point, normal: hit.normal, localPoint: hit.point.clone(), localNormal: hit.normal.clone() };
    }

    intersect(rayLocal: Ray): HitRecord | null {
        return this.visualMode === 'bridge' ? this.intersectBridge(rayLocal) : this.intersectBox(rayLocal);
    }

    getInteriorIor(wavelengthMeters: number): number {
        return cauchyIorFromReference(this.refractiveIndex, wavelengthMeters, { family: 'liquid' });
    }

    getExteriorIor(wavelengthMeters: number): number {
        return cauchyIorFromReference(this.exteriorRefractiveIndex, wavelengthMeters, { family: 'liquid' });
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const localDir = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const outwardNormal = hit.localNormal?.clone().normalize()
            ?? hit.normal.clone().transformDirection(this.worldToLocal).normalize();
        const entering = localDir.dot(outwardNormal) < 0;
        const exteriorIor = this.getExteriorIor(ray.wavelength);
        const interiorIor = this.getInteriorIor(ray.wavelength);
        const n1 = entering ? exteriorIor : interiorIor;
        const n2 = entering ? interiorIor : exteriorIor;
        const incidentNormal = outwardNormal.clone();
        if (incidentNormal.dot(localDir) > 0) incidentNormal.negate();

        // OpticMesh.refract returns Vector3 | null (the refracted direction in local space)
        const refractedDir = OpticMesh.refract(localDir, incidentNormal, n1, n2);

        if (!refractedDir) {
            // Total internal reflection
            const reflectedDirection = reflectVector(ray.direction, hit.normal).normalize();
            const reflected = childRay(ray, {
                origin: hit.point.clone().addScaledVector(reflectedDirection, MediumVolume.EXIT_NUDGE_MM),
                direction: reflectedDirection,
                opticalPathLength: ray.opticalPathLength + hit.t * n1,
            });
            return {
                rays: [applyPacketMediumIndex(reflected, n1)],
            };
        }

        // Compute Fresnel reflectance (unpolarized average)
        const cosI = Math.abs(localDir.dot(incidentNormal));
        const cosT = Math.abs(refractedDir.dot(incidentNormal));
        const Rs = ((n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT)) ** 2;
        const Rp = ((n2 * cosI - n1 * cosT) / (n2 * cosI + n1 * cosT)) ** 2;
        const R = (Rs + Rp) / 2;

        const dirWorld = refractedDir.clone().transformDirection(this.localToWorld).normalize();
        const opl = ray.opticalPathLength + hit.t * n1;

        const refracted = childRay(ray, {
            origin: hit.point.clone().addScaledVector(dirWorld, MediumVolume.EXIT_NUDGE_MM),
            direction: dirWorld,
            intensity: ray.intensity * (1 - R),
            opticalPathLength: opl,
        });
        const rays = [applyPacketMediumIndex(refracted, n2)];

        // Add partial Fresnel reflection if significant
        if (R > 0.01) {
            const reflectedDirection = reflectVector(ray.direction, hit.normal).normalize();
            const reflected = childRay(ray, {
                origin: hit.point.clone().addScaledVector(reflectedDirection, MediumVolume.EXIT_NUDGE_MM),
                direction: reflectedDirection,
                intensity: ray.intensity * R,
                opticalPathLength: opl,
            });
            rays.push(applyPacketMediumIndex(reflected, n1));
        }

        return { rays };
    }
}
