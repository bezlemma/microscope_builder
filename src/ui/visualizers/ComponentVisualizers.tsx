/**
 * Extracted component visualizers from OpticalTable.tsx
 * 
 * Each visualizer renders the 3D representation of an optical component.
 * Grouped here to keep OpticalTable.tsx focused on the solver/render loop.
 */
import React, { useMemo, useState, useRef, useCallback, useContext, createContext } from 'react';
import { Vector2, Vector3, DoubleSide, BufferGeometry, Float32BufferAttribute, Shape, Path as ThreePath, ExtrudeGeometry, CylinderGeometry, LatheGeometry, ShapeGeometry } from 'three';
import { useAtom } from 'jotai';
import { selectionAtom, cameraBlendAtom, componentsAtom, pushUndoAtom, handleDraggingAtom, uiLockedAtom } from '../../state/store';
import { Text, Edges, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { OpticalComponent } from '../../physics/Component';
import { Mirror } from '../../physics/components/Mirror';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { AsphericLens } from '../../physics/components/AsphericLens';
import { Laser } from '../../physics/components/Laser';
import { Blocker } from '../../physics/components/Blocker';
import { Card } from '../../physics/components/Card';
import { defaultColloidColor, Sample } from '../../physics/components/Sample';
import { Objective } from '../../physics/components/Objective';
import { ObjectiveCasing } from '../../physics/components/ObjectiveCasing';
import { IdealLens } from '../../physics/components/IdealLens';
import { Camera } from '../../physics/components/Camera';
import { CylindricalLens } from '../../physics/components/CylindricalLens';
import { PrismLens } from '../../physics/components/PrismLens';
import { Waveplate } from '../../physics/components/Waveplate';
import { BeamSplitter } from '../../physics/components/BeamSplitter';
import { Aperture } from '../../physics/components/Aperture';
import { SlitAperture } from '../../physics/components/SlitAperture';
import { SampleChamber } from '../../physics/components/SampleChamber';
import { Filter } from '../../physics/components/Filter';
import { DichroicMirror } from '../../physics/components/DichroicMirror';
import { CurvedMirror } from '../../physics/components/CurvedMirror';
import { PolygonScanner } from '../../physics/components/PolygonScanner';
import { AbstractPolygonOptic } from '../../physics/components/AbstractPolygonOptic';
import { PMT } from '../../physics/components/PMT';
import { GalvoScanHead } from '../../physics/components/GalvoScanHead';
import { DualGalvoScanHead } from '../../physics/components/DualGalvoScanHead';
import { Diffuser } from '../../physics/components/Diffuser';
import { DoubleSlit } from '../../physics/components/DoubleSlit';
import { FaradayIsolator } from '../../physics/components/FaradayIsolator';
import { QPD } from '../../physics/components/QPD';
import { AOD } from '../../physics/components/AOD';
import { AchromatDoublet } from '../../physics/components/AchromatDoublet';
import { PupilMaskElement } from '../../physics/components/PupilMaskElement';
import { MediumVolume } from '../../physics/components/MediumVolume';
import { Rail } from '../../physics/components/Rail';
import { StructuredSource } from '../../physics/components/StructuredSource';
import { PointSourceBase } from '../../physics/components/PointSourceBase';
import { ConeSource3D } from '../../physics/components/ConeSource3D';
import { WedgeSource2D } from '../../physics/components/WedgeSource2D';
import { TrappedBead } from '../../physics/components/TrappedBead';

// ─── Shared Helpers ──────────────────────────────────────────────────

import { wavelengthToHex, wavelengthToCSS } from '../../physics/spectral';

/**
 * Context for outline color — black (#000000) for components on the active
 * Z level, grey (#888888) for components on other levels.
 * Provided per-component in OpticalTable.tsx.
 */
export const OutlineColorContext = createContext<string>('#000000');

/** Simple edge outline using drei's <Edges>. Place as a child of any <mesh>. */
const EdgeOutline: React.FC<{ threshold?: number; color?: string }> = ({ threshold = 20, color }) => {
    const contextColor = useContext(OutlineColorContext);
    return <Edges threshold={threshold} color={color ?? contextColor} />;
};

/**
 * Explicit outline for extruded polygon optics (prisms, etc.).
 * Draws front/back endcap perimeters and corner connecting lines.
 */
const PolygonOutline: React.FC<{
    component: { getOutlineData: () => { frontCap: Vector3[]; backCap: Vector3[]; corners: [Vector3, Vector3][] }; version: number };
}> = ({ component }) => {
    const outlineData = useMemo(() => component.getOutlineData(), [component.version]);

    const frontPts = outlineData.frontCap.map(v => [v.x, v.y, v.z] as [number, number, number]);
    if (frontPts.length > 0) frontPts.push(frontPts[0]);
    const backPts = outlineData.backCap.map(v => [v.x, v.y, v.z] as [number, number, number]);
    if (backPts.length > 0) backPts.push(backPts[0]);

    const outlineColor = useContext(OutlineColorContext);

    return (
        <group>
            {frontPts.length > 1 && <Line points={frontPts} color={outlineColor} lineWidth={1.5} />}
            {backPts.length > 1 && <Line points={backPts} color={outlineColor} lineWidth={1.5} />}
            {outlineData.corners.map((pair, i) => (
                <Line key={i} points={[[pair[0].x, pair[0].y, pair[0].z], [pair[1].x, pair[1].y, pair[1].z]]} color={outlineColor} lineWidth={1.5} />
            ))}
        </group>
    );
};

/**
 * Build a flat ShapeGeometry from a lens profile for clean 2D top-down rendering.
 */
function buildProfileShapeGeo(profile: Vector2[]): ShapeGeometry {
    const shape = new Shape();
    shape.moveTo(profile[0].x, profile[0].y);
    for (let i = 1; i < profile.length; i++) {
        shape.lineTo(profile[i].x, profile[i].y);
    }
    for (let i = profile.length - 1; i >= 0; i--) {
        shape.lineTo(-profile[i].x, profile[i].y);
    }
    shape.closePath();
    return new ShapeGeometry(shape);
}

function useDisposableGeometry<T extends BufferGeometry>(factory: () => T, deps: React.DependencyList): T {
    const geometry = useMemo(factory, deps);
    React.useEffect(() => () => {
        geometry.dispose();
    }, [geometry]);
    return geometry;
}

const GLASS_TRANSMISSION_3D = 0.03;
const GLASS_OPACITY_3D = 0.98;
const SELECTED_GLASS_TRANSMISSION_3D = 0.02;
const SELECTED_GLASS_OPACITY_3D = 0.99;
const FILTER_TRANSMISSION_3D = 0.12;
const FILTER_OPACITY = 0.68;
const DICHROIC_TRANSMISSION_3D = 0.1;
const DICHROIC_OPACITY_2D = 0.82;
const DICHROIC_OPACITY_3D = 0.86;
const LENS_FLAT_OPACITY = 0.62;
const SELECTED_LENS_FLAT_OPACITY = 0.7;
const LENS_BODY_OPACITY = 0.92;
const SELECTED_LENS_BODY_OPACITY = 0.96;

function tiltedGlassOpacity(orthoOpacity: number, perspOpacity: number, blend: number): number {
    const perspectiveWeight = Math.min(1, Math.max(0, blend) * 1.8);
    return orthoOpacity + perspectiveWeight * (perspOpacity - orthoOpacity);
}

/**
 * Explicit rim outline for LatheGeometry-based lenses.
 * EdgesGeometry doesn't work well on curved lathe surfaces (picks up seam,
 * misses rim).  Instead we draw the rim circle(s) for perspective view, and
 * the profile cross-section curves for top-down view.
 */
const LensRimOutline: React.FC<{
    profilePoints: Vector2[];
    aperture: number;
}> = ({ profilePoints, aperture }) => {
    const [blend] = useAtom(cameraBlendAtom);

    const { rimCircles, rightProfile, leftProfile } = useMemo(() => {
        let maxR = 0;
        for (const p of profilePoints) {
            if (p.x > maxR) maxR = p.x;
        }

        const segments = 64;
        const makeCircle = (z: number, r: number): [number, number, number][] => {
            const circle: [number, number, number][] = [];
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                circle.push([
                    Math.cos(angle) * r,
                    Math.sin(angle) * r,
                    z
                ]);
            }
            return circle;
        };

        const threshold = maxR * 0.99;
        let rimZmin = Infinity, rimZmax = -Infinity;
        for (const p of profilePoints) {
            if (p.x >= threshold) {
                if (p.y < rimZmin) rimZmin = p.y;
                if (p.y > rimZmax) rimZmax = p.y;
            }
        }

        const circles = [makeCircle(rimZmin, maxR)];
        const thin = Math.abs(rimZmax - rimZmin) <= 0.01;
        if (!thin) {
            circles.push(makeCircle(rimZmax, maxR));
        }

        const right: [number, number, number][] = profilePoints.map(p => [p.x, 0, p.y]);
        const left: [number, number, number][] = profilePoints.map(p => [-p.x, 0, p.y]);

        return { rimCircles: circles, rightProfile: right, leftProfile: left };
    }, [profilePoints, aperture]);

    const rimOpacity = blend;
    const profileOpacity = 1 - blend;

    const outlineColor = useContext(OutlineColorContext);

    return (
        <group>
            {rimOpacity > 0.01 && rimCircles.map((circle, i) => (
                <Line key={`rim-${i}`} points={circle} color={outlineColor} lineWidth={1.5} opacity={rimOpacity} transparent={rimOpacity < 1} />
            ))}
            {profileOpacity > 0.01 && rightProfile.length > 2 && (
                <>
                    <Line points={rightProfile} color={outlineColor} lineWidth={1.5} opacity={profileOpacity} transparent={profileOpacity < 1} />
                    <Line points={leftProfile} color={outlineColor} lineWidth={1.5} opacity={profileOpacity} transparent={profileOpacity < 1} />
                </>
            )}
        </group>
    );
};

