import { useMemo } from 'react';
import { DoubleSide, Shape, Path as ThreePath, ExtrudeGeometry, Euler } from 'three';
import { Sample } from './Sample';
import { Vector3, Box3 } from 'three';

/**
 * LXSampleHolder — L/X Sample Holder.
 *
 * Extends Sample to inherit fluorescence spectral properties AND Mickey Mouse
 * intersection geometry (SPHERES). The chamber walls are transparent with
 * holes for objectives; rays interact only with the Mickey specimen inside.
 *
 * Snap ports: 4 positions at the center of each face, with rotation so that
 * an objective placed there faces inward toward the sample.
 */
export class LXSampleHolder extends Sample {
    /** Cube side length (mm). */
    cubeSize: number;
    /** Wall thickness (mm). */
    wallThickness: number;
    /** Diameter of circular bore holes on each face (mm). */
    boreDiameter: number;
    /** Snap positions for objectives (in local coordinates).
     *  Each entry: position (x,y), Euler rotation (rx,ry,rz) to face inward,
     *  and axisDir ('x'|'y') indicating the free-movement axis. */
    snapPorts: { x: number; y: number; rx: number; ry: number; rz: number; axisDir: 'x' | 'y' }[];

    constructor(
        cubeSize: number = 100,
        wallThickness: number = 3,
        boreDiameter: number = 30, // wide enough to fit water dipping objectives
        name: string = "L/X Sample Holder"
    ) {
        super(name);
        this.cubeSize = cubeSize;
        this.wallThickness = wallThickness;
        this.boreDiameter = boreDiameter;

        // Default specimen orientation for the LX chamber (ears up in Z-up world)
        this.specimenRotation = new Euler(Math.PI / 2, Math.PI / 2, 0);

        // 4 snap ports — one on each face.
        // Euler rotation orients objective so nosepiece (-X) faces inward toward sample.
        const half = cubeSize / 2;
        this.snapPorts = [
            // +X face: nosepiece (-X) → world -X (inward). Identity (no rotation needed).
            { x: half, y: 0, rx: 0, ry: 0, rz: 0, axisDir: 'x' },
            // -X face: nosepiece (-X) → world +X (inward). Ry(π).
            { x: -half, y: 0, rx: 0, ry: Math.PI, rz: 0, axisDir: 'x' },
            // +Y face: nosepiece (-X) → world -Y (inward). Rz(+π/2): X→Y, so -X→-Y. ✓
            { x: 0, y: half, rx: 0, ry: 0, rz: Math.PI / 2, axisDir: 'y' },
            // -Y face: nosepiece (-X) → world +Y (inward). Rz(-π/2): X→-Y, so -X→+Y. ✓
            { x: 0, y: -half, rx: 0, ry: 0, rz: -Math.PI / 2, axisDir: 'y' },
        ];

        const half2 = this.cubeSize / 2;
        this.bounds = new Box3(
            new Vector3(-half2, -half2, -half2),
            new Vector3(half2, half2, half2)
        );
    }
    
    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.cubeSize / 2;
    }
}

// --- Helper for LXSampleHolder ---
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

// --- Visualizer ----------------------------------------------------

export const LXSampleHolderVisualizer = ({ component }: { component: LXSampleHolder }) => {
    const s = component.cubeSize;
    const wt = component.wallThickness;
    const boreR = component.boreDiameter / 2;
    const half = s / 2;
    const bodyColor = '#778899';  // light steel gray

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* ── Solid black bottom (no hole, dark for contrast) ── */}
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

            {/* ── 3D Mickey specimen at center (matches Sample.SPHERES) ── */}
            <group position={[component.specimenOffset.x, component.specimenOffset.y, component.specimenOffset.z]} rotation={[component.specimenRotation.x, component.specimenRotation.y, component.specimenRotation.z]}>
                {/* Head sphere */}
                <mesh position={[0, 0, 0]}>
                    <sphereGeometry args={[0.5, 32, 32]} />
                    <meshStandardMaterial color="#ffccaa" roughness={0.3} />
                </mesh>
                {/* Left ear */}
                <mesh position={[-0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 32, 32]} />
                    <meshStandardMaterial color="black" roughness={0.3} />
                </mesh>
                {/* Right ear */}
                <mesh position={[0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 32, 32]} />
                    <meshStandardMaterial color="black" roughness={0.3} />
                </mesh>
            </group>
        </group>
    );
};