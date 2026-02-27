/**
 * SourceRayFactory — Creates initial source rays from Lasers and Lamps.
 *
 * Replaces three duplicate inline constructions in OpticalTable.tsx.
 * Uses Vector3(0, 0, 1) as the local forward direction (optical axis),
 * matching the component coordinate convention.
 */
import { Vector3 } from 'three';
import { OpticalComponent } from './Component';
import { Laser } from './components/Laser';
import { Lamp } from './components/Lamp';
import { PMT } from './components/PMT';
import { Sample } from './components/Sample';
import { Ray, Coherence } from './types';

/**
 * Build radius fractions for hierarchical ring distribution.
 * Level 0: full radius (marginal rays)
 * Level 1+: binary subdivision (1/2, 1/4, 3/4, 1/8, ...)
 */
function buildRadiusFractions(): number[] {
    const fractions: number[] = [1]; // ring 0 = marginal (full radius)
    let level = 1;
    while (fractions.length < 100) {
        const denom = 1 << level;
        for (let k = 1; k < denom; k += 2) {
            fractions.push(k / denom);
        }
        level++;
    }
    return fractions;
}

/** Cached radius fractions — only computed once. */
const RADIUS_FRACTIONS = buildRadiusFractions();

/** Ray counts per ring — outer ring is 24, inner rings are 12 each. */
const FIRST_RING_COUNT = 24;
const INNER_RING_COUNT = 12;


/**
 * Snap a ray count to the nearest ring boundary so that all
 * rings are complete (no partial circles). Rounds up.
 * Valid values: 24, 36, 48, 60, 72, 84, 96, 108, 120, ...
 */
export function snapToRingBoundary(n: number): number {
    if (n <= FIRST_RING_COUNT) return FIRST_RING_COUNT;
    // Round up to next multiple: first_ring + k * inner_ring
    const excess = n - FIRST_RING_COUNT;
    const k = Math.ceil(excess / INNER_RING_COUNT);
    return FIRST_RING_COUNT + k * INNER_RING_COUNT;
}

/**
 * Generate ring-distributed rays around a center ray.
 *
 * @param origin       Center of the beam at the source plane
 * @param direction    Beam propagation direction (normalized)
 * @param beamRadius   1/e² beam radius (mm)
 * @param totalRays    Number of marginal/fill rays (snapped to ring boundary)
 * @param wavelength   Wavelength in meters
 * @param intensity    Ray intensity (power or opacity)
 * @param coherenceMode Coherent or Incoherent
 * @param sourceId     Source component ID
 */
function generateRingRays(
    origin: Vector3,
    direction: Vector3,
    beamRadius: number,
    totalRays: number,
    wavelength: number,
    intensity: number,
    coherenceMode: number,
    sourceId: string,
): Ray[] {
    // Snap to ring boundary so we never have partial circles
    const snapped = snapToRingBoundary(totalRays);

    const rays: Ray[] = [];

    const up = new Vector3(0, 1, 0);
    if (Math.abs(direction.dot(up)) > 0.9) up.set(0, 0, 1);
    const right = new Vector3().crossVectors(direction, up).normalize();
    const trueUp = new Vector3().crossVectors(right, direction).normalize();

    let raysPlaced = 0;
    let ringIndex = 0;
    while (raysPlaced < snapped && ringIndex < RADIUS_FRACTIONS.length) {
        const ringRadius = beamRadius * RADIUS_FRACTIONS[ringIndex];
        const raysForThisRing = ringIndex === 0 ? FIRST_RING_COUNT : INNER_RING_COUNT;
        const angularOffset = ringIndex * Math.PI / 7;

        for (let i = 0; i < raysForThisRing; i++) {
            const phi = angularOffset + (i / raysForThisRing) * Math.PI * 2;
            const ringOffset = new Vector3()
                .addScaledVector(trueUp, Math.sin(phi) * ringRadius)
                .addScaledVector(right, Math.cos(phi) * ringRadius);

            const rNorm = RADIUS_FRACTIONS[ringIndex];
            const gaussIntensity = coherenceMode === Coherence.Coherent
                ? Math.exp(-2 * rNorm * rNorm)
                : intensity;

            rays.push({
                origin: origin.clone().add(ringOffset),
                direction: direction.clone().normalize(),
                wavelength,
                intensity: gaussIntensity,
                polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                opticalPathLength: 0,
                footprintRadius: 0,
                coherenceMode,
                sourceId,
            });
            raysPlaced++;
        }
        ringIndex++;
    }
    return rays;
}

