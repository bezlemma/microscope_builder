import { Vector3 } from 'three';
import { OpticalComponent } from '../physics/Component';
import { wavelengthToHex } from '../physics/spectral';
import { Ray, HitRecord, InteractionResult, childRay } from '../physics/types';
import { SpectralProfile } from '../physics/SpectralProfile';

/**
 * Filter — wavelength-dependent transmission element.
 *
 * Can serve as excitation filter, emission filter, or any spectral filter
 * depending on how the spectral profile is configured.
 *
 * Geometry: thin flat plate at x = 0 (same as BeamSplitter).
 * Physics: transmits or absorbs based on wavelength-dependent transmission.
 */
export class Filter extends OpticalComponent {
    diameter: number;             // mm — circular aperture diameter
    thickness: number;            // mm — plate thickness (visual only)
    spectralProfile: SpectralProfile;

    constructor(
        diameter: number = 25.4,
        thickness: number = 3,
        spectralProfile?: SpectralProfile,
        name: string = "Filter"
    ) {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
        this.spectralProfile = spectralProfile ?? new SpectralProfile('bandpass', 500, [{ center: 525, width: 50 }]);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Flat plane at w=0 (optical axis along x (w) → w)
        // Transverse plane: u=y, v=z
        const radius = this.diameter / 2;
        const dw = rayLocal.direction.x;
        if (Math.abs(dw) < 1e-6) return null;

        const t = -rayLocal.origin.x / dw;
        if (t < 0.001) return null;

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
        // Ray wavelength is in meters (SI), SpectralProfile expects nm
        const wavelengthNm = ray.wavelength * 1e9;
        const transmission = this.spectralProfile.getTransmission(wavelengthNm);

        // Threshold for spawning rays: must be physically significant (>1e-5).
        const minIntensity = 1e-5;

        const transmittedIntensity = ray.intensity * transmission;
        if (transmittedIntensity <= minIntensity) {
            return { rays: [] };
        }

        // Transmit with attenuated intensity
        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone(),
                intensity: transmittedIntensity,
                opticalPathLength: ray.opticalPathLength + hit.t
            })]
        };
    }

    /**
     * ABCD matrix — identity (no optical power).
     */
    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.diameter / 2;
    }
}

// ─── Visualizer ────────────────────────────────────────────

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
