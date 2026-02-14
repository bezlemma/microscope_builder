/**
 * EFieldVisualizer — 3D E-field vector visualization along Gaussian beam segments.
 *
 * Replaces the translucent beam envelope with physics-faithful E-field arrows
 * showing polarization state, phase, and beam width. Each cross-section disc
 * shows the instantaneous E-field direction scaled to the beam radius.
 *
 * Visual elements per segment:
 *  - Cross-section circle rims (red ellipses) at sample positions
 *  - E-field arrows from beam axis to the field tip
 *  - Helical envelope curve connecting E-field tips
 *  - Animated propagation (ωt phase advances with time)
 */
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
    Vector3,
    BufferGeometry,
    Float32BufferAttribute,
    Color,
} from 'three';
import { GaussianBeamSegment, beamRadius } from '../physics/Solver2';

// ─── Constants ──────────────────────────────────────────────────────────

const SAMPLES_PER_MM = 5;   // density: arrow cross-sections per mm of path
const HELIX_PER_MM = 5;     // density: helix samples per mm
const MIN_SAMPLES = 10;     // minimum samples for very short segments
const MAX_SAMPLES = 3000;   // cap to avoid GPU overload on very long paths
const ANIM_SPEED = 3.0;                 // rad/s for wave propagation
const DISPLAY_WAVELENGTH_BASE = 5.0;    // display wavelength (mm) at the reference wavelength
const REFERENCE_WAVELENGTH = 550e-9;    // reference wavelength (m) — middle of visible spectrum
const CIRCLE_SPACING_MM = 5;            // beam-width indicator circles every N mm
const CIRCLE_SEGMENTS = 32;             // vertices per circle ring

// ─── Wavelength to RGB ──────────────────────────────────────────────────

function wavelengthToRGB(wavelengthMeters: number): { r: number; g: number; b: number } {
    const wl = wavelengthMeters * 1e9;
    let r = 0, g = 0, b = 0;
    if (wl >= 380 && wl < 440) { r = -(wl - 440) / 60; b = 1.0; }
    else if (wl >= 440 && wl < 490) { g = (wl - 440) / 50; b = 1.0; }
    else if (wl >= 490 && wl < 510) { g = 1.0; b = -(wl - 510) / 20; }
    else if (wl >= 510 && wl < 580) { r = (wl - 510) / 70; g = 1.0; }
    else if (wl >= 580 && wl < 645) { r = 1.0; g = -(wl - 645) / 65; }
    else if (wl >= 645 && wl <= 780) { r = 1.0; }
    else { return { r: 0.5, g: 0.5, b: 0.5 }; }
    let factor = 1.0;
    if (wl >= 380 && wl < 420) factor = 0.3 + 0.7 * (wl - 380) / 40;
    else if (wl >= 645 && wl <= 780) factor = 0.3 + 0.7 * (780 - wl) / 135;
    return {
        r: Math.pow(r * factor, 0.8),
        g: Math.pow(g * factor, 0.8),
        b: Math.pow(b * factor, 0.8)
    };
}

// ─── Build a local coordinate frame perpendicular to beam direction ─────

function buildLocalFrame(dir: Vector3): { right: Vector3; up: Vector3 } {
    const d = dir.clone().normalize();
    // Choose an arbitrary "up" that isn't parallel to dir
    const worldUp = new Vector3(0, 0, 1);
    if (Math.abs(d.dot(worldUp)) > 0.9) worldUp.set(0, 1, 0);
    const right = new Vector3().crossVectors(d, worldUp).normalize();
    const up = new Vector3().crossVectors(right, d).normalize();
    return { right, up };
}

// ─── Interpolate beam radius at fractional position along segment ───────

function interpolatedBeamRadius(
    seg: GaussianBeamSegment,
    frac: number,
    axis: 'x' | 'y'
): number {
    const wavelengthMm = seg.wavelength * 1e3;
    const qStart = axis === 'x' ? seg.qx_start : seg.qy_start;
    const segLen = seg.start.distanceTo(seg.end);
    const z = frac * segLen;
    // q(z) = q_start + z
    const qz = { re: qStart.re + z, im: qStart.im };
    return beamRadius(qz, wavelengthMm);
}

// ─── Compute NORMALIZED E-field vector (amplitude ≤1, no beam-radius scaling) ─

