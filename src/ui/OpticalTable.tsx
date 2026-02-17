import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Vector2, Vector3, DoubleSide, BufferGeometry, Float32BufferAttribute, Shape, Path as ThreePath, ExtrudeGeometry } from 'three';
import { useAtom } from 'jotai';
import { componentsAtom, rayConfigAtom, selectionAtom, solver3RenderTriggerAtom, solver3RenderingAtom } from '../state/store';
import { Ray, Coherence } from '../physics/types';
import { OpticalComponent } from '../physics/Component';
import { Solver1 } from '../physics/Solver1';
import { Mirror } from '../physics/components/Mirror';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Laser } from '../physics/components/Laser';
import { Lamp } from '../physics/components/Lamp';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Sample } from '../physics/components/Sample';
import { Objective } from '../physics/components/Objective';
import { ObjectiveCasing } from '../physics/components/ObjectiveCasing';
import { IdealLens } from '../physics/components/IdealLens';
import { Camera } from '../physics/components/Camera';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { PrismLens } from '../physics/components/PrismLens';
import { Waveplate } from '../physics/components/Waveplate';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { Aperture } from '../physics/components/Aperture';
import { SlitAperture } from '../physics/components/SlitAperture';
import { SampleChamber } from '../physics/components/SampleChamber';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { PolygonScanner } from '../physics/components/PolygonScanner';

import { RayVisualizer } from './RayVisualizer';

import { EFieldVisualizer } from './EFieldVisualizer';
import { Solver2, GaussianBeamSegment } from '../physics/Solver2';
import { Solver3 } from '../physics/Solver3';
import { Draggable } from './Draggable';



export const CasingVisualizer = ({ component }: { component: ObjectiveCasing }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Transparent Housing - Glassy */}
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
            {/* Grip Ring - Centered or towards rear */}
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


export const SampleVisualizer = ({ component }: { component: Sample }) => {


    // Frame Dimensions
    const outerSize = 40;
    const innerSize = 30;
    const thickness = 2;
    const frameWidth = (outerSize - innerSize) / 2; // 5mm

    // Helpers
    const offset = outerSize / 2 - frameWidth / 2; // 17.5

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Frame + Glass in YZ plane (standing upright at default rotation).
                Frame normal = local X. Thickness along X. */}
            <group>
                {/* Detailed Hollow Frame */}
                <group>
                    {/* Top Bar (+Z) */}
                    <mesh position={[0, 0, offset]}>
                        <boxGeometry args={[thickness, outerSize, frameWidth]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                    {/* Bottom Bar (-Z) */}
                    <mesh position={[0, 0, -offset]}>
                        <boxGeometry args={[thickness, outerSize, frameWidth]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                    {/* Left Bar (-Y) */}
                    <mesh position={[0, -offset, 0]}>
                        <boxGeometry args={[thickness, frameWidth, innerSize]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                    {/* Right Bar (+Y) */}
                    <mesh position={[0, offset, 0]}>
                        <boxGeometry args={[thickness, frameWidth, innerSize]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                </group>

                {/* Glass Pane */}
                <mesh position={[0, 0, 0]}>
                    <boxGeometry args={[0.5, innerSize, innerSize]} />
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

            {/* Mickey Mouse Geometry — ears in +Z (up), spread in ±Y */}
            <group position={[0, 0, 0]}>
                {/* Head */}
                <mesh position={[0, 0, 0]}>
                    <sphereGeometry args={[0.5, 32, 32]} />
                    <meshStandardMaterial color="#ffccaa" roughness={0.3} />
                </mesh>
                {/* Left Ear (-Y, +Z) */}
                <mesh position={[0, -0.5, 0.5]}>
                    <sphereGeometry args={[0.25, 32, 32]} />
                    <meshStandardMaterial color="black" roughness={0.3} />
                </mesh>
                {/* Right Ear (+Y, +Z) */}
                <mesh position={[0, 0.5, 0.5]}>
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
    const a = component.diameter / 2;   // Physical barrel radius for visual sizing
    const wd = component.workingDistance;

    const mainLine = useMemo(() =>
        new Float32Array([0, -a, 0, 0, a, 0]), [a]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Vertical line at principal plane */}
            <line>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[mainLine, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color="#b388ff" linewidth={2} />
            </line>

            {/* Working Distance cylinder */}
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -wd / 2]}>
                <cylinderGeometry args={[a * 0.8, a * 1.2, wd, 16, 1, true]} />
                <meshBasicMaterial color="#b388ff" transparent opacity={isSelected ? 0.25 : 0.08} side={DoubleSide} />
            </mesh>

            {/* Invisible hitbox for selection */}
            <mesh>
                <planeGeometry args={[wd, a * 2]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} />
            </mesh>

            {/* Selection highlight */}
            {isSelected && (
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -wd / 2]}>
                    <cylinderGeometry args={[a * 1.3, a * 1.3, wd + 2, 16]} />
                    <meshBasicMaterial color="#b388ff" transparent opacity={0.15} wireframe />
                </mesh>
            )}
        </group>
    );
};

export const CameraVisualizer = ({ component }: { component: Camera }) => {

    const width = 25;
    const height = 25;
    const depth = 50;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Camera Body (Box) - centered */}
            <mesh position={[0, 0, 0]}>
                <boxGeometry args={[width, height, depth]} />
                <meshStandardMaterial color="#333" metalness={0.6} roughness={0.4} />
            </mesh>

            {/* Sensor Face (Blue) - at front of centered body */}
            <mesh position={[0, 0, depth / 2 + 0.1]}>
                <planeGeometry args={[width * 0.8, height * 0.8]} />
                <meshStandardMaterial color="#224" metalness={0.9} roughness={0.1} />
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
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                {/* Shiny Metric Material */}
                <meshPhysicalMaterial
                    color="#ffffff"
                    metalness={0.95}
                    roughness={0.05}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                />
            </mesh>
        </group>
    );
};

export const PolygonScannerVisualizer = ({ component }: { component: PolygonScanner }) => {
    const N = component.numFaces;
    const R = component.circumRadius;

    // Build polygon shape in local XY plane
    const shape = useMemo(() => {
        const s = new Shape();
        for (let k = 0; k <= N; k++) {
            const angle = component.scanAngle + k * (2 * Math.PI / N);
            const x = R * Math.cos(angle);
            const y = R * Math.sin(angle);
            if (k === 0) s.moveTo(x, y);
            else s.lineTo(x, y);
        }
        return s;
    }, [N, R, component.scanAngle]);

    // Outline vertices for the polygon edges
    const outlineVerts = useMemo(() => {
        const verts: number[] = [];
        for (let k = 0; k <= N; k++) {
            const angle = component.scanAngle + k * (2 * Math.PI / N);
            verts.push(R * Math.cos(angle), R * Math.sin(angle), 0);
        }
        return new Float32Array(verts);
    }, [N, R, component.scanAngle]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Extruded polygon body — centered on Z=0 */}
            <mesh position={[0, 0, -component.faceHeight / 2]}>
                <extrudeGeometry args={[shape, { depth: component.faceHeight, bevelEnabled: false }]} />
                <meshPhysicalMaterial
                    color="#c0c0c0"
                    metalness={0.9}
                    roughness={0.1}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                />
            </mesh>

            {/* Polygon outline at z=0 (table plane) */}
            <line>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[outlineVerts, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color="#888" linewidth={2} />
            </line>

        </group>
    );
};

