import { Vector3 } from 'three';
import { Ray, Coherence, childRay } from './types';
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
        // Pre-compute all component transform matrices once.
        // This avoids redundant rebuilds in the inner render loop
        // (otherwise updateMatrices() is called per-intersection: 10 components × 4096 pixels × N wavelengths).
        for (const comp of scene) {
            comp.updateMatrices();
        }
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
        const candidatePaths: Ray[][][] = [];

        // Camera world-space transform
        camera.updateMatrices();
        const m = camera.localToWorld;
        const camPos = new Vector3().setFromMatrixPosition(m);
        // Forward direction (optical axis)
        const camW = new Vector3(0, 0, 1).transformDirection(m).normalize();
        // Transverse axes (U = right, V = up)
        // We use local basis vectors (-1, -1) to match the UI's existing display logic
        const camU = new Vector3(-1, 0, 0).transformDirection(m).normalize();
        const camV = new Vector3(0, -1, 0).transformDirection(m).normalize();

        // Find the sample in the scene (for fluorescence metadata)
        const sample = this.scene.find(c => c instanceof Sample) as Sample | undefined;

        // Collect all active wavelengths in the forward illumination scene.
        // We trace each wavelength separately so chromatic aberration is visible,
        // but all wavelengths in a given MC sample share the same random direction/polarization
        // so they start from the same conditions and diverge only through optical dispersion.
        const activeWavelengths = new Set<number>();

        // Add the sample's emission wavelength for fluorescence backward tracing
        // Only if fluorescence is enabled — brightfield samples (efficiency=0) must NOT
        // inject the emission wavelength, or it routes through the fluorescence path
        // and bypasses the Mickey Mouse chord absorption geometry.
        const sampleEmissionWl = (sample && sample.fluorescenceEfficiency > 0)
            ? sample.getEmissionWavelength() * 1e-9
            : null;
        if (sampleEmissionWl) activeWavelengths.add(sampleEmissionWl);

        for (const branch of this.beamSegments) {
            if (branch.length > 0) activeWavelengths.add(branch[0].wavelength);
        }
        
        const wlList = Array.from(activeWavelengths);
        if (wlList.length === 0) wlList.push(532e-9);

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

                // Note: excitationImage is NOT populated here. The backward trace
                // already computes the complete sensor signal (illumination × sample
                // throughput) via traceBackward(). Querying the raw beam field at the
                // sensor would double-count the illumination when CameraViewer sums
                // both channels.

                // ── Monte Carlo backward emission: N samples per pixel ──
                let radianceSum = 0;

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

                    // Shared polarization for all wavelengths in this MC sample
                    const polAngle = Math.random() * Math.PI;
                    const polarization = { x: { re: Math.cos(polAngle), im: 0 }, y: { re: Math.sin(polAngle), im: 0 } };

                    // Trace ALL wavelengths through the same direction — collect as a bundle
                    const bundle: Ray[][] = [];
                    for (const wl of wlList) {
                        const backwardRay: Ray = {
                            origin: sensorPoint,
                            direction: backwardDir,
                            wavelength: wl,
                            intensity: 1.0, // Unit importance for throughput tracking
                            polarization,
                            opticalPathLength: 0,
                            footprintRadius: 0.1,
                            coherenceMode: Coherence.Incoherent,
                            isBackward: true,
                            sourceId: `solver3_px${px}_py${py}_s${s}_wl${Math.round(wl*1e9)}`,
                        };

                        const result = this.traceBackward(backwardRay, sample, camera);
                        radianceSum += result.radiance;

                        if (result.radiance > 0 && result.path.length > 1) {
                            bundle.push(result.path);
                        }
                    }

                    // Keep the full spectral bundle so all colors are drawn together
                    if (bundle.length > 0) {
                        candidatePaths.push(bundle);
                    }
                }

                // Average and store the pixel radiance!
                // Divide by wlList.length to average radiance across spectrum without artificially multiplying energy.
                emissionImage[py * resX + px] = radianceSum / (N * wlList.length);
            }
        }

        // Uniformly subsample ray BUNDLES for visualization.
        // Each bundle contains all wavelengths traced through the same direction,
        // so each drawn ray appears white unless chromatic aberration separates colors.
        // We use a golden-ratio sequence to avoid aliasing with the 2D grid dimensions.
        const selectedBundles: Ray[][][] = [];
        if (candidatePaths.length <= maxVisPaths) {
            selectedBundles.push(...candidatePaths);
        } else {
            const goldenConjugate = 0.618033988749895;
            for (let i = 0; i < maxVisPaths; i++) {
                const index = Math.floor((i * goldenConjugate) * candidatePaths.length) % candidatePaths.length;
                selectedBundles.push(candidatePaths[index]);
            }
        }

        // Flatten bundles: each bundle's individual wavelength paths become separate drawable paths
        for (const bundle of selectedBundles) {
            allPaths.push(...bundle);
        }

        return { emissionImage, excitationImage, paths: allPaths, resX, resY };
    }

    /**
     * Generator-based render: yields after each pixel row so the caller can
     * yield control to the browser (via requestAnimationFrame) between rows.
     * 
     * Usage (in OpticalTable):
     *   const gen = solver3.renderGenerator(camera, maxVisPaths);
     *   function step() {
     *     const { value, done } = gen.next();
     *     if (!done) { updateProgress(value.progress); requestAnimationFrame(step); }
     *     else { const result = value; ... }
     *   }
     *   step();
     */
    *renderGenerator(camera: Camera, maxVisPaths: number = 32): Generator<
        { progress: number },  // yielded per-row progress (0..1)
        Solver3Result,         // final return
        void
    > {
        const resX = camera.sensorResX;
        const resY = camera.sensorResY;
        const emissionImage = new Float32Array(resX * resY);
        const excitationImage = new Float32Array(resX * resY);
        const allPaths: Ray[][] = [];
        const candidatePaths: Ray[][][] = [];

        // Camera world-space transform
        camera.updateMatrices();
        const m = camera.localToWorld;
        const camPos = new Vector3().setFromMatrixPosition(m);
        // Forward direction (optical axis)
        const camW = new Vector3(0, 0, 1).transformDirection(m).normalize();
        // Transverse axes (U = right, V = up)
        // We use local basis vectors (-1, -1) to match the UI's existing display logic
        const camU = new Vector3(-1, 0, 0).transformDirection(m).normalize();
        const camV = new Vector3(0, -1, 0).transformDirection(m).normalize();

        const sample = this.scene.find(c => c instanceof Sample) as Sample | undefined;

        const activeWavelengths = new Set<number>();
        const sampleEmissionWl = (sample && sample.fluorescenceEfficiency > 0)
            ? sample.getEmissionWavelength() * 1e-9
            : null;
        if (sampleEmissionWl) activeWavelengths.add(sampleEmissionWl);
        for (const branch of this.beamSegments) {
            if (branch.length > 0) activeWavelengths.add(branch[0].wavelength);
        }
                const wlList = Array.from(activeWavelengths);
                if (wlList.length === 0) wlList.push(532e-9);
        
                const sinThetaMax = Math.min(camera.sensorNA, 1.0);
        
        const N = camera.samplesPerPixel;

        for (let py = 0; py < resY; py++) {
            for (let px = 0; px < resX; px++) {
                const u = ((px + 0.5) / resX - 0.5) * camera.width;
                const v = ((py + 0.5) / resY - 0.5) * camera.height;

                const sensorPoint = camPos.clone()
                    .add(camU.clone().multiplyScalar(u))
                    .add(camV.clone().multiplyScalar(v));

                // excitationImage not populated — backward trace already computes
                // the complete sensor signal (see render() comment).

                let radianceSum = 0;
                for (let s = 0; s < N; s++) {
                    const phi = Math.random() * 2 * Math.PI;
                    const sinTheta = sinThetaMax * Math.sqrt(Math.random());
                    const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);

                    const backwardDir = camW.clone().multiplyScalar(cosTheta)
                        .add(camU.clone().multiplyScalar(sinTheta * Math.cos(phi)))
                        .add(camV.clone().multiplyScalar(sinTheta * Math.sin(phi)))
                        .normalize();

                    const polAngle = Math.random() * Math.PI;
                    const polarization = { x: { re: Math.cos(polAngle), im: 0 }, y: { re: Math.sin(polAngle), im: 0 } };

                    const bundle: Ray[][] = [];
                    for (const wl of wlList) {
                        const backwardRay: Ray = {
                            origin: sensorPoint,
                            direction: backwardDir,
                            wavelength: wl,
                            intensity: 1.0, // Unit importance for throughput tracking
                            polarization,
                            opticalPathLength: 0,
                            footprintRadius: 0.1,
                            coherenceMode: Coherence.Incoherent,
                            isBackward: true,
                            sourceId: `solver3_px${px}_py${py}_s${s}_wl${Math.round(wl*1e9)}`,
                        };

                        const result = this.traceBackward(backwardRay, sample, camera);
                        radianceSum += result.radiance;
                        if (result.radiance > 0 && result.path.length > 1) {
                            bundle.push(result.path);
                        }
                    }
                    if (bundle.length > 0) {
                        candidatePaths.push(bundle);
                    }
                }
                emissionImage[py * resX + px] = radianceSum / (N * wlList.length);
            }

            // Yield after each row so the caller can give control back to the browser
            yield { progress: (py + 1) / resY };
        }

        // Subsample bundles for visualization
        const selectedBundles: Ray[][][] = [];
        if (candidatePaths.length <= maxVisPaths) {
            selectedBundles.push(...candidatePaths);
        } else {
            const goldenConjugate = 0.618033988749895;
            for (let i = 0; i < maxVisPaths; i++) {
                const index = Math.floor((i * goldenConjugate) * candidatePaths.length) % candidatePaths.length;
                selectedBundles.push(candidatePaths[index]);
            }
        }
        for (const bundle of selectedBundles) {
            allPaths.push(...bundle);
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
        
        // Collect wavelengths with same Lamp-deduplication as render()
        const activeWavelengths = new Set<number>();
        const sampleEmissionWl = sample ? sample.getEmissionWavelength() * 1e-9 : null;
        if (sampleEmissionWl) activeWavelengths.add(sampleEmissionWl);

        const hasLamp = this.scene.some(c => c instanceof Lamp);
        if (hasLamp) {
            activeWavelengths.add(550e-9); // Single white representative for broadband
        }
        for (const branch of this.beamSegments) {
            if (branch.length === 0) continue;
            const wl = branch[0].wavelength;
            // Skip individual Lamp-range wavelengths (they're covered by 550nm white)
            if (hasLamp && wl >= 300e-9 && wl <= 850e-9) continue;
            activeWavelengths.add(wl);
        }
        const wlList = Array.from(activeWavelengths);
        if (wlList.length === 0) wlList.push(532e-9);
        
        const sinThetaMax = Math.min(pmt.sensorNA, 1.0);
        const N = pmt.samplesPerPixel;

        // Pinhole-aware sampling: if there's an aperture very close in front of the PMT,
        // we should fire rays TOWARDS the aperture opening instead of random cone sampling.
        // This dramatically improves confocal scan efficiency.
        let targetApertureCenter: Vector3 | null = null;
        let targetApertureRadius = 0;
        
        const searchRay = { origin: pmtPos, direction: pmtW };
        for (const comp of this.scene) {
            if (comp === pmt) continue;
            const hit = comp.chkIntersection(searchRay as any);
            if (hit && hit.t < 100) { // Within 100mm
                if (comp.constructor.name === 'Aperture' || comp.constructor.name === 'SlitAperture') {
                    targetApertureCenter = hit.point;
                    targetApertureRadius = (comp as any).openingDiameter / 2 || (comp as any).slitWidth / 2 || 1.0;
                    break;
                }
            }
        }

        let radianceSum = 0;
        let bestPath: Ray[] | null = null;
        let bestRadiance = 0;

        for (let s = 0; s < N; s++) {
            let backwardDir: Vector3;

            if (targetApertureCenter && Math.random() < 0.9) {
                // Importance sample the aperture: pick a random point in the hole
                const phi = Math.random() * 2 * Math.PI;
                const r = targetApertureRadius * Math.sqrt(Math.random());
                // Aperture is in the UV plane of the component. 
                // Since we hit it with a ray along pmtW, we can use pmtU/pmtV as a proxy if they are aligned.
                // Better: just use a small perturbation around the vector to the center.
                const pointInHole = targetApertureCenter.clone()
                    .add(pmtU.clone().multiplyScalar(r * Math.cos(phi)))
                    .add(pmtV.clone().multiplyScalar(r * Math.sin(phi)));
                backwardDir = pointInHole.clone().sub(pmtPos).normalize();
            } else {
                // Standard cone sampling
                const phi = Math.random() * 2 * Math.PI;
                const sinTheta = sinThetaMax * Math.sqrt(Math.random());
                const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);

                backwardDir = pmtW.clone().multiplyScalar(cosTheta)
                    .add(pmtU.clone().multiplyScalar(sinTheta * Math.cos(phi)))
                    .add(pmtV.clone().multiplyScalar(sinTheta * Math.sin(phi)))
                    .normalize();
            }

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
                    isBackward: true,
                    sourceId: `pmt_bw_s${s}_wl${Math.round(wl*1e9)}`,
                };

                const result = this.traceBackward(backwardRay, sample, pmt);
                radianceSum += result.radiance;

                if (result.radiance > bestRadiance && result.path.length > 1) {
                    bestRadiance = result.radiance;
                    bestPath = result.path;
                }
            }
        }

        return { radiance: radianceSum / (N * wlList.length), bestPath };
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
        sample: Sample | undefined,
        originator?: OpticalComponent
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
                // Self-intersection guard
                if (depth === 0 && component === originator) continue;

                const hit = component.chkIntersection(currentRay);
                if (hit && hit.t < nearestT && hit.t > 0.001) {
                    nearestT = hit.t;
                    nearestHit = hit;
                    nearestComponent = component;
                }
            }

            if (!nearestHit || !nearestComponent) {
                // Cap the final segment so it doesn't draw to infinity
                currentRay.interactionDistance = 50;
                break;
            }

            currentRay.interactionDistance = nearestT;

            // ── Light source reached: terminate trace ──
            if (nearestComponent instanceof Laser || nearestComponent instanceof Lamp) {
                // Query the background field at the hit point
                const backgroundIntensity = Solver2.queryIntensityMultiBeam(
                    nearestHit.point, this.beamSegments, currentRay.wavelength
                );

                // Terminal ray at light source for visualization
                const terminalRay: Ray = {
                    origin: nearestHit.point,
                    direction: currentRay.direction.clone(),
                    wavelength: currentRay.wavelength,
                    intensity: Math.max(0.1, backgroundIntensity),
                    polarization: currentRay.polarization,
                    opticalPathLength: currentRay.opticalPathLength + nearestT,
                    footprintRadius: currentRay.footprintRadius,
                    coherenceMode: Coherence.Coherent,
                    sourceId: currentRay.sourceId,
                    terminationPoint: nearestHit.point.clone(),
                };
                path.push(terminalRay);

                // Total: transmitted illumination + any fluorescence accumulated at sample
                const transmitted = backgroundIntensity * throughput;
                return { radiance: transmitted + fluorescenceRadiance, path, absorbed: false };
            }

            // ── Sample hit: Unified Volumetric Integration ──
            // Every ray experiences the same physics: Beer-Lambert absorption
            // through the specimen geometry AND fluorescence emission from
            // excitation field. No mode-dependent branching.
            if (nearestComponent instanceof Sample && sample) {
                // 1. Beer-Lambert absorption through specimen geometry (Mickey spheres)
                const { chordLength, midT } = sample.computeChordLength(currentRay);
                throughput *= Math.exp(-sample.absorption * chordLength);

                // 2. Fluorescence: accumulate emission from excitation field along chord
                if (sample.fluorescenceEfficiency > 0) {
                    const emitsAtThisWl = sample.emissionSpectrum.getTransmission(currentRay.wavelength * 1e9);
                    if (emitsAtThisWl > 0.5) {
                        const chordSegments = sample.computeChordSegments(currentRay);
                        let fluorescenceSum = 0;
                        for (const seg of chordSegments) {
                            const segLen = seg.tEnd - seg.tStart;
                            if (segLen <= 0) continue;
                            const numSamples = Math.max(4, Math.ceil(segLen * 10));
                            let segRadianceSum = 0;
                            for (let i = 0; i < numSamples; i++) {
                                const fraction = (i + Math.random()) / numSamples;
                                const t = seg.tStart + fraction * segLen;
                                const samplePoint = currentRay.origin.clone().add(currentRay.direction.clone().multiplyScalar(t));
                                segRadianceSum += Solver2.queryIntensityMultiBeam(samplePoint, this.beamSegments, sample.getExcitationWavelength() * 1e-9);
                            }
                            fluorescenceSum += (segRadianceSum / numSamples) * sample.fluorescenceEfficiency * emitsAtThisWl * segLen;
                        }
                        fluorescenceRadiance += fluorescenceSum * throughput;
                    }
                }

                // 3. Continue tracing past the sample volume.
                // getVolumeIntersection can return null when the ray hits exactly on a
                // triangle edge of the BoxGeometry mesh (degenerate hit). Fall back to
                // the chord midpoint + generous offset to jump past the bounding box.
                const bounds = sample.getVolumeIntersection(currentRay);
                const jumpT = bounds
                    ? bounds.tFar + 0.01
                    : (midT > 0 ? midT + 20 : nearestT + 30);
                const nextRay = childRay(currentRay, {
                    origin: currentRay.origin.clone().add(currentRay.direction.clone().multiplyScalar(jumpT)),
                    direction: currentRay.direction.clone(),
                    intensity: currentRay.intensity,
                    opticalPathLength: currentRay.opticalPathLength + jumpT
                });
                currentRay = nextRay;
                path.push(nextRay);
                continue;
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