/** Wall panel with a real circular hole (CSG via Shape + ExtrudeGeometry) */
const WallWithHole = ({ wallSize, holeRadius, thickness, position, rotation, color }: {
    wallSize: number;
    holeRadius: number;
    thickness: number;
    position: [number, number, number];
    rotation: [number, number, number];
    color: string;
}) => {
    const geometry = useDisposableGeometry(() => {
        const hs = wallSize / 2;
        const shape = new Shape();
        shape.moveTo(-hs, -hs);
        shape.lineTo(hs, -hs);
        shape.lineTo(hs, hs);
        shape.lineTo(-hs, hs);
        shape.closePath();

        const hole = new ThreePath();
        hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, false);
        shape.holes.push(hole);

        return new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    }, [wallSize, holeRadius, thickness]);

    return (
        <mesh position={position} rotation={rotation} geometry={geometry}>
            <meshStandardMaterial
                color={color}
                roughness={0.35}
                metalness={0.18}
                emissive="#28323a"
                emissiveIntensity={0.22}
                side={DoubleSide}
            />
            <EdgeOutline threshold={8} color="#000000" />
        </mesh>
    );
};

// ─── Component Visualizers ───────────────────────────────────────────

export const CasingVisualizer = ({ component }: { component: ObjectiveCasing }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[8, 8, 20, 32]} />
                <meshPhysicalMaterial
                    color="#ffffff"
                    transmission={0.99}
                    opacity={0.15}
                    transparent
                    depthWrite={false}
                    roughness={0}
                    metalness={0.05}
                    side={DoubleSide}
                />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
                <cylinderGeometry args={[8.2, 8.2, 5, 32]} />
                <meshStandardMaterial color="#444" metalness={0.5} roughness={0.7} />
            </mesh>
            {isSelected && (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[8.5, 8.5, 20.5, 32]} />
                    <meshBasicMaterial color="#64ffda" transparent opacity={0.3} wireframe />
                </mesh>
            )}
        </group>
    );
};

/**
 * TrappedBeadVisualizer — a small translucent sphere drawn at the bead's
 * dynamic position (component origin + specimenOffset).  Re-renders on
 * component.version changes so the integrator's per-frame mutation of
 * specimenOffset shows up immediately.  Intentionally minimal — the whole
 * point is that the camera/QPD downstream tells you whether the trap is
 * working, not this little marker.
 */
export const TrappedBeadVisualizer = ({ component }: { component: TrappedBead }) => {
    void component.version;   // subscribe to version bumps from the integrator
    const r = component.radius;
    const o = component.getConfinedSpecimenOffset();
    const haloR = Math.max(component.visualGlowRadius, r * 1.4);
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[o.x, o.y, o.z]} renderOrder={2}>
                <sphereGeometry args={[haloR, 32, 18]} />
                <meshBasicMaterial
                    color={component.glowColor}
                    transparent
                    opacity={0.22}
                    depthWrite={false}
                />
            </mesh>
            <mesh position={[o.x, o.y, o.z]}>
                <sphereGeometry args={[Math.max(r, 0.004), 24, 16]} />
                <meshStandardMaterial
                    color="#bcd9ff"
                    transparent
                    opacity={0.78}
                    roughness={0.25}
                    metalness={0.05}
                    emissive={component.glowColor}
                    emissiveIntensity={0.35}
                />
            </mesh>
        </group>
    );
};

export const SampleVisualizer = ({ component }: { component: Sample }) => {
    if (component.specimenKind === 'colloids') {
        const outerW = component.flowCellWidth + 2;
        const outerH = component.flowCellHeight + 2;
        const frameT = 0.5;
        const glassT = component.flowCellGlassThickness;
        const halfDepth = component.flowCellDepth / 2;
        const firstColloidRadius = component.colloidSpheres[0]?.radius ?? 0.0025;
        const glowR = Math.max(0.006, firstColloidRadius * 2.5);

        return (
            <group
                position={[component.position.x, component.position.y, component.position.z]}
                quaternion={component.rotation.clone()}
                onClick={(e) => { e.stopPropagation(); }}
            >
                <mesh>
                    <boxGeometry args={[component.flowCellWidth, component.flowCellHeight, component.flowCellDepth]} />
                    <meshPhysicalMaterial
                        color="#7fd8ff"
                        transmission={0.85}
                        transparent
                        opacity={0.18}
                        roughness={0.05}
                        metalness={0}
                        depthWrite={false}
                    />
                    <EdgeOutline color="#6bbcff" />
                </mesh>
                <mesh position={[0, 0, -halfDepth - glassT / 2]}>
                    <boxGeometry args={[component.flowCellWidth, component.flowCellHeight, glassT]} />
                    <meshPhysicalMaterial color="#cdefff" transparent opacity={0.16} transmission={0.92} roughness={0.02} depthWrite={false} />
                </mesh>
                <mesh position={[0, 0, halfDepth + glassT / 2]}>
                    <boxGeometry args={[component.flowCellWidth, component.flowCellHeight, glassT]} />
                    <meshPhysicalMaterial color="#cdefff" transparent opacity={0.16} transmission={0.92} roughness={0.02} depthWrite={false} />
                </mesh>
                <mesh position={[0, outerH / 2 - frameT / 2, 0]}>
                    <boxGeometry args={[outerW, frameT, glassT * 1.5]} />
                    <meshStandardMaterial color="#1b1b1b" roughness={0.6} metalness={0.2} />
                </mesh>
                <mesh position={[0, -outerH / 2 + frameT / 2, 0]}>
                    <boxGeometry args={[outerW, frameT, glassT * 1.5]} />
                    <meshStandardMaterial color="#1b1b1b" roughness={0.6} metalness={0.2} />
                </mesh>
                <mesh position={[-outerW / 2 + frameT / 2, 0, 0]}>
                    <boxGeometry args={[frameT, outerH, glassT * 1.5]} />
                    <meshStandardMaterial color="#1b1b1b" roughness={0.6} metalness={0.2} />
                </mesh>
                <mesh position={[outerW / 2 - frameT / 2, 0, 0]}>
                    <boxGeometry args={[frameT, outerH, glassT * 1.5]} />
                    <meshStandardMaterial color="#1b1b1b" roughness={0.6} metalness={0.2} />
                </mesh>
                <group
                    position={[component.specimenOffset.x, component.specimenOffset.y, component.specimenOffset.z]}
                    rotation={[component.specimenRotation.x, component.specimenRotation.y, component.specimenRotation.z]}
                    userData={{ svgExport: 'skip' }}
                >
                    {component.colloidSpheres.map((colloid, index) => {
                        const color = colloid.glowColor && colloid.glowColor !== '#007fff'
                            ? colloid.glowColor
                            : defaultColloidColor(index);
                        return (
                            <group key={index} position={[colloid.center.x, colloid.center.y, colloid.center.z]}>
                                <mesh renderOrder={2}>
                                    <sphereGeometry args={[glowR, 24, 12]} />
                                    <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} />
                                </mesh>
                                <mesh>
                                    <sphereGeometry args={[Math.max(colloid.radius, 0.004), 16, 10]} />
                                    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} roughness={0.2} />
                                </mesh>
                            </group>
                        );
                    })}
                </group>
            </group>
        );
    }

    const outerSize = 40;
    const innerSize = 30;
    const thickness = 2;
    const frameWidth = (outerSize - innerSize) / 2;
    const offset = outerSize / 2 - frameWidth / 2;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <group>
                <group>
                    <mesh position={[0, offset, 0]}>
                        <boxGeometry args={[outerSize, frameWidth, thickness]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                    <mesh position={[0, -offset, 0]}>
                        <boxGeometry args={[outerSize, frameWidth, thickness]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                    <mesh position={[-offset, 0, 0]}>
                        <boxGeometry args={[frameWidth, innerSize, thickness]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                    <mesh position={[offset, 0, 0]}>
                        <boxGeometry args={[frameWidth, innerSize, thickness]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                </group>
                <mesh position={[0, 0, 0]}>
                    <boxGeometry args={[innerSize, innerSize, 0.5]} />
                    <meshPhysicalMaterial
                        color="#ffffff"
                        transmission={0.99}
                        opacity={0.1}
                        transparent
                        roughness={0}
                        metalness={0.0}
                        depthWrite={false}
                    />
                </mesh>
            </group>
            <group position={[component.specimenOffset.x, component.specimenOffset.y, component.specimenOffset.z]} rotation={[component.specimenRotation.x, component.specimenRotation.y, component.specimenRotation.z]}>
                <mesh position={[0, 0, 0]}>
                    <sphereGeometry args={[0.5, 32, 32]} />
                    <meshStandardMaterial color="#ffccaa" roughness={0.3} />
                </mesh>
                <mesh position={[-0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 32, 32]} />
                    <meshStandardMaterial color="black" roughness={0.3} />
                </mesh>
                <mesh position={[0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 32, 32]} />
                    <meshStandardMaterial color="black" roughness={0.3} />
                </mesh>
            </group>
        </group>
    );
};

export const ObjectiveVisualizer = ({ component }: { component: Objective }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);

    const f = component.focalLength;
    const a = component.apertureRadius;
    const wd = component.workingDistance;
    const bodyR = Math.max(a + 1, component.diameter / 2);

    const parfocalDistance = 35;
    const zFront = -f + wd;
    const zBack = Math.max(-f + parfocalDistance, zFront + 20);
    const zTaperEnd = zFront + Math.min(15, (zBack - zFront) * 0.6);

    const opticalFrontRadius = component.getOpticalFrontRadius();
    const frontRadius = component.getFrontRadius();
    const barrelLength = zBack - zFront;

    const getObjectiveBandColor = (mag: number) => {
        if (mag <= 4) return '#ff0000';
        if (mag <= 10) return '#ffd700';
        if (mag <= 20) return '#00ff00';
        if (mag <= 40) return '#00bfff';
        if (mag <= 60) return '#0000ff';
        return '#ffffff';
    };

    const lathePoints = React.useMemo(() => {
        const pts = [];
        pts.push(new Vector2(opticalFrontRadius, zFront));
        pts.push(new Vector2(frontRadius, zFront));
        if (zTaperEnd > zFront) pts.push(new Vector2(bodyR, zTaperEnd));
        if (zBack > zTaperEnd) pts.push(new Vector2(bodyR, zBack));
        pts.push(new Vector2(a, zBack));
        if (zBack > 0 && zFront < 0) pts.push(new Vector2(a, 0));
        pts.push(new Vector2(opticalFrontRadius, zFront));
        return pts;
    }, [opticalFrontRadius, zFront, frontRadius, bodyR, zTaperEnd, zBack, a]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={1}>
                <cylinderGeometry args={[a, a, 0.5, 32]} />
                <meshBasicMaterial color="#b388ff" transparent opacity={0.3} side={DoubleSide} depthWrite={false}/>
            </mesh>
            <mesh position={[0, 0, (zFront + 0.01) / 2]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1}>
                <cylinderGeometry args={[a, opticalFrontRadius, Math.abs(zFront - 0.01), 32, 1, true]} />
                <meshStandardMaterial color="#88ccff" transparent opacity={0.15} depthWrite={false} roughness={0.1} side={DoubleSide} />
            </mesh>
            {wd > 0.1 && (
                <mesh position={[0, 0, (-f + zFront) / 2]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1}>
                    <cylinderGeometry args={[frontRadius, 0.1, wd, 32]} />
                    <meshBasicMaterial color="#00ffcc" transparent opacity={0.15} wireframe={false} depthWrite={false} />
                </mesh>
            )}
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                <latheGeometry args={[lathePoints, 32]} />
                <meshStandardMaterial color="#222222" roughness={0.8} metalness={0.2} side={DoubleSide} transparent opacity={0.5} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0, zTaperEnd + 2]} rotation={[Math.PI / 2, 0, 0]} renderOrder={3}>
                <cylinderGeometry args={[bodyR + 0.1, bodyR + 0.1, 3, 32, 1, true]} />
                <meshStandardMaterial color={getObjectiveBandColor(component.magnification)} transparent opacity={0.8} depthWrite={false} roughness={0.3} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 0, (zFront + zBack) / 2]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[bodyR * 1.5, bodyR * 1.5, barrelLength + 10, 8]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} depthWrite={false} colorWrite={false} />
            </mesh>
            {isSelected && (
                <mesh position={[0, 0, (zFront + zBack) / 2]} rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[bodyR * 1.15, bodyR * 1.15, barrelLength + 2, 32]} />
                    <meshBasicMaterial color="#b388ff" transparent opacity={0.3} wireframe />
                </mesh>
            )}
        </group>
    );
};

