import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { evaluateZernikeAberrationWaves, type PupilFunction } from '../PupilFunction';
import { OpticMesh } from '../OpticMesh';

export type ImmersionMediumKind = 'air' | 'oil' | 'water' | 'silicone' | 'custom';
export type ObjectiveMechanicalStyle = 'standard' | 'snout';

export interface ObjectiveMechanicalMetrics {
    a: number;
    bodyR: number;
    zFront: number;
    zBack: number;
    zTaperStart: number;
    zTaperEnd: number;
    opticalFrontRadius: number;
    frontRadius: number;
    barrelLength: number;
    snoutLength: number;
    snoutCutOffset: number;
    snoutCutAngle: number;
}

export interface ObjectiveSnoutBevelPlane {
    center: Vector3;
    radial: Vector3;
    tangent: Vector3;
    slope: Vector3;
    normal: Vector3;
    radius: number;
    slopeRadius: number;
    zMin: number;
    zMax: number;
}

export const OBJECTIVE_SURFACE_SNOUT_ENTRY = 1001;
export const OBJECTIVE_SURFACE_SNOUT_BACK = 1002;

export interface SnoutZemaxEnvelopeRuntime {
    tipIndex: number;
    stopRadius: number;
    blackBoxRadius: number;
    blackBoxLength: number;
    imageSideStopOffset: number;
}

const AMS_AGY_ZEMAX_ENVELOPE: SnoutZemaxEnvelopeRuntime = {
    tipIndex: 1.743996848438,
    stopRadius: 5.0,
    blackBoxRadius: 5.93755627355001,
    blackBoxLength: 25.322594113995482,
    imageSideStopOffset: 1.55,
};

/**
 * Objective — Aplanatic Phase Surface (Ideal Microscope Objective)
 *
 * A zero-thickness phase surface that satisfies the Abbe Sine Condition:
 *   sin(θ_out) = h / f
 *
 * Unlike an ideal thin lens phase sheet, this component correctly focuses
 * rays at ANY numerical aperture —
 * no spherical aberration, even at NA=1.4 (θ ≈ 67°).
 *
 * Parameters (microscopy-native):
 *   - NA:             Numerical Aperture (defines light collection)
 *   - magnification:  System magnification (with tube lens)
 *   - immersionIndex: Refractive index of immersion medium (Air=1, Water=1.33, Oil=1.515)
 *   - workingDistance: Physical distance from front of objective to sample plane (mm)
 *   - tubeLensFocal:  Tube lens focal length for the microscope standard (Nikon=200, Olympus=180, Zeiss=165)
 *
 * Derived:
 *   - focalLength    = tubeLensFocal / magnification
 *   - maxAngle       = arcsin(NA / immersionIndex)
 *   - apertureRadius = focalLength × NA (back-pupil radius in this air-space model)
 *   - frontRadius    = workingDistance × tan(asin(NA / immersionIndex))
 *
 * TODO: Solver 2 still uses the paraxial q-parameter transfer [[1,0],[-1/f,1]].
 *       That remains separate from the surface-by-surface ray interaction here.
 *
 * TODO: Solver 3 (Imaging) — The immersion medium creates a region of
 *       index `n` between the sample and the objective. Backward tracing
 *       from the image plane through the tube lens + objective should
 *       correctly map image points to sample points. The aplanatic
 *       condition guarantees this mapping is free of coma.
 *
 * TODO: Solver 4 (Coherent) — Apply phase shift Δφ = (2π/λ) × ΔOPL
 *       for interference calculations. The OPL contribution below is
 *       the same quadratic form as IdealLens.
 *
 * TODO: Immersion Medium — When immersionIndex > 1, the region between
 *       this objective and the sample should propagate rays at n = immersionIndex.
 *       This affects OPL accumulation and is critical for lightsheet microscopy
 *       where rays travel through containers with different indices.
 *       Current implementation: immersionIndex affects the max acceptance angle
 *       and deflection math, but does NOT yet modify the medium for other rays
 *       in the scene. That requires a "Medium" or "Immersion Volume" system.
 */
export class Objective extends OpticalComponent {
    NA: number;
    magnification: number;
    immersionIndex: number;
    workingDistance: number;
    tubeLensFocal: number;
    diameter: number;           // Physical barrel diameter (mm) — for visual sizing, independent of NA
    mechanicalStyle: ObjectiveMechanicalStyle;
    snoutRadius: number;        // Front mechanical radius for the AMS-AGY-style nose
    snoutLength: number;        // Axial length of the narrow nose before the shoulder
    snoutCutOffset: number;     // D-cut plane offset from the optical axis
    snoutCutAngle: number;      // D-cut normal direction in the local XY pupil plane

    // Derived (recomputed on parameter change)
    focalLength: number;
    maxAngle: number;
    apertureRadius: number;     // Optical clear aperture from NA — used for ray clipping

    // Extended properties retained for older saved scenes.
    coverslipThickness: number = 0.17;  // mm — standard #1.5 coverslip
    fieldNumber: number = 22;           // mm — field of view at the intermediate image plane
    immersionMediumKind: ImmersionMediumKind = 'air';
    pupil: PupilFunction | null = null; // null = diffraction-limited (no custom pupil)
    pupilRadius: number = 0;            // Pupil plane radius (derived)