/**
 * Create source rays from all Lasers and Lamps in the scene.
 *
 * @param components  All scene components
 * @param rayCount    Number of marginal/fill rays per source
 * @param mode        'full' = center + ring rays; 'center' = center ray only
 * @returns           Array of source rays ready for Solver 1
 */
export function createSourceRays(
    components: OpticalComponent[],
    rayCount: number,
    mode: 'full' | 'center' = 'full',
): Ray[] {
    const sourceRays: Ray[] = [];

    // ── Lasers ──
    const laserComps = components.filter(c => c instanceof Laser) as Laser[];
    for (const laser of laserComps) {
        const origin = laser.position.clone();
        const direction = new Vector3(0, 0, 1).applyQuaternion(laser.rotation).normalize();
        origin.add(direction.clone().multiplyScalar(3));

        const wavelength = laser.wavelength * 1e-9;

        // Center (main) ray
        sourceRays.push({
            origin: origin.clone(),
            direction: direction.clone(),
            wavelength,
            intensity: laser.power,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: Coherence.Coherent,
            isMainRay: true,
            sourceId: laser.id,
        });

        // Ring rays (marginal + fill)
        if (mode === 'full') {
            const totalRays = Math.max(1, rayCount);
            sourceRays.push(...generateRingRays(
                origin, direction, laser.beamRadius, totalRays,
                wavelength, laser.power, Coherence.Coherent, laser.id,
            ));
        }
    }

    // ── Lamps ──
    const lampComps = components.filter(c => c instanceof Lamp) as Lamp[];
    for (const lamp of lampComps) {
        const origin = lamp.position.clone();
        const direction = new Vector3(0, 0, 1).applyQuaternion(lamp.rotation).normalize();
        origin.add(direction.clone().multiplyScalar(3));

        const beamRadius = lamp.beamRadius;
        const intensity = lamp.additiveOpacity;

        for (const wavelengthNm of lamp.spectralWavelengths) {
            const wavelength = wavelengthNm * 1e-9;

            // Center (main) ray
            sourceRays.push({
                origin: origin.clone(),
                direction: direction.clone(),
                wavelength,
                intensity,
                polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                opticalPathLength: 0,
                footprintRadius: 0,
                coherenceMode: Coherence.Incoherent,
                isMainRay: true,
                sourceId: `${lamp.id}_${wavelengthNm}nm`,
            });

            // Ring rays
            if (mode === 'full') {
                const defaultRays = Math.max(1, rayCount);
                // Halve rays per wavelength for multi-band lamps
                const totalRays = defaultRays >= 16
                    ? Math.max(1, Math.floor(defaultRays / 2))
                    : defaultRays;

                sourceRays.push(...generateRingRays(
                    origin, direction, beamRadius, totalRays,
                    wavelength, intensity, Coherence.Incoherent,
                    `${lamp.id}_${wavelengthNm}nm`,
                ));
            }
        }
    }

    // ── PMT preview ray ──
    const pmtComps = components.filter(c => c instanceof PMT) as PMT[];
    for (const pmt of pmtComps) {
        pmt.updateMatrices();
        const pmtDir = new Vector3(0, 0, 1).applyQuaternion(pmt.rotation).normalize();
        const pmtOrigin = pmt.position.clone().add(pmtDir.clone().multiplyScalar(1));
        const sampleComp = components.find(c => c instanceof Sample) as Sample | undefined;
        const emWl = sampleComp ? sampleComp.getEmissionWavelength() * 1e-9 : 520e-9;
        sourceRays.push({
            origin: pmtOrigin,
            direction: pmtDir,
            wavelength: emWl,
            intensity: 0.3,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: Coherence.Coherent,
            sourceId: `pmt_preview_${pmt.id}`,
        });
    }

    return sourceRays;
}
