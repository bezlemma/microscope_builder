import React, { useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Vector3, Color, NormalBlending, AdditiveBlending } from 'three';
import { Ray, Coherence } from '../physics/types';

// Wavelength (in meters) to visible spectrum RGB values (0-1 range)
function wavelengthToRGB(wavelengthMeters: number): { r: number; g: number; b: number; isVisible: boolean } {
    const wavelength = wavelengthMeters * 1e9; // Convert to nm
    let r = 0, g = 0, b = 0;

    if (wavelength >= 380 && wavelength < 440) {
        r = -(wavelength - 440) / (440 - 380);
        b = 1.0;
    } else if (wavelength >= 440 && wavelength < 490) {
        g = (wavelength - 440) / (490 - 440);
        b = 1.0;
    } else if (wavelength >= 490 && wavelength < 510) {
        g = 1.0;
        b = -(wavelength - 510) / (510 - 490);
    } else if (wavelength >= 510 && wavelength < 580) {
        r = (wavelength - 510) / (580 - 510);
        g = 1.0;
    } else if (wavelength >= 580 && wavelength < 645) {
        r = 1.0;
        g = -(wavelength - 645) / (645 - 580);
    } else if (wavelength >= 645 && wavelength <= 780) {
        r = 1.0;
    }

    // Apply intensity correction for edge wavelengths
    let factor = 1.0;
    if (wavelength >= 380 && wavelength < 420) {
        factor = 0.3 + 0.7 * (wavelength - 380) / (420 - 380);
    } else if (wavelength >= 645 && wavelength <= 780) {
        factor = 0.3 + 0.7 * (780 - wavelength) / (780 - 645);
    } else if (wavelength < 380 || wavelength > 780) {
        return { r: 0.53, g: 0.53, b: 0.53, isVisible: false };
    }

    r = Math.pow(r * factor, 0.8);
    g = Math.pow(g * factor, 0.8);
    b = Math.pow(b * factor, 0.8);

    return { r, g, b, isVisible: true };
}

function wavelengthToColor(wavelengthMeters: number): { color: string; isVisible: boolean } {
    const rgb = wavelengthToRGB(wavelengthMeters);
    const ri = Math.round(rgb.r * 255);
    const gi = Math.round(rgb.g * 255);
    const bi = Math.round(rgb.b * 255);
    return { color: `rgb(${ri}, ${gi}, ${bi})`, isVisible: rgb.isVisible };
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
}> = ({ points, wavelengthMeters, dashed }) => {
    const lineRef = useRef<any>(null);
    const rgb = wavelengthToRGB(wavelengthMeters);

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

    return (
        <Line
            ref={lineRef}
            points={points}
            color={baseColor}
            lineWidth={4.5}
            toneMapped={false}
            transparent={false}
            opacity={1}
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
    hideAll?: boolean;  // E-field mode: hide all rays
}


export const RayVisualizer: React.FC<RayVisualizerProps> = ({ paths, glowEnabled = true, hideAll = false }) => {
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
                        points.push(r.entryPoint);
                    }
                    if (r.internalPath) {
                        for (const p of r.internalPath) {
                            points.push(p);
                        }
                    }
                    points.push(r.origin);
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
                        const endPoint = lastRay.origin.clone().add(lastRay.direction.clone().multiplyScalar(dist));
                        points.push(endPoint);
                    }
                }

                const isIncoherent = path.length > 0 && path[0].coherenceMode === Coherence.Incoherent;

                // Incoherent rays: always colored by wavelength.
                // Additive blending makes overlapping ROYGBIV produce white naturally.
                // Opacity from Lamp's additiveOpacity ensures balanced RGB white.
                // (Coherent rays have explicit NormalBlending/transparent=false/opacity=1 to prevent state leaks.)
                if (isIncoherent) {
                    const rgb = wavelengthToRGB(wavelength);
                    const color = rgb.isVisible
                        ? `rgb(${Math.round(rgb.r * 255)}, ${Math.round(rgb.g * 255)}, ${Math.round(rgb.b * 255)})`
                        : 'rgb(135, 135, 135)'; // Gray for UV/IR
                    // Opacity from ray intensity (Lamp's additive white-balance value)
                    const rayOpacity = path.length > 0 ? Math.min(1, path[0].intensity) : 0.5;

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
                    const wc = wavelengthToRGB(wavelength);

                    // Pulsating glow only when E&M solver is enabled
                    if (glowEnabled) {
                        return (
                            <PulsatingRayLine
                                key={idx}
                                points={points}
                                wavelengthMeters={wavelength}
                                dashed={!wc.isVisible}
                            />
                        );
                    }

                    // Static main ray (no glow) — thicker white/wavelength line
                    const color = `rgb(${Math.round(wc.r * 255)}, ${Math.round(wc.g * 255)}, ${Math.round(wc.b * 255)})`;
                    return (
                        <Line
                            key={idx}
                            points={points}
                            color={wc.isVisible ? color : 'white'}
                            lineWidth={4}
                            transparent={false}
                            opacity={1}
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
                const wc = wavelengthToColor(wavelength);
                return (
                    <Line
                        key={idx}
                        points={points}
                        color={wc.color}
                        lineWidth={2}
                        transparent={false}
                        opacity={1}
                        dashed={!wc.isVisible}
                        dashSize={!wc.isVisible ? 3 : undefined}
                        gapSize={!wc.isVisible ? 2 : undefined}
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