function eFieldNormalized(
    seg: GaussianBeamSegment,
    frac: number,
    time: number,
    right: Vector3,
    up: Vector3,
    cumulativeZ: number
): Vector3 {
    const pol = seg.polarization;

    // Complex amplitudes
    const axAmp = Math.sqrt(pol.x.re * pol.x.re + pol.x.im * pol.x.im);
    const ayAmp = Math.sqrt(pol.y.re * pol.y.re + pol.y.im * pol.y.im);
    const phiX = Math.atan2(pol.x.im, pol.x.re);
    const phiY = Math.atan2(pol.y.im, pol.y.re);

    // Display wavenumber scaled to preserve relative frequency differences
    const wavelengthRatio = seg.wavelength / REFERENCE_WAVELENGTH;
    const displayLambda = DISPLAY_WAVELENGTH_BASE * wavelengthRatio;
    const k = (2 * Math.PI) / displayLambda;

    // Optical path length for phase continuity across boundaries
    const segLen = seg.start.distanceTo(seg.end);
    const n = seg.refractiveIndex || 1.0;
    const z = cumulativeZ + frac * segLen * n;

    // Instantaneous field: E = Re{A·exp(i(kz - ωt + φ))}
    const phase = k * z - ANIM_SPEED * time;
    const ex = axAmp * Math.cos(phase + phiX);
    const ey = ayAmp * Math.cos(phase + phiY);

    // Normalized field in world coords — NO beam-radius scaling.
    // Beam width scaling is applied AFTER superposition in the render loop.
    return new Vector3()
        .addScaledVector(right, ex)
        .addScaledVector(up, ey);
}

// ─── Evaluate a segment's E-field contribution at an arbitrary world point ──

interface SegmentWithFrame {
    segment: GaussianBeamSegment;
    key: string;
    cumulativeZ: number;
    right: Vector3;
    up: Vector3;
}

function eFieldContributionAt(
    seg: GaussianBeamSegment,
    worldPoint: Vector3,
    time: number,
    right: Vector3,
    up: Vector3,
    cumulativeZ: number
): Vector3 {
    const segLen = seg.start.distanceTo(seg.end);
    if (segLen < 0.1) return new Vector3();

    // Project point onto segment axis
    const toPoint = worldPoint.clone().sub(seg.start);
    const proj = toPoint.dot(seg.direction);

    // Only contribute within the segment bounds (small margin for continuity)
    if (proj < -0.5 || proj > segLen + 0.5) return new Vector3();
    const frac = Math.max(0, Math.min(1, proj / segLen));

    // Perpendicular distance from beam axis
    const onAxis = seg.start.clone().add(seg.direction.clone().multiplyScalar(proj));
    const perpDist = worldPoint.distanceTo(onAxis);

    // Beam radius at this position
    const wx = interpolatedBeamRadius(seg, frac, 'x');
    const wy = interpolatedBeamRadius(seg, frac, 'y');
    const maxW = Math.max(wx, wy, 0.01);

    // Skip if far from axis (beyond 3× beam radius — negligible)
    if (perpDist > 3 * maxW) return new Vector3();

    // Gaussian falloff for off-axis points
    const gaussFalloff = Math.exp(-2 * perpDist * perpDist / (maxW * maxW));

    // E-field computation (same physics as eFieldAtPhase)
    const pol = seg.polarization;
    const axAmp = Math.sqrt(pol.x.re * pol.x.re + pol.x.im * pol.x.im);
    const ayAmp = Math.sqrt(pol.y.re * pol.y.re + pol.y.im * pol.y.im);
    const phiX = Math.atan2(pol.x.im, pol.x.re);
    const phiY = Math.atan2(pol.y.im, pol.y.re);

    const wavelengthRatio = seg.wavelength / REFERENCE_WAVELENGTH;
    const displayLambda = DISPLAY_WAVELENGTH_BASE * wavelengthRatio;
    const k = (2 * Math.PI) / displayLambda;

    const n = seg.refractiveIndex || 1.0;
    const z = cumulativeZ + frac * segLen * n;
    const phase = k * z - ANIM_SPEED * time;

    const ex = axAmp * Math.cos(phase + phiX) * gaussFalloff;
    const ey = ayAmp * Math.cos(phase + phiY) * gaussFalloff;

    // Return NORMALIZED field (no beam-radius scaling) — uses contributing seg's local frame
    return new Vector3()
        .addScaledVector(right, ex)
        .addScaledVector(up, ey);
}