export const CameraVisualizer = ({ component }: { component: Camera }) => {
    const width = 84;
    const height = 84;
    const depth = 122;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -depth / 2]}>
                <boxGeometry args={[width, height, depth]} />
                <meshStandardMaterial color="#333" metalness={0.6} roughness={0.4} />
            </mesh>
            <mesh position={[0, 0, 0.1]}>
                <planeGeometry args={[component.width, component.height]} />
                <meshStandardMaterial color="rgba(104, 65, 131, 1)" metalness={0.9} roughness={0.1} />
            </mesh>
            <Text
                position={[0, height / 2 + 0.1, -depth/4]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={16}
                color="#ffffff"
                anchorX="center"
                anchorY="top"
            >
                Camera
            </Text>
        </group>
    );
};

export const PMTVisualizer = ({ component }: { component: PMT }) => {
    const width = 20;
    const height = 20;
    const depth = 30;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, 0]}>
                <boxGeometry args={[width, height, depth]} />
                <meshStandardMaterial color="#555" metalness={0.5} roughness={0.5} />
            </mesh>
            <mesh position={[0, 0, depth / 2 + 0.1]}>
                <circleGeometry args={[width * 0.3, 32]} />
                <meshStandardMaterial color="rgba(134, 45, 175, 1)" metalness={0.8} roughness={0.15} />
            </mesh>
        </group>
    );
};

export const MirrorVisualizer = ({ component }: { component: Mirror }) => {
    const radius = component.diameter / 2;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={-1}>
                <cylinderGeometry args={[radius, radius, component.thickness, 64]} />
                <meshPhysicalMaterial
                    color="#f4f8fb"
                    metalness={0.92}
                    roughness={0.07}
                    clearcoat={1.0}
                    clearcoatRoughness={0.02}
                    emissive="#9da8b3"
                    emissiveIntensity={0.16}
                    side={DoubleSide}
                />
            </mesh>
        </group>
    );
};

export const GalvoScanHeadVisualizer = ({ component }: { component: GalvoScanHead }) => {
    const radius = component.diameter / 2;
    const boxW = component.diameter * 0.8;
    const boxD = component.thickness * 1.5;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Dark housing body */}
            <mesh>
                <boxGeometry args={[boxW, boxW, boxD]} />
                <meshStandardMaterial color="#111118" roughness={0.7} metalness={0.3} transparent opacity={0.7} />
            </mesh>
            {/* Reflective pivot mirror at z=0 (matches physics intersect plane) */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[radius * 0.85, radius * 0.85, 0.3, 32]} />
                <meshPhysicalMaterial color="#c0d8ff" metalness={0.95} roughness={0.03} clearcoat={1.0} />
            </mesh>
            {/* X-scan axis indicator (red bar) */}
            <mesh position={[0, radius * 0.6, boxD * 0.35]}>
                <boxGeometry args={[radius * 0.8, 0.5, 0.5]} />
                <meshStandardMaterial color="#ff4444" emissive="#661111" />
            </mesh>
            {/* Y-scan axis indicator (blue bar) */}
            <mesh position={[0, -radius * 0.6, -boxD * 0.35]}>
                <boxGeometry args={[0.5, radius * 0.8, 0.5]} />
                <meshStandardMaterial color="#4488ff" emissive="#112266" />
            </mesh>
        </group>
    );
};

export const DualGalvoScanHeadVisualizer = ({ component }: { component: DualGalvoScanHead }) => {
    // Housing only — child Mirror components (component.mirror1/mirror2) are
    // pushed into the scene alongside this component and render themselves
    // through MirrorVisualizer at the world transforms _syncMirrors() sets.
    // Drawing decorative cylinders here would diverge from the physics mirror
    // positions any time the scan head was rotated or the scan angles moved.
    const spacing = component.mirrorSpacing;
    const housingW = component.mirrorDiameter * 1.2;
    const housingH = spacing + component.mirrorDiameter;
    const housingD = component.mirrorDiameter * 1.2;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, spacing / 2, 0]}>
                <boxGeometry args={[housingW, housingH, housingD]} />
                <meshStandardMaterial
                    color="#111"
                    metalness={0.4}
                    roughness={0.8}
                    transparent
                    opacity={0.15}
                    depthWrite={false}
                />
                <EdgeOutline />
            </mesh>
        </group>
    );
};

export const PolygonScannerVisualizer = ({ component }: { component: PolygonScanner }) => {
    const geometry = useDisposableGeometry(() => component.buildDisplayGeometry(), [component.version]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geometry}>
                <meshPhysicalMaterial
                    color="#f4f8fb"
                    metalness={0.92}
                    roughness={0.07}
                    clearcoat={1.0}
                    clearcoatRoughness={0.02}
                    emissive="#9da8b3"
                    emissiveIntensity={0.16}
                    side={DoubleSide}
                />
            </mesh>
        </group>
    );
};

export const CurvedMirrorVisualizer = ({ component }: { component: CurvedMirror }) => {
    const geom = useDisposableGeometry(() => component.buildGeometry(), [component.diameter, component.radiusOfCurvature, component.thickness, component.version]);
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geom} renderOrder={-1}>
                <meshPhysicalMaterial
                    color="#f4f8fb"
                    metalness={0.92}
                    roughness={0.07}
                    clearcoat={1.0}
                    clearcoatRoughness={0.02}
                    emissive="#9da8b3"
                    emissiveIntensity={0.16}
                    side={DoubleSide}
                />
            </mesh>
        </group>
    );
};

export const BeamSplitterVisualizer = ({ component }: { component: BeamSplitter }) => {
    const radius = component.diameter / 2;
    const [blend] = useAtom(cameraBlendAtom);
    const opticColor = '#88ccff';
    const show3D = blend > 0.01;
    const show2D = blend < 0.99;
    const flatOpacity = 0.5;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {show2D && (
                <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                    <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                    <meshBasicMaterial
                        color={opticColor}
                        transparent
                        opacity={flatOpacity * (1 - blend)}
                        depthWrite={false}
                        side={DoubleSide}
                    />
                    <EdgeOutline threshold={15} color="#000000" />
                </mesh>
            )}
            {show3D && (
                <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                    <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                    <meshPhysicalMaterial
                        color={opticColor}
                        transmission={blend * GLASS_TRANSMISSION_3D}
                        opacity={GLASS_OPACITY_3D}
                        transparent
                        roughness={0.1 * (1 - blend)}
                        metalness={0}
                        ior={1.5}
                        thickness={0.5}
                        attenuationColor="#aaddff"
                        attenuationDistance={5}
                        side={DoubleSide}
                        depthWrite={false}
                    />
                    <EdgeOutline threshold={15} color="#000000" />
                </mesh>
            )}
        </group>
    );
};

export const ApertureVisualizer = ({ component }: { component: Aperture }) => {
    const outerR = component.housingDiameter / 2;
    const innerR = component.openingDiameter / 2;
    const halfT = Math.max(component.thickness / 2, 0.001);

    const points = useMemo(() => [
        new Vector2(innerR, -halfT),
        new Vector2(outerR, -halfT),
        new Vector2(outerR,  halfT),
        new Vector2(innerR,  halfT),
    ], [innerR, outerR, halfT]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <latheGeometry args={[points, 48]} />
                <meshStandardMaterial color="#333" roughness={0.6} metalness={0.4} />
            </mesh>
        </group>
    );
};

export interface SlitBarSpec {
    position: [number, number, number];
    size: [number, number, number];
}

export function buildSlitApertureBarSpecs(component: SlitAperture, thickness: number = 1): SlitBarSpec[] {
    const outerR = component.housingDiameter / 2;
    const halfW = component.slitWidth / 2;
    const halfH = component.slitHeight / 2;
    const bars: SlitBarSpec[] = [];

    const topBarHeight = outerR - halfH;
    const bottomBarHeight = outerR - halfH;
    const sideBarWidth = outerR - halfW;

    if (topBarHeight > 0.1) {
        bars.push({
            position: [0, halfH + topBarHeight / 2, 0],
            size: [outerR * 2, topBarHeight, thickness],
        });
    }
    if (bottomBarHeight > 0.1) {
        bars.push({
            position: [0, -(halfH + bottomBarHeight / 2), 0],
            size: [outerR * 2, bottomBarHeight, thickness],
        });
    }
    if (sideBarWidth > 0.1) {
        bars.push({
            position: [-(halfW + sideBarWidth / 2), 0, 0],
            size: [sideBarWidth, halfH * 2, thickness],
        });
        bars.push({
            position: [halfW + sideBarWidth / 2, 0, 0],
            size: [sideBarWidth, halfH * 2, thickness],
        });
    }

    return bars;
}

