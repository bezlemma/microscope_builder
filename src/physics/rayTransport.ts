import { Vector3 } from 'three';
import { Ray, createRay, defaultRayMajorAxis, MIN_PHYSICAL_PACKET_RADIUS_MM, cloneJonesVector } from './types';
import { reflectVector } from './math_solvers';
import {
    GaussianAxisState,
    GaussianPacketQ,
    gaussianAxisStateFromQ,
    gaussianAxisStateToQ,
    gaussianPacketQFromAxisStates,
    propagateGaussianPacketQ,
    transformGaussianPacketQABCD,
} from './gaussianPacketState';

function phaseFromPathLength(deltaPathMm: number, wavelength: number): number {
    const wavelengthMm = wavelength * 1e3;
    if (!Number.isFinite(wavelengthMm) || Math.abs(wavelengthMm) < 1e-12) return 0;
    return (2 * Math.PI * deltaPathMm) / wavelengthMm;
}

function rayPacketQAtOrigin(ray: Ray): GaussianPacketQ {
    const wavelengthMm = Math.max(ray.wavelength * 1e3, 1e-12);
    const refractiveIndex = ray.currentMediumIndex ?? 1;
    return ray.packetQ ?? gaussianPacketQFromAxisStates(
        {
            sigma: ray.sigmaU ?? Math.max(ray.footprintRadius / 3, MIN_PHYSICAL_PACKET_RADIUS_MM / 3),
            curvatureRadius: ray.curvatureRadiusU ?? Number.POSITIVE_INFINITY,
        },
        {
            sigma: ray.sigmaV ?? Math.max(ray.footprintRadius / 3, MIN_PHYSICAL_PACKET_RADIUS_MM / 3),
            curvatureRadius: ray.curvatureRadiusV ?? Number.POSITIVE_INFINITY,
        },
        wavelengthMm,
        refractiveIndex,
    );
}

export function rayPacketQAtDistance(ray: Ray, distance: number): GaussianPacketQ {
    return propagateGaussianPacketQ(rayPacketQAtOrigin(ray), Math.max(distance, 0));
}

export function shiftGaussianAxisState(
    axis: GaussianAxisState,
    distance: number,
    wavelengthMm: number,
    refractiveIndex: number,
): GaussianAxisState {
    const q = gaussianAxisStateToQ(axis.sigma, axis.curvatureRadius, wavelengthMm, refractiveIndex);
    return gaussianAxisStateFromQ({ re: q.re + distance, im: q.im }, wavelengthMm, refractiveIndex);
}

export function propagateGaussianAxisState(
    axis: GaussianAxisState,
    distance: number,
    wavelengthMm: number,
    refractiveIndex: number,
): GaussianAxisState {
    return shiftGaussianAxisState(axis, Math.max(distance, 0), wavelengthMm, refractiveIndex);
}

export function projectMajorAxisToDirection(axis: Vector3 | undefined, direction: Vector3): Vector3 {
    const dir = direction.clone().normalize();
    const candidate = (axis ?? defaultRayMajorAxis(dir)).clone();
    const projected = candidate.sub(dir.clone().multiplyScalar(candidate.dot(dir)));
    if (projected.lengthSq() < 1e-12) {
        return defaultRayMajorAxis(dir);
    }
    return projected.normalize();
}

export function reflectMajorAxis(axis: Vector3 | undefined, direction: Vector3, normal: Vector3): Vector3 {
    const reflectedAxis = reflectVector((axis ?? defaultRayMajorAxis(direction)).clone(), normal.clone().normalize());
    return projectMajorAxisToDirection(reflectedAxis, direction);
}

export function rayTransverseSigmasAtDistance(ray: Ray, distance: number): { sigmaU: number; sigmaV: number } {
    const wavelengthMm = Math.max(ray.wavelength * 1e3, 1e-12);
    const refractiveIndex = ray.currentMediumIndex ?? 1;
    const propagatedQ = rayPacketQAtDistance(ray, distance);
    const propagatedAxisU = gaussianAxisStateFromQ(propagatedQ.uu, wavelengthMm, refractiveIndex);
    const propagatedAxisV = gaussianAxisStateFromQ(propagatedQ.vv, wavelengthMm, refractiveIndex);
    return {
        sigmaU: propagatedAxisU.sigma,
        sigmaV: propagatedAxisV.sigma,
    };
}

export function rayRepresentativeRadiusAtDistance(ray: Ray, distance: number): number {
    const sigmas = rayTransverseSigmasAtDistance(ray, distance);
    const support = 3 * Math.max(sigmas.sigmaU, sigmas.sigmaV);
    const geometric = Math.max((ray.majorLength ?? ray.footprintRadius ?? 0) + Math.max(distance, 0) * (ray.tanAlpha ?? 0), 0);
    return Math.max(support, geometric, MIN_PHYSICAL_PACKET_RADIUS_MM);
}