export const CurvedMirrorVisualizer = ({ component }: { component: CurvedMirror }) => {
    const geom = useMemo(() => component.buildGeometry(), [component.diameter, component.radiusOfCurvature, component.thickness, component.version]);
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geom} renderOrder={-1}>
                <meshPhysicalMaterial
                    color="#ffffff"
                    metalness={0.95}
                    roughness={0.05}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                    side={DoubleSide}
                />
            </mesh>
        </group>
    );
};

export const BeamSplitterVisualizer = ({ component }: { component: BeamSplitter }) => {

    const radius = component.diameter / 2;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshPhysicalMaterial
                    color="#88ccff"
                    metalness={0.3}
                    roughness={0.1}
                    transparent={true}
                    opacity={0.6}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                />
            </mesh>
        </group>
    );
};

// Aperture Visualizer — hollowed cylinder (annular disc / washer shape)
export const ApertureVisualizer = ({ component }: { component: Aperture }) => {
    const outerR = component.housingDiameter / 2;
    const innerR = component.openingDiameter / 2;
    const halfT = 0.5; // fixed half-thickness (1mm total, similar to polarizers)

    // LatheGeometry revolves a 2D profile around Y.
    // Profile: thin rectangle from innerR to outerR at ±halfT depth.
    // Points go: inner-bottom → outer-bottom → outer-top → inner-top
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
            {/* Solid annular disc — revolved rectangular cross-section */}
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <latheGeometry args={[points, 48]} />
                <meshStandardMaterial color="#333" roughness={0.6} metalness={0.4} />
            </mesh>
        </group>
    );
};

// Slit Aperture Visualizer — two rectangular bars with a gap
export const SlitApertureVisualizer = ({ component }: { component: SlitAperture }) => {
    const outerR = component.housingDiameter / 2;
    const halfW = component.slitWidth / 2;
    const halfH = component.slitHeight / 2;
    const halfT = 0.5; // 1mm total thickness

    // Top bar: from halfH to outerR
    const topBarHeight = outerR - halfH;
    // Bottom bar: from -outerR to -halfH
    const bottomBarHeight = outerR - halfH;
    // Side bars: from -halfH to halfH, outerR wide on each side of the slit
    const sideBarWidth = outerR - halfW;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Top bar */}
            {topBarHeight > 0.1 && (
                <mesh position={[0, 0, halfH + topBarHeight / 2]}>
                    <boxGeometry args={[halfT * 2, outerR * 2, topBarHeight]} />
                    <meshStandardMaterial color="#444" roughness={0.5} metalness={0.5} />
                </mesh>
            )}
            {/* Bottom bar */}
            {bottomBarHeight > 0.1 && (
                <mesh position={[0, 0, -(halfH + bottomBarHeight / 2)]}>
                    <boxGeometry args={[halfT * 2, outerR * 2, bottomBarHeight]} />
                    <meshStandardMaterial color="#444" roughness={0.5} metalness={0.5} />
                </mesh>
            )}
            {/* Left side bar */}
            {sideBarWidth > 0.1 && (
                <mesh position={[0, -(halfW + sideBarWidth / 2), 0]}>
                    <boxGeometry args={[halfT * 2, sideBarWidth, halfH * 2]} />
                    <meshStandardMaterial color="#444" roughness={0.5} metalness={0.5} />
                </mesh>
            )}
            {/* Right side bar */}
            {sideBarWidth > 0.1 && (
                <mesh position={[0, halfW + sideBarWidth / 2, 0]}>
                    <boxGeometry args={[halfT * 2, sideBarWidth, halfH * 2]} />
                    <meshStandardMaterial color="#444" roughness={0.5} metalness={0.5} />
                </mesh>
            )}
        </group>
    );
};

// Filter Visualizer — colored semi-transparent disc
export const FilterVisualizer = ({ component }: { component: Filter }) => {
    const radius = component.diameter / 2;
    // Get tint color from spectral profile
    const dominantNm = component.spectralProfile.getDominantPassWavelength();
    const tintColor = dominantNm ? wavelengthToHex(dominantNm) : '#888888';
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshPhysicalMaterial
                    color={tintColor}
                    metalness={0.1}
                    roughness={0.1}
                    transparent={true}
                    opacity={0.5}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                />
            </mesh>
        </group>
    );
};

// Dichroic Mirror Visualizer — like BeamSplitter but with colored tint
export const DichroicVisualizer = ({ component }: { component: DichroicMirror }) => {
    const radius = component.diameter / 2;
    const dominantNm = component.spectralProfile.getDominantPassWavelength();
    const tintColor = dominantNm ? wavelengthToHex(dominantNm) : '#88ccff';
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshPhysicalMaterial
                    color={tintColor}
                    metalness={0.4}
                    roughness={0.05}
                    transparent={true}
                    opacity={0.55}
                    clearcoat={1.0}
                    clearcoatRoughness={0.02}
                />
            </mesh>
        </group>
    );
};

// Helper: wavelength to hex color for visualizer tinting
function wavelengthToHex(nm: number): string {
    let r = 0, g = 0, b = 0;
    if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
    else if (nm >= 440 && nm < 490) { g = (nm - 440) / 50; b = 1; }
    else if (nm >= 490 && nm < 510) { g = 1; b = -(nm - 510) / 20; }
    else if (nm >= 510 && nm < 580) { r = (nm - 510) / 70; g = 1; }
    else if (nm >= 580 && nm < 645) { r = 1; g = -(nm - 645) / 65; }
    else if (nm >= 645 && nm <= 780) { r = 1; }
    else { return '#888888'; }
    const toHex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export const BlockerVisualizer = ({ component }: { component: Blocker }) => {
    const radius = component.diameter / 2;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshStandardMaterial color="#222" roughness={0.8} />
            </mesh>
        </group>
    );
};

// Helper: wall panel with a real circular hole (using Shape + ExtrudeGeometry)
const WallWithHole = ({ wallSize, holeRadius, thickness, position, rotation, color }: {
    wallSize: number;
    holeRadius: number;
    thickness: number;
    position: [number, number, number];
    rotation: [number, number, number];
    color: string;
}) => {
    const geometry = useMemo(() => {
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
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} side={DoubleSide} transparent opacity={0.5} depthWrite={false} />
        </mesh>
    );
};