// ─── Time-independent envelope amplitude at an arbitrary world point ────────
// Returns the MAX possible field amplitude (Jones amplitude × Gaussian falloff)
// from a segment at a given point. Used to normalize superposed fields so that
// arrow peaks always equal beam width regardless of how many beams overlap.

function envelopeContributionAt(
    seg: GaussianBeamSegment,
    worldPoint: Vector3
): number {
    const segLen = seg.start.distanceTo(seg.end);
    if (segLen < 0.1) return 0;

    const toPoint = worldPoint.clone().sub(seg.start);
    const proj = toPoint.dot(seg.direction);
    if (proj < -0.5 || proj > segLen + 0.5) return 0;
    const frac = Math.max(0, Math.min(1, proj / segLen));

    const onAxis = seg.start.clone().add(seg.direction.clone().multiplyScalar(proj));
    const perpDist = worldPoint.distanceTo(onAxis);

    const wx = interpolatedBeamRadius(seg, frac, 'x');
    const wy = interpolatedBeamRadius(seg, frac, 'y');
    const maxW = Math.max(wx, wy, 0.01);
    if (perpDist > 3 * maxW) return 0;

    const gaussFalloff = Math.exp(-2 * perpDist * perpDist / (maxW * maxW));

    const pol = seg.polarization;
    const jonesAmp = Math.sqrt(
        pol.x.re * pol.x.re + pol.x.im * pol.x.im +
        pol.y.re * pol.y.re + pol.y.im * pol.y.im
    );
    return jonesAmp * gaussFalloff;
}

// ─── Per-Segment Visualizer ─────────────────────────────────────────────

interface SegmentEFieldProps {
    segment: GaussianBeamSegment;
    segKey: string;
    cumulativeZ: number;
    allSegments: SegmentWithFrame[];
}