    constructor({
        NA = 0.25,
        magnification = 10,
        immersionIndex = 1.0,
        workingDistance = 10.0,
        tubeLensFocal = 200,
        diameter = 20,
        mechanicalStyle = 'standard',
        snoutRadius = 4,
        snoutLength = 16,
        snoutCutOffset = 2,
        snoutCutAngle = 0,
        name = 'Objective',
    }: {
        NA?: number;
        magnification?: number;
        immersionIndex?: number;
        workingDistance?: number;
        tubeLensFocal?: number;
        diameter?: number;
        mechanicalStyle?: ObjectiveMechanicalStyle;
        snoutRadius?: number;
        snoutLength?: number;
        snoutCutOffset?: number;
        snoutCutAngle?: number;
        name?: string;
    } = {}) {
        super(name);
        this.NA = NA;
        this.magnification = magnification;
        this.immersionIndex = immersionIndex;
        this.workingDistance = workingDistance;
        this.tubeLensFocal = tubeLensFocal;
        this.diameter = diameter;
        this.mechanicalStyle = mechanicalStyle;
        this.snoutRadius = snoutRadius;
        this.snoutLength = snoutLength;
        this.snoutCutOffset = snoutCutOffset;
        this.snoutCutAngle = snoutCutAngle;

        // Derive
        this.focalLength = tubeLensFocal / magnification;
        const indexRatio = Math.min(NA / immersionIndex, 1.0);
        this.maxAngle = Math.asin(indexRatio);
        // Abbe Sine Condition: h = f * NA (back focal plane beam height)
        this.apertureRadius = this.focalLength * NA;
        this.pupilRadius = this.apertureRadius;

        this._updateBounds();
    }

    /** Recalculate derived values after any parameter change. */
    recalculate(): void {
        this.focalLength = this.tubeLensFocal / this.magnification;
        const indexRatio = Math.min(this.NA / this.immersionIndex, 1.0);
        this.maxAngle = Math.asin(indexRatio);
        this.apertureRadius = this.focalLength * this.NA;
        this.pupilRadius = this.apertureRadius;
        this._updateBounds();
        this.version++;
    }

    /** Change magnification while preserving sample-side geometry. */
    setMagnificationPreserveSampleSide(newMag: number): void {
        this.magnification = newMag;
        this.tubeLensFocal = this.focalLength * newMag;
        this.recalculate();
    }

    /** Set immersion medium by kind name. */
    setImmersionMedium(kind: ImmersionMediumKind): void {
        this.immersionMediumKind = kind;
        if (kind === 'oil') this.immersionIndex = 1.515;
        else if (kind === 'water') this.immersionIndex = 1.33;
        else if (kind === 'silicone') this.immersionIndex = 1.406;
        else if (kind === 'custom') { /* leave existing index untouched */ }
        else this.immersionIndex = 1.0;
        this.recalculate();
    }

    getMechanicalMetrics(): ObjectiveMechanicalMetrics {
        const f = this.focalLength;
        const wd = this.workingDistance;
        const a = this.apertureRadius;
        const bodyR = Math.max(a + 1, this.diameter / 2);

        const parfocalDistance = 35;
        const zFront = -f + wd;
        const zBack = Math.max(-f + parfocalDistance, zFront + 20);

        const opticalFrontRadius = this.getOpticalFrontRadius();
        const standardFrontRadius = this.getFrontRadius();
        const frontRadius = this.mechanicalStyle === 'snout'
            ? Math.max(standardFrontRadius, this.snoutRadius)
            : standardFrontRadius;

        const rawSnoutLength = this.mechanicalStyle === 'snout'
            ? Math.max(0, this.snoutLength)
            : 0;
        const zTaperStart = this.mechanicalStyle === 'snout'
            ? Math.min(zBack, zFront + rawSnoutLength)
            : zFront;
        const remainingBodyLength = Math.max(0, zBack - zTaperStart);
        const zTaperEnd = zTaperStart + Math.min(15, remainingBodyLength * 0.6);
        const snoutLength = Math.max(0, zTaperStart - zFront);
        const snoutCutOffset = Math.max(0, Math.min(this.snoutCutOffset, frontRadius * 0.98));

        return {
            a,
            bodyR,
            zFront,
            zBack,
            zTaperStart,
            zTaperEnd,
            opticalFrontRadius,
            frontRadius,
            barrelLength: zBack - zFront,
            snoutLength,
            snoutCutOffset,
            snoutCutAngle: this.snoutCutAngle,
        };
    }

    getSnoutBevelPlane(metrics = this.getMechanicalMetrics()): ObjectiveSnoutBevelPlane | null {
        if (this.mechanicalStyle !== 'snout' || metrics.snoutLength <= 1e-6) return null;

        const radius = Math.max(metrics.frontRadius, 0.01);
        const radial = new Vector3(
            Math.cos(metrics.snoutCutAngle),
            Math.sin(metrics.snoutCutAngle),
            0,
        ).normalize();
        const tangent = new Vector3(-radial.y, radial.x, 0).normalize();
        const slope = new Vector3(radial.x, radial.y, 1).normalize();
        const normal = new Vector3(radial.x, radial.y, -1).normalize();
        const zMin = metrics.zFront;
        const zMax = Math.min(metrics.zTaperStart, metrics.zFront + 2 * radius);
        return {
            center: new Vector3(0, 0, metrics.zFront + radius),
            radial,
            tangent,
            slope,
            normal,
            radius,
            slopeRadius: radius * Math.SQRT2,
            zMin,
            zMax,
        };
    }