export const SlitApertureVisualizer = ({ component }: { component: SlitAperture }) => {
    const bars = useMemo(() => buildSlitApertureBarSpecs(component), [
        component.slitWidth,
        component.slitHeight,
        component.housingDiameter,
    ]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {bars.map((bar, index) => (
                <mesh key={index} position={bar.position}>
                    <boxGeometry args={bar.size} />
                    <meshStandardMaterial color="#444" roughness={0.5} metalness={0.5} />
                </mesh>
            ))}
        </group>
    );
};

export const FilterVisualizer = ({ component }: { component: Filter }) => {
    const radius = component.diameter / 2;
    const dominantNm = component.spectralProfile.getDominantPassWavelength();
    const tintColor = dominantNm ? wavelengthToHex(dominantNm) : '#888888';
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshPhysicalMaterial
                    color={tintColor}
                    metalness={0}
                    roughness={0.12}
                    transmission={FILTER_TRANSMISSION_3D}
                    transparent={true}
                    opacity={FILTER_OPACITY}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                    side={DoubleSide}
                    depthWrite={false}
                />
                <EdgeOutline threshold={15} color="#000000" />
            </mesh>
        </group>
    );
};

export const DichroicVisualizer = ({ component }: { component: DichroicMirror }) => {
    const radius = component.diameter / 2;
    const dominantNm = component.spectralProfile.getDominantPassWavelength();
    const tintColor = dominantNm ? wavelengthToHex(dominantNm) : '#88ccff';
    const [blend] = useAtom(cameraBlendAtom);
    const show3D = blend > 0.01;
    const show2D = blend < 0.99;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {show2D && (
                <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                    <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                    <meshBasicMaterial
                        color={tintColor}
                        transparent
                        opacity={DICHROIC_OPACITY_2D * (1 - blend)}
                        depthWrite={false}
                        side={DoubleSide}
                    />
                    <EdgeOutline threshold={15} color="#000000" />
                </mesh>
            )}
            {show3D && (
                <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                    <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                    <meshPhysicalMaterial
                        color={tintColor}
                        transmission={blend * DICHROIC_TRANSMISSION_3D}
                        opacity={DICHROIC_OPACITY_3D}
                        transparent
                        roughness={0.1 * (1 - blend)}
                        metalness={0}
                        ior={1.5}
                        thickness={0.5}
                        attenuationColor="#aaddff"
                        attenuationDistance={5}
                        side={DoubleSide}
                        depthWrite={false}
                    />
                    <EdgeOutline threshold={15} color="#000000" />
                </mesh>
            )}
        </group>
    );
};

export const BlockerVisualizer = ({ component }: { component: Blocker }) => {
    const radius = component.diameter / 2;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshStandardMaterial color="#222" roughness={0.8} />
            </mesh>
        </group>
    );
};

export const SampleChamberVisualizer = ({ component }: { component: SampleChamber }) => {
    const s = component.cubeSize;
    const wt = component.wallThickness;
    const boreR = component.boreDiameter / 2;
    const half = s / 2;
    const bodyColor = '#8fa3b2';

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -half]}>
                <boxGeometry args={[s, s, wt]} />
                <meshStandardMaterial color="#1a1a1a" roughness={0.8} metalness={0.1} />
            </mesh>
            <WallWithHole wallSize={s} holeRadius={boreR} thickness={wt} position={[half - wt, 0, 0]} rotation={[0, Math.PI / 2, 0]} color={bodyColor} />
            <WallWithHole wallSize={s} holeRadius={boreR} thickness={wt} position={[-half + wt, 0, 0]} rotation={[0, -Math.PI / 2, 0]} color={bodyColor} />
            <WallWithHole wallSize={s} holeRadius={boreR} thickness={wt} position={[0, half - wt, 0]} rotation={[-Math.PI / 2, 0, 0]} color={bodyColor} />
            <WallWithHole wallSize={s} holeRadius={boreR} thickness={wt} position={[0, -half + wt, 0]} rotation={[Math.PI / 2, 0, 0]} color={bodyColor} />
            <group position={[component.specimenOffset.x, component.specimenOffset.y, component.specimenOffset.z]} rotation={[component.specimenRotation.x, component.specimenRotation.y, component.specimenRotation.z]}>
                <mesh position={[0, 0, 0]}>
                    <sphereGeometry args={[0.5, 24, 24]} />
                    <meshStandardMaterial color="#ffccaa" roughness={0.6} />
                </mesh>
                <mesh position={[-0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 16, 16]} />
                    <meshStandardMaterial color="#3a3a3a" roughness={0.6} />
                </mesh>
                <mesh position={[0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 16, 16]} />
                    <meshStandardMaterial color="#3a3a3a" roughness={0.6} />
                </mesh>
            </group>
        </group>
    );
};

export const WaveplateVisualizer = ({ component }: { component: Waveplate }) => {
    const r = component.apertureRadius;
    const modeColors: Record<string, string> = {
        'half': '#6a5acd',
        'quarter': '#20b2aa',
        'polarizer': '#b8860b'
    };
    const color = modeColors[component.waveplateMode] || '#888';
    const bodyOpacity = component.waveplateMode === 'polarizer' ? 0.62 : 0.5;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                <cylinderGeometry args={[r, r, component.thickness, 32]} />
                <meshPhysicalMaterial
                    color={color}
                    transparent
                    opacity={bodyOpacity}
                    transmission={0.08}
                    roughness={0.18}
                    metalness={0}
                    ior={component.bulkIndex}
                    thickness={0.4}
                    side={DoubleSide}
                    depthWrite={false}
                />
                <EdgeOutline threshold={15} color="#000000" />
            </mesh>
            <mesh rotation={[0, Math.PI / 2, component.fastAxisAngle]}>
                <ringGeometry args={[r * 0.75, r * 1.1, 12, 1, Math.PI / 2 - Math.PI / 6, Math.PI / 3]} />
                <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.6} transparent opacity={0.75} side={DoubleSide} depthWrite={false} />
            </mesh>
            <mesh rotation={[0, Math.PI / 2, component.fastAxisAngle]}>
                <ringGeometry args={[r * 0.75, r * 1.1, 12, 1, -Math.PI / 2 - Math.PI / 6, Math.PI / 3]} />
                <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.6} transparent opacity={0.75} side={DoubleSide} depthWrite={false} />
            </mesh>
        </group>
    );
};

export const CardVisualizer = ({ component }: { component: Card }) => {
    const opaque = component.opaque;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh>
                <boxGeometry args={[component.width, component.height, 1]} />
                {opaque
                    ? <meshStandardMaterial color="#050505" roughness={0.95} metalness={0.0} emissive="#000000" />
                    : <meshStandardMaterial color="white" roughness={0.5} emissive="white" emissiveIntensity={0.1} />}
            </mesh>
            <mesh>
                <boxGeometry args={[component.width, component.height, 10]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} depthWrite={false} />
            </mesh>
        </group>
    );
};

export const LensVisualizer = ({ component }: { component: SphericalLens }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);

    const aperture = component.apertureRadius || 10;
    const thickness = component.thickness || 2;

    let R1 = 1e9;
    let R2 = -1e9;

    try {
        if (typeof component.getRadii === 'function') {
            const r = component.getRadii();
            R1 = (!isNaN(r.R1) && Math.abs(r.R1) < 1e12) ? r.R1 : (r.R1 > 0 ? 1e9 : -1e9);
            R2 = (!isNaN(r.R2) && Math.abs(r.R2) < 1e12) ? r.R2 : (r.R2 > 0 ? 1e9 : -1e9);
        } else {
            const power = component.curvature || 0;
            const ior = component.ior || 1.5;
            const R = Math.abs(power) > 1e-6 ? (2 * (ior - 1)) / power : 1e9;
            R1 = R;
            R2 = -R;
        }
    } catch (e) {
        console.warn("LensVisualizer: Error getting radii", e);
    }

    const profilePoints = useMemo(() => {
        const profile = SphericalLens.generateProfile(R1, R2, aperture, thickness, 32);
        if (profile.length < 2) {
            const frontApex = -thickness / 2;
            const backApex = thickness / 2;
            return [new Vector2(0, frontApex), new Vector2(aperture, frontApex), new Vector2(aperture, backApex), new Vector2(0, backApex)];
        }
        return profile;
    }, [aperture, thickness, R1, R2]);

    const [blend] = useAtom(cameraBlendAtom);

    const lensGeo = useDisposableGeometry(() => new LatheGeometry(profilePoints, 32), [profilePoints]);
    const lensFlatGeo = useDisposableGeometry(() => buildProfileShapeGeo(profilePoints), [profilePoints]);

    const lensColor = component.ior > 1.55 ? "#88ffee" : "#aaddff";
    const lensEmissive = isSelected ? "#64ffda" : "#000000";
    const lensEmissiveIntensity = isSelected ? 0.15 : 0;

    const opacity = isSelected ? SELECTED_LENS_BODY_OPACITY : LENS_BODY_OPACITY;

    const show3D = blend > 0.01;
    const show2D = blend < 0.99;
    const flatOpacity = isSelected ? SELECTED_LENS_FLAT_OPACITY : LENS_FLAT_OPACITY;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {show2D && (
                <mesh geometry={lensFlatGeo} rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                    <meshBasicMaterial
                        color={lensColor}
                        transparent
                        opacity={flatOpacity * (1 - blend)}
                        depthWrite={false}
                        side={DoubleSide}
                    />
                </mesh>
            )}
            {show3D && (
                <mesh geometry={lensGeo} rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                    <meshStandardMaterial
                        color={lensColor}
                        opacity={opacity}
                        transparent
                        roughness={0.18}
                        metalness={0}
                        side={DoubleSide}
                        depthWrite={false}
                        emissive={lensEmissive}
                        emissiveIntensity={lensEmissiveIntensity}
                    />
                </mesh>
            )}
            <LensRimOutline profilePoints={profilePoints} aperture={aperture} />
        </group>
    );
};

