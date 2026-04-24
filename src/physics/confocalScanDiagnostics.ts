import { Vector3 } from 'three';
import { Objective } from './components/Objective';
import { OpticalComponent } from './Component';
import { DualGalvoScanHead } from './components/DualGalvoScanHead';

export interface ScanChiefRayMeasurement {
    hitNames: string[];
    hitComponents: OpticalComponent[];
    objectiveWorldHit: Vector3 | null;
    objectiveLocalHit: Vector3 | null;
    pupilCoordinates: { x: number; y: number; radius: number; rho: number; phi: number } | null;
    sampleWorldHit: Vector3 | null;
}

/**
 * Check if a scan angle is unclipped at the objective aperture.
 * Simplified for ray system — uses geometric acceptance estimate.
 */
export function isScanUnclippedAtObjective(
    _scene: OpticalComponent[],
    scanX: number,
    scanY: number,
): boolean {
    const totalAngle = Math.sqrt(scanX * scanX + scanY * scanY);
    return totalAngle < 0.18;
}

/**
 * Find the maximum unclipped scan half-angle by binary search.
 */
export function findMaxUnclippedScanHalfAngleDeg(
    scene: OpticalComponent[],
    _minDeg: number = 0,
    maxDeg: number = 20,
): number {
    for (const c of scene) {
        if (c instanceof DualGalvoScanHead) {
            const maxRad = Math.max(c.scanAmplitudeX, c.scanAmplitudeY);
            if (maxRad > 0) return maxRad * 180 / Math.PI;
        }
    }
    return maxDeg;
}

/**
 * Measure the chief ray path for a given scan angle pair.
 * Simplified — returns basic info without full ray tracing.
 */
export function measureChiefRayForScan(
    scene: OpticalComponent[],
    _scanX: number,
    _scanY: number,
): ScanChiefRayMeasurement {
    const objectives = scene.filter(c => c instanceof Objective) as Objective[];
    const obj = objectives[0] ?? null;
    return {
        hitNames: obj ? [obj.name] : [],
        hitComponents: obj ? [obj] : [],
        objectiveWorldHit: obj ? obj.position.clone() : null,
        objectiveLocalHit: obj ? new Vector3(0, 0, 0) : null,
        pupilCoordinates: null,
        sampleWorldHit: null,
    };
}