export interface TransportRayOptions {
    hitPoint?: Vector3;
    origin?: Vector3;
    direction?: Vector3;
    traveledDistance?: number;
    refractiveIndex?: number;
    currentMediumIndex?: number;
    intensity?: number;
    powerWeight?: number;
    polarization?: Ray['polarization'];
    majorAxis?: Vector3;
    majorLength?: number;
    tanAlpha?: number;
    eU?: number;
    eV?: number;
    sigmaU?: number;
    sigmaV?: number;
    curvatureRadiusU?: number;
    curvatureRadiusV?: number;
    packetQ?: GaussianPacketQ;
    opticalPathLength?: number;
    phase?: number;
    phaseShift?: number;
    nudge?: number;
    propagateFrame?: 'project' | 'reflect';
    surfaceNormal?: Vector3;
}

export function transportRay(parent: Ray, options: TransportRayOptions): Ray {
    const direction = (options.direction ?? parent.direction).clone().normalize();
    const traveledDistance = Math.max(
        options.traveledDistance
            ?? options.hitPoint?.distanceTo(parent.origin)
            ?? options.origin?.distanceTo(parent.origin)
            ?? 0,
        0,
    );
    const refractiveIndex = options.refractiveIndex ?? parent.currentMediumIndex ?? 1;
    const originBase = options.origin ?? options.hitPoint ?? parent.origin;
    const origin = originBase.clone().addScaledVector(direction, options.nudge ?? 0);
    const opticalPathLength = options.opticalPathLength ?? (parent.opticalPathLength + traveledDistance * refractiveIndex);
    const opticalPathDelta = opticalPathLength - parent.opticalPathLength;
    const phase = options.phase ?? ((parent.phase ?? phaseFromPathLength(parent.opticalPathLength, parent.wavelength))
        + phaseFromPathLength(opticalPathDelta, parent.wavelength)
        + (options.phaseShift ?? 0));
    const propagatedQ = propagateGaussianPacketQ(rayPacketQAtOrigin(parent), traveledDistance);
    const wavelengthMm = Math.max(parent.wavelength * 1e3, 1e-12);
    const axisU = gaussianAxisStateFromQ(propagatedQ.uu, wavelengthMm, refractiveIndex);
    const axisV = gaussianAxisStateFromQ(propagatedQ.vv, wavelengthMm, refractiveIndex);
    let majorAxis = options.majorAxis;
    if (!majorAxis) {
        majorAxis = options.propagateFrame === 'reflect' && options.surfaceNormal
            ? reflectMajorAxis(parent.majorAxis, direction, options.surfaceNormal)
            : projectMajorAxisToDirection(parent.majorAxis, direction);
    }

    return createRay({
        ...parent,
        origin,
        direction,
        intensity: options.intensity ?? options.powerWeight ?? parent.powerWeight ?? parent.intensity,
        powerWeight: options.powerWeight ?? parent.powerWeight ?? options.intensity ?? parent.intensity,
        currentMediumIndex: options.currentMediumIndex ?? parent.currentMediumIndex,
        polarization: options.polarization ? cloneJonesVector(options.polarization) : cloneJonesVector(parent.polarization),
        opticalPathLength,
        phase,
        majorAxis,
        majorLength: options.majorLength ?? Math.max(3 * Math.max(axisU.sigma, axisV.sigma), MIN_PHYSICAL_PACKET_RADIUS_MM),
        footprintRadius: Math.max(Math.SQRT2 * Math.max(axisU.sigma, axisV.sigma), MIN_PHYSICAL_PACKET_RADIUS_MM),
        tanAlpha: options.tanAlpha ?? parent.tanAlpha,
        eU: options.eU ?? parent.eU,
        eV: options.eV ?? parent.eV,
        sigmaU: options.sigmaU ?? axisU.sigma,
        sigmaV: options.sigmaV ?? axisV.sigma,
        curvatureRadiusU: options.curvatureRadiusU ?? axisU.curvatureRadius,
        curvatureRadiusV: options.curvatureRadiusV ?? axisV.curvatureRadius,
        packetQ: options.packetQ ?? propagatedQ,
        packetStateMode: 'explicit',
    });
}

export function applyReflectedPacketFrame(ray: Ray, parent: Ray, surfaceNormal: Vector3): Ray {
    return createRay({
        ...ray,
        majorAxis: reflectMajorAxis(parent.majorAxis, ray.direction, surfaceNormal),
    });
}