export const AsphericLensVisualizer = ({ component }: { component: AsphericLens }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);

    const aperture = component.apertureRadius || 10;
    const thickness = component.thickness || 2;

    const profilePoints = useMemo(
        () => AsphericLens.generateProfile(component.frontSurface, component.backSurface, aperture, thickness, 64),
        [
            aperture,
            thickness,
            component.r1,
            component.r2,
            component.k1,
            component.k2,
            component.A1,
            component.A2,
            component.version,
        ],
    );

    const [blend] = useAtom(cameraBlendAtom);
    const lensGeo = useDisposableGeometry(() => new LatheGeometry(profilePoints, 64), [profilePoints]);
    const lensFlatGeo = useDisposableGeometry(() => buildProfileShapeGeo(profilePoints), [profilePoints]);

    const lensColor = component.ior > 1.55 ? '#88ffee' : '#aaddff';
    const lensEmissive = isSelected ? '#64ffda' : '#000000';
    const lensEmissiveIntensity = isSelected ? 0.15 : 0;
    const opacity = isSelected ? SELECTED_LENS_BODY_OPACITY : LENS_BODY_OPACITY;
    const show3D = blend > 0.01;
    const show2D = blend < 0.99;
    const flatOpacity = isSelected ? SELECTED_LENS_FLAT_OPACITY : LENS_FLAT_OPACITY;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {show2D && (
                <mesh geometry={lensFlatGeo} rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                    <meshBasicMaterial
                        color={lensColor}
                        transparent
                        opacity={flatOpacity * (1 - blend)}
                        depthWrite={false}
                        side={DoubleSide}
                    />
                </mesh>
            )}
            {show3D && (
                <mesh geometry={lensGeo} rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                    <meshStandardMaterial
                        color={lensColor}
                        opacity={opacity}
                        transparent
                        roughness={0.18}
                        metalness={0}
                        side={DoubleSide}
                        depthWrite={false}
                        emissive={lensEmissive}
                        emissiveIntensity={lensEmissiveIntensity}
                    />
                </mesh>
            )}
            <LensRimOutline profilePoints={profilePoints} aperture={aperture} />
        </group>
    );
};

export const SourceVisualizer = ({ component }: { component: OpticalComponent }) => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const laser = component instanceof Laser ? component : null;
    const isLaser = laser !== null;
    const beamColor = laser ? wavelengthToCSS(laser.wavelength) : "#222";
    const stopButtonEvent = useCallback((e: any) => {
        e.stopPropagation();
    }, []);
    const toggleLaser = useCallback((e: any) => {
        e.stopPropagation();
        if (!laser) return;
        pushUndo();
        laser.isOn = !laser.isOn;
        laser.version++;
        setComponents([...components]);
    }, [components, laser, pushUndo, setComponents]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -33]}>
                <boxGeometry args={[38, 40, 70]} />
                <meshStandardMaterial color="#222" metalness={0.5} roughness={0.5} />
            </mesh>
            {isLaser && (
                <mesh position={[0, 20.1, -40]} rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[20, 38]} />
                    <meshBasicMaterial color={laser.isOn ? beamColor : '#111'} />
                </mesh>
            )}
            {laser && (
                <group
                    position={[0, 20.8, -40]}
                    onPointerDown={stopButtonEvent}
                    onPointerUp={toggleLaser}
                    onClick={stopButtonEvent}
                >
                    <mesh>
                        <cylinderGeometry args={[5.2, 5.2, 1.4, 32]} />
                        <meshStandardMaterial
                            color="#6f767d"
                            emissive="#15181b"
                            emissiveIntensity={0.18}
                            roughness={0.32}
                            metalness={0.15}
                        />
                    </mesh>
                    <mesh position={[0, 0.76, 0]} rotation={[Math.PI / 2, 0, 0]}>
                        <torusGeometry args={[2.1, 0.32, 8, 28]} />
                        <meshBasicMaterial color="#e2e6ea" />
                    </mesh>
                    <mesh position={[0, 0.78, -1.2]} rotation={[Math.PI / 2, 0, 0]}>
                        <boxGeometry args={[0.6, 2.1, 0.2]} />
                        <meshBasicMaterial color="#e2e6ea" />
                    </mesh>
                </group>
            )}
            <mesh position={[0, 0, 2]} rotation={[-Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[10, 5, 2, 16]} />
                <meshStandardMaterial color="#666" />
            </mesh>
        </group>
    );
};

export const LampVisualizer = ({ component }: { component: OpticalComponent }) => {
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -8.5]}>
                <boxGeometry args={[30, 22, 23]} />
                <meshStandardMaterial color="#2a2520" metalness={0.3} roughness={0.7} />
            </mesh>
            <mesh position={[0, 0, 3]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[5, 5, 2, 16]} />
                <meshStandardMaterial color="#BBB" />
            </mesh>
        </group>
    );
};

export const IdealLensVisualizer = ({ component }: { component: IdealLens }) => {
    const a = component.apertureRadius;
    const converging = component.focalLength > 0;
    const color = converging ? '#64ffda' : '#ff6b9d';

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={[component.rotation.x, component.rotation.y, component.rotation.z, component.rotation.w]}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[a, a, 0.5, 32]} />
                <meshStandardMaterial
                    color={color}
                    transparent
                    opacity={0.4}
                    roughness={0.2}
                    metalness={0.1}
                    side={DoubleSide}
                    depthWrite={false}
                />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[a, a, 4, 32]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} />
            </mesh>
        </group>
    );
};

export const CylindricalLensVisualizer = ({ component }: { component: CylindricalLens }) => {
    const [blend] = useAtom(cameraBlendAtom);
    const geometry = useDisposableGeometry(() => {
        const segsY = 24;
        const segsX = 2;
        const halfW = component.width / 2;
        const R1 = component.r1;
        const R2 = component.r2;
        const thickness = component.thickness;
        const maxY = component.apertureRadius;

        const sagFront = (y: number) => {
            const frontApex = -thickness / 2;
            if (Math.abs(R1) > 1e8) return frontApex;
            const val = R1 * R1 - y * y;
            if (val < 0) return frontApex;
            return (frontApex + R1) - (R1 > 0 ? 1 : -1) * Math.sqrt(val);
        };
        const sagBack = (y: number) => {
            const backApex = thickness / 2;
            if (Math.abs(R2) > 1e8) return backApex;
            const val = R2 * R2 - y * y;
            if (val < 0) return backApex;
            return (backApex + R2) - (R2 > 0 ? 1 : -1) * Math.sqrt(val);
        };

        const positions: number[] = [];
        const indices: number[] = [];
        const yCount = segsY + 1;

        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            for (let yi = 0; yi <= segsY; yi++) {
                const y = -maxY + (2 * maxY * yi) / segsY;
                positions.push(x, y, sagFront(Math.abs(y)));
            }
        }
        const backOff = (segsX + 1) * yCount;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            for (let yi = 0; yi <= segsY; yi++) {
                const y = -maxY + (2 * maxY * yi) / segsY;
                positions.push(x, y, sagBack(Math.abs(y)));
            }
        }

        for (let xi = 0; xi < segsX; xi++) {
            for (let yi = 0; yi < segsY; yi++) {
                const a = xi * yCount + yi;
                const b = (xi + 1) * yCount + yi;
                const c = (xi + 1) * yCount + (yi + 1);
                const d = xi * yCount + (yi + 1);
                indices.push(a, b, c, a, c, d);
            }
        }
        for (let xi = 0; xi < segsX; xi++) {
            for (let yi = 0; yi < segsY; yi++) {
                const a = backOff + xi * yCount + yi;
                const b = backOff + (xi + 1) * yCount + yi;
                const c = backOff + (xi + 1) * yCount + (yi + 1);
                const d = backOff + xi * yCount + (yi + 1);
                indices.push(a, c, b, a, d, c);
            }
        }

        const topOff = positions.length / 3;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            positions.push(x, maxY, sagFront(maxY));
            positions.push(x, maxY, sagBack(maxY));
        }
        for (let xi = 0; xi < segsX; xi++) {
            const a = topOff + xi * 2, b = topOff + (xi + 1) * 2;
            const c = topOff + (xi + 1) * 2 + 1, d = topOff + xi * 2 + 1;
            indices.push(a, b, c, a, c, d);
        }
        const botOff = positions.length / 3;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            positions.push(x, -maxY, sagFront(maxY));
            positions.push(x, -maxY, sagBack(maxY));
        }
        for (let xi = 0; xi < segsX; xi++) {
            const a = botOff + xi * 2, b = botOff + (xi + 1) * 2;
            const c = botOff + (xi + 1) * 2 + 1, d = botOff + xi * 2 + 1;
            indices.push(a, c, b, a, d, c);
        }
        const leftOff = positions.length / 3;
        for (let yi = 0; yi <= segsY; yi++) {
            const y = -maxY + (2 * maxY * yi) / segsY;
            positions.push(-halfW, y, sagFront(Math.abs(y)));
            positions.push(-halfW, y, sagBack(Math.abs(y)));
        }
        for (let yi = 0; yi < segsY; yi++) {
            const a = leftOff + yi * 2, b = leftOff + (yi + 1) * 2;
            const c = leftOff + (yi + 1) * 2 + 1, d = leftOff + yi * 2 + 1;
            indices.push(a, c, b, a, d, c);
        }
        const rightOff = positions.length / 3;
        for (let yi = 0; yi <= segsY; yi++) {
            const y = -maxY + (2 * maxY * yi) / segsY;
            positions.push(halfW, y, sagFront(Math.abs(y)));
            positions.push(halfW, y, sagBack(Math.abs(y)));
        }
        for (let yi = 0; yi < segsY; yi++) {
            const a = rightOff + yi * 2, b = rightOff + (yi + 1) * 2;
            const c = rightOff + (yi + 1) * 2 + 1, d = rightOff + yi * 2 + 1;
            indices.push(a, b, c, a, c, d);
        }

        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        return geo;
    }, [component.r1, component.r2, component.apertureRadius, component.width, component.thickness]);
    const topDownGeometry = useDisposableGeometry(() => {
        const halfW = component.width / 2;
        const halfT = Math.max(component.thickness, 2) / 2;
        const shape = new Shape();
        shape.moveTo(-halfW, -halfT);
        shape.lineTo(halfW, -halfT);
        shape.lineTo(halfW, halfT);
        shape.lineTo(-halfW, halfT);
        shape.closePath();
        return new ShapeGeometry(shape);
    }, [component.width, component.thickness]);
    const topDownOpacity = 0.98 * (1 - Math.min(1, blend * 1.25));

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {topDownOpacity > 0.01 && (
                <mesh geometry={topDownGeometry} rotation={[Math.PI / 2, 0, 0]} renderOrder={3}>
                    <meshBasicMaterial
                        color="#aaddff"
                        transparent
                        opacity={topDownOpacity}
                        depthWrite={false}
                        side={DoubleSide}
                    />
                    <EdgeOutline threshold={15} color="#000000" />
                </mesh>
            )}
            <mesh geometry={geometry}>
                <meshStandardMaterial
                    color="#aaddff"
                    opacity={LENS_BODY_OPACITY}
                    transparent
                    roughness={0.18}
                    metalness={0}
                    side={DoubleSide}
                    depthWrite={false}
                />
                <EdgeOutline threshold={15} color="#000000" />
            </mesh>
        </group>
    );
};

