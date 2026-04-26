import React, { useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Vector3, Color, NormalBlending, AdditiveBlending } from 'three';
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

/** Coherent display color: wavelength color plus a cheap far-red display lift. */
function wavelengthToColor(wavelengthMeters: number): { color: string; isVisible: boolean } {
    const rgb = coherentDisplayRGB(wavelengthMeters);
    return { color: rgb.isVisible ? rgbToCSS(rgb) : 'rgb(135, 135, 135)', isVisible: rgb.isVisible };
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

function coherentBranchOpacity(relativeIntensity: number, maxOpacity: number): number {
    return Math.min(maxOpacity, Math.sqrt(Math.max(0, relativeIntensity)) * maxOpacity);
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

interface RayVisualizerProps {
    paths: Ray[][];
    glowEnabled?: boolean;
    noBloom?: boolean;  // If true, dims the colors below the bloom threshold
    hideAll?: boolean;  // E-field mode: hide all rays
    minOpacity?: number; // 0..1, controls dimmest visible ray alpha
    maxOpacity?: number; // 0..1, controls brightest ray alpha
}

export const RayVisualizer: React.FC<RayVisualizerProps> = ({ paths, glowEnabled = true, noBloom = false, hideAll = false, minOpacity = 0.33, maxOpacity = 1.0 }) => {
    // In E-field mode, hide all rays entirely
    if (hideAll) return null;

    // Sort paths: non-main rays first, main ray last so it renders on top.
    // Within incoherent sets, sort by wavelength (longest first) so shorter
    // wavelengths (blue/violet) draw on top and are visible in the rainbow fan.
    const sortedPaths = React.useMemo(() => {
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
    }, [paths]);

    return (
        <group>
            {sortedPaths.map(({ path, idx }) => {
                // Build points array, inserting entryPoint and internalPath before origin
                const points: Vector3[] = [];
                for (const r of path) {
                    // Skip near-zero intensity rays (extinct after polarizer, etc.)
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
                }

                const isMain = path.length > 0 && path[0].isMainRay === true;
                const wavelength = path.length > 0 ? path[0].wavelength : 532e-9;
                const lastRay = lastVisibleRay(path);
                const terminalRelativeIntensity = relativePathIntensity(path, lastRay);

                // Add an "infinite" end to the last ray for visualization
                // (only if the last ray in the built points list has nonzero intensity)
                if (points.length > 0 && path.length > 0) {
                    const shouldDrawOpenTail = isMain
                        || path[0].coherenceMode === Coherence.Incoherent
                        || terminalRelativeIntensity >= OPEN_TAIL_RELATIVE_INTENSITY;
                    if (lastRay && lastRay.intensity >= 1e-6 && !lastRay.terminationPoint && shouldDrawOpenTail) {
                        const dist = lastRay.interactionDistance ?? 1000;
                        const origin = toVec3(lastRay.origin);
                        const direction = toVec3(lastRay.direction);
                        const endPoint = origin.clone().add(direction.clone().multiplyScalar(dist));
                        points.push(endPoint);
                    }
                }

                const isIncoherent = path.length > 0 && path[0].coherenceMode === Coherence.Incoherent;

                // Incoherent rays: always colored by wavelength.
                // Additive blending makes overlapping ROYGBIV produce white naturally.
                // Opacity from Lamp's additiveOpacity ensures balanced RGB white.
                // (Coherent rays have explicit NormalBlending/transparent=false/opacity=1 to prevent state leaks.)
                if (isIncoherent) {
                    const rgb = wavelengthToRGB(wavelength * 1e9);
                    const scale = noBloom ? 0.18 : 1.0;
                    const bStr = noBloom 
                        ? `rgb(${Math.round(rgb.r * 255 * scale)}, ${Math.round(rgb.g * 255 * scale)}, ${Math.round(rgb.b * 255 * scale)})`
                        : (rgb.isVisible
                            ? `rgb(${Math.round(rgb.r * 255)}, ${Math.round(rgb.g * 255)}, ${Math.round(rgb.b * 255)})`
                            : 'rgb(135, 135, 135)');
                    const color = bStr;
                    // Opacity from ray intensity, remapped through min/max opacity range
                    const rawOpacity = path.length > 0 ? Math.min(1, path[0].intensity) : 0.5;
                    const rayOpacity = minOpacity + rawOpacity * (maxOpacity - minOpacity);

                    return (
                        <Line
                            key={idx}
                            points={points}
                            color={color}
                            lineWidth={isMain ? 4 : 2}
                            depthTest={true}
                            renderOrder={1}
                            transparent
                            opacity={rayOpacity}
                            dashed={!rgb.isVisible}
                            dashSize={!rgb.isVisible ? 3 : undefined}
                            gapSize={!rgb.isVisible ? 2 : undefined}
                            toneMapped={false}
                            blending={AdditiveBlending}
                        />
                    );
                }

                // Coherent (laser) rays: wavelength-colored rendering
                if (isMain) {
                    const wc = coherentDisplayRGB(wavelength);

                    // Pulsating glow only when E&M solver is enabled
                    if (glowEnabled) {
                        const glowRawOpacity = Math.min(1, path[0].intensity);
                        const glowOpacity = minOpacity + glowRawOpacity * (maxOpacity - minOpacity);
                        return (
                            <PulsatingRayLine
                                key={idx}
                                points={points}
                                wavelengthMeters={wavelength}
                                dashed={!wc.isVisible}
                                opacity={glowOpacity}
                            />
                        );
                    }

                    // Static main ray (no glow) — thicker white/wavelength line
                    const color = rgbToCSS(wc);
                    const mainRawOpacity = Math.min(1, path[0].intensity);
                    const mainOpacity = minOpacity + mainRawOpacity * (maxOpacity - minOpacity);
                    const mainTransparent = mainOpacity < 0.999;
                    const redGlow = redEdgeGlow(wavelength, mainOpacity);
                    return (
                        <group key={idx}>
                            {redGlow && (
                                <Line
                                    points={points}
                                    color={redGlow.color}
                                    lineWidth={4 + redGlow.lineWidthBoost}
                                    transparent
                                    opacity={redGlow.opacity}
                                    depthWrite={false}
                                    dashed={!wc.isVisible}
                                    dashSize={!wc.isVisible ? 3 : undefined}
                                    gapSize={!wc.isVisible ? 2 : undefined}
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
                                opacity={mainOpacity}
                                depthWrite={!mainTransparent}
                                dashed={!wc.isVisible}
                                dashSize={!wc.isVisible ? 3 : undefined}
                                gapSize={!wc.isVisible ? 2 : undefined}
                                depthTest={true}
                                renderOrder={1}
                                toneMapped={false}
                                blending={NormalBlending}
                            />
                        </group>
                    );
                }

                // Non-main coherent rays: static wavelength color
                if (terminalRelativeIntensity < MIN_DRAW_RELATIVE_INTENSITY) {
                    return null;
                }
                const nrGb = coherentDisplayRGB(wavelength);
                const nScale = noBloom ? 0.18 : 1.0;
                const wavelengthColor = wavelengthToColor(wavelength);
                const nColor = noBloom
                    ? rgbToCSS(nrGb, nScale)
                    : wavelengthColor.color;
                const isVis = wavelengthColor.isVisible;
                const nOpacity = Math.max(minOpacity * terminalRelativeIntensity, coherentBranchOpacity(terminalRelativeIntensity, maxOpacity));
                const nTransparent = nOpacity < 0.999;
                const nLineWidth = 0.75 + 1.25 * Math.sqrt(terminalRelativeIntensity);
                return (
                    <Line
                        key={idx}
                        points={points}
                        color={nColor}
                        lineWidth={nLineWidth}
                        transparent={nTransparent}
                        opacity={nOpacity}
                        depthWrite={!nTransparent}
                        dashed={!isVis}
                        dashSize={!isVis ? 3 : undefined}
                        gapSize={!isVis ? 2 : undefined}
                        depthTest={true}
                        renderOrder={1}
                        toneMapped={false}
                        blending={NormalBlending}
                    />
                );
            })}
        </group>
    );
};