    getSnoutZemaxEnvelope(): SnoutZemaxEnvelopeRuntime | null {
        if (this.catalog?.partId !== 'asi:54-10-5') return null;
        if (this.mechanicalStyle !== 'snout') return null;
        return AMS_AGY_ZEMAX_ENVELOPE;
    }

    getSnoutZemaxEnvelopePlanes(metrics = this.getMechanicalMetrics()): {
        corePlaneZ: number;
        blackBoxExitZ: number;
        imageStopZ: number;
    } | null {
        const envelope = this.getSnoutZemaxEnvelope();
        if (!envelope) return null;
        const corePlaneZ = 0;
        const blackBoxExitZ = Math.min(metrics.zBack, corePlaneZ + envelope.blackBoxLength);
        const imageStopZ = Math.min(metrics.zBack, blackBoxExitZ + envelope.imageSideStopOffset);
        return { corePlaneZ, blackBoxExitZ, imageStopZ };
    }

    private orientedAgainstRay(normal: Vector3, direction: Vector3): Vector3 {
        const oriented = normal.clone().normalize();
        if (oriented.dot(direction) > 0) oriented.negate();
        return oriented;
    }

    private projectLocalRayToZ(origin: Vector3, direction: Vector3, z: number, minT = 1e-6): { t: number; point: Vector3 } | null {
        if (Math.abs(direction.z) < 1e-12) return null;
        const t = (z - origin.z) / direction.z;
        if (t <= minT) return null;
        return { t, point: origin.clone().addScaledVector(direction, t) };
    }

    private intersectSnoutBevelWindow(origin: Vector3, direction: Vector3, bevel: ObjectiveSnoutBevelPlane): { t: number; point: Vector3 } | null {
        const denom = direction.dot(bevel.normal);
        if (Math.abs(denom) < 1e-12) return null;
        const t = bevel.center.clone().sub(origin).dot(bevel.normal) / denom;
        if (t <= 1e-6) return null;
        const point = origin.clone().addScaledVector(direction, t);
        const local = point.clone().sub(bevel.center);
        const tangentCoord = local.dot(bevel.tangent);
        const slopeCoord = local.dot(bevel.slope);
        const ellipseValue =
            (tangentCoord * tangentCoord) / (bevel.radius * bevel.radius) +
            (slopeCoord * slopeCoord) / (bevel.slopeRadius * bevel.slopeRadius);
        if (
            point.z < bevel.zMin - 1e-6 ||
            point.z > bevel.zMax + 1e-6 ||
            ellipseValue > 1 + 1e-6
        ) {
            return null;
        }
        return { t, point };
    }

    private intersectAbbeCore(origin: Vector3, direction: Vector3): HitRecord | null {
        const f = this.focalLength;
        const ox = origin.x;
        const oy = origin.y;
        const ozC = origin.z + f;
        const b = ox * direction.x + oy * direction.y + ozC * direction.z;
        const c = (ox * ox + oy * oy + ozC * ozC) - f * f;
        const disc = b * b - c;
        if (disc < 0) return null;

        const sqrtDisc = Math.sqrt(disc);
        const candidates = [-b - sqrtDisc, -b + sqrtDisc];
        let tHit = -1;
        for (const t of candidates) {
            if (t <= 1e-6) continue;
            const point = origin.clone().addScaledVector(direction, t);
            if (point.z >= -f - 1e-4 && point.z <= 0.001) {
                tHit = t;
                break;
            }
        }
        if (tHit <= 0) return null;

        const point = origin.clone().addScaledVector(direction, tHit);
        if (point.x * point.x + point.y * point.y > this.apertureRadius * this.apertureRadius) return null;

        const normal = new Vector3(point.x, point.y, point.z + f).normalize();
        return {
            t: tHit,
            point,
            normal: this.orientedAgainstRay(normal, direction),
            localPoint: point.clone(),
        };
    }

    private computeAplanaticDirection(
        ray: Ray,
        originLocal: Vector3,
        dirInLocal: Vector3,
        hitLocal: Vector3,
    ): { direction: Vector3; pupilOplOffset: number } | null {
        const pupilWaves = evaluateZernikeAberrationWaves(
            this.pupil?.aberrations ?? null,
            hitLocal.x / Math.max(this.pupilRadius || this.apertureRadius, 1e-9),
            hitLocal.y / Math.max(this.pupilRadius || this.apertureRadius, 1e-9),
        );
        const referenceWavelengthMm = (this.pupil?.aberrations?.referenceWavelengthNm ?? ray.wavelength * 1e9) * 1e-6;
        const pupilOplOffset = pupilWaves * referenceWavelengthMm;
        const f = this.focalLength;

        const hitRadSq = hitLocal.x * hitLocal.x + hitLocal.y * hitLocal.y;
        const dirRadSq = dirInLocal.x * dirInLocal.x + dirInLocal.y * dirInLocal.y;
        if (hitRadSq < 1e-14 && dirRadSq < 1e-14) {
            return { direction: dirInLocal.clone(), pupilOplOffset };
        }

        if (dirInLocal.z < 0) {
            const sx = f * dirInLocal.x;
            const sy = f * dirInLocal.y;
            const sz = -f;
            const target = new Vector3(sx, sy, sz);
            const direction = target.sub(hitLocal).normalize();
            if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 1e-18) {
                return { direction: dirInLocal.clone(), pupilOplOffset };
            }
            return { direction, pupilOplOffset };
        }

