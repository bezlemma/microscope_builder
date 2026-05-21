import React from 'react';
import { Line } from '@react-three/drei';
import {
    Vector3,
    BufferAttribute,
    BufferGeometry,
    DynamicDrawUsage,
    LineBasicMaterial,
    LineSegments,
    NormalBlending,
    AdditiveBlending,
    type Blending,
    type Object3D,
} from 'three';
import { Ray, Coherence, polarizationToColor } from '../physics/types';
import { wavelengthToRGB } from '../physics/spectral';
import { RAY_RENDER_ORDER } from './renderOrder';

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

export function coherentDisplayRGB(wavelengthMeters: number): DisplayRGB {
    const nm = wavelengthMeters * 1e9;
    const rgb = wavelengthToRGB(nm);
    if (!rgb.isVisible || nm < 700 || nm > 800) return rgb;

    // Far red is physically dim on an sRGB display. Lift it into a nicer
    // single-line material color, but keep it red-only: tiny green/blue lifts
    // accumulate to white when a dense coherent bundle uses additive blending.
    const edge = Math.max(0, Math.min(1, (nm - 700) / 100));
    const lift = 0.14 + 0.18 * edge;
    return {
        ...rgb,
        r: Math.min(1, rgb.r + (1 - rgb.r) * lift),
    };
}

/** Defensive: accept either a Vector3 or a {x,y,z} plain object and return a Vector3. */
function toVec3(v: { x: number; y: number; z: number }): Vector3 {
    return v instanceof Vector3 ? v : new Vector3(v.x, v.y, v.z);
}

const MIN_DRAW_RELATIVE_INTENSITY = 1e-3;
const POLARIZATION_MIN_DRAW_RELATIVE_INTENSITY = 1e-6;
const MIN_PATH_SEGMENT_RELATIVE_INTENSITY = 1e-9;
const OPEN_TAIL_RELATIVE_INTENSITY = 3e-2;
const LAMP_REFERENCE_PACKETS_PER_WAVELENGTH = 17;
const MAX_LAMP_DISPLAY_PACKETS_PER_WAVELENGTH = 512;
const MAX_SEGMENTS_PER_LINE_BATCH = 8192;
const PHYSICAL_RAY_LINE_WIDTH = 0.75;

function terminalBranchRay(path: Ray[]): Ray | undefined {
    return path[path.length - 1];
}

function lampDisplaySourceKey(ray: Ray | undefined, fallback: string): string {
    if (ray?.sourceKind !== 'lamp') return ray?.sourceId ?? fallback;
    return (ray.sourceId ?? fallback).replace(/_\d+(?:\.\d+)?nm(?:_pt\d+)?$/, '');
}

function wavelengthKey(ray: Ray): number {
    return Math.round(ray.wavelength * 1e12);
}

export function additivePacketOpacityScale(packetCount: number, referencePacketCount = LAMP_REFERENCE_PACKETS_PER_WAVELENGTH): number {
    if (!Number.isFinite(packetCount) || packetCount <= 0) return 1;
    const reference = Math.max(1, referencePacketCount);
    return Math.min(1, reference / Math.max(1, packetCount));
}

export function lampDisplayPacketCount(packetCount: number, displayLimit = MAX_LAMP_DISPLAY_PACKETS_PER_WAVELENGTH): number {
    if (!Number.isFinite(packetCount) || packetCount <= 0) return 1;
    return Math.max(1, Math.min(Math.floor(packetCount), Math.max(1, Math.floor(displayLimit))));
}

export function shouldDrawLampDisplayPath(
    ordinal: number,
    packetCount: number,
    displayLimit = MAX_LAMP_DISPLAY_PACKETS_PER_WAVELENGTH,
): boolean {
    if (!Number.isFinite(packetCount) || packetCount <= displayLimit) return true;
    const stride = Math.max(1, Math.ceil(packetCount / Math.max(1, displayLimit)));
    return ordinal % stride === Math.floor(stride / 2);
}

