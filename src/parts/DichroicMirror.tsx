import { Vector3 } from 'three';
import { wavelengthToHex } from '../physics/spectral';
import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../physics/types';
import { reflectVector } from '../physics/math_solvers';
import { SpectralProfile } from '../physics/SpectralProfile';

/**
 * DichroicMirror — wavelength-selective beam splitter.
 *
 * Reflects some wavelengths and transmits others, based on a SpectralProfile.
 * The profile's transmission value T determines the split:
 *   - Transmitted ray: intensity *= T
 *   - Reflected ray:   intensity *= (1 - T)
 *
 * Geometry: thin flat plate at x = 0 (same as BeamSplitter/Mirror).
 */
export class DichroicMirror extends OpticalComponent {
    diameter: number;             // mm — circular aperture diameter
    thickness: number;            // mm — plate thickness (visual only)
    spectralProfile: SpectralProfile;

    constructor(
        diameter: number = 25.4,
        thickness: number = 2,
        spectralProfile?: SpectralProfile,
        name: string = "Dichroic"
    ) {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
        this.spectralProfile = spectralProfile ?? new SpectralProfile('longpass', 500);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Flat plane at w=0 (optical axis along x (w) → w)
        // Transverse plane: u=y, v=z
        const radius = this.diameter / 2;
        const dw = rayLocal.direction.x;
        if (Math.abs(dw) < 1e-6) {
            return null;
        }

        const t = -rayLocal.origin.x / dw;
        if (t < 0.001) {
            return null;
        }

        const hitPoint = rayLocal.origin.clone().add(
            rayLocal.direction.clone().multiplyScalar(t)
        );

        // Circular aperture check in uv transverse plane
        const hu = hitPoint.y;
        const hv = hitPoint.z;
        
        if (hu * hu + hv * hv > radius * radius) {
            return null;
        }

        const normal = new Vector3(dw < 0 ? 1 : -1, 0, 0);  // ±w normal
        return {
            t,
            point: hitPoint,
            normal,
            localPoint: hitPoint.clone()
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const approaching = ray.direction.dot(hit.normal) < 0;

        if (!approaching) {
            // Hitting from the back of the mirror — pass through undeviated
            return {
                rays: [childRay(ray, {
                    origin: hit.point,
                    intensity: ray.intensity
                })]
            };
        }

        // Ray wavelength is in meters (SI), SpectralProfile expects nm
        const wavelengthNm = ray.wavelength * 1e9;
        const transmission = this.spectralProfile.getTransmission(wavelengthNm);
        const opl = ray.opticalPathLength + hit.t;
        const rays: Ray[] = [];

        // Threshold for spawning rays: must be physically significant (>1e-5).
        // This prevents 'ghost' leakage from rays that are mathematically near-zero.
        const minIntensity = 1e-5;

        // Transmitted ray
        const transmittedIntensity = ray.intensity * transmission;
        if (transmittedIntensity > minIntensity) {
            rays.push(childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone(),
                intensity: transmittedIntensity,
                opticalPathLength: opl
            }));
        }

        // Reflected ray
        const reflection = 1.0 - transmission;
        const reflectedIntensity = ray.intensity * reflection;
        if (reflectedIntensity > minIntensity) {
            const reflectedDir = reflectVector(ray.direction, hit.normal);

            // Mirror reflection introduces π phase shift (E → -E)
            const polX = ray.polarization.x;
            const polY = ray.polarization.y;

            rays.push(childRay(ray, {
                origin: hit.point,
                direction: reflectedDir,
                intensity: reflectedIntensity,
                polarization: {
                    x: { re: -polX.re, im: -polX.im },
                    y: { re: -polY.re, im: -polY.im }
                },
                opticalPathLength: opl
            }));
        }

        return { rays };
    }
    

    /**
     * ABCD matrix — identity (thin flat plate).
     */
    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.diameter / 2;
    }
}

// ─── Visualizer ────────────────────────────────────────────

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