// SampleChamber Visualizer — hollow open-top cube with real circular holes on all 4 side faces
export const SampleChamberVisualizer = ({ component }: { component: SampleChamber }) => {
    const s = component.cubeSize;
    const wt = component.wallThickness;
    const boreR = component.boreDiameter / 2;
    const half = s / 2;

    const bodyColor = '#778899';  // light steel gray

    // ExtrudeGeometry extrudes the shape (in local XY) along local +Z from 0 to depth.
    // Wall rotations place each wall on the correct face of the cube:
    //   +X wall: Ry(π/2)  → local Z extrudes along world +X
    //   -X wall: Ry(-π/2) → local Z extrudes along world -X
    //   +Y wall: Rx(-π/2) → local Z extrudes along world +Y
    //   -Y wall: Rx(π/2)  → local Z extrudes along world -Y

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* ── Bottom wall (solid, no hole, dark for contrast from above) ── */}
            <mesh position={[0, 0, -half]}>
                <boxGeometry args={[s, s, wt]} />
                <meshStandardMaterial color="#1a1a1a" roughness={0.8} metalness={0.1} />
            </mesh>

            {/* ── +X wall (real hole) ── */}
            <WallWithHole
                wallSize={s} holeRadius={boreR} thickness={wt}
                position={[half - wt, 0, 0]}
                rotation={[0, Math.PI / 2, 0]}
                color={bodyColor}
            />
            {/* ── -X wall (real hole) ── */}
            <WallWithHole
                wallSize={s} holeRadius={boreR} thickness={wt}
                position={[-half + wt, 0, 0]}
                rotation={[0, -Math.PI / 2, 0]}
                color={bodyColor}
            />
            {/* ── +Y wall (real hole) ── */}
            <WallWithHole
                wallSize={s} holeRadius={boreR} thickness={wt}
                position={[0, half - wt, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                color={bodyColor}
            />
            {/* ── -Y wall (real hole) ── */}
            <WallWithHole
                wallSize={s} holeRadius={boreR} thickness={wt}
                position={[0, -half + wt, 0]}
                rotation={[Math.PI / 2, 0, 0]}
                color={bodyColor}
            />

            {/* ── 3D Mickey specimen at center — same size as Sample physics ── */}
            {/* Head sphere */}
            <mesh position={[0, 0, 0]}>
                <sphereGeometry args={[0.5, 24, 24]} />
                <meshStandardMaterial color="#ffccaa" roughness={0.6} />
            </mesh>
            {/* Left ear (-Y, +Z) */}
            <mesh position={[0, -0.5, 0.5]}>
                <sphereGeometry args={[0.25, 16, 16]} />
                <meshStandardMaterial color="#3a3a3a" roughness={0.6} />
            </mesh>
            {/* Right ear (+Y, +Z) */}
            <mesh position={[0, 0.5, 0.5]}>
                <sphereGeometry args={[0.25, 16, 16]} />
                <meshStandardMaterial color="#3a3a3a" roughness={0.6} />
            </mesh>
        </group>
    );
};

export const WaveplateVisualizer = ({ component }: { component: Waveplate }) => {

    const r = component.apertureRadius;
    const modeColors: Record<string, string> = {
        'half': '#6a5acd',      // slate blue for λ/2
        'quarter': '#20b2aa',   // teal for λ/4
        'polarizer': '#b8860b'  // dark goldenrod for polarizer
    };
    const color = modeColors[component.waveplateMode] || '#888';
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[r, r, 1.5, 32]} />
                <meshStandardMaterial color={color} transparent opacity={0.7} roughness={0.3} />
            </mesh>
            {/* Fast axis arc indicators — two small arcs on opposite sides of rim.
                Ring default plane = XY (normal Z). Cylinder face = YZ plane (normal X).
                Euler XYZ intrinsic: [0, π/2, fastAxisAngle]
                  Step 1: 0 around X (no-op)
                  Step 2: π/2 around Y → ring normal Z maps to X (ring now in YZ plane) ✓
                  Step 3: fastAxisAngle around new Z'' = beam axis X → rotates within face */}
            <mesh rotation={[0, Math.PI / 2, component.fastAxisAngle]}>
                <ringGeometry args={[r * 0.75, r * 1.1, 12, 1, Math.PI / 2 - Math.PI / 6, Math.PI / 3]} />
                <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.6} side={DoubleSide} />
            </mesh>
            <mesh rotation={[0, Math.PI / 2, component.fastAxisAngle]}>
                <ringGeometry args={[r * 0.75, r * 1.1, 12, 1, -Math.PI / 2 - Math.PI / 6, Math.PI / 3]} />
                <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.6} side={DoubleSide} />
            </mesh>
        </group>
    );
};

export const CardVisualizer = ({ component }: { component: Card }) => {

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* White Screen */}
            <mesh>
                <boxGeometry args={[component.width, component.height, 1]} />
                <meshStandardMaterial color="white" roughness={0.5} emissive="white" emissiveIntensity={0.1} />
            </mesh>
            {/* Invisible hitbox for easier selection — extends along beam axis */}
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

    // Safety check for malformed components
    if (!component || !component.rotation || !component.position) return null;

    const aperture = component.apertureRadius || 10;
    const thickness = component.thickness || 2;

    let R1 = 1e9;
    let R2 = -1e9;

    try {
        if (typeof component.getRadii === 'function') {
            const r = component.getRadii();
            // Validate Radii - use large number for Infinity to simplify math logic below
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

    // Generate profile using the SAME function as the physics mesh — single source of truth
    const profilePoints = useMemo(() => {
        const profile = SphericalLens.generateProfile(R1, R2, aperture, thickness, 32);


        if (profile.length < 2) {
            const frontApex = -thickness / 2;
            const backApex = thickness / 2;
            return [new Vector2(0, frontApex), new Vector2(aperture, frontApex), new Vector2(aperture, backApex), new Vector2(0, backApex)];
        }

        return profile;
    }, [aperture, thickness, R1, R2]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Lens body - LatheGeometry for accurate spherical cap profile */}
            {/* Rotate Lathe (Y-axis symmetry) to Optical Axis (Z-axis) */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <latheGeometry args={[profilePoints, 32]} />
                <meshPhysicalMaterial
                    color={component.ior > 1.55 ? "#88ffee" : "#aaddff"}
                    transmission={isSelected ? 0.85 : 0.95}
                    opacity={isSelected ? 0.6 : 0.4}
                    transparent
                    roughness={0}
                    metalness={0}
                    ior={component.ior || 1.5}
                    side={DoubleSide}
                    depthWrite={false}
                    emissive={isSelected ? "#64ffda" : "#000000"}
                    emissiveIntensity={isSelected ? 0.15 : 0}
                />
            </mesh>
        </group>
    );
};

export const SourceVisualizer = ({ component }: { component: OpticalComponent }) => {

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Laser Box Body - centered */}
            <mesh position={[0, 0, 0]}>
                <boxGeometry args={[50, 25, 25]} />
                <meshStandardMaterial color="#222" metalness={0.5} roughness={0.5} />
            </mesh>
            {/* Aperture Ring - at emission end (+X) */}
            <mesh position={[27, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[4, 4, 4, 16]} />
                <meshStandardMaterial color="#666" />
            </mesh>
            {/* Emission Point */}
            <mesh position={[1, 0, 0]}>
                <sphereGeometry args={[1, 16, 16]} />
                <meshBasicMaterial color="lime" />
            </mesh>
        </group>
    );
};

// Lamp Visualizer — wider, shorter body with warm dome to distinguish from laser
const LampVisualizer = ({ component }: { component: OpticalComponent }) => {
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Lamp Housing*/}
            <mesh position={[0, 0, 0]}>
                <boxGeometry args={[40, 22, 30]} />
                <meshStandardMaterial color="#2a2520" metalness={0.3} roughness={0.7} />
            </mesh>
            {/* Aperture slit - at emission end (+X) */}
            <mesh position={[21, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[5, 5, 2, 16]} />
                <meshStandardMaterial color="#BBB" />
            </mesh>
        </group>
    );
};


// Ideal Lens Visualizer — textbook thin-lens diagram
const IdealLensVisualizer = ({ component }: { component: IdealLens }) => {
    const a = component.apertureRadius;
    const converging = component.focalLength > 0;
    const color = converging ? '#64ffda' : '#ff6b9d';

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={[component.rotation.x, component.rotation.y, component.rotation.z, component.rotation.w]}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Thin disc representing the ideal lens */}
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
            {/* Invisible thicker hitbox for easier selection */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[a, a, 4, 32]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} />
            </mesh>
        </group>
    );
};

