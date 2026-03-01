import { Vector3, Quaternion } from 'three';
import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../physics/types';
import { reflectVector } from '../physics/math_solvers';

/**
 * GalvoScanHead — dual-axis galvanometer scan head (e.g. Thorlabs VantagePro).
 *
 * Physically, this is two close-coupled galvo mirrors that steer the beam
 * from a single pivot point. The beam enters, reflects off the internal
 * 45° mirror, and exits with additional angular deflections from scanX/scanY.
 *
 * Unlike two separate Mirror components spaced apart, the GalvoScanHead
 * ensures the beam always exits from the same pivot point regardless of
 * scan angle — exactly like a real scan head. This prevents beam walk-off
 * at large scan angles.
 *
 * Properties (animatable):
 *   - scanX: horizontal scan angle in radians (galvo mechanical angle).
 *            The beam deflects by 2×scanX about the component's local Y axis.
 *   - scanY: vertical scan angle in radians (galvo mechanical angle).
 *            The beam deflects by 2×scanY about the component's local X axis.
 *
 * Place the scan lens at f₁ from this component for telecentric scanning.
 */
export class GalvoScanHead extends OpticalComponent {
    diameter: number;   // mm — clear aperture
    thickness: number;  // mm — body thickness (visual only)
    scanX: number = 0;  // horizontal scan angle (radians), animatable
    scanY: number = 0;  // vertical scan angle (radians), animatable

    constructor(diameter: number = 15, thickness: number = 2, name: string = "Galvo Scan Head") {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Reflective plane at x=0 (optical axis = x)
        const radius = this.diameter / 2;

        const dw = rayLocal.direction.x;
        if (Math.abs(dw) < 1e-6) return null;

        const t = -rayLocal.origin.x / dw;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(
            rayLocal.direction.clone().multiplyScalar(t)
        );

        // Circular aperture check in transverse plane (y,z)
        const hu = hitPoint.y;
        const hv = hitPoint.z;
        if (hu * hu + hv * hv > radius * radius) return null;

        const normal = new Vector3(dw < 0 ? 1 : -1, 0, 0);
        return {
            t,
            point: hitPoint,
            normal,
            localPoint: hitPoint.clone()
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Absorb rays hitting from the back (same as Mirror)
        if (ray.direction.dot(hit.normal) >= 0) {
            return { rays: [] };
        }

        // 1. Standard mirror reflection
        const reflectedDir = reflectVector(ray.direction, hit.normal);

        // 2. Apply scan deflections from the pivot point
        // Axes are derived from the component's local frame (orientation-independent):
        //   scanX rotates about the component's local Y axis (in world space)
        //   scanY rotates about the component's local X axis (in world space)
        // The ×2 factor represents mirror reflection doubling (mechanical → optical)
        if (Math.abs(this.scanX) > 1e-10) {
            const localY = new Vector3(0, 1, 0).applyQuaternion(this.rotation);
            const qx = new Quaternion().setFromAxisAngle(localY, this.scanX * 2);
            reflectedDir.applyQuaternion(qx);
        }

        if (Math.abs(this.scanY) > 1e-10) {
            const localX = new Vector3(1, 0, 0).applyQuaternion(this.rotation);
            const qy = new Quaternion().setFromAxisAngle(localX, this.scanY * 2);
            reflectedDir.applyQuaternion(qy);
        }

        reflectedDir.normalize();

        // Mirror-style polarization (π phase shift)
        const polX = ray.polarization.x;
        const polY = ray.polarization.y;

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: reflectedDir,
                polarization: {
                    x: { re: -polX.re, im: -polX.im },
                    y: { re: -polY.re, im: -polY.im }
                },
                opticalPathLength: ray.opticalPathLength + hit.t
            })]
        };
    }

    /** ABCD matrix: identity (flat mirror). */
    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.diameter / 2;
    }
}

// ─── Visualizer ────────────────────────────────────────────

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
            <mesh>
                <boxGeometry args={[boxD, boxW, boxW]} />
                <meshStandardMaterial color="#111118" roughness={0.7} metalness={0.3} transparent opacity={0.7} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[radius * 0.85, radius * 0.85, 0.3, 32]} />
                <meshPhysicalMaterial color="#c0d8ff" metalness={0.95} roughness={0.03} clearcoat={1.0} />
            </mesh>
            <mesh position={[boxD * 0.35, radius * 0.6, 0]}>
                <boxGeometry args={[0.5, radius * 0.8, 0.5]} />
                <meshStandardMaterial color="#ff4444" emissive="#661111" />
            </mesh>
            <mesh position={[-boxD * 0.35, -radius * 0.6, 0]}>
                <boxGeometry args={[0.5, 0.5, radius * 0.8]} />
                <meshStandardMaterial color="#4488ff" emissive="#112266" />
            </mesh>
        </group>
    );
};
