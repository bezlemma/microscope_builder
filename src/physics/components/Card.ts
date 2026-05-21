import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay, JonesVector } from '../types';
import { Vector3 } from 'three';
import type { TerminalPacketHit } from '../cardFieldSynthesis';

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
    opaque: boolean = false;
    hits: { localPoint: Vector3, ray: Ray }[] = [];
    packetHits: TerminalPacketHit[] = [];
    beamProfiles: BeamProfile[] = [];
    /** Field data from card field synthesis. */
    fieldData: { resX: number; resY: number; extentWidth: number; extentHeight: number } | null = null;
    /** Manual pixel pitch overrides (0 = auto). */
    fieldPixelPitchOverrideX: number = 0;
    fieldPixelPitchOverrideY: number = 0;
    emissionPowerRef: number = 0;   // Estimated total fluorescence emission power (W)
    /** Phosphor trail: accumulate hits across frames with exponential fade, so a
     *  moving scan spot leaves a visible afterglow. Opt-in per card; presets
     *  that animate a single scanning beam onto a card set this true. */
    persistTrail: boolean = false;

    constructor(width: number, height: number, name: string) {
        super(name);
        this.width = width;
        this.height = height;
        this.bounds.set(
            new Vector3(-width / 2, -height / 2, -0.5),
            new Vector3(width / 2, height / 2, 0.5),
        );
    }

    intersect(localRay: Ray): HitRecord | null {
        const dw = localRay.direction.z;
        if (Math.abs(dw) < 1e-6) return null;

        const t = -localRay.origin.z / dw;
        if (t < 0.001) return null;

        const point = localRay.origin.clone().add(localRay.direction.clone().multiplyScalar(t));

        const hu = point.x;
        const hv = point.y;
        if (Math.abs(hu) <= this.width / 2 && Math.abs(hv) <= this.height / 2) {
            return {
                t,
                point: point.clone(),
                normal: new Vector3(0, 0, 1),
                localPoint: point
            };
        }
        return null;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const terminalRay = childRay(ray, {
            origin: hit.point,
            opticalPathLength: ray.opticalPathLength + hit.t,
        });

        // Record the hit for visualization
        this.hits.push({ localPoint: hit.localPoint, ray: terminalRay });
        this.packetHits.push({
            localPoint: hit.localPoint,
            localDirection: hit.localDirection?.clone(),
            ray: terminalRay,
            detectorId: this.id,
        });

        // Opaque cards absorb all light
        if (this.opaque) {
            return { rays: [] };
        }

        // Pass the ray through unaffected (Viewing card probe)
        return {
            rays: [terminalRay],
            passthrough: true
        };
    }

    // Clear hits before new trace
    resetHits() {
        this.hits = [];
        this.packetHits = [];
        this.beamProfiles = [];
    }
}
