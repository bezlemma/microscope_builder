import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { SpectralProfile } from '../SpectralProfile';

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
        // Flat plane at w=0 (optical axis along z → w)
        // Transverse plane: u=x, v=y
        const radius = this.diameter / 2;
        const dw = rayLocal.direction.z;
        if (Math.abs(dw) < 1e-6) return null;

        const t = -rayLocal.origin.z / dw;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(
            rayLocal.direction.clone().multiplyScalar(t)
        );

        // Circular aperture check in uv transverse plane
        const hu = hitPoint.x;
        const hv = hitPoint.y;
        if (hu * hu + hv * hv > radius * radius) {
            return null;
        }

        const normal = new Vector3(0, 0, dw < 0 ? 1 : -1);  // ±w normal
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
