import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { reflectVector } from '../math_solvers';
import { SpectralProfile } from '../SpectralProfile';

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
        // Flat plane at w=0 (optical axis along x → w)
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
        const approaching = ray.direction.dot(hit.normal) < 0;

        if (!approaching) {
            // Hitting from inside — pass through (shouldn't normally happen)
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

        // Transmitted ray — passes straight through
        const transmittedIntensity = ray.intensity * transmission;
        if (transmittedIntensity > 0.001) {
            rays.push(childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone(),
                intensity: transmittedIntensity,
                opticalPathLength: opl
            }));
        }

        // Reflected ray — bounces off the surface
        const reflectedIntensity = ray.intensity * (1 - transmission);
        if (reflectedIntensity > 0.001) {
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
