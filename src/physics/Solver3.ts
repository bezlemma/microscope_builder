import { Vector3 } from 'three';
import { Ray, Coherence } from './types';
import { OpticalComponent } from './Component';
import { Camera } from './components/Camera';
import { Laser } from './components/Laser';
import { Sample } from './components/Sample';
import { Solver2, GaussianBeamSegment } from './Solver2';

/**
 * Solver 3: Incoherent Imaging Engine (CPU)
 *
 * Backward Monte Carlo path tracer: traces rays from camera sensor pixels
 * backward through the optical system to the sample. At the sample, queries
 * Solver 2's Gaussian beam field to compute excitation intensity for
 * fluorescence, or evaluates absorption for brightfield transmission.
 *
 * This solver produces:
 *   1. A 64×64 image (radiance per pixel)
 *   2. Ray paths (reversed to forward direction) for visualization
 *
 * Key principle: Snell's law is reciprocal — backward refraction through
 * lenses works identically to forward. The dichroic/filter spectral
 * behavior uses the backward ray's wavelength (emission λ for fluorescence).
 */

export interface Solver3Result {
    emissionImage: Float32Array;    // Backward fluorescence radiance per pixel
    excitationImage: Float32Array;  // Forward excitation (Solver 2 beam) per pixel
    paths: Ray[][];                 // Backward-traced ray paths (for visualization)
    resX: number;
    resY: number;
}

export class Solver3 {
    private scene: OpticalComponent[];
    private beamSegments: GaussianBeamSegment[][];
    private maxDepth: number = 20;

    constructor(scene: OpticalComponent[], beamSegments: GaussianBeamSegment[][]) {
        this.scene = scene;
        this.beamSegments = beamSegments;
    }

    /**
     * Render an image from the given camera.
     * Traces backward rays from each sensor pixel through the optics.
     */
    render(camera: Camera): Solver3Result {
        const resX = camera.sensorResX;
        const resY = camera.sensorResY;
        const emissionImage = new Float32Array(resX * resY);
        const excitationImage = new Float32Array(resX * resY);
        const allPaths: Ray[][] = [];

        // Camera world-space transform
        camera.updateMatrices();
        const camPos = camera.position.clone();
        const camW = new Vector3(0, 0, 1).applyQuaternion(camera.rotation).normalize();
        const camU = new Vector3(1, 0, 0).applyQuaternion(camera.rotation).normalize();
        const camV = new Vector3(0, 1, 0).applyQuaternion(camera.rotation).normalize();

        // Find the sample in the scene (for fluorescence metadata)
        const sample = this.scene.find(c => c instanceof Sample) as Sample | undefined;

        // Emission wavelength for backward rays (fluorescence mode)
        // If no sample with fluorescence, use a generic visible wavelength
        const emissionWavelength = sample ? sample.emissionNm * 1e-9 : 532e-9;
        const excitationWavelength = sample ? sample.excitationNm * 1e-9 : 488e-9;
        const efficiency = sample?.fluorescenceEfficiency ?? 1e-4;

        for (let py = 0; py < resY; py++) {
            for (let px = 0; px < resX; px++) {
                // Map pixel to sensor position in world space
                // Pixel (0,0) = bottom-left corner of sensor
                const u = ((px + 0.5) / resX - 0.5) * camera.width;
                const v = ((py + 0.5) / resY - 0.5) * camera.height;

                const sensorPoint = camPos.clone()
                    .add(camU.clone().multiplyScalar(u))
                    .add(camV.clone().multiplyScalar(v));

                // ── Forward excitation: query Solver 2 beam field at this pixel ──
                const forwardIntensity = Solver2.queryIntensityMultiBeam(
                    sensorPoint, this.beamSegments
                );
                excitationImage[py * resX + px] = forwardIntensity;

                // ── Backward emission: trace from this pixel through optics ──
                const backwardDir = camW.clone();
                const backwardRay: Ray = {
                    origin: sensorPoint,
                    direction: backwardDir,
                    wavelength: emissionWavelength,
                    intensity: 1.0,
                    polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                    opticalPathLength: 0,
                    footprintRadius: 0.1,
                    coherenceMode: Coherence.Incoherent,
                    sourceId: `solver3_px${px}_py${py}`,
                };

                const result = this.traceBackward(backwardRay, sample, excitationWavelength);
                // Scale by fluorescence efficiency so emission is comparable to excitation
                emissionImage[py * resX + px] = result.radiance * efficiency;

                // Store a subset of paths for visualization
                if (result.radiance > 0 && result.path.length > 1 && this.shouldVisualizePath(px, py, resX, resY)) {
                    allPaths.push(result.path);
                }
            }
        }

        return { emissionImage, excitationImage, paths: allPaths, resX, resY };
    }