// Cylindrical Lens Visualizer — curved in Y, flat in X, matching physics profile
export const CylindricalLensVisualizer = ({ component }: { component: CylindricalLens }) => {

    if (!component || !component.rotation || !component.position) return null;

    const geometry = useMemo(() => {
        const segsY = 24;
        const segsX = 2;
        const halfW = component.width / 2;
        const R1 = component.r1;
        const R2 = component.r2;
        const thickness = component.thickness;
        const maxY = component.apertureRadius;

        // Sag functions (same as physics)
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

        // Front face (curved)
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            for (let yi = 0; yi <= segsY; yi++) {
                const y = -maxY + (2 * maxY * yi) / segsY;
                positions.push(x, y, sagFront(Math.abs(y)));
            }
        }
        // Back face (flat or curved)
        const backOff = (segsX + 1) * yCount;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            for (let yi = 0; yi <= segsY; yi++) {
                const y = -maxY + (2 * maxY * yi) / segsY;
                positions.push(x, y, sagBack(Math.abs(y)));
            }
        }

        // Front face tris
        for (let xi = 0; xi < segsX; xi++) {
            for (let yi = 0; yi < segsY; yi++) {
                const a = xi * yCount + yi;
                const b = (xi + 1) * yCount + yi;
                const c = (xi + 1) * yCount + (yi + 1);
                const d = xi * yCount + (yi + 1);
                indices.push(a, b, c, a, c, d);
            }
        }
        // Back face tris (reversed winding)
        for (let xi = 0; xi < segsX; xi++) {
            for (let yi = 0; yi < segsY; yi++) {
                const a = backOff + xi * yCount + yi;
                const b = backOff + (xi + 1) * yCount + yi;
                const c = backOff + (xi + 1) * yCount + (yi + 1);
                const d = backOff + xi * yCount + (yi + 1);
                indices.push(a, c, b, a, d, c);
            }
        }

        // Side walls: top, bottom, left, right
        // Top wall (y = maxY)
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
        // Bottom wall (y = -maxY)
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
        // Left wall (x = -halfW)
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
        // Right wall (x = +halfW)
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

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geometry}>
                <meshPhysicalMaterial
                    color="#ccffff"
                    transmission={0.99}
                    opacity={0.6}
                    transparent
                    roughness={0}
                    side={2}
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
};

// Prism Visualizer — triangular cross-section extruded along X
export const PrismVisualizer = ({ component }: { component: PrismLens }) => {

    if (!component || !component.rotation || !component.position) return null;

    const halfAngle = component.apexAngle / 2;
    const baseHalfWidth = component.height * Math.tan(halfAngle);
    const centroidY = component.height / 3;
    const halfW = component.width / 2;

    const geometry = useMemo(() => {
        const ay = component.height - centroidY, az = 0;
        const bly = -centroidY, blz = -baseHalfWidth;
        const bry = -centroidY, brz = baseHalfWidth;
        // Vertices are duplicated per face so each face has its own normals
        // (sharp edges, no smooth interpolation across different faces)
        const positions = [
            -halfW, ay, az, -halfW, bly, blz, -halfW, bry, brz,           // 0-2:  left cap
            halfW, ay, az, halfW, bly, blz, halfW, bry, brz,              // 3-5:  right cap
            -halfW, ay, az, halfW, ay, az, -halfW, bly, blz, halfW, bly, blz, // 6-9:  front face
            -halfW, ay, az, halfW, ay, az, -halfW, bry, brz, halfW, bry, brz, // 10-13: back face
            -halfW, bly, blz, halfW, bly, blz, -halfW, bry, brz, halfW, bry, brz, // 14-17: base
        ];
        const indices = [0, 2, 1, 3, 4, 5, 6, 8, 7, 7, 8, 9, 10, 11, 12, 11, 13, 12, 14, 15, 16, 15, 17, 16];

        // Compute flat per-face normals (NOT computeVertexNormals which averages)
        // Front face: edge from apex → baseLeft, normal = perpendicular in YZ plane
        const frontDy = bly - ay, frontDz = blz - az;
        const frontLen = Math.sqrt(frontDy * frontDy + frontDz * frontDz);
        const fnY = -frontDz / frontLen, fnZ = frontDy / frontLen;

        // Back face: edge from apex → baseRight
        const backDy = bry - ay, backDz = brz - az;
        const backLen = Math.sqrt(backDy * backDy + backDz * backDz);
        const bnY = backDz / backLen, bnZ = -backDy / backLen;

        // Per-vertex normals: same normal for all verts of each face
        const normals = [
            -1, 0, 0, -1, 0, 0, -1, 0, 0,            // left cap
            1, 0, 0, 1, 0, 0, 1, 0, 0,             // right cap
            0, fnY, fnZ, 0, fnY, fnZ, 0, fnY, fnZ, 0, fnY, fnZ,  // front face
            0, bnY, bnZ, 0, bnY, bnZ, 0, bnY, bnZ, 0, bnY, bnZ,  // back face
            0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,     // base
        ];

        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
        geo.setIndex(indices);
        return geo;
    }, [component.apexAngle, component.height, component.width]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geometry}>
                <meshPhysicalMaterial
                    color="#ccffff"
                    transmission={0.99}
                    opacity={0.6}
                    transparent
                    roughness={0}
                    side={2}
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
};