export function applyParaxialPacketTransform(
    ray: Ray,
    transformU: [number, number, number, number],
    transformV: [number, number, number, number] = transformU,
): Ray {
    const isIdentity = (m: [number, number, number, number]) =>
        Math.abs(m[0] - 1) < 1e-12
        && Math.abs(m[1]) < 1e-12
        && Math.abs(m[2]) < 1e-12
        && Math.abs(m[3] - 1) < 1e-12;
    if (isIdentity(transformU) && isIdentity(transformV)) return ray;

    const packetQ = transformGaussianPacketQABCD(rayPacketQAtDistance(ray, 0), transformU, transformV);
    const wavelengthMm = Math.max(ray.wavelength * 1e3, 1e-12);
    const refractiveIndex = ray.currentMediumIndex ?? 1;
    const axisU = gaussianAxisStateFromQ(packetQ.uu, wavelengthMm, refractiveIndex);
    const axisV = gaussianAxisStateFromQ(packetQ.vv, wavelengthMm, refractiveIndex);

    return createRay({
        ...ray,
        packetQ,
        packetStateMode: 'explicit',
        sigmaU: axisU.sigma,
        sigmaV: axisV.sigma,
        curvatureRadiusU: axisU.curvatureRadius,
        curvatureRadiusV: axisV.curvatureRadius,
        majorLength: Math.max(3 * Math.max(axisU.sigma, axisV.sigma), MIN_PHYSICAL_PACKET_RADIUS_MM),
    });
}

export function applyParaxialPacketTransformAtHit(
    parent: Ray,
    child: Ray,
    hitDistance: number,
    transformU: [number, number, number, number],
    transformV: [number, number, number, number] = transformU,
): Ray {
    const isIdentity = (m: [number, number, number, number]) =>
        Math.abs(m[0] - 1) < 1e-12
        && Math.abs(m[1]) < 1e-12
        && Math.abs(m[2]) < 1e-12
        && Math.abs(m[3] - 1) < 1e-12;
    if (isIdentity(transformU) && isIdentity(transformV)) return child;

    const inputQ = rayPacketQAtDistance(parent, Math.max(hitDistance, 0));
    const packetQ = transformGaussianPacketQABCD(inputQ, transformU, transformV);
    const wavelengthMm = Math.max(child.wavelength * 1e3, 1e-12);
    const refractiveIndex = child.currentMediumIndex ?? parent.currentMediumIndex ?? 1;
    const axisU = gaussianAxisStateFromQ(packetQ.uu, wavelengthMm, refractiveIndex);
    const axisV = gaussianAxisStateFromQ(packetQ.vv, wavelengthMm, refractiveIndex);

    return createRay({
        ...child,
        packetQ,
        packetStateMode: 'explicit',
        sigmaU: axisU.sigma,
        sigmaV: axisV.sigma,
        curvatureRadiusU: axisU.curvatureRadius,
        curvatureRadiusV: axisV.curvatureRadius,
        majorLength: Math.max(3 * Math.max(axisU.sigma, axisV.sigma), MIN_PHYSICAL_PACKET_RADIUS_MM),
        footprintRadius: Math.max(Math.SQRT2 * Math.max(axisU.sigma, axisV.sigma), MIN_PHYSICAL_PACKET_RADIUS_MM),
    });
}

export function applyPacketMediumIndex(ray: Ray, mediumIndex: number): Ray {
    const targetIndex = Math.max(mediumIndex, 1e-9);
    const currentIndex = ray.currentMediumIndex ?? 1;
    if (Math.abs(targetIndex - currentIndex) < 1e-12) return ray;

    if (!ray.packetQ && ray.packetStateMode !== 'explicit') {
        return createRay({
            ...ray,
            currentMediumIndex: targetIndex,
        });
    }

    const wavelengthMm = Math.max(ray.wavelength * 1e3, 1e-12);
    const sourceQ = ray.packetQ ?? gaussianPacketQFromAxisStates(
        {
            sigma: ray.sigmaU ?? Math.max(ray.footprintRadius / 3, MIN_PHYSICAL_PACKET_RADIUS_MM / 3),
            curvatureRadius: ray.curvatureRadiusU ?? Number.POSITIVE_INFINITY,
        },
        {
            sigma: ray.sigmaV ?? Math.max(ray.footprintRadius / 3, MIN_PHYSICAL_PACKET_RADIUS_MM / 3),
            curvatureRadius: ray.curvatureRadiusV ?? Number.POSITIVE_INFINITY,
        },
        wavelengthMm,
        currentIndex,
    );
    const axisU = gaussianAxisStateFromQ(sourceQ.uu, wavelengthMm, currentIndex);
    const axisV = gaussianAxisStateFromQ(sourceQ.vv, wavelengthMm, currentIndex);
    const packetQ = gaussianPacketQFromAxisStates(axisU, axisV, wavelengthMm, targetIndex);

    return createRay({
        ...ray,
        currentMediumIndex: targetIndex,
        packetQ,
        packetStateMode: 'explicit',
        sigmaU: axisU.sigma,
        sigmaV: axisV.sigma,
        curvatureRadiusU: axisU.curvatureRadius,
        curvatureRadiusV: axisV.curvatureRadius,
        majorLength: Math.max(3 * Math.max(axisU.sigma, axisV.sigma), MIN_PHYSICAL_PACKET_RADIUS_MM),
    });
}
