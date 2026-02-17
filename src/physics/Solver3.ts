import { Vector3 } from 'three';
import { Ray, Coherence } from './types';
import { OpticalComponent } from './Component';
import { Camera } from './components/Camera';
import { Laser } from './components/Laser';
import { Lamp } from './components/Lamp';
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
     *
     * Monte Carlo backward path tracer: for each pixel, fires N rays
     * distributed within the pixel's acceptance cone (determined by sensorNA).
     * With correct optics, all rays converge to the same conjugate point → sharp.
     * Without optics, rays diverge → blurred/washed out.
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
        // Sensor rotated 90° CCW around W so world +Z (ears up) → image +V (up)
        const camU = new Vector3(0, -1, 0).applyQuaternion(camera.rotation).normalize();
        const camV = new Vector3(1, 0, 0).applyQuaternion(camera.rotation).normalize();

        // Find the sample in the scene (for fluorescence metadata)
        const sample = this.scene.find(c => c instanceof Sample) as Sample | undefined;

        // Emission wavelength for backward rays (fluorescence mode)
        const emissionWavelength = sample ? sample.getEmissionWavelength() * 1e-9 : 532e-9;
        const excitationWavelength = sample ? (sample.excitationSpectrum.getDominantPassWavelength() ?? 488) * 1e-9 : 488e-9;

        // Pixel acceptance cone: half-angle from sensor NA
        const sinThetaMax = Math.min(camera.sensorNA, 1.0);
        const N = camera.samplesPerPixel;

        for (let py = 0; py < resY; py++) {
            for (let px = 0; px < resX; px++) {
                // Map pixel to sensor position in world space
                const u = ((px + 0.5) / resX - 0.5) * camera.width;
                const v = ((py + 0.5) / resY - 0.5) * camera.height;

                const sensorPoint = camPos.clone()
                    .add(camU.clone().multiplyScalar(u))
                    .add(camV.clone().multiplyScalar(v));

                // Forward excitation: query Solver 2 beam field at this pixel
                const forwardIntensity = Solver2.queryIntensityMultiBeam(
                    sensorPoint, this.beamSegments
                );
                excitationImage[py * resX + px] = forwardIntensity;

                // ── Monte Carlo backward emission: N samples per pixel ──
                let radianceSum = 0;
                let bestPath: Ray[] | null = null;
                let bestRadiance = 0;

                for (let s = 0; s < N; s++) {
                    // Sample a random direction within the pixel's acceptance cone
                    // Uniform disk sampling in sin(θ) space, then convert to direction
                    const phi = Math.random() * 2 * Math.PI;
                    const sinTheta = sinThetaMax * Math.sqrt(Math.random());
                    const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);

                    // Perturbed direction in camera frame, then to world
                    const backwardDir = camW.clone().multiplyScalar(cosTheta)
                        .add(camU.clone().multiplyScalar(sinTheta * Math.cos(phi)))
                        .add(camV.clone().multiplyScalar(sinTheta * Math.sin(phi)))
                        .normalize();

                    const backwardRay: Ray = {
                        origin: sensorPoint,
                        direction: backwardDir,
                        wavelength: emissionWavelength,
                        intensity: 1.0,
                        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                        opticalPathLength: 0,
                        footprintRadius: 0.1,
                        coherenceMode: Coherence.Incoherent,
                        sourceId: `solver3_px${px}_py${py}_s${s}`,
                    };

                    const result = this.traceBackward(backwardRay, sample, excitationWavelength);
                    radianceSum += result.radiance;

                    // Keep the brightest path for visualization
                    if (result.radiance > bestRadiance && result.path.length > 1) {
                        bestRadiance = result.radiance;
                        bestPath = result.path;
                    }
                }

                // Average radiance across all samples
                emissionImage[py * resX + px] = radianceSum / N;

                // Store a subset of paths for visualization (use brightest sample)
                if (bestPath && this.shouldVisualizePath(px, py, resX, resY)) {
                    allPaths.push(bestPath);
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
     *
     * Physics:
     *   - The ray traces from camera → optics → sample → illumination source
     *   - When hitting a Sample: attenuate throughput by absorption (brightfield),
     *     accumulate fluorescence radiance from excitation beam query
     *   - When hitting a Lamp/Laser: return throughput × source power (transmitted light)
     *   - Total radiance = fluorescence + transmitted light
     */
    private traceBackward(
        startRay: Ray,
        sample: Sample | undefined,
        _excitationWavelength: number
    ): { radiance: number; path: Ray[] } {
        const path: Ray[] = [startRay];
        let currentRay = startRay;
        let throughput = 1.0;
        let fluorescenceRadiance = 0;

        for (let depth = 0; depth < this.maxDepth; depth++) {
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

            // ── Light source reached: brightfield transmission ──
            if (nearestComponent instanceof Laser || nearestComponent instanceof Lamp) {
                const sourcePower = (nearestComponent as any).power ?? 1.0;

                // Wavelength check: a Laser only contributes if it emits at
                // the backward ray's wavelength. This prevents the backward ray
                // (at emission λ) from picking up excitation sources that would
                // be blocked by filters in the real forward direction.
                // Lamps (broadband) always contribute.
                if (nearestComponent instanceof Laser) {
                    const laserWlM = (nearestComponent as Laser).wavelength * 1e-9; // nm → m
                    const rayWl = currentRay.wavelength; // already in meters
                    const tolerance = 15e-9; // ±15 nm acceptance window
                    if (Math.abs(laserWlM - rayWl) > tolerance) {
                        // Laser doesn't emit at backward ray's wavelength — no contribution
                        break;
                    }
                }

                // Terminal ray at light source for visualization
                const terminalRay: Ray = {
                    origin: nearestHit.point,
                    direction: currentRay.direction.clone(),
                    wavelength: currentRay.wavelength,
                    intensity: throughput * sourcePower,
                    polarization: currentRay.polarization,
                    opticalPathLength: currentRay.opticalPathLength + nearestT,
                    footprintRadius: currentRay.footprintRadius,
                    coherenceMode: Coherence.Incoherent,
                    sourceId: currentRay.sourceId,
                    terminationPoint: nearestHit.point.clone(),
                };
                path.push(terminalRay);

                // Total: transmitted illumination + any fluorescence from sample
                const transmitted = throughput * sourcePower;
                return { radiance: fluorescenceRadiance + transmitted, path };
            }

            // ── Sample hit: Beer-Lambert absorption + fluorescence, then CONTINUE ──
            if (nearestComponent instanceof Sample && sample) {
                const hitPoint = nearestHit.point;

                // Fluorescence: query excitation beam intensity at sample point
                const excitationIntensity = Solver2.queryIntensityMultiBeam(
                    hitPoint, this.beamSegments
                );
                if (excitationIntensity > 0) {
                    fluorescenceRadiance += throughput * excitationIntensity * (sample.fluorescenceEfficiency ?? 1e-4);
                }

                // Beer-Lambert absorption: T = exp(-α·d)
                // d = total chord length through sample geometry
                const chordLength = sample.computeChordLength(currentRay);
                throughput *= Math.exp(-(sample.absorption ?? 3.0) * chordLength);

                // Continue tracing through the sample (pass-through)
                const result = nearestComponent.interact(currentRay, nearestHit);
                if (result.rays.length === 0) break;

                const passRay = result.rays[0];
                passRay.sourceId = currentRay.sourceId;

                // Add intermediate path segment at sample for visualization
                const sampleSegRay: Ray = {
                    origin: hitPoint,
                    direction: passRay.direction.clone(),
                    wavelength: currentRay.wavelength,
                    intensity: throughput,
                    polarization: currentRay.polarization,
                    opticalPathLength: currentRay.opticalPathLength + nearestT,
                    footprintRadius: currentRay.footprintRadius,
                    coherenceMode: Coherence.Incoherent,
                    sourceId: currentRay.sourceId,
                };
                path.push(sampleSegRay);

                currentRay = passRay;

                if (throughput < 1e-6) break;
                continue;
            }

            // ── Normal optical element: refraction/reflection ──
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

        // Ray escaped without hitting a light source.
        // Only fluorescence (collected at sample interactions) contributes.
        // We do NOT query the beam field here because it would bypass spectral
        // filtering (e.g., emission filters blocking excitation wavelength).
        return { radiance: fluorescenceRadiance, path };
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
