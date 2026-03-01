import { DoubleSide } from 'three';
import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult, childRay, JonesVector } from '../physics/types';
import { Vector3 } from 'three';

export interface BeamProfile {
    wx: number;           // beam half-width u (mm)
    wy: number;           // beam half-width v (mm)
    wavelength: number;   // meters (SI)
    power: number;        // axial power [0,1]
    polarization: JonesVector;
    phase: number;        // accumulated optical path length (mm)
    centerU: number;      // beam center u on card surface (mm, local frame)
    centerV: number;      // beam center v on card surface (mm, local frame)
    tiltU: number;        // beam direction tilt in card local u (rad, ≈ sin θ)
    tiltV: number;        // beam direction tilt in card local v (rad, ≈ sin θ)
}

export class Card extends OpticalComponent {
    width: number;
    height: number;
    hits: { localPoint: Vector3, ray: Ray }[] = [];
    beamProfiles: BeamProfile[] = [];
    emissionPowerRef: number = 0;   // Estimated total fluorescence emission power (W)

    constructor(width: number, height: number, name: string) {
        super(name);
        this.width = width;
        this.height = height;
    }

    intersect(localRay: Ray): HitRecord | null {
        // Plane intersection at w=0 (optical axis along x (w) → w)
        // Transverse plane: u=y, v=z
        const dw = localRay.direction.x;
        if (Math.abs(dw) < 1e-6) return null; // Parallel

        const t = -localRay.origin.x / dw;
        if (t < 0) return null;

        const point = localRay.origin.clone().add(localRay.direction.clone().multiplyScalar(t));

        // Check bounds in uv transverse plane
        const hu = point.y;
        const hv = point.z;
        if (Math.abs(hu) <= this.width / 2 && Math.abs(hv) <= this.height / 2) {
            return {
                t,
                point: point.clone(),
                normal: new Vector3(1, 0, 0),  // +w normal
                localPoint: point
            };
        }
        return null;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Record the hit for visualization
        this.hits.push({ localPoint: hit.localPoint, ray });

        // Pass the ray through unaffected (Viewing card probe)
        return {
            rays: [childRay(ray, {
                origin: hit.point
            })],
            passthrough: true
        };
    }

    // Clear hits before new trace
    resetHits() {
        this.hits = [];
        this.beamProfiles = [];
    }
}

// ─── Visualizer ────────────────────────────────────────────

export const CardVisualizer = ({ component }: { component: Card }) => {
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh>
                <boxGeometry args={[1, component.width, component.height]} />
                <meshStandardMaterial color="white" roughness={0.5} emissive="white" emissiveIntensity={0.1} />
            </mesh>
            <mesh>
                <boxGeometry args={[10, component.width, component.height]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} depthWrite={false} />
            </mesh>
        </group>
    );
};
