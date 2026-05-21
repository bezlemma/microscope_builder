import { Vector3 } from 'three';
import { Sample, type ColloidTrapZone } from './components/Sample';
import { TrappedBead } from './components/TrappedBead';
import { Coherence } from './types';
import { GaussianBeamSegment, BeamField } from './BeamField';

const PASSIVE_TRAP_RATE_PER_FIELD_DROP = 0.15;
const PASSIVE_TRAP_MIN_RELATIVE_CURVATURE = 1e-4;
const PASSIVE_TRAP_MIN_STIFFNESS_PER_SECOND = 0.5;
const PASSIVE_TRAP_MAX_STIFFNESS_PER_SECOND = 80;
const REFERENCE_COLLOID_TRAP_RESPONSE = trapMaterialResponse(0.0025, 1.59, 1.33);

export type TrapQuality = 'dark' | 'unstable' | 'marginal' | 'stable';

export interface TrapFieldDiagnostics {
    quality: TrapQuality;
    centerIntensity: number;
    localMaximum: boolean;
    probe: number;
    relativeCurvature: { x: number; y: number; z: number };
    stiffnessPerSecond: { x: number; y: number; z: number };
    branchCount: number;
}

function incidentTrapBranchesForBead(
    beamSegments: GaussianBeamSegment[][],
    beadId: string,
): GaussianBeamSegment[][] {
    const branches: GaussianBeamSegment[][] = [];

    for (const branch of beamSegments) {
        const first = branch[0];
        if (!first || first.coherenceMode !== Coherence.Coherent || first.power <= 1e-12) continue;

        const incidentBranch: GaussianBeamSegment[] = [];
        let touchesBead = false;
        for (const segment of branch) {
            const key = segment.bundleKey ?? '';
            const touchesThisBead = key.includes(beadId);
            if (touchesThisBead && key.includes('|glass|')) break;
            incidentBranch.push(segment);
            if (touchesThisBead) {
                touchesBead = true;
                break;
            }
        }
        if (touchesBead && incidentBranch.length > 0) branches.push(incidentBranch);
    }

    return branches;
}

export function trapMaterialResponse(radius: number, iorBead: number, iorMedium: number): number {
    const relativeIndex = iorBead / Math.max(1e-6, iorMedium);
    const relativeIndexSq = relativeIndex * relativeIndex;
    const indexTerm = (relativeIndexSq - 1) / (relativeIndexSq + 2);
    const volume = (4 * Math.PI * radius * radius * radius) / 3;
    return Math.max(0, indexTerm) * volume;
}

export function estimateTrapFieldDiagnostics(
    bead: TrappedBead,
    beamSegments: GaussianBeamSegment[][],
): TrapFieldDiagnostics | null {
    const trapBranches = incidentTrapBranchesForBead(beamSegments, bead.id);
    if (trapBranches.length === 0) return null;

    const materialResponse = trapMaterialResponse(bead.radius, bead.iorBead, bead.iorMedium);
    if (materialResponse <= 0 || REFERENCE_COLLOID_TRAP_RESPONSE <= 0) return null;

    bead.updateMatrices();
    const centerLocal = new Vector3(0, 0, 0);
    const probe = Math.max(bead.radius * 2, Math.min(bead.trapCaptureRadius * 0.25, 0.01), 0.0025);

    const intensityAtLocal = (localOffset: Vector3): number => {
        const worldPoint = localOffset.clone().applyMatrix4(bead.localToWorld);
        let total = 0;
        for (const branch of trapBranches) {
            total += BeamField.queryIntensity(worldPoint.x, worldPoint.y, worldPoint.z, branch)?.intensity ?? 0;
        }
        return total;
    };

    const centerIntensity = intensityAtLocal(centerLocal);
    if (centerIntensity <= 1e-12) {
        return null;
    }

    const sampleAxis = (axis: 'x' | 'y' | 'z') => {
        const positive = new Vector3();
        const negative = new Vector3();
        positive[axis] = probe;
        negative[axis] = -probe;
        return {
            plus: intensityAtLocal(positive),
            minus: intensityAtLocal(negative),
        };
    };

    const x = sampleAxis('x');
    const y = sampleAxis('y');
    const z = sampleAxis('z');
    const neighbors = [x.plus, x.minus, y.plus, y.minus, z.plus, z.minus];
    const localMaximum = neighbors.every(value => value <= centerIntensity * (1 + 1e-6));
    const curvatureX = (2 * centerIntensity - x.plus - x.minus) / (probe * probe);
    const curvatureY = (2 * centerIntensity - y.plus - y.minus) / (probe * probe);
    const curvatureZ = (2 * centerIntensity - z.plus - z.minus) / (probe * probe);
    const materialScale = materialResponse / REFERENCE_COLLOID_TRAP_RESPONSE;
    const gradientScale = Math.max(0, bead.gradientForceScale) / 1e6;
    const toRate = (curvature: number) =>
        Math.min(
            PASSIVE_TRAP_MAX_STIFFNESS_PER_SECOND,
            curvature * probe * probe * PASSIVE_TRAP_RATE_PER_FIELD_DROP * materialScale * gradientScale,
        );
    const relativeCurvature = {
        x: curvatureX * probe * probe / centerIntensity,
        y: curvatureY * probe * probe / centerIntensity,
        z: curvatureZ * probe * probe / centerIntensity,
    };
    const stiffnessPerSecond = {
        x: toRate(curvatureX),
        y: toRate(curvatureY),
        z: toRate(curvatureZ),
    };
    const minRelativeCurvature = Math.min(
        relativeCurvature.x,
        relativeCurvature.y,
        relativeCurvature.z,
    );
    const minStiffness = Math.min(
        stiffnessPerSecond.x,
        stiffnessPerSecond.y,
        stiffnessPerSecond.z,
    );

    const quality: TrapQuality = !localMaximum || minRelativeCurvature < PASSIVE_TRAP_MIN_RELATIVE_CURVATURE
        ? 'unstable'
        : minStiffness < PASSIVE_TRAP_MIN_STIFFNESS_PER_SECOND
            ? 'unstable'
            : minStiffness < 5
                ? 'marginal'
                : 'stable';

    return {
        quality,
        centerIntensity,
        localMaximum,
        probe,
        relativeCurvature,
        stiffnessPerSecond: {
            x: Math.max(0, stiffnessPerSecond.x),
            y: Math.max(0, stiffnessPerSecond.y),
            z: Math.max(0, stiffnessPerSecond.z),
        },
        branchCount: trapBranches.length,
    };
}

export function estimatePassiveColloidTrapZone(
    bead: TrappedBead,
    parentSample: Sample,
    beamSegments: GaussianBeamSegment[][],
): ColloidTrapZone | null {
    const diagnostics = estimateTrapFieldDiagnostics(bead, beamSegments);
    if (!diagnostics || diagnostics.quality === 'dark' || diagnostics.quality === 'unstable') {
        return null;
    }

    bead.updateMatrices();
    parentSample.updateMatrices();
    const centerInSample = new Vector3(0, 0, 0)
        .applyMatrix4(bead.localToWorld)
        .applyMatrix4(parentSample.worldToLocal);

    return {
        center: centerInSample,
        lateralRadius: bead.trapCaptureRadius,
        axialRange: bead.trapAxialCaptureRange,
        stiffnessPerSecond: Math.min(
            diagnostics.stiffnessPerSecond.x,
            diagnostics.stiffnessPerSecond.y,
            diagnostics.stiffnessPerSecond.z,
        ),
    };
}