export const PrismVisualizer = ({ component }: { component: PrismLens }) => {
    const geometry = useDisposableGeometry(() => component.buildDisplayGeometry(), [component.version]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geometry}>
                <meshPhysicalMaterial
                    color="#ccffff"
                    transmission={GLASS_TRANSMISSION_3D}
                    opacity={GLASS_OPACITY_3D}
                    transparent
                    roughness={0.03}
                    metalness={0}
                    ior={component.ior || 1.5}
                    thickness={0.8}
                    attenuationColor="#aaddff"
                    attenuationDistance={6}
                    side={DoubleSide}
                    depthWrite={false}
                    clearcoat={1.0}
                    clearcoatRoughness={0.02}
                />
            </mesh>
        </group>
    );
};

// ─── Legacy optical-table rendering helpers ──────────────────────────

export const PolygonOpticVisualizer = ({ component }: { component: AbstractPolygonOptic }) => {
    const [blend] = useAtom(cameraBlendAtom);
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);
    const geometry = useDisposableGeometry(() => component.buildDisplayGeometry(), [component.version]);

    const isGlass = component.faceModes.some(m => m === 'refractive');

    if (isGlass) {
        const glassColor = component.ior > 1.55 ? "#88ffee" : "#aaddff";
        const targetTransmission = isSelected ? SELECTED_GLASS_TRANSMISSION_3D : GLASS_TRANSMISSION_3D;
        const orthoOpacity = isSelected ? 0.45 : 0.3;
        const perspOpacity = isSelected ? SELECTED_GLASS_OPACITY_3D : GLASS_OPACITY_3D;

        return (
            <group
                position={[component.position.x, component.position.y, component.position.z]}
                quaternion={component.rotation.clone()}
                onClick={(e) => { e.stopPropagation(); }}
            >
                <mesh geometry={geometry} renderOrder={2}>
                    <meshPhysicalMaterial
                        color={glassColor}
                        transmission={blend * targetTransmission}
                        opacity={tiltedGlassOpacity(orthoOpacity, perspOpacity, blend)}
                        transparent
                        roughness={0.1 * (1 - blend)}
                        metalness={0}
                        ior={component.ior || 1.5}
                        thickness={0.5}
                        attenuationColor="#aaddff"
                        attenuationDistance={5}
                        side={DoubleSide}
                        depthWrite={false}
                    />
                </mesh>
                <PolygonOutline component={component} />
            </group>
        );
    }

    const metalOrthoOpacity = isSelected ? 0.55 : 0.45;
    const metalPerspOpacity = 1.0;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geometry}>
                <meshPhysicalMaterial
                    color="#f4f8fb"
                    metalness={0.9}
                    roughness={0.07 + 0.16 * (1 - blend)}
                    clearcoat={1.0}
                    clearcoatRoughness={0.02}
                    emissive="#8f9aa4"
                    emissiveIntensity={0.12}
                    transparent
                    opacity={metalOrthoOpacity + blend * (metalPerspOpacity - metalOrthoOpacity)}
                    side={DoubleSide}
                    depthWrite={blend > 0.5}
                />
            </mesh>
            <PolygonOutline component={component} />
        </group>
    );
};

export const PupilMaskVisualizer = ({ component }: { component: PupilMaskElement }) => {
    const outerR = component.radius;
    const innerR = outerR * Math.max(0, Math.min(component.innerRadius, 1));
    const ringOuterR = outerR * Math.max(component.innerRadius, Math.min(component.outerRadius, 1));
    const ringVisible = component.mode !== 'uniform' && ringOuterR > innerR + 1e-4;
    const backgroundOpacity = Math.max(0.08, Math.min(0.65, component.backgroundTransmission));
    const ringOpacity = Math.max(0.1, Math.min(0.85, component.ringTransmission));
    const ringColor = component.ringPhaseShift >= 0 ? '#ffd166' : '#ef476f';

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[outerR, outerR, component.thickness, 48]} />
                <meshStandardMaterial color="#6f7d8c" transparent opacity={backgroundOpacity} metalness={0.3} roughness={0.3} />
                <EdgeOutline />
            </mesh>
            {component.mode !== 'annulus' && innerR > 0.01 && (
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, component.thickness * 0.02]}>
                    <cylinderGeometry args={[innerR, innerR, component.thickness * 0.55, 48]} />
                    <meshBasicMaterial color="#8ecae6" transparent opacity={Math.max(0.1, backgroundOpacity)} />
                </mesh>
            )}
            {ringVisible && (
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, component.thickness * 0.04]}>
                    <cylinderGeometry args={[ringOuterR, ringOuterR, component.thickness * 0.65, 48]} />
                    <meshBasicMaterial color={ringColor} transparent opacity={ringOpacity} />
                </mesh>
            )}
            {ringVisible && innerR > 0.001 && (
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, component.thickness * 0.05]}>
                    <cylinderGeometry args={[innerR, innerR, component.thickness * 0.8, 48]} />
                    <meshStandardMaterial color="#111" transparent opacity={component.mode === 'annulus' ? 0.9 : 0.15} />
                </mesh>
            )}
        </group>
    );
};

export const MediumVolumeVisualizer = ({ component }: { component: MediumVolume }) => {
    const isBridge = component.visualMode === 'bridge';
    const radiusA = Math.max(component.bridgeStartRadius, 0.05);
    const radiusB = Math.max(component.bridgeEndRadius, 0.05);
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={isBridge ? [Math.PI / 2, 0, 0] : undefined}>
                {isBridge ? (
                    <cylinderGeometry args={[radiusB, radiusA, component.depth, 32]} />
                ) : (
                    <boxGeometry args={[component.width, component.height, component.depth]} />
                )}
                <meshPhysicalMaterial
                    color="#7fd8ff"
                    transmission={0.75}
                    transparent
                    opacity={0.16}
                    roughness={0.05}
                    metalness={0}
                    depthWrite={false}
                />
                <EdgeOutline color="#7fd8ff" />
            </mesh>
        </group>
    );
};

export const DiffuserVisualizer = ({ component }: { component: Diffuser }) => {
    const radius = component.diameter / 2;
    const geo = useDisposableGeometry(() => new CylinderGeometry(radius, radius, component.thickness, 32), [radius, component.thickness]);
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geo} rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                <meshPhysicalMaterial
                    color="#eeddcc"
                    metalness={0.0}
                    roughness={0.9}
                    transparent={true}
                    opacity={0.6}
                />
                <EdgeOutline />
            </mesh>
        </group>
    );
};

export const DoubleSlitVisualizer = ({ component }: { component: DoubleSlit }) => {
    const bars = useMemo(() => {
        const halfSep = component.slitSeparation / 2;
        const halfW = component.slitWidth / 2;
        const halfH = component.slitHeight / 2;
        const outerR = component.housingDiameter / 2;
        const thickness = 2;
        const leftEdge = -halfSep - halfW;
        const rightEdgeLeft = -halfSep + halfW;
        const leftEdgeRight = halfSep - halfW;
        const rightEdge = halfSep + halfW;
        const result: { position: [number, number, number]; size: [number, number, number] }[] = [
            { position: [(leftEdge + (-outerR)) / 2, 0, 0], size: [leftEdge - (-outerR), halfH * 2, thickness] },
            { position: [(rightEdgeLeft + leftEdgeRight) / 2, 0, 0], size: [leftEdgeRight - rightEdgeLeft, halfH * 2, thickness] },
            { position: [(rightEdge + outerR) / 2, 0, 0], size: [outerR - rightEdge, halfH * 2, thickness] },
            { position: [0, (halfH + outerR) / 2, 0], size: [outerR * 2, outerR - halfH, thickness] },
            { position: [0, -(halfH + outerR) / 2, 0], size: [outerR * 2, outerR - halfH, thickness] },
        ];
        return result.filter(b => b.size[0] > 0.01 && b.size[1] > 0.01);
    }, [component.slitWidth, component.slitSeparation, component.slitHeight, component.housingDiameter]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {bars.map((bar, index) => (
                <group key={index} position={bar.position}>
                    <mesh>
                        <boxGeometry args={bar.size} />
                        <meshStandardMaterial color="#444" roughness={0.5} metalness={0.5} />
                        <EdgeOutline />
                    </mesh>
                </group>
            ))}
        </group>
    );
};

