import React, { useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import {
    Vector3,
    Color,
    NormalBlending,
    AdditiveBlending,
    type Blending,
} from 'three';
import { LineSegments2, LineSegmentsGeometry, LineMaterial } from 'three-stdlib';
import { Ray, Coherence, polarizationToColor } from '../physics/types';
import { wavelengthToRGB } from '../physics/spectral';

type DisplayRGB = ReturnType<typeof wavelengthToRGB>;

function rgbToCSS(rgb: Pick<DisplayRGB, 'r' | 'g' | 'b'>, scale = 1): string {
    return `rgb(${Math.round(rgb.r * 255 * scale)}, ${Math.round(rgb.g * 255 * scale)}, ${Math.round(rgb.b * 255 * scale)})`;
}

/** Visualisation predicate: a ray is "thermal" — and so should render with
 *  the additive-blending wavelength colour rather than the laser-style
 *  coherent path — if it is either tagged Incoherent or coherent with a
 *  non-zero spectral bandwidth (e.g. one of a lamp's per-line sub-bundles).
 *  Pure-coherent rays with Δλ = 0 (lasers, structured sources) keep the
 *  laser look. */
function isThermalForDisplay(ray: Ray | undefined): boolean {
    if (!ray) return false;
    if (ray.coherenceMode === Coherence.Incoherent) return true;
    return (ray.bandwidth ?? 0) > 0;
}

function coherentDisplayRGB(wavelengthMeters: number): DisplayRGB {
    const nm = wavelengthMeters * 1e9;
    const rgb = wavelengthToRGB(nm);
    if (!rgb.isVisible || nm < 700 || nm > 800) return rgb;

    // Far red is physically dim on an sRGB display. Lift it into a nicer
    // single-line material color instead of rendering a second glow line per ray.
    const edge = Math.max(0, Math.min(1, (nm - 700) / 100));
    const lift = 0.14 + 0.18 * edge;
    return {
        ...rgb,
        r: Math.min(1, rgb.r + (1 - rgb.r) * lift),
        g: Math.min(1, rgb.g + lift * 0.25),
        b: Math.min(1, rgb.b + lift * 0.12),
    };
}

/** Defensive: accept either a Vector3 or a {x,y,z} plain object and return a Vector3. */
function toVec3(v: { x: number; y: number; z: number }): Vector3 {
    return v instanceof Vector3 ? v : new Vector3(v.x, v.y, v.z);
}

const MIN_DRAW_RELATIVE_INTENSITY = 1e-3;
const POLARIZATION_MIN_DRAW_RELATIVE_INTENSITY = 1e-6;
const OPEN_TAIL_RELATIVE_INTENSITY = 3e-2;

function terminalBranchRay(path: Ray[]): Ray | undefined {
    return path[path.length - 1];
}

function relativePathIntensity(path: Ray[], ray: Ray | undefined): number {
    const sourceIntensity = Math.max(path[0]?.intensity ?? 0, 1e-12);
    return Math.max(0, Math.min(1, (ray?.intensity ?? 0) / sourceIntensity));
}

export function isMainRayPath(path: Ray[]): boolean {
    return terminalBranchRay(path)?.isMainRay === true;
}

export function shouldDrawPolarizationPath(path: Ray[]): boolean {
    if (path.length === 0) return false;
    if (isMainRayPath(path)) return true;
    return relativePathIntensity(path, terminalBranchRay(path)) >= POLARIZATION_MIN_DRAW_RELATIVE_INTENSITY;
}

export function shouldDrawPolarizationOpenTail(path: Ray[]): boolean {
    return shouldDrawPolarizationPath(path);
}

function polarizationSegmentVisibility(relativeIntensity: number): number {
    const clamped = Math.max(0, Math.min(1, relativeIntensity));
    return Math.sqrt(clamped);
}

function stableSegmentKey(start: Vector3, end: Vector3): string {
    const q = (v: number) => Math.round(v * 1e6);
    return `${q(start.x)},${q(start.y)},${q(start.z)}>${q(end.x)},${q(end.y)},${q(end.z)}`;
}

function nextPowerOfTwo(value: number): number {
    let capacity = 1;
    while (capacity < value) capacity *= 2;
    return capacity;
}

export function coherentBranchDisplayStyle(
    relativeIntensity: number,
    maxOpacity: number,
): { opacity: number; lineWidth: number } {
    const visibility = Math.pow(Math.max(0, Math.min(1, relativeIntensity)), 0.25);
    return {
        opacity: Math.min(maxOpacity, visibility * maxOpacity),
        lineWidth: quantizeCoherentLineWidth(1.0 + 1.5 * visibility),
    };
}

export function terminalVisualizationDistance(
    ray: Pick<Ray, 'interactionDistance' | 'suppressOpenTail' | 'terminationPoint'> | undefined,
    shouldDrawOpenTail: boolean,
    allowSuppressedOpenTail: boolean = false,
): number | null {
    if (!ray || ray.terminationPoint) return null;

    // A finite hit distance means the ray really reaches an absorber/detector.
    // `suppressOpenTail` is only for infinite escape tails after bead scatter,
    // not for hiding the last physical segment into a component.
    if (ray.interactionDistance !== undefined) return ray.interactionDistance;
    if ((ray.suppressOpenTail && !allowSuppressedOpenTail) || !shouldDrawOpenTail) return null;
    return 1000;
}

export function openTailSuppressionExpired(path: Ray[]): boolean {
    const firstSuppressedIndex = path.findIndex(ray => ray.suppressOpenTail && !ray.suppressVisualization);
    if (firstSuppressedIndex < 0) return false;

    for (let i = firstSuppressedIndex; i < path.length - 1; i++) {
        const ray = path[i];
        const nextRay = path[i + 1];
        if (ray.suppressVisualization) break;
        if (ray.interactionDistance === undefined || !ray.interactionComponentId) continue;

        const currentDir = toVec3(ray.direction).clone().normalize();
        const nextDir = toVec3(nextRay.direction).clone().normalize();
        if (currentDir.dot(nextDir) < 0.999999) {
            return true;
        }
    }

    return false;
}

function redEdgeGlow(wavelengthMeters: number, opacity: number): { color: string; opacity: number; lineWidthBoost: number } | null {
    const nm = wavelengthMeters * 1e9;
    if (nm < 700 || nm > 800) return null;
    const edge = Math.max(0, Math.min(1, (nm - 700) / 100));
    return {
        color: 'rgb(255, 74, 48)',
        opacity: Math.min(0.22, Math.max(0, opacity) * (0.16 + 0.08 * edge)),
        lineWidthBoost: 2.5 + 1.5 * edge,
    };
}

/**
 * Animated pulsating glow line for the main ray (Solver 2 skeleton).
 * Sharp spike pulse that stays mostly at the wavelength color and briefly
 * flashes to a bright HDR glow — feels like a laser lasing.
 */
const PulsatingRayLine: React.FC<{
    points: Vector3[];
    wavelengthMeters: number;
    dashed: boolean;
    opacity?: number;
}> = ({ points, wavelengthMeters, dashed, opacity = 1 }) => {
    const lineRef = useRef<any>(null);
    const rgb = coherentDisplayRGB(wavelengthMeters);

    // Base color at the wavelength's natural brightness
    const baseColor = new Color(rgb.r, rgb.g, rgb.b);
    // HDR glow color: boost the wavelength color to >1.0 for bloom-like intensity
    // This keeps the hue but makes it "impossibly bright" during the spike
    const glowColor = new Color(
        rgb.r * 3.0 + 0.4,
        rgb.g * 3.0 + 0.4,
        rgb.b * 3.0 + 0.4
    );
    const mixedColor = new Color();
    const redGlow = redEdgeGlow(wavelengthMeters, opacity);

    useFrame(({ clock }) => {
        if (!lineRef.current) return;
        const elapsed = clock.getElapsedTime();

        // Sharp spike: pow(sin, 4) stays near 0 most of the time,
        // only briefly spikes to 1. This keeps the beam in its
        // natural color ~90% of the cycle.
        const sinVal = Math.sin(elapsed * 2.5); // ~2.5Hz cycle
        const spike = Math.pow(Math.max(0, sinVal), 4); // 0..1, sharp peak

        mixedColor.copy(baseColor).lerp(glowColor, spike);

        const mat = lineRef.current.material;
        if (mat && mat.color) {
            mat.color.copy(mixedColor);
        }

        // Subtle lineWidth throb: 4.5 → 6 on spike
        if (mat && mat.linewidth !== undefined) {
            mat.linewidth = 4.5 + spike * 1.5;
        }
    });

    const isTransparent = opacity < 0.999;
    return (
        <group>
            {redGlow && (
                <Line
                    points={points}
                    color={redGlow.color}
                    lineWidth={7 + redGlow.lineWidthBoost}
                    toneMapped={false}
                    transparent
                    opacity={redGlow.opacity}
                    depthWrite={false}
                    dashed={dashed}
                    dashSize={dashed ? 3 : undefined}
                    gapSize={dashed ? 2 : undefined}
                    depthTest={true}
                    renderOrder={0}
                    blending={AdditiveBlending}
                />
            )}
            <Line
                ref={lineRef}
                points={points}
                color={baseColor}
                lineWidth={4.5}
                toneMapped={false}
                transparent={isTransparent}
                opacity={opacity}
                depthWrite={!isTransparent}
                dashed={dashed}
                dashSize={dashed ? 3 : undefined}
                gapSize={dashed ? 2 : undefined}
                depthTest={true}
                renderOrder={1}
                blending={NormalBlending}
            />
        </group>
    );
};

interface RegularRayDraw {
    key: string;
    points: Vector3[];
    color: Pick<DisplayRGB, 'r' | 'g' | 'b'>;
    opacity: number;
    lineWidth: number;
    dashed: boolean;
    blending: Blending;
    renderOrder: number;
    depthWrite: boolean;
    /** When true, `points` is laid out as consecutive (start, end) pairs and
     *  each pair is rendered as a discrete segment. Used by the polarization
     *  view so segments with different polarizations don't share endpoints. */
    segments?: boolean;
    /** Per-vertex colors, one entry per point in `points`. When provided, the
     *  base `color` is set to white so the vertex colors come through cleanly
     *  on drei's Line material. */
    vertexColors?: Array<[number, number, number]>;
}

interface MainRayDraw {
    key: string;
    points: Vector3[];
    wavelength: number;
    dashed: boolean;
    opacity: number;
    glowEnabled: boolean;
}

function scaledRGB(rgb: Pick<DisplayRGB, 'r' | 'g' | 'b'>, scale: number): Pick<DisplayRGB, 'r' | 'g' | 'b'> {
    return { r: rgb.r * scale, g: rgb.g * scale, b: rgb.b * scale };
}

function quantizeCoherentLineWidth(lineWidth: number): number {
    if (lineWidth < 1.25) return 1;
    if (lineWidth < 1.75) return 1.25;
    return 1.5;
}

const RayPathLine: React.FC<RegularRayDraw> = ({
    points,
    color,
    opacity,
    lineWidth,
    dashed,
    blending,
    renderOrder,
    depthWrite,
    segments,
    vertexColors,
}) => {
    if (segments && vertexColors) {
        return (
            <StableSegmentLine
                points={points}
                vertexColors={vertexColors}
                opacity={opacity}
                lineWidth={lineWidth}
                blending={blending}
                renderOrder={renderOrder}
                depthWrite={depthWrite}
            />
        );
    }

    return (
        <Line
            points={points}
            color={vertexColors ? 'white' : rgbToCSS(color)}
            vertexColors={vertexColors}
            segments={segments}
            lineWidth={lineWidth}
            transparent
            opacity={opacity}
            depthWrite={depthWrite}
            dashed={dashed}
            dashSize={dashed ? 3 : undefined}
            gapSize={dashed ? 2 : undefined}
            depthTest={true}
            renderOrder={renderOrder}
            toneMapped={false}
            blending={blending}
        />
    );
};

const StableSegmentLine: React.FC<{
    points: Vector3[];
    vertexColors: Array<[number, number, number]>;
    opacity: number;
    lineWidth: number;
    blending: Blending;
    renderOrder: number;
    depthWrite: boolean;
}> = ({ points, vertexColors, opacity, lineWidth, blending, renderOrder, depthWrite }) => {
    const size = useThree(state => state.size);
    const geometry = React.useMemo(() => new LineSegmentsGeometry(), []);
    const material = React.useMemo(() => {
        const mat = new LineMaterial({
            color: 0xffffff,
            vertexColors: true,
            transparent: true,
            opacity,
            linewidth: lineWidth,
            depthTest: true,
            depthWrite,
            toneMapped: false,
            blending,
        });
        return mat;
    }, []);
    const line = React.useMemo(() => {
        const obj = new LineSegments2(geometry, material);
        obj.frustumCulled = false;
        return obj;
    }, [geometry, material]);
    const capacityRef = React.useRef(0);

    React.useLayoutEffect(() => {
        material.resolution.set(size.width, size.height);
    }, [material, size.width, size.height]);

    React.useLayoutEffect(() => {
        material.opacity = opacity;
        material.linewidth = lineWidth;
        material.blending = blending;
        material.depthWrite = depthWrite;
        material.depthTest = true;
        material.transparent = true;
        material.toneMapped = false;
    }, [blending, depthWrite, lineWidth, material, opacity]);

    React.useLayoutEffect(() => {
        const segmentCount = Math.floor(points.length / 2);
        if (segmentCount <= 0) {
            geometry.instanceCount = 0;
            return;
        }

        if (segmentCount > capacityRef.current) {
            const capacity = nextPowerOfTwo(segmentCount);
            geometry.setPositions(new Float32Array(capacity * 6));
            geometry.setColors(new Float32Array(capacity * 6), 3);
            capacityRef.current = capacity;
        }

        const startAttr = geometry.getAttribute('instanceStart') as any;
        const colorStartAttr = geometry.getAttribute('instanceColorStart') as any;
        const positions = startAttr.data.array as Float32Array;
        const colors = colorStartAttr.data.array as Float32Array;

        for (let segment = 0; segment < segmentCount; segment++) {
            const start = points[segment * 2];
            const end = points[segment * 2 + 1];
            const colorStart = vertexColors[segment * 2] ?? [1, 1, 1];
            const colorEnd = vertexColors[segment * 2 + 1] ?? colorStart;
            const posOffset = segment * 6;
            positions[posOffset] = start.x;
            positions[posOffset + 1] = start.y;
            positions[posOffset + 2] = start.z;
            positions[posOffset + 3] = end.x;
            positions[posOffset + 4] = end.y;
            positions[posOffset + 5] = end.z;
            colors[posOffset] = colorStart[0];
            colors[posOffset + 1] = colorStart[1];
            colors[posOffset + 2] = colorStart[2];
            colors[posOffset + 3] = colorEnd[0];
            colors[posOffset + 4] = colorEnd[1];
            colors[posOffset + 5] = colorEnd[2];
        }

        startAttr.data.needsUpdate = true;
        colorStartAttr.data.needsUpdate = true;
        geometry.instanceCount = segmentCount;
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
    }, [geometry, points, vertexColors]);

    React.useEffect(() => () => {
        geometry.dispose();
        material.dispose();
    }, [geometry, material]);

    return <primitive object={line} renderOrder={renderOrder} />;
};

const StaticMainRayLine: React.FC<MainRayDraw> = ({ points, wavelength, dashed, opacity }) => {
    const wc = coherentDisplayRGB(wavelength);
    const color = rgbToCSS(wc);
    const mainTransparent = opacity < 0.999;
    const redGlow = redEdgeGlow(wavelength, opacity);

    return (
        <group>
            {redGlow && (
                <Line
                    points={points}
                    color={redGlow.color}
                    lineWidth={4 + redGlow.lineWidthBoost}
                    transparent
                    opacity={redGlow.opacity}
                    depthWrite={false}
                    dashed={dashed}
                    dashSize={dashed ? 3 : undefined}
                    gapSize={dashed ? 2 : undefined}
                    depthTest={true}
                    renderOrder={0}
                    toneMapped={false}
                    blending={AdditiveBlending}
                />
            )}
            <Line
                points={points}
                color={wc.isVisible ? color : 'white'}
                lineWidth={4}
                transparent={mainTransparent}
                opacity={opacity}
                depthWrite={!mainTransparent}
                dashed={dashed}
                dashSize={dashed ? 3 : undefined}
                gapSize={dashed ? 2 : undefined}
                depthTest={true}
                renderOrder={1}
                toneMapped={false}
                blending={NormalBlending}
            />
        </group>
    );
};

interface RayVisualizerProps {
    paths: Ray[][];
    glowEnabled?: boolean;
    noBloom?: boolean;  // If true, dims the colors below the bloom threshold
    hideAll?: boolean;  // E-field mode: hide all rays
    minOpacity?: number; // 0..1, controls dimmest visible ray alpha
    maxOpacity?: number; // 0..1, controls brightest ray alpha
    /** Polariscope view: color each segment by its E-field polarization state
     *  rather than the laser's wavelength. Useful for tracking what happens
     *  to polarization through PBS/waveplate chains. */
    colorByPolarization?: boolean;
}

export const RayVisualizer: React.FC<RayVisualizerProps> = ({ paths, glowEnabled = true, noBloom = false, hideAll = false, minOpacity = 0.33, maxOpacity = 1.0, colorByPolarization = false }) => {
    // Sort paths: non-main rays first, main ray last so it renders on top.
    // Within incoherent sets, sort by wavelength (longest first) so shorter
    // wavelengths (blue/violet) draw on top and are visible in the rainbow fan.
    const sortedPaths = React.useMemo(() => {
        if (hideAll) return [];

        const indexed = paths.map((path, idx) => ({ path, idx }));
        indexed.sort((a, b) => {
            const aMain = isMainRayPath(a.path) ? 1 : 0;
            const bMain = isMainRayPath(b.path) ? 1 : 0;
            if (aMain !== bMain) return aMain - bMain;
            // Same main-ness: sort by wavelength descending (longest first → drawn first)
            const aWl = a.path.length > 0 ? a.path[0].wavelength : 0;
            const bWl = b.path.length > 0 ? b.path[0].wavelength : 0;
            return bWl - aWl; // Longest wavelength first (red), shortest last (blue on top)
        });
        return indexed;
    }, [paths, hideAll]);

    const prepared = React.useMemo(() => {
        const regularRays: RegularRayDraw[] = [];
        const mainRays: MainRayDraw[] = [];
        const polarizationPoints: Vector3[] = [];
        const polarizationColors: Array<[number, number, number]> = [];
        const seenPolarizationSegments = new Set<string>();

        for (const { path, idx } of sortedPaths) {
            const points: Vector3[] = [];
            let truncatedForVisualization = false;
            for (const r of path) {
                if (r.intensity < 1e-6) break;

                if (r.entryPoint) {
                    points.push(toVec3(r.entryPoint));
                }
                if (r.internalPath) {
                    for (const p of r.internalPath) {
                        points.push(toVec3(p));
                    }
                }
                points.push(toVec3(r.origin));
                if (r.suppressVisualization) {
                    truncatedForVisualization = true;
                    break;
                }
            }

            const isMain = isMainRayPath(path);
            const wavelength = path.length > 0 ? path[0].wavelength : 532e-9;
            const lastRay = terminalBranchRay(path);
            const terminalRelativeIntensity = relativePathIntensity(path, lastRay);

            if (points.length > 0 && path.length > 0) {
                const shouldDrawOpenTail = colorByPolarization
                    ? shouldDrawPolarizationOpenTail(path)
                    : (
                        isMain
                        || isThermalForDisplay(path[0])
                        || terminalRelativeIntensity >= OPEN_TAIL_RELATIVE_INTENSITY
                    );
                const dist = terminalVisualizationDistance(
                    lastRay,
                    shouldDrawOpenTail,
                    openTailSuppressionExpired(path),
                );
                if (!truncatedForVisualization && lastRay && lastRay.intensity >= 1e-6 && dist !== null) {
                    const origin = toVec3(lastRay.origin);
                    const direction = toVec3(lastRay.direction);
                    points.push(origin.clone().add(direction.clone().multiplyScalar(dist)));
                }
            }

            if (points.length < 2) continue;

            // ── Polarization view ─────────────────────────────────────────
            // Color each segment of the path by the polarization state of the
            // E-field on that segment. Bypasses the wavelength/main/incoherent
            // branches below so a beam can change color when it goes through
            // a PBS or waveplate.
            if (colorByPolarization && path.length > 0) {
                // Draw visibility is decided per physical segment, not per
                // terminal path. A faint PBS leakage child must not make the
                // shared incoming launch segment disappear, which otherwise
                // makes the laser look like it changes ray count while scanning.
                const scale = noBloom ? 0.45 : 1.0;
                for (let i = 0; i < path.length; i++) {
                    const r = path[i];
                    const relativeIntensity = relativePathIntensity(path, r);
                    if (relativeIntensity < POLARIZATION_MIN_DRAW_RELATIVE_INTENSITY) break;
                    if (r.suppressVisualization) break;
                    const segStart = toVec3(r.origin);
                    let segEnd: Vector3;
                    const next = path[i + 1];
                    if (next) {
                        segEnd = toVec3(next.origin);
                    } else {
                        const dist = terminalVisualizationDistance(
                            r,
                            shouldDrawPolarizationOpenTail(path),
                            openTailSuppressionExpired(path),
                        );
                        if (dist === null) break;
                        segEnd = segStart.clone().addScaledVector(toVec3(r.direction), dist);
                    }
                    if (segStart.distanceToSquared(segEnd) < 1e-18) continue;
                    const key = stableSegmentKey(segStart, segEnd);
                    if (seenPolarizationSegments.has(key)) continue;
                    seenPolarizationSegments.add(key);

                    const segVisibility = polarizationSegmentVisibility(relativeIntensity);
                    const dim = scale * segVisibility;
                    const polColor = polarizationToColor(r.polarization, r.direction);
                    const c: [number, number, number] = [polColor.r * dim, polColor.g * dim, polColor.b * dim];
                    polarizationPoints.push(segStart, segEnd);
                    polarizationColors.push(c, c);
                }
                continue;
            }

            if (isThermalForDisplay(path[0])) {
                const rgb = wavelengthToRGB(wavelength * 1e9);
                const scale = noBloom ? 0.18 : 1.0;
                const color = rgb.isVisible
                    ? scaledRGB(rgb, scale)
                    : scaledRGB({ r: 135 / 255, g: 135 / 255, b: 135 / 255 }, scale);
                const rawOpacity = path.length > 0 ? Math.min(1, path[0].intensity) : 0.5;
                const rayOpacity = minOpacity + rawOpacity * (maxOpacity - minOpacity);
                regularRays.push({
                    key: `ray-${idx}`,
                    points,
                    color,
                    opacity: rayOpacity,
                    lineWidth: isMain ? 4 : 2,
                    dashed: !rgb.isVisible,
                    blending: AdditiveBlending,
                    renderOrder: 1,
                    depthWrite: false,
                });
                continue;
            }

            if (isMain) {
                const wc = coherentDisplayRGB(wavelength);
                const rawOpacity = Math.min(1, path[0].intensity);
                mainRays.push({
                    key: `main-${idx}`,
                    points,
                    wavelength,
                    dashed: !wc.isVisible,
                    opacity: minOpacity + rawOpacity * (maxOpacity - minOpacity),
                    glowEnabled,
                });
                continue;
            }

            if (terminalRelativeIntensity < MIN_DRAW_RELATIVE_INTENSITY) {
                continue;
            }

            const rgb = coherentDisplayRGB(wavelength);
            const color = noBloom ? scaledRGB(rgb, 0.18) : (rgb.isVisible ? rgb : { r: 135 / 255, g: 135 / 255, b: 135 / 255 });
            const branchStyle = coherentBranchDisplayStyle(terminalRelativeIntensity, maxOpacity);
            const nOpacity = Math.max(minOpacity * terminalRelativeIntensity, branchStyle.opacity);
            const nLineWidth = branchStyle.lineWidth;
            const wavelengthNm = wavelength * 1e9;
            const blendsAsFarRedBundle = wavelengthNm >= 700 && wavelengthNm <= 800;
            regularRays.push({
                key: `ray-${idx}`,
                points,
                color,
                opacity: nOpacity,
                lineWidth: nLineWidth,
                dashed: !rgb.isVisible,
                blending: blendsAsFarRedBundle ? AdditiveBlending : NormalBlending,
                renderOrder: 1,
                depthWrite: false,
            });
        }

        if (colorByPolarization) {
            if (polarizationPoints.length >= 2) {
                regularRays.push({
                    key: 'pol-segments',
                    points: polarizationPoints,
                    color: { r: 1, g: 1, b: 1 },
                    // The whole Line rides at maxOpacity; the per-segment
                    // vertex-color scaling above does the faint/bright
                    // differentiation, so there is no path-wide average
                    // and no minOpacity floor to lift faint rays.
                    opacity: maxOpacity,
                    lineWidth: 2,
                    dashed: false,
                    blending: AdditiveBlending,
                    renderOrder: 1,
                    depthWrite: false,
                    segments: true,
                    vertexColors: polarizationColors,
                });
            }
        }

        return {
            regularRays,
            mainRays,
        };
    }, [glowEnabled, maxOpacity, minOpacity, noBloom, sortedPaths, colorByPolarization]);

    // In E-field mode, hide all rays entirely. Keep hooks above this point
    // unconditional so toggling the mode cannot corrupt React hook order.
    if (hideAll) return null;

    return (
        <group userData={{ svgExport: 'skip' }}>
            {prepared.regularRays.map(({ key, ...ray }) => (
                <RayPathLine key={key} {...ray} />
            ))}
            {prepared.mainRays.map(({ key, ...ray }) => (
                ray.glowEnabled ? (
                    <PulsatingRayLine
                        key={key}
                        points={ray.points}
                        wavelengthMeters={ray.wavelength}
                        dashed={ray.dashed}
                        opacity={ray.opacity}
                    />
                ) : (
                    <StaticMainRayLine key={key} {...ray} />
                )
            ))}
        </group>
    );
};
