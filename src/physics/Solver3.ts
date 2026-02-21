import { Vector3 } from 'three';
import { Ray, Coherence } from './types';
import { OpticalComponent } from './Component';
import { Camera } from './components/Camera';
import { Laser } from './components/Laser';
import { Lamp } from './components/Lamp';
import { PMT } from './components/PMT';
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
    render(camera: Camera, maxVisPaths: number = 32): Solver3Result {
        const resX = camera.sensorResX;
        const resY = camera.sensorResY;
        const emissionImage = new Float32Array(resX * resY);
        const excitationImage = new Float32Array(resX * resY);
        const allPaths: Ray[][] = [];
        const candidatePaths: Ray[][] = [];

        // Camera world-space transform
        camera.updateMatrices();
        const camPos = camera.position.clone();
        const camW = new Vector3(0, 0, 1).applyQuaternion(camera.rotation).normalize();
        const camU = new Vector3(-1, 0, 0).applyQuaternion(camera.rotation).normalize();
        const camV = new Vector3(0, -1, 0).applyQuaternion(camera.rotation).normalize();

        // Find the sample in the scene (for fluorescence metadata)
        const sample = this.scene.find(c => c instanceof Sample) as Sample | undefined;

        // Collect all active wavelengths in the forward illumination scene
        const activeWavelengths = new Set<number>();

        // We add the sample's emission wavelength FIRST so that if rays escape the system
        // it defaults to visualizing the emission color rather than excitation color.
        const sampleEmissionWl = sample ? sample.getEmissionWavelength() * 1e-9 : null;
        if (sampleEmissionWl) activeWavelengths.add(sampleEmissionWl);

        for (const branch of this.beamSegments) {
            if (branch.length > 0) activeWavelengths.add(branch[0].wavelength);
        }
        
        const wlList = Array.from(activeWavelengths);
        if (wlList.length === 0) wlList.push(532e-9); // Fallback

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

                    for (const wl of wlList) {
                        // Random polarization angle — fluorescence emission is unpolarized
                        const polAngle = Math.random() * Math.PI;
                        const backwardRay: Ray = {
                            origin: sensorPoint,
                            direction: backwardDir,
                            wavelength: wl,
                            intensity: 1.0,
                            polarization: { x: { re: Math.cos(polAngle), im: 0 }, y: { re: Math.sin(polAngle), im: 0 } },
                            opticalPathLength: 0,
                            footprintRadius: 0.1,
                            coherenceMode: Coherence.Coherent,
                            sourceId: `solver3_px${px}_py${py}_s${s}_wl${Math.round(wl*1e9)}`,
                        };

                        const result = this.traceBackward(backwardRay, sample);
                        radianceSum += result.radiance;

                        // We only keep paths that actually found light and contributed to the image!
                        if (result.radiance > bestRadiance && result.path.length > 1) {
                            bestRadiance = result.radiance;
                            bestPath = result.path;
                        }
                    }
                }

                // Average and store the pixel radiance!
                // Divide by wlList.length to average radiance across spectrum without artificially multiplying energy.
                emissionImage[py * resX + px] = radianceSum / (N * wlList.length);

                // Collect all successful paths for visualization.
                // We subsample these later to visually confirm full-field image mapping.
                if (bestPath) {
                    candidatePaths.push(bestPath);
                }
            }
        }

        // Uniformly subsample simulated rays for visualization.
        // We use a golden-ratio sequence to avoid aliasing with the 2D grid dimensions
        // (e.g. if we simply strided by 128 on a 64x64 grid, we'd only pick pixels from x=0).
        if (candidatePaths.length <= maxVisPaths) {
            allPaths.push(...candidatePaths);
        } else {
            const goldenConjugate = 0.618033988749895;
            for (let i = 0; i < maxVisPaths; i++) {
                const index = Math.floor((i * goldenConjugate) * candidatePaths.length) % candidatePaths.length;
                allPaths.push(candidatePaths[index]);
            }
        }

        return { emissionImage, excitationImage, paths: allPaths, resX, resY };
    }

    /**
     * Render a single "pixel" from a PMT at its current position.
     *
     * The PMT is treated as a 1-pixel camera: fires N backward rays within
     * the PMT's acceptance cone (sensorNA), traces each through the optics,
     * and queries excitation at the sample. Returns the averaged radiance
     * and the brightest surviving path for visualization.
     *
     * This reuses the exact same traceBackward() that Camera.render() uses.
     */
    renderPMTPixel(pmt: PMT): { radiance: number; bestPath: Ray[] | null } {
        pmt.updateMatrices();
        const pmtPos = pmt.position.clone();
        const pmtW = new Vector3(0, 0, 1).applyQuaternion(pmt.rotation).normalize();
        const pmtU = new Vector3(1, 0, 0).applyQuaternion(pmt.rotation).normalize();
        const pmtV = new Vector3(0, 1, 0).applyQuaternion(pmt.rotation).normalize();

        const sample = this.scene.find(c => c instanceof Sample) as Sample | undefined;
        
        const sinThetaMax = Math.min(pmt.sensorNA, 1.0);
        const N = pmt.samplesPerPixel;

        let radianceSum = 0;
        let bestPath: Ray[] | null = null;
        let bestRadiance = 0;

        for (let s = 0; s < N; s++) {
            // Sample a random direction within the PMT's acceptance cone
            const phi = Math.random() * 2 * Math.PI;
            const sinTheta = sinThetaMax * Math.sqrt(Math.random());
            const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);

            const backwardDir = pmtW.clone().multiplyScalar(cosTheta)
                .add(pmtU.clone().multiplyScalar(sinTheta * Math.cos(phi)))
                .add(pmtV.clone().multiplyScalar(sinTheta * Math.sin(phi)))
                .normalize();

            // Need same dynamic wavelength sampling for PMT or we get monochromatic noise
            const sampleEmissionWl = sample ? sample.getEmissionWavelength() * 1e-9 : 520e-9;
            const wlList = [sampleEmissionWl]; // Temporary fallback for PMT, though ideally it should loop too

            for (const wl of wlList) {
                const polAngle = Math.random() * Math.PI;
                const backwardRay: Ray = {
                    origin: pmtPos.clone(),
                    direction: backwardDir,
                    wavelength: wl,
                    intensity: 1.0,
                    polarization: { x: { re: Math.cos(polAngle), im: 0 }, y: { re: Math.sin(polAngle), im: 0 } },
                    opticalPathLength: 0,
                    footprintRadius: 0.1,
                    coherenceMode: Coherence.Coherent,
                    sourceId: `pmt_bw_s${s}_wl${Math.round(wl*1e9)}`,
                };

                const result = this.traceBackward(backwardRay, sample);
                radianceSum += result.radiance;

                if (result.radiance > bestRadiance && result.path.length > 1) {
                    bestRadiance = result.radiance;
                    bestPath = result.path;
                }
            }
        }

        return { radiance: radianceSum / N, bestPath };
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
    traceBackward(
        startRay: Ray,
        sample: Sample | undefined
    ): { radiance: number; path: Ray[]; absorbed: boolean } {
        const path: Ray[] = [startRay];
        let currentRay = startRay;
        let throughput = 1.0;
        let fluorescenceRadiance = 0;
        let absorbed = false;

        for (let depth = 0; depth < this.maxDepth; depth++) {
            let nearestT = Infinity;
            let nearestHit = null;
            let nearestComponent: OpticalComponent | null = null;

            for (const component of this.scene) {
                if (depth === 0 && (component instanceof Camera || component instanceof PMT)) continue;

                const hit = component.chkIntersection(currentRay);
                if (hit && hit.t < nearestT && hit.t > 0.001) {
                    nearestT = hit.t;
                    nearestHit = hit;
                    nearestComponent = component;
                }
            }

            // Debug: log full backward path for first ray
            if ((globalThis as any).__pmtPathLogDone !== true && nearestComponent) {
                console.log(`[BWD Path] depth=${depth} => ${nearestComponent.name} hit=(${nearestHit!.point.x.toFixed(2)}, ${nearestHit!.point.y.toFixed(2)}, ${nearestHit!.point.z.toFixed(2)}) rayDir=(${currentRay.direction.x.toFixed(4)}, ${currentRay.direction.y.toFixed(4)}, ${currentRay.direction.z.toFixed(4)})`);
            }

            if (!nearestHit || !nearestComponent) {
                // Cap the final segment so it doesn't draw to infinity
                currentRay.interactionDistance = 50;
                if ((globalThis as any).__pmtPathLogDone !== true) {
                    (globalThis as any).__pmtPathLogDone = true;
                    console.log(`[BWD Path] END (no more hits)`);
                }
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
                    coherenceMode: Coherence.Coherent,
                    sourceId: currentRay.sourceId,
                    terminationPoint: nearestHit.point.clone(),
                };
                path.push(terminalRay);

                // Total: transmitted illumination + any fluorescence from sample
                const transmitted = throughput * sourcePower;
                return { radiance: fluorescenceRadiance + transmitted, path, absorbed: false };
            }

            // ── Sample hit: Volumetric E&M Integration ──
            if (nearestComponent instanceof Sample && sample) {
                const bounds = sample.getVolumeIntersection(currentRay);
                if (!bounds) break; // Safety fallback
                
                // Camera ray mathematically and visually terminates at the near-plane
                const nearPoint = currentRay.origin.clone().add(currentRay.direction.clone().multiplyScalar(bounds.tNear));
                const farPoint = currentRay.origin.clone().add(currentRay.direction.clone().multiplyScalar(bounds.tFar));
                
                // 1. Query Background Illumination at the FAR plane (Light entering the sample block)
                // We ask for exactly our reverse ray's wavelength (e.g. 600nm red photon from Lamp).
                let backgroundIntensity = Solver2.queryIntensityMultiBeam(farPoint, this.beamSegments, currentRay.wavelength);
                
                // 2. Compute absorption through the entire sample slab
                // Beer-Lambert absorption: T = exp(-α·d) where d is chord length through Mickey Mouse
                const chordLength = sample.computeChordLength(currentRay);
                const transmission = Math.exp(-(sample.absorption ?? 3.0) * chordLength);
                
                // 3. Query Fluorescence (Emission from the internal E&M field)
                // We estimate the internal field by querying the midpoint of the chord.
                const midPoint = currentRay.origin.clone().add(currentRay.direction.clone().multiplyScalar((bounds.tNear + bounds.tFar) / 2));
                
                const isFluorescent = (sample.fluorescenceEfficiency ?? 1e-4) > 0;
                let integratedFluorescence = 0;
                
                // Only consider fluorescence if the reverse ray wavelength lies within the fluorophore's emission spectrum!
                const emitsAtThisWl = sample.emissionSpectrum.getTransmission(currentRay.wavelength * 1e9);
                
                if (isFluorescent && emitsAtThisWl > 0.05 && chordLength > 0) {
                    // Query excitation field (ALL wavelengths, but ideally should filter by excitation spectrum). 
                    // For now, assume any field intensity present is excitation light.
                    let excitationIntensity = Solver2.queryIntensityMultiBeam(midPoint, this.beamSegments);
                    integratedFluorescence = excitationIntensity * (sample.fluorescenceEfficiency ?? 1e-4) * emitsAtThisWl * chordLength;
                }
                
                // Final radiance exiting the near-plane toward the camera
                const exitingRadiance = (backgroundIntensity * transmission) + integratedFluorescence;
                
                // Apply the throughput gathered from the camera down to the sample
                const finalRadiance = exitingRadiance * throughput;
                
                // Visually terminate the camera ray exactly at the near-plane
                const terminalRay: Ray = {
                    origin: nearestHit.point, // entry point from intersect()
                    direction: currentRay.direction.clone(),
                    wavelength: currentRay.wavelength,
                    intensity: Math.max(0.1, exitingRadiance), // Keep path somewhat visible
                    polarization: currentRay.polarization,
                    opticalPathLength: currentRay.opticalPathLength + bounds.tNear,
                    footprintRadius: currentRay.footprintRadius,
                    coherenceMode: Coherence.Coherent,
                    sourceId: currentRay.sourceId,
                    terminationPoint: nearPoint, 
                };
                path.push(terminalRay);

                return { radiance: fluorescenceRadiance + finalRadiance, path, absorbed: false };
            }

            // ── Normal optical element: refraction/reflection ──
            const result = nearestComponent.interact(currentRay, nearestHit);

            if (result.rays.length === 0) {
                absorbed = true;
                break;
            }

            // Perform Stochastic Monte Carlo selection weighted by intensity
            let totalIntensity = 0;
            for (const child of result.rays) {
                totalIntensity += child.intensity;
            }

            if (totalIntensity < 1e-12) {
                absorbed = true; // All paths absorbed
                break;
            }

            let randomWeight = Math.random() * totalIntensity;
            let selectedChild = result.rays[0];
            
            for (const child of result.rays) {
                randomWeight -= child.intensity;
                if (randomWeight <= 0) {
                    selectedChild = child;
                    break;
                }
            }

            // In classical Monte Carlo, the weighting throughput remains exactly 1.0 
            // split ratio / pick probability (e.g. 0.5 / 0.5 = 1.0)
            // But we might be absorbing light, so throughput tracks the total surviving energy ratio
            if (currentRay.intensity > 1e-12) {
                throughput *= totalIntensity / currentRay.intensity;
            }

            if (result.passthrough && result.rays.length === 1) {
                // Lens passthrough: push the child ray so the visualizer can
                // draw the segment inside the lens (entryPoint/internalPath)
                selectedChild.sourceId = currentRay.sourceId;
                path.push(selectedChild);
                currentRay = selectedChild;
                continue;
            }

            selectedChild.interactionDistance = undefined;
            selectedChild.sourceId = currentRay.sourceId;
            path.push(selectedChild);
            currentRay = selectedChild;

            if (throughput < 1e-6) {
                absorbed = true;
                break;
            }
        }

        // Cap final ray segment so visualizer doesn't draw to infinity
        if (path.length > 0) {
            const last = path[path.length - 1];
            if (last.interactionDistance === undefined || last.interactionDistance > 2000) {
                last.interactionDistance = 2000;
            }
        }

        // Ray escaped without hitting a light source.
        // Only fluorescence (collected at sample interactions) contributes.
        // We do NOT query the beam field here because it would bypass spectral
        // filtering (e.g., emission filters blocking excitation wavelength).
        return { radiance: fluorescenceRadiance, path, absorbed };
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