const DoubletOutline: React.FC<{
    component: AchromatDoublet;
    frontProfile: Vector2[];
    backProfile: Vector2[];
}> = ({ component, backProfile }) => {
    const [blend] = useAtom(cameraBlendAtom);

    const outlineData = useMemo(() => {
        const combinedProfile = component.generateCombinedProfile(48);

        let maxR = 0;
        for (const p of combinedProfile) if (p.x > maxR) maxR = p.x;

        const rightProfile: [number, number, number][] = combinedProfile.map(p => [p.x, 0, p.y]);
        const leftProfile: [number, number, number][] = combinedProfile.map(p => [-p.x, 0, p.y]);

        const cementRight: [number, number, number][] = [];
        const cementLeft: [number, number, number][] = [];
        for (const p of backProfile) {
            if (Math.abs(p.x - maxR) < 0.001) break;
            cementRight.push([p.x, 0, p.y]);
            cementLeft.push([-p.x, 0, p.y]);
        }

        const threshold = maxR * 0.99;
        let rimZmin = Infinity, rimZmax = -Infinity;
        for (const p of combinedProfile) {
            if (p.x >= threshold) {
                if (p.y < rimZmin) rimZmin = p.y;
                if (p.y > rimZmax) rimZmax = p.y;
            }
        }
        const circleSegs = 64;
        const makeCircle = (z: number, r: number): [number, number, number][] => {
            const circle: [number, number, number][] = [];
            for (let i = 0; i <= circleSegs; i++) {
                const angle = (i / circleSegs) * Math.PI * 2;
                circle.push([Math.cos(angle) * r, Math.sin(angle) * r, z]);
            }
            return circle;
        };
        const rimCircles = [makeCircle(rimZmin, maxR)];
        if (Math.abs(rimZmax - rimZmin) > 0.01) {
            rimCircles.push(makeCircle(rimZmax, maxR));
        }
        return { rightProfile, leftProfile, cementRight, cementLeft, rimCircles };
    }, [component.version, backProfile]);

    const rimOpacity = blend;
    const profileOpacity = 1 - blend;

    const outlineColor = useContext(OutlineColorContext);

    return (
        <group>
            {rimOpacity > 0.01 && outlineData.rimCircles.map((circle, i) => (
                <Line key={`rim-${i}`} points={circle} color={outlineColor} lineWidth={1.5} opacity={rimOpacity} transparent={rimOpacity < 1} />
            ))}
            {profileOpacity > 0.01 && (
                <>
                    <Line points={outlineData.rightProfile} color={outlineColor} lineWidth={1.5} opacity={profileOpacity} transparent={profileOpacity < 1} />
                    <Line points={outlineData.leftProfile} color={outlineColor} lineWidth={1.5} opacity={profileOpacity} transparent={profileOpacity < 1} />
                    {outlineData.cementRight.length > 2 && (
                        <>
                            <Line points={outlineData.cementRight} color={outlineColor} lineWidth={1.0} opacity={profileOpacity * 0.7} transparent />
                            <Line points={outlineData.cementLeft} color={outlineColor} lineWidth={1.0} opacity={profileOpacity * 0.7} transparent />
                        </>
                    )}
                </>
            )}
        </group>
    );
};

export const AchromatDoubletVisualizer = ({ component }: { component: AchromatDoublet }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);

    const [blend] = useAtom(cameraBlendAtom);

    const [frontProfile, backProfile] = useMemo(
        () => component.generateSplitProfiles(32),
        [component.version],
    );

    const frontGeo = useDisposableGeometry(() => new LatheGeometry(frontProfile, 32), [frontProfile]);
    const backGeo = useDisposableGeometry(() => new LatheGeometry(backProfile, 32), [backProfile]);

    const frontFlatGeo = useDisposableGeometry(() => buildProfileShapeGeo(frontProfile), [frontProfile]);
    const backFlatGeo = useDisposableGeometry(() => buildProfileShapeGeo(backProfile), [backProfile]);

    const frontColor = "#88ffee";
    const backColor  = "#aabbff";
    const lensEmissive = isSelected ? "#64ffda" : "#000000";
    const lensEmissiveIntensity = isSelected ? 0.15 : 0;

    const opacity = isSelected ? SELECTED_LENS_BODY_OPACITY : LENS_BODY_OPACITY;

    const matProps3D = {
        opacity,
        transparent: true as const,
        roughness: 0.18,
        metalness: 0,
        depthWrite: false,
        emissive: lensEmissive,
        emissiveIntensity: lensEmissiveIntensity,
        side: DoubleSide,
    };

    const show3D = blend > 0.01;
    const show2D = blend < 0.99;
    const flatOpacity = isSelected ? SELECTED_LENS_FLAT_OPACITY : LENS_FLAT_OPACITY;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {show2D && (
                <>
                    <mesh geometry={frontFlatGeo} rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                        <meshBasicMaterial color={frontColor} transparent opacity={flatOpacity * (1 - blend)} depthWrite={false} side={DoubleSide} />
                    </mesh>
                    <mesh geometry={backFlatGeo} rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                        <meshBasicMaterial color={backColor} transparent opacity={flatOpacity * (1 - blend)} depthWrite={false} side={DoubleSide} />
                    </mesh>
                </>
            )}
            {show3D && (
                <>
                    <mesh geometry={frontGeo} rotation={[Math.PI / 2, 0, 0]} renderOrder={1}>
                        <meshStandardMaterial color={frontColor} {...matProps3D} opacity={opacity} />
                    </mesh>
                    <mesh geometry={backGeo} rotation={[Math.PI / 2, 0, 0]} renderOrder={3}>
                        <meshStandardMaterial color={backColor} {...matProps3D} opacity={opacity} />
                    </mesh>
                </>
            )}
            <DoubletOutline component={component} frontProfile={frontProfile} backProfile={backProfile} />
        </group>
    );
};

export const PointSourceVisualizer: React.FC<{ component: PointSourceBase }> = ({ component }) => {
    const color = useMemo(() => {
        return wavelengthToCSS(component.wavelength);
    }, [component.wavelength, component.version]);

    const isCone = component instanceof ConeSource3D;
    const isWedge = component instanceof WedgeSource2D;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh>
                <sphereGeometry args={[2.5, 16, 16]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} metalness={0.3} roughness={0.4} />
            </mesh>

            {isCone && (() => {
                const cone = component as ConeSource3D;
                const len = 25;
                const radius = len * Math.tan(cone.halfAngle);
                return (
                    <mesh position={[0, 0, len / 2]} rotation={[Math.PI / 2, 0, 0]}>
                        <coneGeometry args={[radius, len, 24, 1, true]} />
                        <meshBasicMaterial color={color} wireframe transparent opacity={0.3} />
                    </mesh>
                );
            })()}

            {isWedge && (() => {
                const wedge = component as WedgeSource2D;
                const halfAngle = wedge.subtendedAngle / 2;
                const len = 25;
                const segments = 24;
                const points: [number, number, number][] = [[0, 0, 0]];
                for (let i = 0; i <= segments; i++) {
                    const theta = -halfAngle + (i / segments) * wedge.subtendedAngle;
                    points.push([Math.sin(theta) * len, 0, Math.cos(theta) * len]);
                }
                points.push([0, 0, 0]);
                return (
                    <Line points={points} color={color} lineWidth={1} transparent opacity={0.4} />
                );
            })()}
        </group>
    );
};

export const StructuredSourceVisualizer: React.FC<{ component: StructuredSource }> = ({ component }) => {
    const beamColor = useMemo(() => {
        return wavelengthToCSS(component.wavelength);
    }, [component.wavelength, component.version]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -33]}>
                <boxGeometry args={[38, 40, 70]} />
                <meshStandardMaterial color="#222" metalness={0.5} roughness={0.5} />
                <EdgeOutline />
            </mesh>
            <mesh position={[0, 20.1, -33]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
                <planeGeometry args={[38, 20]} />
                <meshBasicMaterial color={beamColor} />
            </mesh>
            <Text
                position={[0, 20.2, -33]}
                rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
                fontSize={18}
                color="#fff"
                anchorX="center"
                anchorY="middle"
                font={undefined}
            >
                {component.asciiChar}
            </Text>
            <mesh position={[0, 0, 2]}>
                <boxGeometry args={[component.beamRadius * 2, component.beamRadius * 2, 2]} />
                <meshStandardMaterial color="#666" />
                <EdgeOutline />
            </mesh>
        </group>
    );
};

// ─── Rail Visualizer ─────────────────────────────────────────────────

/** Snap XY to the nearest 25mm optical table hole (offset 12.5mm to match shader grid). */
function snapEndpointToHole(x: number, y: number): Vector3 {
    const spacing = 25;
    const offset = 12.5;
    const sx = Math.round((x - offset) / spacing) * spacing + offset;
    const sy = Math.round((y - offset) / spacing) * spacing + offset;
    return new Vector3(sx, sy, Rail.TABLE_Z);
}

const RailEndpointHandle: React.FC<{
    rail: Rail;
    endpoint: 'A' | 'B';
    position: [number, number, number];
}> = ({ rail, endpoint, position }) => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [, setHandleDragging] = useAtom(handleDraggingAtom);
    const { controls } = useThree();
    const dragging = useRef(false);
    const [hovered, setHovered] = useState(false);

    const raycastToTable = useCallback((e: any): Vector3 | null => {
        const ray = e.ray;
        if (Math.abs(ray.direction.z) < 1e-6) return null;
        const t = (Rail.TABLE_Z - ray.origin.z) / ray.direction.z;
        return ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    }, []);

    const handlePointerDown = useCallback((e: any) => {
        e.stopPropagation();
        try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { }
        pushUndo();
        dragging.current = true;
        setHandleDragging(true);
        if (controls) (controls as any).enabled = false;
    }, [pushUndo, setHandleDragging, controls]);

    const handlePointerUp = useCallback((e: any) => {
        e.stopPropagation();
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { }
        dragging.current = false;
        setHandleDragging(false);
        if (controls) (controls as any).enabled = true;
    }, [setHandleDragging, controls]);

    const handlePointerMove = useCallback((e: any) => {
        if (!dragging.current) return;
        e.stopPropagation();

        const worldPos = raycastToTable(e);
        if (!worldPos) return;

        const snapped = snapEndpointToHole(worldPos.x, worldPos.y);

        if (endpoint === 'A') {
            rail.setEndpointA(snapped);
        } else {
            rail.setEndpointB(snapped);
        }

        setComponents([...components]);
    }, [components, setComponents, rail, endpoint, raycastToTable]);

    return (
        <mesh
            position={position}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerMove={handlePointerMove}
            onPointerOver={() => { setHovered(true); document.body.style.cursor = 'grab'; }}
            onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
        >
            <sphereGeometry args={[3.5, 16, 16]} />
            <meshStandardMaterial color={hovered ? '#64ffda' : '#999'} metalness={0.5} roughness={0.3} />
        </mesh>
    );
};

