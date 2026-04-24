import React, { useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Vector3, Color, NormalBlending, AdditiveBlending } from 'three';
import { Ray, Coherence } from '../physics/types';
import { wavelengthToRGB, wavelengthToCSS } from '../physics/spectral';

/** Thin wrapper: takes wavelength in meters, returns CSS color + visibility flag. */
function wavelengthToColor(wavelengthMeters: number): { color: string; isVisible: boolean } {
    const nm = wavelengthMeters * 1e9;
    const { isVisible } = wavelengthToRGB(nm);
    return { color: wavelengthToCSS(nm), isVisible };
}

/** Defensive: accept either a Vector3 or a {x,y,z} plain object and return a Vector3. */
function toVec3(v: { x: number; y: number; z: number }): Vector3 {
    return v instanceof Vector3 ? v : new Vector3(v.x, v.y, v.z);
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
    const rgb = wavelengthToRGB(wavelengthMeters * 1e9);

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

                // Add an "infinite" end to the last ray for visualization
                // (only if the last ray in the built points list has nonzero intensity)
                if (points.length > 0 && path.length > 0) {
                    // Find the last ray that was actually included (non-extinct)
                    const lastIncludedIdx = path.findIndex(r => r.intensity < 1e-6) - 1;
                    const lastRay = lastIncludedIdx >= 0 ? path[lastIncludedIdx] : path[path.length - 1];
                    if (lastRay.intensity >= 1e-6 && !lastRay.terminationPoint) {
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
                    const wc = wavelengthToRGB(wavelength * 1e9);

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
                    const color = `rgb(${Math.round(wc.r * 255)}, ${Math.round(wc.g * 255)}, ${Math.round(wc.b * 255)})`;
                    const mainRawOpacity = Math.min(1, path[0].intensity);
                    const mainOpacity = minOpacity + mainRawOpacity * (maxOpacity - minOpacity);
                    const mainTransparent = mainOpacity < 0.999;
                    return (
                        <Line
                            key={idx}
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
                    );
                }

                // Non-main coherent rays: static wavelength color
                const nrGb = wavelengthToRGB(wavelength * 1e9);
                const nScale = noBloom ? 0.18 : 1.0;
                const nColor = noBloom
                    ? `rgb(${Math.round(nrGb.r * 255 * nScale)}, ${Math.round(nrGb.g * 255 * nScale)}, ${Math.round(nrGb.b * 255 * nScale)})`
                    : wavelengthToColor(wavelength).color;
                const isVis = wavelengthToColor(wavelength).isVisible;
                const nRawOpacity = path.length > 0 ? Math.min(1, path[0].intensity) : 1;
                const nOpacity = minOpacity + nRawOpacity * (maxOpacity - minOpacity);
                const nTransparent = nOpacity < 0.999;
                return (
                    <Line
                        key={idx}
                        points={points}
                        color={nColor}
                        lineWidth={2}
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
