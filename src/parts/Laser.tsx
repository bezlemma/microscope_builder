import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult } from '../physics/types';
import { intersectAABB } from '../physics/math_solvers';
import { Vector3, Box3 } from 'three';

export class Laser extends OpticalComponent {
    wavelength: number = 532; // nm (default green)
    beamRadius: number = 2;   // mm (1/e² beam half-width)
    power: number = 1.0;      // Watts (optical output power)

    // HOUSING box: body extends behind emission point along -X
    private static readonly HOUSING = new Box3(
        new Vector3(-68, -19, -20),
        new Vector3(2, 19, 20)
    );
    
    constructor(name: string = "Laser Source") {
        super(name);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const { hit, tMin, tMax } = intersectAABB(rayLocal.origin, rayLocal.direction, Laser.HOUSING);
        if (!hit) return null;

        const t = tMin > 0 ? tMin : tMax;
        if (t < 0) return null;

        return {
            t,
            point: rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t)),
            normal: new Vector3(1, 0, 0),
            localPoint: rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t))
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb external rays hitting the housing
        return { rays: [] }; 
    }
}

// ─── Visualizer ────────────────────────────────────────────

export const SourceVisualizer = ({ component }: { component: OpticalComponent }) => {
    const isLaser = component instanceof Laser || component.constructor.name === 'Laser';
    let beamColor = "#222";
    if (isLaser) {
        const wl = (component as Laser).wavelength;
        if (wl < 430) beamColor = "#8a2be2";
        else if (wl < 490) beamColor = "#00bfff";
        else if (wl < 550) beamColor = "#00ff00";
        else if (wl < 590) beamColor = "#ffd700";
        else if (wl < 630) beamColor = "#ff8c00";
        else beamColor = "#ff0000";
    }

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[-33, 0, 0]}>
                <boxGeometry args={[70, 38, 40]} />
                <meshStandardMaterial color="#222" metalness={0.5} roughness={0.5} />
            </mesh>
            {isLaser && (
                <mesh position={[-40, 0, 20.1]} rotation={[0, 0, 0]}>
                    <planeGeometry args={[38, 20]} />
                    <meshBasicMaterial color={beamColor} />
                </mesh>
            )}
            <mesh position={[2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[10, 5, 2, 16]} />
                <meshStandardMaterial color="#666" />
            </mesh>
        </group>
    );
};