        let sx = originLocal.x;
        let sy = originLocal.y;
        if (Math.abs(dirInLocal.z) > 1e-12) {
            const tToFFP = (-f - originLocal.z) / dirInLocal.z;
            sx = originLocal.x + tToFFP * dirInLocal.x;
            sy = originLocal.y + tToFFP * dirInLocal.y;
        }

        const sinX = sx / f;
        const sinY = sy / f;
        const sinSq = sinX * sinX + sinY * sinY;
        if (sinSq >= 1) return null;
        return {
            direction: new Vector3(sinX, sinY, Math.sqrt(1 - sinSq)),
            pupilOplOffset,
        };
    }

    private interactSnoutZemaxEnvelope(ray: Ray, hit: HitRecord, envelope: SnoutZemaxEnvelopeRuntime): InteractionResult {
        const metrics = this.getMechanicalMetrics();
        const planes = this.getSnoutZemaxEnvelopePlanes(metrics);
        const bevel = this.getSnoutBevelPlane(metrics);
        if (!planes || !bevel || !hit.localPoint) return { rays: [] };

        const dirInLocal = (hit.localDirection?.clone()
            ?? ray.direction.clone().transformDirection(this.worldToLocal))
            .normalize();
        const entryLocal = hit.localPoint.clone();
        const entryWorld = hit.point.clone();

        const apertureOk = (point: Vector3, radius: number) =>
            point.x * point.x + point.y * point.y <= radius * radius + 1e-9;

        if (hit.surfaceIndex === OBJECTIVE_SURFACE_SNOUT_ENTRY && dirInLocal.z > 0) {
            const entryNormal = this.orientedAgainstRay(
                hit.localNormal?.clone() ?? hit.normal.clone().transformDirection(this.worldToLocal),
                dirInLocal,
            );
            const dirInsideTip = OpticMesh.refract(dirInLocal, entryNormal, 1.0, envelope.tipIndex);
            if (!dirInsideTip) return { rays: [] };

            const coreHit = this.intersectAbbeCore(entryLocal, dirInsideTip);
            if (!coreHit || !apertureOk(coreHit.point, envelope.stopRadius)) return { rays: [] };

            const originLocal = ray.origin.clone().applyMatrix4(this.worldToLocal);
            const transformed = this.computeAplanaticDirection(ray, originLocal, dirInLocal, coreHit.point);
            if (!transformed) return { rays: [] };

            const blackBoxExit = this.projectLocalRayToZ(coreHit.point, transformed.direction, planes.blackBoxExitZ, 0);
            if (blackBoxExit && !apertureOk(blackBoxExit.point, envelope.blackBoxRadius)) return { rays: [] };

            const imageStop = this.projectLocalRayToZ(coreHit.point, transformed.direction, planes.imageStopZ, 0);
            if (!imageStop || !apertureOk(imageStop.point, envelope.stopRadius)) return { rays: [] };

            const physicalExit = this.projectLocalRayToZ(coreHit.point, transformed.direction, metrics.zBack, 0);
            if (!physicalExit || !apertureOk(physicalExit.point, metrics.bodyR)) return { rays: [] };

            const exitPoint = physicalExit.point.clone().addScaledVector(transformed.direction, 1e-4);
            const exitWorld = exitPoint.applyMatrix4(this.localToWorld);
            const coreWorld = coreHit.point.clone().applyMatrix4(this.localToWorld);
            const imageStopWorld = imageStop.point.clone().applyMatrix4(this.localToWorld);
            const dirOutWorld = transformed.direction.clone().transformDirection(this.localToWorld).normalize();
            const opl = ray.opticalPathLength
                + hit.t
                + coreHit.t * envelope.tipIndex
                + physicalExit.t
                + transformed.pupilOplOffset;

            return {
                rays: [childRay(ray, {
                    origin: exitWorld,
                    direction: dirOutWorld,
                    opticalPathLength: opl,
                    entryPoint: entryWorld,
                    internalPath: [coreWorld, imageStopWorld],
                })],
            };
        }

        if (hit.surfaceIndex === OBJECTIVE_SURFACE_SNOUT_BACK && dirInLocal.z < 0) {
            const coreHit = this.intersectAbbeCore(entryLocal, dirInLocal);
            if (!coreHit || !apertureOk(coreHit.point, envelope.stopRadius)) return { rays: [] };

            const transformed = this.computeAplanaticDirection(ray, entryLocal, dirInLocal, coreHit.point);
            if (!transformed) return { rays: [] };

            const reverseAirDirection = transformed.direction.clone().negate();
            const normalAgainstReverseAir = this.orientedAgainstRay(bevel.normal, reverseAirDirection);
            const reverseInsideDirection = OpticMesh.refract(reverseAirDirection, normalAgainstReverseAir, 1.0, envelope.tipIndex);
            if (!reverseInsideDirection) return { rays: [] };
            const insideDirectionToBevel = reverseInsideDirection.negate();

            const bevelExit = this.intersectSnoutBevelWindow(coreHit.point, insideDirectionToBevel, bevel);
            if (!bevelExit) return { rays: [] };

            const exitWorld = bevelExit.point.clone().applyMatrix4(this.localToWorld);
            const coreWorld = coreHit.point.clone().applyMatrix4(this.localToWorld);
            const dirOutWorld = transformed.direction.clone().transformDirection(this.localToWorld).normalize();
            const opl = ray.opticalPathLength
                + hit.t
                + coreHit.t
                + bevelExit.t * envelope.tipIndex
                + transformed.pupilOplOffset;

            return {
                rays: [childRay(ray, {
                    origin: exitWorld,
                    direction: dirOutWorld,
                    opticalPathLength: opl,
                    entryPoint: entryWorld,
                    internalPath: [coreWorld],
                })],
            };
        }

        return { rays: [] };
    }

    private _updateBounds(): void {
        const metrics = this.getMechanicalMetrics();

        // Bounds must cover the physical barrel AND the optical Abbe sphere (starts at -f)
        // AND the principal plane (z=0.01)
        const minZ = Math.min(-this.focalLength, metrics.zFront);
        const maxZ = Math.max(0.01, metrics.zBack);

        this.bounds.set(
            new Vector3(-metrics.bodyR, -metrics.bodyR, minZ),
            new Vector3(metrics.bodyR, metrics.bodyR, maxZ)
        );
    }

    /**
     * Intersect: 
     * Applies the rigorous Abbe Sine Condition by intersecting with the 
     * Abbe Reference Sphere on the object side (facing -Z).
     * The sphere is centered at the focal point (0, 0, -f) with radius f.
     * Light coming from the back (+Z) intersects the flat principal plane at z=0.
     * 
     * Also fully encompasses the metal barrel geometry to block stray light!
     */
    intersect(rayLocal: Ray): HitRecord | null {
        // --- 1. PHYSICAL ENCLOSURE INTERSECTION ---
        const f = this.focalLength;
        const metrics = this.getMechanicalMetrics();
        const a = metrics.a;
        const bodyR = metrics.bodyR;
        const zFront = metrics.zFront;
        const zBack = metrics.zBack;
        const frontRadius = metrics.frontRadius;
        const zTaperStart = metrics.zTaperStart;
        const zTaperEnd = metrics.zTaperEnd;

        const ox = rayLocal.origin.x;
        const oy = rayLocal.origin.y;
        const oz = rayLocal.origin.z;
        const dx = rayLocal.direction.x;
        const dy = rayLocal.direction.y;
        const dz = rayLocal.direction.z;

        type EnclosureHitType = 'wall' | 'taper' | 'front' | 'back' | 'bevel';
        const candidates: {t: number, type: EnclosureHitType, r?: number}[] = [];
        const snoutBevel = this.getSnoutBevelPlane(metrics);

        const addCylinderCandidates = (
            radius: number,
            zMin: number,
            zMax: number,
            type: EnclosureHitType,
        ) => {
            if (zMax <= zMin + 1e-6 || radius <= 0) return;
            const A_cyl = dx * dx + dy * dy;
            const B_cyl = 2 * (ox * dx + oy * dy);
            const C_cyl = ox * ox + oy * oy - radius * radius;
            if (A_cyl <= 1e-12) return;
            const disc = B_cyl * B_cyl - 4 * A_cyl * C_cyl;
            if (disc < 0) return;
            const sqrtDisc = Math.sqrt(disc);
            for (const t of [
                (-B_cyl - sqrtDisc) / (2 * A_cyl),
                (-B_cyl + sqrtDisc) / (2 * A_cyl),
            ]) {
                if (t <= 1e-6) continue;
                const hz = oz + t * dz;
                if (hz < zMin || hz > zMax) continue;
                candidates.push({ t, type });
            }
        };

        const addConeCandidates = (
            rStart: number,
            zStart: number,
            rEnd: number,
            zEnd: number,
            type: EnclosureHitType,
        ) => {
            const dzTaper = zEnd - zStart;
            if (dzTaper <= 1e-6) return;
            const k = (rEnd - rStart) / dzTaper;
            const M = rStart - k * zStart; // R(z) = M + k*z
            const A_cone = dx * dx + dy * dy - k * k * dz * dz;
            const B_cone = 2 * (ox * dx + oy * dy - M * k * dz - k * k * oz * dz);
            const C_cone = ox * ox + oy * oy - M * M - 2 * M * k * oz - k * k * oz * oz;

            const maybeAdd = (t: number) => {
                if (t <= 1e-6) return;
                const hz = oz + t * dz;
                if (hz < zStart || hz > zEnd) return;
                const rAtZ = M + k * hz;
                if (rAtZ <= 0) return;
                candidates.push({ t, type });
            };

            if (Math.abs(A_cone) > 1e-12) {
                const disc = B_cone * B_cone - 4 * A_cone * C_cone;
                if (disc >= 0) {
                    const sqrtDisc = Math.sqrt(disc);
                    maybeAdd((-B_cone - sqrtDisc) / (2 * A_cone));
                    maybeAdd((-B_cone + sqrtDisc) / (2 * A_cone));
                }
            } else if (Math.abs(B_cone) > 1e-12) {
                maybeAdd(-C_cone / B_cone);
            }
        };

        if (this.mechanicalStyle === 'snout' && metrics.snoutLength > 1e-6) {
            addCylinderCandidates(frontRadius, zFront, zTaperStart, 'wall');
            if (snoutBevel) {
                const denom = dx * snoutBevel.normal.x + dy * snoutBevel.normal.y + dz * snoutBevel.normal.z;
                if (Math.abs(denom) > 1e-12) {
                    const tBevel = (
                        (snoutBevel.center.x - ox) * snoutBevel.normal.x +
                        (snoutBevel.center.y - oy) * snoutBevel.normal.y +
                        (snoutBevel.center.z - oz) * snoutBevel.normal.z
                    ) / denom;
                    if (tBevel > 1e-6) {
                        const hx = ox + tBevel * dx;
                        const hy = oy + tBevel * dy;
                        const hz = oz + tBevel * dz;
                        const local = new Vector3(hx, hy, hz).sub(snoutBevel.center);
                        const tangentCoord = local.dot(snoutBevel.tangent);
                        const slopeCoord = local.dot(snoutBevel.slope);
                        const ellipseValue =
                            (tangentCoord * tangentCoord) / (snoutBevel.radius * snoutBevel.radius) +
                            (slopeCoord * slopeCoord) / (snoutBevel.slopeRadius * snoutBevel.slopeRadius);
                        if (
                            hz >= snoutBevel.zMin - 1e-6 &&
                            hz <= snoutBevel.zMax + 1e-6 &&
                            ellipseValue <= 1 + 1e-6
                        ) {
                            candidates.push({ t: tBevel, type: 'bevel', r: Math.sqrt(hx * hx + hy * hy) });
                        }
                    }
                }
            }
        }
        addConeCandidates(frontRadius, zTaperStart, bodyR, zTaperEnd, 'taper');
        addCylinderCandidates(bodyR, zTaperEnd, zBack, 'wall');

        // 3. Intersect planes z = zFront, z = zBack
        let tFront = Infinity;
        let tBack = Infinity;
        if (Math.abs(dz) > 1e-12) {
            tFront = (zFront - oz) / dz;
            tBack = (zBack - oz) / dz;
        }

        if (!snoutBevel && tFront > 1e-6) {
            const hitX = ox + tFront * dx;
            const hitY = oy + tFront * dy;
            const r2 = hitX * hitX + hitY * hitY;
            if (r2 <= frontRadius * frontRadius) {
                candidates.push({t: tFront, type: 'front', r: Math.sqrt(r2)});
            }
        }
        if (tBack > 1e-6) {
            const hitX = ox + tBack * dx;
            const hitY = oy + tBack * dy;
            const r2 = hitX * hitX + hitY * hitY;
            if (r2 <= bodyR * bodyR) candidates.push({t: tBack, type: 'back', r: Math.sqrt(r2)});
        }

        if (candidates.length === 0) return null; // Missed entire physical bounds entirely

        candidates.sort((c1, c2) => c1.t - c2.t);
        const bboxHit = candidates[0];

        let isBlocked = true;

        if (bboxHit.type === 'wall' || bboxHit.type === 'taper') {
            isBlocked = true; // Side walls and taper are solid metal
        } else if (bboxHit.type === 'bevel') {
            isBlocked = false; // Entered through the 45-degree ground snout face
        } else if (bboxHit.type === 'front') {
            // Allow rays to pass if they are within the physical clear aperture,
            // which includes a buffer for the off-axis field of view (FOV).
            if (bboxHit.r !== undefined && bboxHit.r <= frontRadius) {
                isBlocked = false; // Entered clear aperture
            }
        } else if (bboxHit.type === 'back') {
            // The back clear aperture is defined by the principal plane size (this.apertureRadius)
            if (bboxHit.r !== undefined && bboxHit.r <= a) {
                isBlocked = false; // Entered clear back plane
            }
        }

        if (isBlocked) {
            const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(bboxHit.t));
            let normal = new Vector3(0, 0, 1);
            if (bboxHit.type === 'front') normal.set(0, 0, -1);
            else if (bboxHit.type === 'wall') normal.set(point.x, point.y, 0).normalize();
            else if (bboxHit.type === 'bevel' && snoutBevel) normal.copy(snoutBevel.normal);
            if (normal.dot(rayLocal.direction) > 0) normal.negate();
            
            return {
                t: bboxHit.t,
                point, // We calculate world point higher up in the component pipeline anyway, pipeline overrides this point field usually
                normal,
                localPoint: point,
                isBlocked: true
            };
        }

        const snoutEnvelope = this.getSnoutZemaxEnvelope();
        if (snoutEnvelope && (bboxHit.type === 'bevel' || bboxHit.type === 'front' || bboxHit.type === 'back')) {
            const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(bboxHit.t));
            let normal = new Vector3(0, 0, bboxHit.type === 'back' ? 1 : -1);
            if (bboxHit.type === 'bevel' && snoutBevel) normal = snoutBevel.normal.clone();
            normal = this.orientedAgainstRay(normal, rayLocal.direction);
            return {
                t: bboxHit.t,
                point,
                normal,
                localPoint: point.clone(),
                surfaceIndex: bboxHit.type === 'back' ? OBJECTIVE_SURFACE_SNOUT_BACK : OBJECTIVE_SURFACE_SNOUT_ENTRY,
            };
        }

        // --- 2. OPTICAL INTERSECTION (ABBE SINE CONDITION) ---
        // If we reach here, the ray entered through the clear glass aperture.
        // We now perform the standard mathematical Abbe intersection.
        const dw = rayLocal.direction.z;

        if (Math.abs(dw) < 1e-12) return null;

        let tHit = -1;
        let normal = new Vector3();

        // ALWAYS intersect Abbe Reference Sphere: Center C = (0, 0, -f), R = f
        // This is exactly required by the Abbe Sine Condition to eliminate spherical aberration
        // in BOTH forward and backward (infinity-space) ray paths!
        const ozC = rayLocal.origin.z + f;
        const b = ox * rayLocal.direction.x + oy * rayLocal.direction.y + ozC * dw;
        const c = (ox * ox + oy * oy + ozC * ozC) - f * f;
        const disc = b * b - c;

        const returnBlocked = () => {
            const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(bboxHit.t));
            const blockedNormal = (bboxHit.type === 'bevel' && snoutBevel)
                ? snoutBevel.normal.clone()
                : ((bboxHit.type === 'front') ? new Vector3(0, 0, -1) : new Vector3(0, 0, 1));
            if (blockedNormal.dot(rayLocal.direction) > 0) blockedNormal.negate();
            return {
                t: bboxHit.t,
                point,
                normal: blockedNormal,
                localPoint: point,
                isBlocked: true
            };
        };

        if (disc < 0) return returnBlocked();

        const t1 = -b - Math.sqrt(disc);
        const t2 = -b + Math.sqrt(disc);

        // We only want hits on the right hemisphere of the Abbe sphere (z >= -f)
        // This stops rays coming from the front being intercepted 2f in front of the objective.
        const checkFace = (t: number) => {
            if (t <= 1e-6) return false;
            const pt = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
            // Ensure the hit is between -f and 0.
            return pt.z >= -f - 1e-4; 
        };

        if (checkFace(t1)) tHit = t1;
        else if (checkFace(t2)) tHit = t2;

        if (tHit <= 0) {
            // No valid collision with the correct face of the sphere. 
            // If the ray is exiting the sphere and heading out, allow it to pass gracefully.
            return null;
        }

        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(tHit));
        
        // Exclude rays that hit the correct half of the sphere, but OUTSIDE the clear aperture.
        const rt2 = point.x * point.x + point.y * point.y;
        if (rt2 > this.apertureRadius * this.apertureRadius) {
            return returnBlocked();
        }

        if (point.z > 0.001) return returnBlocked(); // Must hit the front hemisphere (z <= 0)

        // Normal of the sphere at hit point points radially outward from center
        normal.set(point.x, point.y, point.z + f).normalize();
        // We want normal facing AGAINST the ray
        if (normal.dot(rayLocal.direction) > 0) normal.negate();

        return { t: tHit, point, normal, localPoint: point.clone() };
    }

    /**
     * Interact: aplanatic redirection on the Abbe reference sphere.
     *
     * Abbe sine condition: a sample point at height h on the front focal plane
     * (z = -f) corresponds to a parallel beam in image space whose angle θ to
     * the optical axis satisfies h = f · sin(θ). Equivalently, in direction
     * cosines, a unit parallel-beam direction d with optical-axis component
     * d.z maps to the focal-plane point (f · d.x, f · d.y, -f).
     *
     * We support both propagation senses:
     *   • FORWARD (ray from sample toward the pupil, dirInLocal.z > 0):
     *     The sample point is the ray's CURRENT origin projected onto the FFP.
     *     The outgoing direction is the parallel-beam direction determined by
     *     the aplanatic mapping: d_out = (s.x/f, s.y/f, +sqrt(1 - (s.x/f)² - (s.y/f)²)).
     *   • BACKWARD (ray from pupil toward sample, dirInLocal.z < 0):
     *     The incoming direction IS the parallel-beam direction, so
     *     sample_point = (f · d_in.x, f · d_in.y, -f). The outgoing direction
     *     points from the hit point toward the sample point, converging to it.
     *
     * Because each pixel's backward rays all share the same parallel-beam
     * direction (after the tube lens), they converge at the SAME sample point —
     * which is the conjugate of the pixel. Different pixels → different sample
     * points → an image forms. The earlier implementation pointed every
     * backward ray at (0, 0, -f), collapsing all pixels to a single sample
     * point and producing only noise.
     *
     * Because hit points lie on the Abbe reference sphere, the OPL from any
     * hit point to the conjugate focal-plane point is constant (= f · n). No
     * per-height phase correction is applied.
     */
    interact(ray: Ray, hit: HitRecord): InteractionResult {
        if (hit.isBlocked) {
            return { rays: [] }; // Ray crashed into the solid metal bounds
        }

        const snoutEnvelope = this.getSnoutZemaxEnvelope();
        if (
            snoutEnvelope &&
            (hit.surfaceIndex === OBJECTIVE_SURFACE_SNOUT_ENTRY || hit.surfaceIndex === OBJECTIVE_SURFACE_SNOUT_BACK)
        ) {
            return this.interactSnoutZemaxEnvelope(ray, hit, snoutEnvelope);
        }

        const dirInLocal = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const hitLocal = hit.localPoint!;
        const pupilWaves = evaluateZernikeAberrationWaves(
            this.pupil?.aberrations ?? null,
            hitLocal.x / Math.max(this.pupilRadius || this.apertureRadius, 1e-9),
            hitLocal.y / Math.max(this.pupilRadius || this.apertureRadius, 1e-9),
        );
        const referenceWavelengthMm = (this.pupil?.aberrations?.referenceWavelengthNm ?? ray.wavelength * 1e9) * 1e-6;
        const pupilOplOffset = pupilWaves * referenceWavelengthMm;
        const opl = ray.opticalPathLength + hit.t + pupilOplOffset;
        const f = this.focalLength;

        // Short-circuit when the hit point is essentially on the optical axis
        // AND the ray is on-axis (no bend needed, avoids division-by-zero).
        const hitRadSq = hitLocal.x * hitLocal.x + hitLocal.y * hitLocal.y;
        const dirRadSq = dirInLocal.x * dirInLocal.x + dirInLocal.y * dirInLocal.y;
        if (hitRadSq < 1e-14 && dirRadSq < 1e-14) {
            return {
                rays: [childRay(ray, {
                    origin: hit.point,
                    direction: ray.direction.clone(),
                    opticalPathLength: opl,
                })],
            };
        }

        let dirOutLocal: Vector3;

        if (dirInLocal.z < 0) {
            // BACKWARD: incoming parallel beam; aplanatic map sends it to sample
            // point (f · d.x, f · d.y, -f) on the front focal plane.
            const sx = f * dirInLocal.x;
            const sy = f * dirInLocal.y;
            const sz = -f;
            const vx = sx - hitLocal.x;
            const vy = sy - hitLocal.y;
            const vz = sz - hitLocal.z;
            const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (vLen < 1e-12) {
                // Hit point coincides with sample point — preserve direction.
                dirOutLocal = dirInLocal.clone();
            } else {
                dirOutLocal = new Vector3(vx / vLen, vy / vLen, vz / vLen);
            }
        } else {
            // FORWARD: ray originated at or near the FFP. Take the sample point
            // as the ray's intersection with z = -f. Outgoing direction is
            // the parallel-beam direction determined by that sample point.
            const originLocal = ray.origin.clone().applyMatrix4(this.worldToLocal);
            let sx = originLocal.x;
            let sy = originLocal.y;
            
            // Project along ray to the front focal plane (z = -f)
            if (Math.abs(dirInLocal.z) > 1e-12) {
                const tToFFP = (-f - originLocal.z) / dirInLocal.z;
                sx = originLocal.x + tToFFP * dirInLocal.x;
                sy = originLocal.y + tToFFP * dirInLocal.y;
            }

            const sinX = sx / f;
            const sinY = sy / f;
            const sinSq = sinX * sinX + sinY * sinY;
            if (sinSq >= 1) {
                // Outside the NA cone — treat as blocked.
                return { rays: [] };
            }
            const cosZ = Math.sqrt(1 - sinSq);
            dirOutLocal = new Vector3(sinX, sinY, cosZ);
        }

        const dirOutWorld = dirOutLocal.transformDirection(this.localToWorld).normalize();

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: dirOutWorld,
                opticalPathLength: opl,
            })],
        };
    }

    /** Formatted label for visualization. */
    get label(): string {
        const immersionStr = this.immersionIndex > 1.3
            ? (this.immersionIndex > 1.4 ? ' Oil' : ' Water')
            : '';
        return `${this.magnification}x / ${this.NA}${immersionStr}`;
    }

    // ── Helper methods for immersion bridges ─────────────────────────────

    /** Local Z coordinate of the sample-side principal plane. */
    getSampleSideLocalZ(): number {
        return -this.focalLength + this.workingDistance;
    }

    /** Optical aperture radius at the sample side based on NA and working distance. */
    getOpticalFrontRadius(): number {
        const maxSin = Math.min(Math.max(this.NA / this.immersionIndex, 0), 0.999999);
        const maxTan = maxSin / Math.sqrt(Math.max(1 - maxSin * maxSin, 1e-9));
        return this.workingDistance * maxTan;
    }

    /** Physical front radius (optical + margin). */
    getFrontRadius(): number {
        return Math.max(this.getOpticalFrontRadius() + 0.5, 2);
    }

    /** World-space position of the sample-side center. */
    getSampleSideCenterWorld(): Vector3 {
        this.updateMatrices();
        return new Vector3(0, 0, this.getSampleSideLocalZ()).applyMatrix4(this.localToWorld);
    }

    /** World-space normal pointing from sample toward objective. */
    getSampleSideNormalWorld(): Vector3 {
        this.updateMatrices();
        return new Vector3(0, 0, -1).transformDirection(this.localToWorld).normalize();
    }
}