export function relativePathIntensity(path: Ray[], ray: Ray | undefined): number {
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

export function opacityFromRelativeRange(
    relativeIntensity: number,
    minRelativeIntensity: number,
    maxRelativeIntensity: number,
    minOpacity: number,
    maxOpacity: number,
    responsePower: number = 0.25,
): number {
    const minOut = Math.max(0, Math.min(1, minOpacity));
    const maxOut = Math.max(minOut, Math.min(1, maxOpacity));
    const lo = Math.max(0, Math.min(1, minRelativeIntensity));
    const hi = Math.max(lo, Math.min(1, maxRelativeIntensity));
    if (hi - lo < 1e-12) return maxOut;
    const t = Math.max(0, Math.min(1, (relativeIntensity - lo) / (hi - lo)));
    const power = Number.isFinite(responsePower) && responsePower > 0 ? responsePower : 0.25;
    return minOut + Math.pow(t, power) * (maxOut - minOut);
}

export function polarizationOpacityFromRelativeRange(
    relativeIntensity: number,
    minOpacity: number,
    maxOpacity: number,
): number {
    return opacityFromRelativeRange(
        relativeIntensity,
        POLARIZATION_MIN_DRAW_RELATIVE_INTENSITY,
        1,
        minOpacity,
        maxOpacity,
        1,
    );
}

function stableSegmentKey(start: Vector3, end: Vector3): string {
    const q = (v: number) => Math.round(v * 1e6);
    return `${q(start.x)},${q(start.y)},${q(start.z)}>${q(end.x)},${q(end.y)},${q(end.z)}`;
}

function stablePointKey(point: { x: number; y: number; z: number } | undefined): string {
    if (!point) return 'unknown';
    const q = (v: number) => Math.round(v * 1e6);
    return `${q(point.x)},${q(point.y)},${q(point.z)}`;
}

function coherentSegmentDedupeKey(path: Ray[], segment: PathDrawSegment): string {
    const source = path[0] ?? segment.ray;
    const sourcePoint = source.sourcePosition ?? source.origin ?? segment.ray.sourcePosition ?? segment.ray.origin;
    const sourceKey = source.sourceId ?? segment.ray.sourceId ?? 'source';
    const kindKey = source.sourceKind ?? segment.ray.sourceKind ?? 'coherent';
    const wavelength = source.wavelength ?? segment.ray.wavelength;
    return [
        sourceKey,
        kindKey,
        Math.round(wavelength * 1e12),
        stablePointKey(sourcePoint),
        stableSegmentKey(segment.start, segment.end),
    ].join('|');
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
        lineWidth: PHYSICAL_RAY_LINE_WIDTH,
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

export interface RegularRayDraw {
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

export interface RegularRayBatch {
    key: string;
    points: Vector3[];
    vertexColors: Array<[number, number, number]>;
    opacity: number;
    lineWidth: number;
    blending: Blending;
    renderOrder: number;
    depthWrite: boolean;
}

interface PolarizationSegmentDraw {
    start: Vector3;
    end: Vector3;
    relativeIntensity: number;
    color: { r: number; g: number; b: number };
}

interface LampSegmentAccum {
    start: Vector3;
    end: Vector3;
    color: [number, number, number];
}

interface PathDrawSegment {
    start: Vector3;
    end: Vector3;
    ray: Ray;
}

export function buildPathDrawSegments(
    path: Ray[],
    shouldDrawOpenTail: boolean,
    allowSuppressedOpenTail: boolean,
): PathDrawSegment[] {
    const segments: PathDrawSegment[] = [];
    const append = (start: Vector3, end: Vector3, ray: Ray) => {
        if (start.distanceToSquared(end) < 1e-18) return;
        segments.push({ start, end, ray });
    };

    for (let i = 0; i < path.length; i++) {
        const ray = path[i];
        if (relativePathIntensity(path, ray) < MIN_PATH_SEGMENT_RELATIVE_INTENSITY) break;

        const rayOrigin = toVec3(ray.origin);
        if (ray.entryPoint) {
            let previous = toVec3(ray.entryPoint);
            if (ray.internalPath) {
                for (const point of ray.internalPath) {
                    const next = toVec3(point);
                    append(previous, next, ray);
                    previous = next;
                }
            }
            append(previous, rayOrigin, ray);
        }

        if (ray.suppressVisualization) break;

        const nextRay = path[i + 1];
        if (nextRay) {
            append(
                rayOrigin,
                nextRay.entryPoint ? toVec3(nextRay.entryPoint) : toVec3(nextRay.origin),
                ray,
            );
            continue;
        }

        const dist = terminalVisualizationDistance(ray, shouldDrawOpenTail, allowSuppressedOpenTail);
        if (dist !== null) {
            append(
                rayOrigin,
                rayOrigin.clone().addScaledVector(toVec3(ray.direction), dist),
                ray,
            );
        }
    }

    return segments;
}

function pointsFromSegments(segments: PathDrawSegment[]): Vector3[] {
    if (segments.length === 0) return [];
    const points = [segments[0].start];
    for (const segment of segments) points.push(segment.end);
    return points;
}

function scaledRGB(rgb: Pick<DisplayRGB, 'r' | 'g' | 'b'>, scale: number): Pick<DisplayRGB, 'r' | 'g' | 'b'> {
    return { r: rgb.r * scale, g: rgb.g * scale, b: rgb.b * scale };
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
    const disableRaycast = React.useCallback((object: Object3D | null) => {
        if (object) object.raycast = () => undefined;
    }, []);

    if (segments && vertexColors) {
        return (
            <Line
                ref={disableRaycast}
                points={points}
                color="white"
                vertexColors={vertexColors}
                lineWidth={lineWidth}
                transparent
                opacity={opacity}
                depthWrite={depthWrite}
                segments={segments}
                dashed={dashed}
                dashSize={dashed ? 3 : undefined}
                gapSize={dashed ? 2 : undefined}
                depthTest={true}
                renderOrder={renderOrder}
                toneMapped={false}
                blending={blending}
            />
        );
    }

    return (
        <Line
            ref={disableRaycast}
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

function scaledVertexColor(
    color: [number, number, number] | undefined,
    fallback: Pick<DisplayRGB, 'r' | 'g' | 'b'>,
): [number, number, number] {
    const c = color ?? [fallback.r, fallback.g, fallback.b];
    return [c[0], c[1], c[2]];
}

function opacityBatchKey(opacity: number): string {
    return String(Math.round(Math.max(0, Math.min(1, opacity)) * 100));
}

export function batchedRegularRays(regularRays: RegularRayDraw[]): { batches: RegularRayBatch[]; individual: RegularRayDraw[] } {
    const batches = new Map<string, RegularRayBatch[]>();
    const individual: RegularRayDraw[] = [];

    for (const ray of regularRays) {
        // Dashed lines need a per-line distance attribute path; keep those rare
        // cases individual instead of mixing them into segment batches.
        if (ray.dashed) {
            individual.push(ray);
            continue;
        }

        const key = [
            ray.lineWidth,
            ray.blending,
            ray.renderOrder,
            ray.depthWrite ? 'dw' : 'ndw',
            opacityBatchKey(ray.opacity),
        ].join('|');

        const getWritableBatch = (): RegularRayBatch => {
            let group = batches.get(key);
            if (!group) {
                group = [];
                batches.set(key, group);
            }
            let batch = group[group.length - 1];
            if (batch && batch.points.length / 2 < MAX_SEGMENTS_PER_LINE_BATCH) {
                return batch;
            }
            batch = {
                key: `batch-${key}-${group.length}`,
                points: [],
                vertexColors: [],
                opacity: Math.max(0, Math.min(1, ray.opacity)),
                lineWidth: ray.lineWidth,
                blending: ray.blending,
                renderOrder: ray.renderOrder,
                depthWrite: ray.depthWrite,
            };
            group.push(batch);
            return batch;
        };

        const appendSegment = (startIndex: number, endIndex: number) => {
            const start = ray.points[startIndex];
            const end = ray.points[endIndex];
            if (!start || !end) return;
            const batch = getWritableBatch();
            batch.points.push(start, end);
            batch.vertexColors.push(
                scaledVertexColor(ray.vertexColors?.[startIndex], ray.color),
                scaledVertexColor(ray.vertexColors?.[endIndex], ray.color),
            );
        };

        if (ray.segments) {
            for (let i = 0; i < ray.points.length - 1; i += 2) {
                appendSegment(i, i + 1);
            }
        } else {
            for (let i = 0; i < ray.points.length - 1; i++) {
                appendSegment(i, i + 1);
            }
        }
    }

    return { batches: Array.from(batches.values()).flat(), individual };
}

const StableSegmentLine: React.FC<{
    points: Vector3[];
    vertexColors: Array<[number, number, number]>;
    opacity: number;
    lineWidth: number;
    blending: Blending;
    renderOrder: number;
    depthWrite: boolean;
}> = ({ points, vertexColors, opacity, lineWidth, blending, renderOrder, depthWrite }) => {
    const geometry = React.useMemo(() => new BufferGeometry(), []);
    const material = React.useMemo(() => {
        const mat = new LineBasicMaterial({
            color: 0xffffff,
            vertexColors: true,
            transparent: true,
            opacity,
            linewidth: lineWidth,
            depthTest: true,
            depthWrite,
            blending,
        });
        mat.toneMapped = false;
        return mat;
    }, []);
    const line = React.useMemo(() => {
        const obj = new LineSegments(geometry, material);
        obj.frustumCulled = false;
        obj.raycast = () => null;
        return obj;
    }, [geometry, material]);
    const capacityRef = React.useRef(0);

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
            geometry.setDrawRange(0, 0);
            return;
        }

        if (segmentCount > capacityRef.current) {
            const capacity = nextPowerOfTwo(segmentCount);
            const positionAttr = new BufferAttribute(new Float32Array(capacity * 6), 3);
            const colorAttr = new BufferAttribute(new Float32Array(capacity * 6), 3);
            positionAttr.setUsage(DynamicDrawUsage);
            colorAttr.setUsage(DynamicDrawUsage);
            geometry.setAttribute('position', positionAttr);
            geometry.setAttribute('color', colorAttr);
            capacityRef.current = capacity;
        }

        const positionAttr = geometry.getAttribute('position') as BufferAttribute;
        const colorAttr = geometry.getAttribute('color') as BufferAttribute;
        const positions = positionAttr.array as Float32Array;
        const colors = colorAttr.array as Float32Array;

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

        positionAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        geometry.setDrawRange(0, segmentCount * 2);
    }, [geometry, points, vertexColors]);

    React.useEffect(() => () => {
        geometry.dispose();
        material.dispose();
    }, [geometry, material]);

    return <primitive object={line} renderOrder={renderOrder} />;
};

interface RayVisualizerProps {
    paths: Ray[][];
    noBloom?: boolean;  // If true, dims the colors below the bloom threshold
    hideAll?: boolean;  // E-field mode: hide all rays
    minOpacity?: number; // 0..1, controls dimmest visible ray alpha
    maxOpacity?: number; // 0..1, controls brightest ray alpha
    /** Polariscope view: color each segment by its E-field polarization state
     *  rather than the laser's wavelength. Useful for tracking what happens
     *  to polarization through PBS/waveplate chains. */
    colorByPolarization?: boolean;
}

export const RayVisualizer: React.FC<RayVisualizerProps> = ({ paths, noBloom = false, hideAll = false, minOpacity = 0.33, maxOpacity = 1.0, colorByPolarization = false }) => {
    // Sort paths by wavelength (longest first) so shorter
    // wavelengths (blue/violet) draw on top and are visible in the rainbow fan.
    // Do not sort the center/chief ray specially; it is just another sampled
    // source ray and must not obscure or replace marginal rays.
    const sortedPaths = React.useMemo(() => {
        if (hideAll) return [];

        const indexed = paths.map((path, idx) => ({ path, idx }));
        indexed.sort((a, b) => {
            const aWl = a.path.length > 0 ? a.path[0].wavelength : 0;
            const bWl = b.path.length > 0 ? b.path[0].wavelength : 0;
            if (aWl !== bWl) return bWl - aWl;
            return a.idx - b.idx;
        });
        return indexed;
    }, [paths, hideAll]);

    const prepared = React.useMemo(() => {
        const regularRays: RegularRayDraw[] = [];
        const polarizationSegments: PolarizationSegmentDraw[] = [];
        const seenPolarizationSegments = new Set<string>();
        const lampSegmentsByWidth = new Map<number, Map<string, LampSegmentAccum>>();
        const lampWavelengthColors = new Map<string, Map<number, Pick<DisplayRGB, 'r' | 'g' | 'b'>>>();
        const lampWavelengthPathCounts = new Map<string, Map<number, number>>();
        const lampWavelengthOrdinals = new Map<string, Map<number, number>>();
        const lampWhiteBalance = new Map<string, { r: number; g: number; b: number }>();
        const seenCoherentSegments = new Set<string>();

        for (const { path, idx } of sortedPaths) {
            const first = path[0];
            if (first?.sourceKind !== 'lamp') continue;
            const rgb = wavelengthToRGB(first.wavelength * 1e9);
            if (!rgb.isVisible) continue;
            const key = lampDisplaySourceKey(first, `lamp-${idx}`);
            let colors = lampWavelengthColors.get(key);
            if (!colors) {
                colors = new Map();
                lampWavelengthColors.set(key, colors);
            }
            const wlKey = wavelengthKey(first);
            colors.set(wlKey, { r: rgb.r, g: rgb.g, b: rgb.b });
            let counts = lampWavelengthPathCounts.get(key);
            if (!counts) {
                counts = new Map();
                lampWavelengthPathCounts.set(key, counts);
            }
            counts.set(wlKey, (counts.get(wlKey) ?? 0) + 1);
        }

        for (const [key, colors] of lampWavelengthColors) {
            let sumR = 0;
            let sumG = 0;
            let sumB = 0;
            for (const color of colors.values()) {
                sumR += color.r;
                sumG += color.g;
                sumB += color.b;
            }
            const positive = [sumR, sumG, sumB].filter(value => value > 1e-6);
            const target = positive.length > 0 ? Math.min(...positive) : 1;
            lampWhiteBalance.set(key, {
                r: sumR > 1e-6 ? target / sumR : 1,
                g: sumG > 1e-6 ? target / sumG : 1,
                b: sumB > 1e-6 ? target / sumB : 1,
            });
        }

        const accumulateLampSegment = (
            start: Vector3,
            end: Vector3,
            color: Pick<DisplayRGB, 'r' | 'g' | 'b'>,
            opacity: number,
            lineWidth: number,
        ) => {
            let widthSegments = lampSegmentsByWidth.get(lineWidth);
            if (!widthSegments) {
                widthSegments = new Map();
                lampSegmentsByWidth.set(lineWidth, widthSegments);
            }
            const scaled: [number, number, number] = [
                color.r * opacity,
                color.g * opacity,
                color.b * opacity,
            ];
            if (start.distanceToSquared(end) < 1e-18) return;
            const key = stableSegmentKey(start, end);
            let segment = widthSegments.get(key);
            if (!segment) {
                segment = { start, end, color: [0, 0, 0] };
                widthSegments.set(key, segment);
            }
            segment.color[0] += scaled[0];
            segment.color[1] += scaled[1];
            segment.color[2] += scaled[2];
        };

        for (const { path, idx } of sortedPaths) {
            const isMain = isMainRayPath(path);
            const wavelength = path.length > 0 ? path[0].wavelength : 532e-9;
            const lastRay = terminalBranchRay(path);
            const terminalRelativeIntensity = relativePathIntensity(path, lastRay);
            const shouldDrawOpenTail = colorByPolarization
                ? shouldDrawPolarizationOpenTail(path)
                : (
                    isMain
                    || isThermalForDisplay(path[0])
                    || terminalRelativeIntensity >= OPEN_TAIL_RELATIVE_INTENSITY
                );
            const pathSegments = buildPathDrawSegments(
                path,
                shouldDrawOpenTail,
                openTailSuppressionExpired(path),
            );
            const points = pointsFromSegments(pathSegments);
            if (pathSegments.length === 0 || points.length < 2) continue;

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
                for (const segment of pathSegments) {
                    const relativeIntensity = relativePathIntensity(path, segment.ray);
                    if (relativeIntensity < POLARIZATION_MIN_DRAW_RELATIVE_INTENSITY) continue;
                    const key = stableSegmentKey(segment.start, segment.end);
                    if (seenPolarizationSegments.has(key)) continue;
                    seenPolarizationSegments.add(key);

                    const polColor = polarizationToColor(segment.ray.polarization, segment.ray.direction);
                    polarizationSegments.push({
                        start: segment.start,
                        end: segment.end,
                        relativeIntensity,
                        color: {
                            r: polColor.r * scale,
                            g: polColor.g * scale,
                            b: polColor.b * scale,
                        },
                    });
                }
                continue;
            }

            if (isThermalForDisplay(path[0])) {
                const rgb = wavelengthToRGB(wavelength * 1e9);
                const scale = noBloom ? 0.18 : 1.0;
                const color = rgb.isVisible
                    ? scaledRGB(rgb, scale)
                    : scaledRGB({ r: 135 / 255, g: 135 / 255, b: 135 / 255 }, scale);
                const isLampRay = path[0]?.sourceKind === 'lamp';
                const lampKey = isLampRay ? lampDisplaySourceKey(path[0], `lamp-${idx}`) : '';
                const balance = isLampRay ? lampWhiteBalance.get(lampKey) : undefined;
                const baseColor = balance
                    ? { r: color.r * balance.r, g: color.g * balance.g, b: color.b * balance.b }
                    : color;
                if (isLampRay && rgb.isVisible) {
                    const wlKey = wavelengthKey(path[0]);
                    const packetCount = lampWavelengthPathCounts.get(lampKey)?.get(wlKey) ?? 1;
                    let ordinals = lampWavelengthOrdinals.get(lampKey);
                    if (!ordinals) {
                        ordinals = new Map();
                        lampWavelengthOrdinals.set(lampKey, ordinals);
                    }
                    const ordinal = ordinals.get(wlKey) ?? 0;
                    ordinals.set(wlKey, ordinal + 1);
                    if (!isMain && !shouldDrawLampDisplayPath(ordinal, packetCount)) continue;
                    const densityScale = additivePacketOpacityScale(lampDisplayPacketCount(packetCount));
                    for (const segment of pathSegments) {
                        const segmentRelative = relativePathIntensity(path, segment.ray);
                        if (segmentRelative < MIN_DRAW_RELATIVE_INTENSITY) continue;
                        const segmentOpacity = opacityFromRelativeRange(
                            segmentRelative,
                            MIN_DRAW_RELATIVE_INTENSITY,
                            1,
                            minOpacity,
                            maxOpacity,
                        ) * 0.55 * densityScale;
                        accumulateLampSegment(segment.start, segment.end, baseColor, segmentOpacity, PHYSICAL_RAY_LINE_WIDTH);
                    }
                    continue;
                }
                const segmentPoints: Vector3[] = [];
                const vertexColors: Array<[number, number, number]> = [];
                for (const segment of pathSegments) {
                    const segmentRelative = relativePathIntensity(path, segment.ray);
                    if (segmentRelative < MIN_DRAW_RELATIVE_INTENSITY) continue;
                    const segmentOpacity = opacityFromRelativeRange(
                        segmentRelative,
                        MIN_DRAW_RELATIVE_INTENSITY,
                        1,
                        minOpacity,
                        maxOpacity,
                    );
                    const c: [number, number, number] = [
                        baseColor.r * segmentOpacity,
                        baseColor.g * segmentOpacity,
                        baseColor.b * segmentOpacity,
                    ];
                    segmentPoints.push(segment.start, segment.end);
                    vertexColors.push(c, c);
                }
                if (segmentPoints.length < 2) continue;
                regularRays.push({
                    key: `ray-${idx}`,
                    points: segmentPoints,
                    color: { r: 1, g: 1, b: 1 },
                    opacity: 1,
                    lineWidth: PHYSICAL_RAY_LINE_WIDTH,
                    dashed: !rgb.isVisible,
                    blending: AdditiveBlending,
                    renderOrder: RAY_RENDER_ORDER,
                    depthWrite: false,
                    segments: true,
                    vertexColors,
                });
                continue;
            }

            const rgb = coherentDisplayRGB(wavelength);
            const color = noBloom ? scaledRGB(rgb, 0.18) : (rgb.isVisible ? rgb : { r: 135 / 255, g: 135 / 255, b: 135 / 255 });
            const wavelengthNm = wavelength * 1e9;
            const blendsAsFarRedBundle = wavelengthNm >= 700 && wavelengthNm <= 800;
            let segmentIndex = 0;
            for (const segment of pathSegments) {
                const segmentRelative = relativePathIntensity(path, segment.ray);
                if (segmentRelative < MIN_DRAW_RELATIVE_INTENSITY) continue;
                const dedupeKey = coherentSegmentDedupeKey(path, segment);
                if (seenCoherentSegments.has(dedupeKey)) continue;
                seenCoherentSegments.add(dedupeKey);
                const currentSegmentIndex = segmentIndex++;
                const segmentOpacity = opacityFromRelativeRange(
                    segmentRelative,
                    MIN_DRAW_RELATIVE_INTENSITY,
                    1,
                    minOpacity,
                    maxOpacity,
                );
                const c: [number, number, number] = [
                    color.r,
                    color.g,
                    color.b,
                ];
                regularRays.push({
                    key: `ray-${idx}-${currentSegmentIndex}`,
                    points: [segment.start, segment.end],
                    color: { r: 1, g: 1, b: 1 },
                    opacity: segmentOpacity,
                    lineWidth: coherentBranchDisplayStyle(segmentRelative, maxOpacity).lineWidth,
                    dashed: !rgb.isVisible,
                    blending: blendsAsFarRedBundle ? AdditiveBlending : NormalBlending,
                    renderOrder: RAY_RENDER_ORDER,
                    depthWrite: false,
                    segments: true,
                    vertexColors: [c, c],
                });
            }
        }

        for (const [lineWidth, segments] of lampSegmentsByWidth) {
            const points: Vector3[] = [];
            const vertexColors: Array<[number, number, number]> = [];
            for (const segment of segments.values()) {
                const c: [number, number, number] = [
                    Math.min(1, segment.color[0]),
                    Math.min(1, segment.color[1]),
                    Math.min(1, segment.color[2]),
                ];
                points.push(segment.start, segment.end);
                vertexColors.push(c, c);
            }
            if (points.length >= 2) {
                regularRays.push({
                    key: `lamp-segments-${lineWidth}`,
                    points,
                    color: { r: 1, g: 1, b: 1 },
                    opacity: 1,
                    lineWidth,
                    dashed: false,
                    blending: AdditiveBlending,
                    renderOrder: RAY_RENDER_ORDER,
                    depthWrite: false,
                    segments: true,
                    vertexColors,
                });
            }
        }

        if (colorByPolarization) {
            let segmentIndex = 0;
            for (const segment of polarizationSegments) {
                const opacity = polarizationOpacityFromRelativeRange(
                    segment.relativeIntensity,
                    minOpacity,
                    maxOpacity,
                );
                if (opacity <= 0.001) continue;
                const c: [number, number, number] = [
                    segment.color.r,
                    segment.color.g,
                    segment.color.b,
                ];
                regularRays.push({
                    key: `pol-segment-${segmentIndex++}`,
                    points: [segment.start, segment.end],
                    color: { r: 1, g: 1, b: 1 },
                    opacity,
                    lineWidth: PHYSICAL_RAY_LINE_WIDTH,
                    dashed: false,
                    blending: NormalBlending,
                    renderOrder: RAY_RENDER_ORDER,
                    depthWrite: false,
                    segments: true,
                    vertexColors: [c, c],
                });
            }
        }

        return {
            regularRays,
        };
    }, [maxOpacity, minOpacity, noBloom, sortedPaths, colorByPolarization]);

    const regularRender = React.useMemo(
        () => batchedRegularRays(prepared.regularRays),
        [prepared.regularRays],
    );
    // In E-field mode, hide all rays entirely. Keep hooks above this point
    // unconditional so toggling the mode cannot corrupt React hook order.
    if (hideAll) return null;

    return (
        <group userData={{ svgExport: 'skip' }}>
            {regularRender.batches.map(({ key, ...ray }) => (
                <StableSegmentLine key={key} {...ray} />
            ))}
            {regularRender.individual.map(({ key, ...ray }) => (
                <RayPathLine key={key} {...ray} />
            ))}
        </group>
    );
};