export const OpticalTable: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [rayConfig] = useAtom(rayConfigAtom);
    const [rays, setRays] = useState<Ray[][]>([]);
    const [beamSegments, setBeamSegments] = useState<GaussianBeamSegment[][]>([]);
    const [solver3Paths, setSolver3Paths] = useState<Ray[][]>([]);
    const [solver3Trigger] = useAtom(solver3RenderTriggerAtom);
    const [, setSolver3Rendering] = useAtom(solver3RenderingAtom);

    // ─── Optics fingerprint: changes only when non-Card components change ───
    // Cards are passive detectors and don't affect the optical path, so moving
    // them should NOT trigger the expensive Solver1/Solver2 re-computation.
    const opticsFingerprint = useMemo(() => {
        if (!components) return '';
        return components
            .filter(c => !(c instanceof Card))
            .map(c => {

                const base = `${c.id}:${c.position.x},${c.position.y},${c.position.z}:${c.rotation.x},${c.rotation.y},${c.rotation.z},${c.rotation.w}:v${c.version}`;
                const props: string[] = [];
                if ('wavelength' in c) props.push(`wl=${(c as any).wavelength}`);
                if ('beamRadius' in c) props.push(`br=${(c as any).beamRadius}`);
                
                if ('power' in c) props.push(`pw=${(c as any).power}`);
                if ('ior' in c) props.push(`ior=${(c as any).ior}`);
                if ('curvature' in c) props.push(`cv=${(c as any).curvature}`);
                if ('apertureRadius' in c) props.push(`ar=${(c as any).apertureRadius}`);
                if ('aperture' in c) props.push(`ap=${(c as any).aperture}`);
                if ('thickness' in c) props.push(`th=${(c as any).thickness}`);
                if ('openingDiameter' in c) props.push(`od=${(c as any).openingDiameter}`);
                if ('apexAngle' in c) props.push(`aa=${(c as any).apexAngle}`);
                if ('height' in c) props.push(`h=${(c as any).height}`);
                if ('r1' in c) props.push(`r1=${(c as any).r1}`);
                if ('r2' in c) props.push(`r2=${(c as any).r2}`);
                if ('focalLength' in c) props.push(`fl=${(c as any).focalLength}`);
                if ('diameter' in c) props.push(`d=${(c as any).diameter}`);
                if ('width' in c) props.push(`w=${(c as any).width}`);
                if ('radiusOfCurvature' in c) props.push(`roc=${(c as any).radiusOfCurvature}`);
                if ('spectralProfile' in c) {
                    const sp = (c as any).spectralProfile;
                    props.push(`sp=${sp.preset},${sp.cutoffNm},${sp.edgeSteepness},${JSON.stringify(sp.bands)}`);
                }
                // PolygonScanner properties
                if ('numFaces' in c) props.push(`nf=${(c as any).numFaces}`);
                if ('inscribedRadius' in c) props.push(`ir=${(c as any).inscribedRadius}`);
                if ('faceHeight' in c) props.push(`fh=${(c as any).faceHeight}`);
                if ('scanAngle' in c) props.push(`sa=${(c as any).scanAngle}`);
                // Sample fluorescence spectral profiles
                if ('excitationSpectrum' in c) {
                    const sp = (c as any).excitationSpectrum;
                    props.push(`exsp=${sp.preset},${sp.cutoffNm},${sp.edgeSteepness},${JSON.stringify(sp.bands)}`);
                }
                if ('emissionSpectrum' in c) {
                    const sp = (c as any).emissionSpectrum;
                    props.push(`emsp=${sp.preset},${sp.cutoffNm},${sp.edgeSteepness},${JSON.stringify(sp.bands)}`);
                }
                if ('fluorescenceEfficiency' in c) props.push(`fe=${(c as any).fluorescenceEfficiency}`);
                if ('absorption' in c) props.push(`abs=${(c as any).absorption}`);

                return props.length > 0 ? `${base}:${props.join(',')}` : base;
            })
            .join('|');
    }, [components]);

    // Refs to hold expensive solver results for card sampling effect
    const solverPathsRef = useRef<Ray[][]>([]);
    const beamSegsRef = useRef<GaussianBeamSegment[][]>([]);

    useEffect(() => {
        if (!components) return;


        const cardsToReset = components.filter(c => c instanceof Card) as Card[];
        for (const card of cardsToReset) {
            card.hits = [];
        }

        const solver = new Solver1(components);

        const laserComps = components.filter(c => c instanceof Laser) as Laser[];

        const sourceRays: Ray[] = [];


        for (const laserComp of laserComps) {
            let origin = laserComp.position.clone();
            const direction = new Vector3(1, 0, 0).applyQuaternion(laserComp.rotation).normalize();


            const offset = direction.clone().multiplyScalar(5);
            origin.add(offset);

            const laserWavelength = laserComp.wavelength * 1e-9;
            const beamRadius = laserComp.beamRadius;


            sourceRays.push({
                origin: origin.clone(),
                direction: direction.clone(),
                wavelength: laserWavelength, intensity: laserComp.power, polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } }, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent,
                isMainRay: true, sourceId: laserComp.id
            });

            // Hierarchical ray distribution using binary subdivision:
            //   Ring 0: 24 rays at full beam radius (marginal rays)
            //   Ring 1+: 12 rays each at radii that fill gaps via binary subdivision
            //     Sequence: 1/2, 1/4, 3/4, 1/8, 3/8, 5/8, 7/8, ...
            // Each ring is angularly offset so projected 2D lines don't overlap.
            const totalRays = Math.max(1, rayConfig.rayCount);
            const FIRST_RING_COUNT = Math.min(24, totalRays);
            const INNER_RING_COUNT = 12;

            // Build radius fractions via breadth-first binary subdivision:
            // Level 0: [1/2]  Level 1: [1/4, 3/4]  Level 2: [1/8, 3/8, 5/8, 7/8] ...
            const radiusFractions: number[] = [1]; // ring 0 = marginal (full radius)
            let subdivLevel = 1;
            while (radiusFractions.length < 100) { // generate enough levels
                const denom = 1 << subdivLevel; // 2, 4, 8, 16, ...
                for (let k = 1; k < denom; k += 2) { // odd numerators only
                    radiusFractions.push(k / denom);
                }
                subdivLevel++;
            }

            const up = new Vector3(0, 1, 0);
            if (Math.abs(direction.dot(up)) > 0.9) {
                up.set(0, 0, 1);
            }
            const right = new Vector3().crossVectors(direction, up).normalize();
            const trueUp = new Vector3().crossVectors(right, direction).normalize();

            let raysPlaced = 0;
            let ringIndex = 0;
            while (raysPlaced < totalRays && ringIndex < radiusFractions.length) {
                const ringRadius = beamRadius * radiusFractions[ringIndex];
                const raysForThisRing = ringIndex === 0 ? FIRST_RING_COUNT : INNER_RING_COUNT;
                const raysThisRing = Math.min(raysForThisRing, totalRays - raysPlaced);

                // Angular offset per ring to avoid 2D line overlap
                const angularOffset = ringIndex * Math.PI / 7; // golden-ish rotation

                for (let i = 0; i < raysThisRing; i++) {
                    const phi = angularOffset + (i / raysForThisRing) * Math.PI * 2;

                    const ringOffset = new Vector3()
                        .addScaledVector(trueUp, Math.sin(phi) * ringRadius)
                        .addScaledVector(right, Math.cos(phi) * ringRadius);


                    const rNorm = radiusFractions[ringIndex]; // 0..1
                    const gaussIntensity = Math.exp(-2 * rNorm * rNorm);

                    sourceRays.push({
                        origin: origin.clone().add(ringOffset),
                        direction: direction.clone().normalize(),
                        wavelength: laserWavelength, intensity: gaussIntensity, polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } }, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent,
                        sourceId: laserComp.id
                    });
                    raysPlaced++;
                }
                ringIndex++;
            }
        }



        const lampComps = components.filter(c => c instanceof Lamp) as Lamp[];
        for (const lampComp of lampComps) {
            let origin = lampComp.position.clone();
            const direction = new Vector3(1, 0, 0).applyQuaternion(lampComp.rotation).normalize();
            const offset = direction.clone().multiplyScalar(5);
            origin.add(offset);

            const beamRadius = lampComp.beamRadius;
            const rayOpacity = lampComp.additiveOpacity;

            for (let wIdx = 0; wIdx < lampComp.spectralWavelengths.length; wIdx++) {
                const wavelengthNm = lampComp.spectralWavelengths[wIdx];
                const wavelengthM = wavelengthNm * 1e-9;


                sourceRays.push({
                    origin: origin.clone(),
                    direction: direction.clone(),
                    wavelength: wavelengthM, intensity: rayOpacity,
                    polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                    opticalPathLength: 0, footprintRadius: 0,
                    coherenceMode: Coherence.Incoherent,
                    isMainRay: true, sourceId: `${lampComp.id}_${wavelengthNm}nm`
                });

                const defaultRays = Math.max(1, rayConfig.rayCount);
                // With many spectral bands, halve rays per wavelength to keep
                // total count reasonable. Only reduce when default >= 16.
                const totalRays = defaultRays >= 16
                    ? Math.max(1, Math.floor(defaultRays / 2))
                    : defaultRays;
                const FIRST_RING_COUNT = Math.min(24, totalRays);
                const INNER_RING_COUNT = 12;

                const radiusFractions: number[] = [1];
                let subdivLevel = 1;
                while (radiusFractions.length < 100) {
                    const denom = 1 << subdivLevel;
                    for (let k = 1; k < denom; k += 2) {
                        radiusFractions.push(k / denom);
                    }
                    subdivLevel++;
                }

                const up = new Vector3(0, 1, 0);
                if (Math.abs(direction.dot(up)) > 0.9) up.set(0, 0, 1);
                const right = new Vector3().crossVectors(direction, up).normalize();
                const trueUp = new Vector3().crossVectors(right, direction).normalize();

                let raysPlaced = 0;
                let ringIndex = 0;
                while (raysPlaced < totalRays && ringIndex < radiusFractions.length) {
                    const ringRadius = beamRadius * radiusFractions[ringIndex];
                    const raysForThisRing = ringIndex === 0 ? FIRST_RING_COUNT : INNER_RING_COUNT;
                    const raysThisRing = Math.min(raysForThisRing, totalRays - raysPlaced);
                    const angularOffset = ringIndex * Math.PI / 7;

                    for (let i = 0; i < raysThisRing; i++) {
                        const phi = angularOffset + (i / raysForThisRing) * Math.PI * 2;
                        const ringOffset = new Vector3()
                            .addScaledVector(trueUp, Math.sin(phi) * ringRadius)
                            .addScaledVector(right, Math.cos(phi) * ringRadius);


                        sourceRays.push({
                            origin: origin.clone().add(ringOffset),
                            direction: direction.clone().normalize(),
                            wavelength: wavelengthM, intensity: rayOpacity,
                            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                            opticalPathLength: 0, footprintRadius: 0,
                            coherenceMode: Coherence.Incoherent,
                            sourceId: `${lampComp.id}_${wavelengthNm}nm`
                        });
                        raysPlaced++;
                    }
                    ringIndex++;
                }
            }
        }


        const calculatedPaths = solver.trace(sourceRays);

        // Post-trace: detect beam splits via angle histogram population analysis.
        // Only needed when E&M solver is enabled — the branching path logic
        // relies on marginal rays to detect population splits.
        if (rayConfig.solver2Enabled) {
            const surviving = calculatedPaths.filter(p => {
                if (p.length < 2) return false;
                const last = p[p.length - 1];
                return last.intensity > 0 && !last.terminationPoint;
            });


            type SplitEntry = { path: Ray[]; exitRay: Ray; angle: number; sourceId?: string };
            const allSplitCandidates: SplitEntry[] = [];
            for (const p of surviving) {
                for (let i = p.length - 1; i >= 0; i--) {
                    if (p[i].exitSurfaceId) {
                        allSplitCandidates.push({
                            path: p,
                            exitRay: p[i],
                            angle: Math.atan2(p[i].direction.y, p[i].direction.x),
                            sourceId: p[0].sourceId
                        });
                        break;
                    }
                }
            }


            const splitBySource = new Map<string, SplitEntry[]>();
            for (const sc of allSplitCandidates) {
                const key = sc.sourceId || '__unknown__';
                if (!splitBySource.has(key)) splitBySource.set(key, []);
                splitBySource.get(key)!.push(sc);
            }

            for (const [, splitCandidates] of splitBySource) {
                if (splitCandidates.length >= 4) {

                    splitCandidates.sort((a, b) => a.angle - b.angle);


                    const gaps: number[] = [];
                    for (let i = 1; i < splitCandidates.length; i++) {
                        gaps.push(splitCandidates[i].angle - splitCandidates[i - 1].angle);
                    }

                    // IQR-based outlier detection on gaps.
                    // A gap is a split boundary if it's a statistical outlier —
                    // this naturally distinguishes "one spread-out population" from
                    // "two distinct clusters" regardless of absolute angle scale.
                    const sortedGaps = [...gaps].sort((a, b) => a - b);
                    const q1 = sortedGaps[Math.floor(sortedGaps.length * 0.25)];
                    const q3 = sortedGaps[Math.floor(sortedGaps.length * 0.75)];
                    const iqr = q3 - q1;
                    // Median-based floor: when gaps are uniform (IQR ≈ 0), the raw
                    // fence collapses to Q3 and flags tiny variations as splits.
                    // Requiring 3× the median gap prevents false positives.
                    const median = sortedGaps[Math.floor(sortedGaps.length * 0.5)];
                    const fence = Math.max(q3 + 1.5 * iqr, median * 3);

                    const splitIndices: number[] = [];
                    for (let i = 0; i < gaps.length; i++) {
                        if (gaps[i] > fence && gaps[i] > 0.01) {
                            splitIndices.push(i + 1);
                        }
                    }

                    if (splitIndices.length > 0) {
                        const boundaries = [0, ...splitIndices, splitCandidates.length];
                        const populations: SplitEntry[][] = [];
                        for (let i = 0; i < boundaries.length - 1; i++) {
                            const pop = splitCandidates.slice(boundaries[i], boundaries[i + 1]);
                            if (pop.length > 0) populations.push(pop);
                        }

                        // Identify the split component name from candidates' exitSurfaceId.
                        // e.g. "Prism:front" → "Prism". Only match main-ray paths that
                        // interact with this same component (prevents cross-laser contamination
                        // when multiple lasers are on the table).
                        const splitCompName = splitCandidates[0].exitRay.exitSurfaceId?.split(':')[0] ?? '';
                        const mainPathMatchesSplitComp = (p: Ray[]) =>
                            p.some(r => r.exitSurfaceId?.startsWith(splitCompName));

                        let mainRayExitAngle: number | null = null;
                        for (const p of calculatedPaths) {
                            if (p.length > 0 && p[0].isMainRay === true && mainPathMatchesSplitComp(p)) {
                                for (let i = p.length - 1; i >= 0; i--) {
                                    if (p[i].exitSurfaceId?.startsWith(splitCompName)) {
                                        mainRayExitAngle = Math.atan2(
                                            p[i].direction.y, p[i].direction.x
                                        );
                                        break;
                                    }
                                }
                                if (mainRayExitAngle !== null) break;
                            }
                        }


                        let mainRayPopIdx = -1;
                        if (mainRayExitAngle !== null) {
                            for (let pi = 0; pi < populations.length; pi++) {
                                const pop = populations[pi];
                                const minA = pop[0].angle;
                                const maxA = pop[pop.length - 1].angle;
                                const margin = (maxA - minA) * 0.5 + 0.05;
                                if (mainRayExitAngle >= minA - margin &&
                                    mainRayExitAngle <= maxA + margin) {
                                    mainRayPopIdx = pi;
                                    break;
                                }
                            }
                        }


                        const uncoveredPops = populations.filter((_, i) => i !== mainRayPopIdx);

                        if (uncoveredPops.length > 0) {
                            for (const pop of uncoveredPops) {
                                // Find the most central ring ray in this population
                                // and clone its full path as the white center line.
                                // This preserves the correct physical path (laser → prism
                                // internal → exit → infinity) instead of creating a
                                // synthetic ray that starts inside the prism.
                                const meanAngle = pop.reduce((s, e) => s + e.angle, 0) / pop.length;
                                const closest = pop.reduce((best, e) =>
                                    Math.abs(e.angle - meanAngle) < Math.abs(best.angle - meanAngle) ? e : best
                                );
                                const syntheticPath = closest.path.map(
                                    r => ({ ...r, isMainRay: true })
                                );
                                calculatedPaths.push(syntheticPath);
                            }
                        }
                    }
                }
            } // end for splitBySource

            // Fallback: ensure every population of boundary-terminating rays has a
            // white center line. Fires for ANY ray that terminates in space (no
            // further object hit), regardless of whether it passed through a prism,
            // lens, or nothing. If populations are found that lack a main-ray path,
            // the most central ring ray is cloned as white.
            {
                // Paths terminating in space: last ray has positive intensity and
                // no interactionDistance (it went to infinity, not stopped by an object)
                const boundaryPaths = calculatedPaths.filter(p => {
                    if (p.length < 1) return false;
                    const last = p[p.length - 1];
                    return last.intensity > 0 && last.interactionDistance === undefined;
                });


                const boundaryBySource = new Map<string, typeof boundaryPaths>();
                for (const p of boundaryPaths) {
                    const key = p[0].sourceId || '__unknown__';
                    if (!boundaryBySource.has(key)) boundaryBySource.set(key, []);
                    boundaryBySource.get(key)!.push(p);
                }

                for (const [, sourcePaths] of boundaryBySource) {
                    if (sourcePaths.length >= 3) {
                        type BEntry = { path: Ray[]; angle: number; isMain: boolean };
                        const entries: BEntry[] = sourcePaths.map(p => ({
                            path: p,
                            angle: Math.atan2(
                                p[p.length - 1].direction.y,
                                p[p.length - 1].direction.x
                            ),
                            isMain: p[0].isMainRay === true
                        }));
                        entries.sort((a, b) => a.angle - b.angle);


                        const gaps: number[] = [];
                        for (let i = 1; i < entries.length; i++) {
                            gaps.push(entries[i].angle - entries[i - 1].angle);
                        }

                        if (gaps.length >= 2) {
                            const sortedGaps = [...gaps].sort((a, b) => a - b);
                            const q1 = sortedGaps[Math.floor(sortedGaps.length * 0.25)];
                            const q3 = sortedGaps[Math.floor(sortedGaps.length * 0.75)];
                            const iqr = q3 - q1;
                            // Median-based floor: prevents false splits when gaps are
                            // nearly uniform (single wide population through a lens).
                            const median = sortedGaps[Math.floor(sortedGaps.length * 0.5)];
                            const fence = Math.max(q3 + 1.5 * iqr, median * 3);


                            const splitIndices: number[] = [];
                            for (let i = 0; i < gaps.length; i++) {
                                if (gaps[i] > fence && gaps[i] > 0.01) {
                                    splitIndices.push(i + 1);
                                }
                            }


                            const bounds = [0, ...splitIndices, entries.length];
                            const populations: BEntry[][] = [];
                            for (let i = 0; i < bounds.length - 1; i++) {
                                const pop = entries.slice(bounds[i], bounds[i + 1]);
                                if (pop.length > 0) populations.push(pop);
                            }


                            for (const pop of populations) {
                                const hasMain = pop.some(e => e.isMain);
                                if (hasMain) continue;
                                if (pop.length < 2) continue;


                                const meanAngle = pop.reduce((s, e) => s + e.angle, 0) / pop.length;
                                const closest = pop.reduce((best, e) =>
                                    Math.abs(e.angle - meanAngle) < Math.abs(best.angle - meanAngle) ? e : best
                                );
                                const syntheticPath = closest.path.map(
                                    r => ({ ...r, isMainRay: true })
                                );
                                calculatedPaths.push(syntheticPath);
                            }
                        } else if (!entries.some(e => e.isMain)) {

                            const meanAngle = entries.reduce((s, e) => s + e.angle, 0) / entries.length;
                            const closest = entries.reduce((best, e) =>
                                Math.abs(e.angle - meanAngle) < Math.abs(best.angle - meanAngle) ? e : best
                            );
                            const syntheticPath = closest.path.map(
                                r => ({ ...r, isMainRay: true })
                            );
                            calculatedPaths.push(syntheticPath);
                        }
                    }
                } // end for boundaryBySource

            } // end fallback split detection block
        } // end solver2Enabled guard

        setRays(calculatedPaths);
        solverPathsRef.current = calculatedPaths;

        let beamSegs: GaussianBeamSegment[][] = [];
        if (rayConfig.solver2Enabled) {
            try {
                const solver2 = new Solver2();
                beamSegs = solver2.propagate(calculatedPaths, components);
            } catch (e) {
                console.warn('Solver 2 error:', e);
            }
        }
        setBeamSegments(beamSegs);
        beamSegsRef.current = beamSegs;


        for (const comp of components) {
            if (comp instanceof Camera) {
                comp.markSolver3Stale();
            }
        }
        setSolver3Paths([]);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opticsFingerprint, rayConfig]);

    // ─── Effect 1b: Solver 3 — backward trace from camera (on-demand) ───
    useEffect(() => {
        if (solver3Trigger === 0) return; // Skip initial mount
        if (!components) return;

        const camera = components.find(c => c instanceof Camera) as Camera | undefined;
        if (!camera) return;

        const beamSegs = beamSegsRef.current;
        setSolver3Rendering(true);


        setTimeout(() => {
            try {
                const solver3 = new Solver3(components, beamSegs);
                const result = solver3.render(camera);

                camera.solver3Image = result.emissionImage;
                camera.forwardImage = result.excitationImage;
                camera.solver3Paths = result.paths;
                camera.solver3Stale = false;

                setSolver3Paths(result.paths);
            } catch (e) {
                console.warn('Solver 3 error:', e);
            }
            setSolver3Rendering(false);
        }, 50);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [solver3Trigger]);

    // ─── Effect 2: Cheap card beam profile sampling ───
    // Runs whenever ANY component changes (including card drags).
    // Uses cached solver results — no physics re-computation.
    useEffect(() => {
        if (!components) return;

        const beamSegs = beamSegsRef.current;
        const solverPaths = solverPathsRef.current;

        const cardComps = components.filter(c => c instanceof Card) as Card[];
        for (const card of cardComps) {
            card.beamProfiles = [];

            const invQ = card.rotation.clone().conjugate();

            const hitRays: { ray: Ray; hitLocalPoint: Vector3; t: number }[] = [];

            for (const path of solverPaths) {
                for (const ray of path) {
                    if (!ray.isMainRay) continue;


                    const localOrigin = ray.origin.clone().sub(card.position).applyQuaternion(invQ);
                    const localDir = ray.direction.clone().applyQuaternion(invQ);


                    if (Math.abs(localDir.z) < 1e-6) continue;
                    const t = -localOrigin.z / localDir.z;
                    if (t < 0.001) continue;


                    if (ray.interactionDistance !== undefined && t > ray.interactionDistance + 0.1) continue;

                    const hitPt = localOrigin.clone().add(localDir.clone().multiplyScalar(t));


                    if (Math.abs(hitPt.x) <= card.width / 2 && Math.abs(hitPt.y) <= card.height / 2) {
                        hitRays.push({ ray, hitLocalPoint: hitPt, t });
                    }
                }
            }

            if (hitRays.length === 0 || beamSegs.length === 0) continue;


            for (const { ray: mainHitRay, hitLocalPoint } of hitRays) {
                let bestSeg: GaussianBeamSegment | null = null;
                let bestDist = Infinity;
                let bestZ = 0;

                const worldHitPt = hitLocalPoint.clone().applyQuaternion(card.rotation).add(card.position);


                for (const branch of beamSegs) {
                    for (const seg of branch) {
                        const toHit = worldHitPt.clone().sub(seg.start);
                        const segLen = seg.start.distanceTo(seg.end);
                        const proj = toHit.dot(seg.direction);

                        if (proj >= -1 && proj <= segLen + 1) {
                            const along = seg.direction.clone().multiplyScalar(proj);
                            const perpDist = toHit.clone().sub(along).length();


                            const dirDot = Math.abs(seg.direction.dot(mainHitRay.direction.clone().normalize()));
                            if (dirDot < 0.5) continue; // Wrong beam branch

                            if (perpDist < bestDist) {
                                bestDist = perpDist;
                                bestSeg = seg;
                                bestZ = Math.max(0, Math.min(proj, segLen));
                            }
                        }
                    }
                }

                if (!bestSeg || bestDist >= 50) continue;

                const wavelengthMm = bestSeg.wavelength * 1e3;
                const qx = { re: bestSeg.qx_start.re + bestZ, im: bestSeg.qx_start.im };
                const qy = { re: bestSeg.qy_start.re + bestZ, im: bestSeg.qy_start.im };

                const invQx = { re: qx.re / (qx.re * qx.re + qx.im * qx.im), im: -qx.im / (qx.re * qx.re + qx.im * qx.im) };
                const invQy = { re: qy.re / (qy.re * qy.re + qy.im * qy.im), im: -qy.im / (qy.re * qy.re + qy.im * qy.im) };

                const beamWx = invQx.im < 0 ? Math.sqrt(-wavelengthMm / (Math.PI * invQx.im)) : 10;
                const beamWy = invQy.im < 0 ? Math.sqrt(-wavelengthMm / (Math.PI * invQy.im)) : 10;


                const beamDir = bestSeg.direction.clone().normalize();
                const worldZ = new Vector3(0, 0, 1);
                let beamU = new Vector3().crossVectors(beamDir, worldZ);
                if (beamU.length() < 0.01) {
                    beamU = new Vector3().crossVectors(beamDir, new Vector3(1, 0, 0));
                }
                beamU.normalize();
                const beamV = new Vector3().crossVectors(beamU, beamDir).normalize();

                const cardLocalX = new Vector3(1, 0, 0).applyQuaternion(card.rotation);
                const cardLocalY = new Vector3(0, 1, 0).applyQuaternion(card.rotation);

                const ux = beamU.dot(cardLocalX);
                const vx = beamV.dot(cardLocalX);
                const uy = beamU.dot(cardLocalY);
                const vy = beamV.dot(cardLocalY);

                const wx = Math.sqrt(ux * ux * beamWx * beamWx + vx * vx * beamWy * beamWy);
                const wy = Math.sqrt(uy * uy * beamWx * beamWx + vy * vy * beamWy * beamWy);

                const pol = mainHitRay.polarization;
                const phase = mainHitRay.opticalPathLength ?? 0;

                // Compute beam tilt in card's local frame
                // localDir.u / localDir.w and localDir.v / localDir.w give the tangent of the
                // incidence angle in each transverse direction  (≈ sin θ for small angles)
                const localDir2 = mainHitRay.direction.clone().applyQuaternion(invQ);
                const tiltU = Math.abs(localDir2.z) > 1e-6 ? localDir2.x / Math.abs(localDir2.z) : 0;
                const tiltV = Math.abs(localDir2.z) > 1e-6 ? localDir2.y / Math.abs(localDir2.z) : 0;

                card.beamProfiles.push({
                    wx, wy,
                    wavelength: bestSeg.wavelength,
                    power: bestSeg.power,
                    polarization: pol,
                    phase,
                    centerU: hitLocalPoint.x,
                    centerV: hitLocalPoint.y,
                    tiltU,
                    tiltV
                });
            }

            // Compute fluorescence emission power reference:
            // total excitation power at the sample × fluorescence efficiency
            const sample = components.find(c => c instanceof Sample) as Sample | undefined;
            if (sample && beamSegs.length > 0) {
                let totalLaserPower = 0;
                for (const branch of beamSegs) {
                    if (branch.length > 0) totalLaserPower += branch[0].power;
                }
                card.emissionPowerRef = totalLaserPower * sample.fluorescenceEfficiency;
            } else {
                card.emissionPowerRef = 0;
            }
        }

    }, [components, rayConfig]);

    return (
        <group>
            {/* Beams render at z=0 (default), components at z=2.
                In the top-down view the Z offset is invisible, but the depth buffer
                ensures components appear in front of beam lines. */}
            <RayVisualizer paths={rays} glowEnabled={rayConfig.solver2Enabled} hideAll={rayConfig.emFieldVisible} />
            {solver3Paths.length > 0 && <RayVisualizer paths={solver3Paths} glowEnabled={false} hideAll={false} />}
            {rayConfig.solver2Enabled && rayConfig.emFieldVisible && <EFieldVisualizer beamSegments={beamSegments} />}

            <group>
                {components.map(c => {
                    let visual = null;
                    if (c instanceof Mirror) visual = <MirrorVisualizer component={c} />;
                    else if (c instanceof CurvedMirror) visual = <CurvedMirrorVisualizer component={c} />;
                    else if (c instanceof ObjectiveCasing) visual = <CasingVisualizer component={c} />;
                    else if (c instanceof Objective) visual = <ObjectiveVisualizer component={c} />;
                    else if (c instanceof IdealLens) visual = <IdealLensVisualizer component={c} />;
                    else if (c instanceof SphericalLens) visual = <LensVisualizer component={c} />;
                    else if (c instanceof Laser) visual = <SourceVisualizer component={c} />;
                    else if (c instanceof Lamp) visual = <LampVisualizer component={c} />;

                    else if (c instanceof Blocker) visual = <BlockerVisualizer component={c} />;
                    else if (c instanceof Card) visual = <CardVisualizer component={c} />;
                    else if (c instanceof SampleChamber) visual = <SampleChamberVisualizer component={c} />;
                    else if (c instanceof Sample) visual = <SampleVisualizer component={c} />;
                    else if (c instanceof Camera) visual = <CameraVisualizer component={c} />;
                    else if (c instanceof CylindricalLens) visual = <CylindricalLensVisualizer component={c} />;
                    else if (c instanceof PrismLens) visual = <PrismVisualizer component={c} />;
                    else if (c instanceof Waveplate) visual = <WaveplateVisualizer component={c} />;
                    else if (c instanceof BeamSplitter) visual = <BeamSplitterVisualizer component={c} />;
                    else if (c instanceof SlitAperture) visual = <SlitApertureVisualizer component={c} />;
                    else if (c instanceof Aperture) visual = <ApertureVisualizer component={c} />;
                    else if (c instanceof Filter) visual = <FilterVisualizer component={c} />;
                    else if (c instanceof DichroicMirror) visual = <DichroicVisualizer component={c} />;
                    else if (c instanceof PolygonScanner) visual = <PolygonScannerVisualizer component={c} />;

                    if (visual) {
                        return (
                            <group key={c.id}>
                                <Draggable component={c}>
                                    {visual}
                                </Draggable>
                            </group>
                        );
                    }
                    return null;
                })}
            </group>
        </group>
    );
};
