import React, { useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import {
    Vector3,
    Color,
    NormalBlending,
    AdditiveBlending,
} from 'three';
import { Ray, Coherence } from '../physics/types';
import { wavelengthToRGB } from '../physics/spectral';

type DisplayRGB = ReturnType<typeof wavelengthToRGB>;

function rgbToCSS(rgb: Pick<DisplayRGB, 'r' | 'g' | 'b'>, scale = 1): string {
    return `rgb(${Math.round(rgb.r * 255 * scale)}, ${Math.round(rgb.g * 255 * scale)}, ${Math.round(rgb.b * 255 * scale)})`;
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
const OPEN_TAIL_RELATIVE_INTENSITY = 3e-2;

function lastVisibleRay(path: Ray[]): Ray | undefined {
    const extinctIdx = path.findIndex(r => r.intensity < 1e-6);
    if (extinctIdx >= 0) return path[Math.max(0, extinctIdx - 1)];
    return path[path.length - 1];
}

function relativePathIntensity(path: Ray[], ray: Ray | undefined): number {
    const sourceIntensity = Math.max(path[0]?.intensity ?? 0, 1e-12);
    return Math.max(0, Math.min(1, (ray?.intensity ?? 0) / sourceIntensity));
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
    blending: typeof NormalBlending | typeof AdditiveBlending;
    renderOrder: number;
    depthWrite: boolean;
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
}) => (
    <Line
        points={points}
        color={rgbToCSS(color)}
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
}

export const RayVisualizer: React.FC<RayVisualizerProps> = ({ paths, glowEnabled = true, noBloom = false, hideAll = false, minOpacity = 0.33, maxOpacity = 1.0 }) => {
    // Sort paths: non-main rays first, main ray last so it renders on top.
    // Within incoherent sets, sort by wavelength (longest first) so shorter
    // wavelengths (blue/violet) draw on top and are visible in the rainbow fan.
    const sortedPaths = React.useMemo(() => {
        if (hideAll) return [];

        const indexed = paths.map((path, idx) => ({ path, idx }));
        indexed.sort((a, b) => {
            const aMain = a.path.length > 0 && a.path[0].isMainRay === true ? 1 : 0;
            const bMain = b.path.length > 0 && b.path[0].isMainRay === true ? 1 : 0;
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

            const isMain = path.length > 0 && path[0].isMainRay === true;
            const wavelength = path.length > 0 ? path[0].wavelength : 532e-9;
            const lastRay = lastVisibleRay(path);
            const terminalRelativeIntensity = relativePathIntensity(path, lastRay);

            if (points.length > 0 && path.length > 0) {
                const shouldDrawOpenTail = isMain
                    || path[0].coherenceMode === Coherence.Incoherent
                    || terminalRelativeIntensity >= OPEN_TAIL_RELATIVE_INTENSITY;
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

            const isIncoherent = path.length > 0 && path[0].coherenceMode === Coherence.Incoherent;
            if (isIncoherent) {
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

        return {
            regularRays,
            mainRays,
        };
    }, [glowEnabled, maxOpacity, minOpacity, noBloom, sortedPaths]);

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