export const RailVisualizer: React.FC<{ component: Rail }> = ({ component }) => {
    const outlineColor = useContext(OutlineColorContext);
    const [uiLocked] = useAtom(uiLockedAtom);

    const { midPos, angle, len } = useMemo(() => {
        const a = component.holeA;
        const b = component.holeB;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const mid = a.clone().add(b).multiplyScalar(0.5);
        mid.z = Rail.TABLE_Z + component.profileHeight / 2 + 0.1;
        return {
            midPos: mid,
            angle: Math.atan2(dy, dx),
            len: Math.sqrt(dx * dx + dy * dy),
        };
    }, [component.holeA, component.holeB, component.profileHeight, component.version]);

    const w = component.profileWidth;
    const h = component.profileHeight;

    const grooveWidth = w * 0.35;
    const grooveDepth = h * 0.2;
    const handleZ = Rail.TABLE_Z + h + 0.5;
    const tickMarks = useMemo(() => {
        const maxMm = Math.floor(len);
        return Array.from({ length: maxMm + 1 }, (_, mm) => ({
            mm,
            x: -len / 2 + mm,
            major: mm % 5 === 0,
        }));
    }, [len]);

    return (
        <group>
            <mesh position={[midPos.x, midPos.y, midPos.z]} rotation={[0, 0, angle]}>
                <boxGeometry args={[len, w, h]} />
                <meshStandardMaterial color="#555" metalness={0.6} roughness={0.4} />
                <Edges threshold={15} color={outlineColor} />
            </mesh>
            <mesh
                position={[midPos.x, midPos.y, midPos.z + h / 2 - grooveDepth / 2 + 0.01]}
                rotation={[0, 0, angle]}
            >
                <boxGeometry args={[len - 1, grooveWidth, grooveDepth]} />
                <meshStandardMaterial color="#333" metalness={0.7} roughness={0.3} />
            </mesh>
            <group position={[midPos.x, midPos.y, midPos.z]} rotation={[0, 0, angle]}>
                {tickMarks.map(({ mm, x, major }) => {
                    const tickLength = major ? w - 2 : w * 0.36;
                    return (
                        <mesh
                            key={`tick-${mm}`}
                            position={[x, w / 2 - tickLength / 2 - 0.6, h / 2 + 0.045]}
                        >
                            <boxGeometry args={[0.16, tickLength, 0.045]} />
                            <meshBasicMaterial color="#fff" toneMapped={false} />
                        </mesh>
                    );
                })}
                {tickMarks.filter(tick => tick.major).map(({ mm, x }) => (
                    <Text
                        key={`label-${mm}`}
                        position={[x, -w / 2 + 2.2, h / 2 + 0.09]}
                        fontSize={2.2}
                        color="#fff"
                        anchorX="center"
                        anchorY="middle"
                        outlineWidth={0.04}
                        outlineColor="#000"
                        font={undefined}
                    >
                        {mm}
                    </Text>
                ))}
            </group>
            {!uiLocked && (
                <>
                    <RailEndpointHandle rail={component} endpoint="A" position={[component.holeA.x, component.holeA.y, handleZ]} />
                    <RailEndpointHandle rail={component} endpoint="B" position={[component.holeB.x, component.holeB.y, handleZ]} />
                </>
            )}
        </group>
    );
};

export const FaradayIsolatorVisualizer: React.FC<{ component: FaradayIsolator }> = ({ component }) => {
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[12, 12, 25, 32]} />
                <meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.4} />
                <EdgeOutline />
            </mesh>
            <mesh position={[0, 0, 8]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[12.2, 12.2, 3, 32]} />
                <meshStandardMaterial color="#00cc66" metalness={0.3} roughness={0.5} />
            </mesh>
            <Line
                points={[[0, 12.5, -6], [0, 12.5, 8], [3, 12.5, 5], [-3, 12.5, 5], [0, 12.5, 8]]}
                color="#00cc66"
                lineWidth={2}
            />
        </group>
    );
};

export const QPDVisualizer: React.FC<{ component: QPD }> = ({ component }) => {
    const r = component.activeDiameter / 2;
    const gap = component.gapWidth;
    const quadSize = r - gap / 2;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -3]}>
                <boxGeometry args={[component.activeDiameter + 6, component.activeDiameter + 6, 6]} />
                <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                <EdgeOutline />
            </mesh>
            {[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([qx, qy], i) => (
                <mesh key={i} position={[qx * (quadSize / 2 + gap / 2), qy * (quadSize / 2 + gap / 2), 0.1]}>
                    <planeGeometry args={[quadSize, quadSize]} />
                    <meshStandardMaterial color={['#4ecdc4', '#45b7aa', '#3ea99d', '#378f85'][i]} metalness={0.7} roughness={0.2} />
                </mesh>
            ))}
            <Line points={[[0, -r, 0.15], [0, r, 0.15]]} color="#111" lineWidth={2} />
            <Line points={[[-r, 0, 0.15], [r, 0, 0.15]]} color="#111" lineWidth={2} />
        </group>
    );
};

export const AODVisualizer: React.FC<{ component: AOD }> = ({ component }) => {
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh>
                <boxGeometry args={[12, 12, 30]} />
                <meshPhysicalMaterial
                    color="#88ccff"
                    metalness={0.0}
                    roughness={0.1}
                    transmission={0.6}
                    thickness={5}
                    transparent
                    opacity={0.4}
                />
                <EdgeOutline />
            </mesh>
            <mesh position={[-6.1, 0, 0]}>
                <boxGeometry args={[0.5, 10, 25]} />
                <meshStandardMaterial color="#cc8833" metalness={0.7} roughness={0.3} />
            </mesh>
            {[-8, -4, 0, 4, 8].map((zz, i) => (
                <Line
                    key={i}
                    points={[[-5.8, -4, zz], [-5.8, 4, zz]]}
                    color="#ffaa44"
                    lineWidth={1}
                />
            ))}
        </group>
    );
};

// ─── Ghost Visualizer (mb4-specific) ─────────────────────────────────

/**
 * Renders a component as a glowing dashed-blue outline — a target placeholder
 * the user drags a real component into. Ghosts are excluded from ray tracing.
 * Color: rgb(0, 127, 255) = #007fff (matches the table beam glow).
 */
export const GhostVisualizer = ({ component }: { component: OpticalComponent }) => {
    const GHOST_COLOR = '#007fff';

    // Guess an aperture radius from the component; fall back to 12.7 mm.
    const anyComp = component as any;
    const radius =
        typeof anyComp.diameter === 'number' ? anyComp.diameter / 2 :
        typeof anyComp.apertureRadius === 'number' ? anyComp.apertureRadius :
        typeof anyComp.radius === 'number' ? anyComp.radius :
        12.7;

    // Build a ring of points in the component's local XY plane (the mirror/lens aperture plane).
    const ringPoints = useMemo(() => {
        const pts: [number, number, number][] = [];
        const N = 64;
        for (let i = 0; i <= N; i++) {
            const a = (i / N) * Math.PI * 2;
            pts.push([Math.cos(a) * radius, Math.sin(a) * radius, 0]);
        }
        return pts;
    }, [radius]);

    // Small cross at the center to show the exact target point.
    const crossPoints: Array<[number, number, number][]> = useMemo(() => {
        const h = radius * 0.25;
        return [
            [[-h, 0, 0], [h, 0, 0]],
            [[0, -h, 0], [0, h, 0]],
        ];
    }, [radius]);

    if (component instanceof Camera) {
        const width = Camera.BODY_WIDTH;
        const height = Camera.BODY_HEIGHT;
        const depth = Camera.BODY_DEPTH;
        const sensorW = component.width;
        const sensorH = component.height;
        const bodyRect: [number, number, number][] = [
            [-width / 2, -height / 2, 0],
            [width / 2, -height / 2, 0],
            [width / 2, height / 2, 0],
            [-width / 2, height / 2, 0],
            [-width / 2, -height / 2, 0],
        ];
        const sensorRect: [number, number, number][] = [
            [-sensorW / 2, -sensorH / 2, 0.35],
            [sensorW / 2, -sensorH / 2, 0.35],
            [sensorW / 2, sensorH / 2, 0.35],
            [-sensorW / 2, sensorH / 2, 0.35],
            [-sensorW / 2, -sensorH / 2, 0.35],
        ];

        return (
            <group
                position={[component.position.x, component.position.y, component.position.z]}
                quaternion={component.rotation.clone()}
            >
                <mesh position={[0, 0, -depth / 2]}>
                    <boxGeometry args={[width, height, depth]} />
                    <meshBasicMaterial color={GHOST_COLOR} transparent opacity={0.06} depthWrite={false} />
                </mesh>
                <Line
                    points={bodyRect}
                    color={GHOST_COLOR}
                    lineWidth={2.5}
                    dashed
                    dashSize={3}
                    gapSize={2}
                    transparent
                    opacity={0.95}
                />
                <Line
                    points={sensorRect}
                    color={GHOST_COLOR}
                    lineWidth={2}
                    transparent
                    opacity={0.9}
                />
                <mesh position={[0, 0, 0.2]}>
                    <planeGeometry args={[sensorW, sensorH]} />
                    <meshBasicMaterial color={GHOST_COLOR} transparent opacity={0.14} depthWrite={false} side={DoubleSide} />
                </mesh>
            </group>
        );
    }

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
        >
            {/* Dashed circle outlining the aperture. */}
            <Line
                points={ringPoints}
                color={GHOST_COLOR}
                lineWidth={2}
                dashed
                dashSize={2}
                gapSize={1.5}
                transparent
                opacity={0.95}
            />
            {/* Second offset ring to imply thickness + give a glow halo. */}
            <Line
                points={ringPoints}
                color={GHOST_COLOR}
                lineWidth={6}
                dashed
                dashSize={2}
                gapSize={1.5}
                transparent
                opacity={0.25}
            />
            {/* Center cross. */}
            {crossPoints.map((seg, i) => (
                <Line key={i} points={seg} color={GHOST_COLOR} lineWidth={1.5} transparent opacity={0.8} />
            ))}
            {/* Faint filled disc so the target is visible under bloom. */}
            <mesh>
                <circleGeometry args={[radius * 0.95, 48]} />
                <meshBasicMaterial color={GHOST_COLOR} transparent opacity={0.06} depthWrite={false} />
            </mesh>
        </group>
    );
};