const SegmentEField: React.FC<SegmentEFieldProps> = ({ segment, segKey, cumulativeZ, allSegments }) => {
    const arrowGeoRef = useRef<BufferGeometry>(null);
    const helixGeoRef = useRef<BufferGeometry>(null);

    const seg = segment;
    const segLen = seg.start.distanceTo(seg.end);
    if (segLen < 0.1) return null;

    const { right, up } = useMemo(() => buildLocalFrame(seg.direction), [seg.direction]);
    const rgb = useMemo(() => wavelengthToRGB(seg.wavelength), [seg.wavelength]);
    const beamColor = useMemo(() => new Color(rgb.r, rgb.g, rgb.b), [rgb]);

    // Density-based sample counts proportional to segment length
    const numCrossSections = Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.round(segLen * SAMPLES_PER_MM)));
    const numHelixSamples = Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.round(segLen * HELIX_PER_MM)));

    // Build arrow geometry (lines from axis to E-field tip) — updated each frame
    const arrowPositions = useMemo(() => new Float32Array(numCrossSections * 2 * 3), [numCrossSections]);
    // lineSegments needs pairs: (numHelixSamples-1) segments × 2 endpoints × 3 components
    const helixPositions = useMemo(() => new Float32Array((numHelixSamples - 1) * 2 * 3), [numHelixSamples]);

    useFrame(({ clock }: { clock: { getElapsedTime: () => number } }) => {
        const t = clock.getElapsedTime();

        // --- Update arrow lines (start→tip per cross-section) ---
        let ai = 0;
        for (let i = 0; i < numCrossSections; i++) {
            const frac = i / (numCrossSections - 1);
            const center = seg.start.clone().add(seg.direction.clone().multiplyScalar(frac * segLen));

            // Start with this segment's own normalized E-field
            const ef = eFieldNormalized(seg, frac, t, right, up, cumulativeZ);

            // Compute time-independent envelope sum for normalization
            const primaryPol = seg.polarization;
            let envSum = Math.sqrt(
                primaryPol.x.re * primaryPol.x.re + primaryPol.x.im * primaryPol.x.im +
                primaryPol.y.re * primaryPol.y.re + primaryPol.y.im * primaryPol.y.im
            );

            // Sum normalized contributions from ALL other segments (coherent superposition)
            for (const other of allSegments) {
                if (other.segment === seg) continue;
                ef.add(eFieldContributionAt(
                    other.segment, center, t,
                    other.right, other.up, other.cumulativeZ
                ));
                envSum += envelopeContributionAt(other.segment, center);
            }

            // Normalize by envelope sum so peaks = beam width (not amplitude)
            // envSum is time-independent → preserves sinusoidal wave shape
            if (envSum > 1) ef.multiplyScalar(1 / envSum);

            // Scale to primary beam radius — arrows trace the beam envelope
            const wx = interpolatedBeamRadius(seg, frac, 'x');
            const wy = interpolatedBeamRadius(seg, frac, 'y');
            ef.multiplyScalar(Math.max(wx, wy));

            // Arrow base (at beam axis)
            arrowPositions[ai++] = center.x;
            arrowPositions[ai++] = center.y;
            arrowPositions[ai++] = center.z;

            // Arrow tip (field vector endpoint)
            arrowPositions[ai++] = center.x + ef.x;
            arrowPositions[ai++] = center.y + ef.y;
            arrowPositions[ai++] = center.z + ef.z;
        }

        if (arrowGeoRef.current) {
            const attr = arrowGeoRef.current.getAttribute('position') as Float32BufferAttribute;
            if (attr) {
                attr.set(arrowPositions);
                attr.needsUpdate = true;
            }
        }

        // --- Update helix envelope (tip trace as connected line segments) ---
        // Compute points first, then write pairs
        const helixPoints: number[] = [];
        for (let i = 0; i < numHelixSamples; i++) {
            const frac = i / (numHelixSamples - 1);
            const center = seg.start.clone().add(seg.direction.clone().multiplyScalar(frac * segLen));

            // Superposed normalized E-field at this helix sample point
            const ef = eFieldNormalized(seg, frac, t, right, up, cumulativeZ);

            // Envelope normalization
            const primaryPol = seg.polarization;
            let envSum = Math.sqrt(
                primaryPol.x.re * primaryPol.x.re + primaryPol.x.im * primaryPol.x.im +
                primaryPol.y.re * primaryPol.y.re + primaryPol.y.im * primaryPol.y.im
            );
            for (const other of allSegments) {
                if (other.segment === seg) continue;
                ef.add(eFieldContributionAt(
                    other.segment, center, t,
                    other.right, other.up, other.cumulativeZ
                ));
                envSum += envelopeContributionAt(other.segment, center);
            }
            if (envSum > 1) ef.multiplyScalar(1 / envSum);

            // Scale to beam width
            const wx = interpolatedBeamRadius(seg, frac, 'x');
            const wy = interpolatedBeamRadius(seg, frac, 'y');
            ef.multiplyScalar(Math.max(wx, wy));

            helixPoints.push(center.x + ef.x, center.y + ef.y, center.z + ef.z);
        }
        // Write as pairs for lineSegments: segment i uses points i and i+1
        let hi = 0;
        for (let i = 0; i < numHelixSamples - 1; i++) {
            // Start of segment
            helixPositions[hi++] = helixPoints[i * 3];
            helixPositions[hi++] = helixPoints[i * 3 + 1];
            helixPositions[hi++] = helixPoints[i * 3 + 2];
            // End of segment
            helixPositions[hi++] = helixPoints[(i + 1) * 3];
            helixPositions[hi++] = helixPoints[(i + 1) * 3 + 1];
            helixPositions[hi++] = helixPoints[(i + 1) * 3 + 2];
        }

        if (helixGeoRef.current) {
            const attr = helixGeoRef.current.getAttribute('position') as Float32BufferAttribute;
            if (attr) {
                attr.set(helixPositions);
                attr.needsUpdate = true;
            }
        }
    });

    // ─── Beam-width indicator circles (static, every CIRCLE_SPACING_MM mm) ───
    const circlePositions = useMemo(() => {
        const numCircles = Math.max(1, Math.floor(segLen / CIRCLE_SPACING_MM));
        // Each circle: CIRCLE_SEGMENTS line segments × 2 endpoints × 3 components
        const posArr = new Float32Array(numCircles * CIRCLE_SEGMENTS * 2 * 3);
        let ci = 0;

        for (let c = 0; c < numCircles; c++) {
            // Place circles at CIRCLE_SPACING_MM intervals, offset by half spacing
            const dist = (c + 0.5) * CIRCLE_SPACING_MM;
            if (dist > segLen) break;
            const frac = dist / segLen;
            const center = seg.start.clone().add(seg.direction.clone().multiplyScalar(dist));
            const wx = interpolatedBeamRadius(seg, frac, 'x');
            const wy = interpolatedBeamRadius(seg, frac, 'y');

            for (let s = 0; s < CIRCLE_SEGMENTS; s++) {
                const angle0 = (s / CIRCLE_SEGMENTS) * Math.PI * 2;
                const angle1 = ((s + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;

                // Ellipse point in local (right, up) plane
                const p0 = center.clone()
                    .addScaledVector(right, Math.cos(angle0) * wx)
                    .addScaledVector(up, Math.sin(angle0) * wy);
                const p1 = center.clone()
                    .addScaledVector(right, Math.cos(angle1) * wx)
                    .addScaledVector(up, Math.sin(angle1) * wy);

                posArr[ci++] = p0.x; posArr[ci++] = p0.y; posArr[ci++] = p0.z;
                posArr[ci++] = p1.x; posArr[ci++] = p1.y; posArr[ci++] = p1.z;
            }
        }
        return posArr.slice(0, ci);
    }, [seg, segLen, right, up]);

    return (
        <group key={segKey}>

            {/* E-field arrows (axis → tip) — one line per cross-section */}
            <lineSegments frustumCulled={false}>
                <bufferGeometry ref={arrowGeoRef}>
                    <bufferAttribute
                        attach="attributes-position"
                        args={[arrowPositions, 3]}
                    />
                </bufferGeometry>
                <lineBasicMaterial
                    color={beamColor}
                    linewidth={1}
                    transparent
                    opacity={0.85}
                    depthTest={true}
                    toneMapped={false}
                />
            </lineSegments>

            {/* Helical envelope — tip trace curve, drawn as connected line segments */}
            <lineSegments frustumCulled={false}>
                <bufferGeometry ref={helixGeoRef}>
                    <bufferAttribute
                        attach="attributes-position"
                        args={[helixPositions, 3]}
                    />
                </bufferGeometry>
                <lineBasicMaterial
                    color={beamColor}
                    linewidth={1}
                    transparent
                    opacity={0.6}
                    depthTest={true}
                    toneMapped={false}
                />
            </lineSegments>

            {/* Beam-width indicator circles — static elliptical rings every 5mm */}
            {circlePositions.length > 0 && (
                <lineSegments frustumCulled={false}>
                    <bufferGeometry>
                        <bufferAttribute
                            attach="attributes-position"
                            args={[circlePositions, 3]}
                        />
                    </bufferGeometry>
                    <lineBasicMaterial
                        color={beamColor}
                        linewidth={1}
                        transparent
                        opacity={0.35}
                        depthTest={true}
                        toneMapped={false}
                    />
                </lineSegments>
            )}
        </group>
    );
};

// ─── Main EFieldVisualizer Component ────────────────────────────────────

interface EFieldVisualizerProps {
    beamSegments: GaussianBeamSegment[][];
}

export const EFieldVisualizer: React.FC<EFieldVisualizerProps> = ({ beamSegments }) => {
    // Filter & precompute local frames for all valid segments
    const validSegments: SegmentWithFrame[] = useMemo(() => {
        const result: SegmentWithFrame[] = [];
        for (let bi = 0; bi < beamSegments.length; bi++) {
            const segments = beamSegments[bi];
            let runningZ = 0;
            for (let si = 0; si < segments.length; si++) {
                const seg = segments[si];
                const segLen = seg.start.distanceTo(seg.end);
                if (segLen < 0.1) continue;

                const wavelengthMm = seg.wavelength * 1e3;
                const wxStart = beamRadius(seg.qx_start, wavelengthMm);
                const wyStart = beamRadius(seg.qy_start, wavelengthMm);
                const maxW = Math.max(wxStart, wyStart);
                if (maxW < 0.01 || maxW > 500) { runningZ += segLen * (seg.refractiveIndex || 1.0); continue; }

                const { right, up } = buildLocalFrame(seg.direction);
                result.push({
                    segment: seg,
                    key: `efield-${bi}-${si}`,
                    cumulativeZ: runningZ,
                    right,
                    up
                });
                const n = seg.refractiveIndex || 1.0;
                runningZ += segLen * n;
            }
        }
        return result;
    }, [beamSegments]);

    return (
        <group>
            {validSegments.map(({ segment, key, cumulativeZ }) => (
                <SegmentEField
                    key={key}
                    segment={segment}
                    segKey={key}
                    cumulativeZ={cumulativeZ}
                    allSegments={validSegments}
                />
            ))}
        </group>
    );
};