    /**
     * Decide which pixel paths to visualize to avoid clutter.
     * Show a sparse grid of paths, plus the center pixel.
     */
    private shouldVisualizePath(px: number, py: number, resX: number, resY: number): boolean {

        if (px === Math.floor(resX / 2) && py === Math.floor(resY / 2)) return true;
        const step = Math.max(Math.floor(resX / 6), 1);
        return (px % step === Math.floor(step / 2)) && (py % step === Math.floor(step / 2));
    }

    /**
     * Trace a single backward ray through the optical system.
     * Returns the accumulated radiance and the ray path.
     */
    private traceBackward(
        startRay: Ray,
        sample: Sample | undefined,
        _excitationWavelength: number
    ): { radiance: number; path: Ray[] } {
        const path: Ray[] = [startRay];
        let currentRay = startRay;
        let throughput = 1.0;

        for (let depth = 0; depth < this.maxDepth; depth++) {
            // Stop if ray has passed beyond the sample into the illumination path
            if (depth > 0 && sample) {
                const toSample = sample.position.clone().sub(currentRay.origin);
                if (toSample.dot(currentRay.direction) < 0) {
                    break;
                }
            }


            let nearestT = Infinity;
            let nearestHit = null;
            let nearestComponent: OpticalComponent | null = null;

            for (const component of this.scene) {
                if (depth === 0 && component instanceof Camera) continue;

                const hit = component.chkIntersection(currentRay);
                if (hit && hit.t < nearestT && hit.t > 0.001) {
                    nearestT = hit.t;
                    nearestHit = hit;
                    nearestComponent = component;
                }
            }


            if (!nearestHit || !nearestComponent) {
                break;
            }

            currentRay.interactionDistance = nearestT;

            if (nearestComponent instanceof Laser) {
                break;
            }

            if (nearestComponent instanceof Sample && sample) {
                const hitPoint = nearestHit.point;

                // Widefield fluorescence: assume uniform illumination across
                // the sample. Image contrast comes from the sample GEOMETRY
                // (the intersection test filters which backward rays actually
                // hit the specimen) and the optical throughput.
                //
                // In a real widefield scope the condenser produces Köhler
                // illumination so excitation intensity is ~constant.
                const radiance = throughput;

                // Terminal ray segment at sample for visualization
                const terminalRay: Ray = {
                    origin: hitPoint,
                    direction: currentRay.direction.clone(),
                    wavelength: currentRay.wavelength,
                    intensity: radiance,
                    polarization: currentRay.polarization,
                    opticalPathLength: currentRay.opticalPathLength + nearestT,
                    footprintRadius: currentRay.footprintRadius,
                    coherenceMode: Coherence.Incoherent,
                    sourceId: currentRay.sourceId,
                    terminationPoint: hitPoint.clone(),
                };
                path.push(terminalRay);

                return { radiance, path };
            }

            const result = nearestComponent.interact(currentRay, nearestHit);

            if (result.rays.length === 0) {

                break;
            }

            // Take the brightest child ray for backward tracing
            let bestChild = result.rays[0];
            for (const child of result.rays) {
                if (child.intensity > bestChild.intensity) {
                    bestChild = child;
                }
            }


            if (currentRay.intensity > 1e-12) {
                throughput *= bestChild.intensity / currentRay.intensity;
            }


            if (result.passthrough && result.rays.length === 1) {
                currentRay.interactionDistance = undefined;
                bestChild.interactionDistance = undefined;
                currentRay = bestChild;
                continue;
            }


            bestChild.interactionDistance = undefined;
            bestChild.sourceId = currentRay.sourceId;
            path.push(bestChild);
            currentRay = bestChild;


            if (throughput < 1e-6) break;
        }

        return { radiance: 0, path };
    }

    /**
     * Query Solver 2's Gaussian beam field for excitation intensity at a point.
     * This is the "cross-channel query" — the backward ray carries emission λ,
     * but we query for excitation λ intensity.
     *
     * Currently unused (widefield mode assumes uniform illumination).
     * Reserved for future confocal/structured-illumination modes.
     */
    // @ts-ignore — intentionally unused, reserved for confocal mode
    private queryExcitationIntensity(
        point: Vector3,
        _excitationWavelength: number
    ): number {
        if (this.beamSegments.length === 0) return 0;

        // Use Solver2's multi-beam intensity query
        const totalIntensity = Solver2.queryIntensityMultiBeam(point, this.beamSegments);
        return totalIntensity;
    }
}
