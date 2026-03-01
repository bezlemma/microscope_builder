import { useMemo } from 'react';
import { useAtom } from 'jotai';
import { selectionAtom } from '../state/selectionAtom';
import { Vector2, DoubleSide } from 'three';
import { Vector3 } from 'three';
import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../physics/types';

/**
 * Objective — Aplanatic Phase Surface (Ideal Microscope Objective)
 *
 * A zero-thickness phase surface that satisfies the Abbe Sine Condition:
 *   sin(θ_out) = h / f
 *
 * Unlike the paraxial thin-lens (IdealLens) which uses θ_out ≈ h/f,
 * this component correctly focuses rays at ANY numerical aperture —
 * no spherical aberration, even at NA=1.4 (θ ≈ 67°).
 *
 * Parameters (microscopy-native):
 *   - NA:             Numerical Aperture (defines light collection)
 *   - magnification:  System magnification (with tube lens)
 *   - immersionIndex: Refractive index of immersion medium (Air=1, Water=1.33, Oil=1.515)
 *   - workingDistance: Physical distance from front of objective to sample plane (mm)
 *   - tubeLensFocal:  Tube lens focal length for the microscope standard (Nikon=200, Olympus=180, Zeiss=165)
 *
 * Derived:
 *   - focalLength    = tubeLensFocal / magnification
 *   - maxAngle       = arcsin(NA / immersionIndex)
 *   - apertureRadius = focalLength × (NA / immersionIndex) (Exact Abbe Sine relation)
 *
 * TODO: Solver 2 (Gaussian Beam) — getABCD() returns [[1,0],[-1/f,1]].
 *       This is exact for paraxial Gaussian beams. For high-NA beams,
 *       the q-parameter transform is still a valid approximation because
 *       Gaussian beams are inherently paraxial.
 *
 * TODO: Solver 3 (Imaging) — The immersion medium creates a region of
 *       index `n` between the sample and the objective. Backward tracing
 *       from the image plane through the tube lens + objective should
 *       correctly map image points to sample points. The aplanatic
 *       condition guarantees this mapping is free of coma.
 *
 * TODO: Solver 4 (Coherent) — Apply phase shift Δφ = (2π/λ) × ΔOPL
 *       for interference calculations. The OPL contribution below is
 *       the same quadratic form as IdealLens.
 *
 * TODO: Immersion Medium — When immersionIndex > 1, the region between
 *       this objective and the sample should propagate rays at n = immersionIndex.
 *       This affects OPL accumulation and is critical for lightsheet microscopy
 *       where rays travel through containers with different indices.
 *       Current implementation: immersionIndex affects the max acceptance angle
 *       and deflection math, but does NOT yet modify the medium for other rays
 *       in the scene. That requires a "Medium" or "Immersion Volume" system.
 */
export class Objective extends OpticalComponent {
    NA: number;
    magnification: number;
    immersionIndex: number;
    workingDistance: number;
    tubeLensFocal: number;
    diameter: number;           // Physical barrel diameter (mm) — for visual sizing, independent of NA

    // Derived (recomputed on parameter change)
    focalLength: number;
    maxAngle: number;
    apertureRadius: number;     // Optical clear aperture from NA — used for ray clipping

    constructor({
        NA = 0.25,
        magnification = 10,
        immersionIndex = 1.0,
        workingDistance = 10.0,
        tubeLensFocal = 200,
        diameter = 20,
        name = 'Objective',
    }: {
        NA?: number;
        magnification?: number;
        immersionIndex?: number;
        workingDistance?: number;
        tubeLensFocal?: number;
        diameter?: number;
        name?: string;
    } = {}) {
        super(name);
        this.NA = NA;
        this.magnification = magnification;
        this.immersionIndex = immersionIndex;
        this.workingDistance = workingDistance;
        this.tubeLensFocal = tubeLensFocal;
        this.diameter = diameter;

        // Derive
        this.focalLength = tubeLensFocal / magnification;
        const indexRatio = Math.min(NA / immersionIndex, 1.0);
        this.maxAngle = Math.asin(indexRatio);
        // Exact Abbe Sine Condition: h = f * n * sin(theta) => h = f * NA
        this.apertureRadius = this.focalLength * indexRatio;

        this._updateBounds();
    }

    /** Recalculate derived values after any parameter change. */
    recalculate(): void {
        this.focalLength = this.tubeLensFocal / this.magnification;
        const indexRatio = Math.min(this.NA / this.immersionIndex, 1.0);
        this.maxAngle = Math.asin(indexRatio);
        this.apertureRadius = this.focalLength * indexRatio;
        this._updateBounds();
        this.version++;
    }

    private _updateBounds(): void {
        const f = this.focalLength;
        const wd = this.workingDistance;
        const a = this.apertureRadius;
        
        // Match the bounding cylinder from intersect() and visualizer
        const bodyR = Math.max(a + 1, this.diameter / 2);
        const parfocalDistance = 35;
        const xFront = -f + wd;
        const xBack = Math.max(-f + parfocalDistance, xFront + 20);

        // Bounds: barrel along X, transverse in YZ
        const minX = Math.min(-f, xFront);
        const maxX = Math.max(0.01, xBack);

        this.bounds.set(
            new Vector3(minX, -bodyR, -bodyR),
            new Vector3(maxX, bodyR, bodyR)
        );
    }

    /**
     * Intersect: 
     * Applies the rigorous Abbe Sine Condition by intersecting with the 
     * Abbe Reference Sphere on the object side (facing -Z).
     * The sphere is centered at the focal point (0, 0, -f) with radius f.
     * Light coming from the back (+Z) intersects the flat principal plane at z=0.
     * 
     * Also fully encompasses the metal barrel geometry to block stray light!
     */
    intersect(rayLocal: Ray): HitRecord | null {
        // --- 1. PHYSICAL ENCLOSURE INTERSECTION ---
        // Barrel along X-axis (X-forward convention). Transverse in YZ.
        const f = this.focalLength;
        const wd = this.workingDistance;
        const a = this.apertureRadius;
        const bodyR = Math.max(a + 1, this.diameter / 2);
        
        const parfocalDistance = 35;
        const xFront = -f + wd;
        const xBack = Math.max(-f + parfocalDistance, xFront + 20);

        const immersionIdx = this.immersionIndex || 1;
        const maxSin = this.NA / immersionIdx;
        const maxTan = maxSin / Math.sqrt(1 - maxSin * maxSin);
        const opticalFrontRadius = wd * maxTan; 
        const frontRadius = Math.max(opticalFrontRadius + 0.5, 2);

        const xTaperEnd = xFront + Math.min(15, (xBack - xFront) * 0.6);

        // Barrel axis = X, transverse = Y,Z
        const ot = rayLocal.origin.y;      // transverse 1
        const ou = rayLocal.origin.z;      // transverse 2
        const ow = rayLocal.origin.x;      // barrel (axial)
        const dt = rayLocal.direction.y;   // transverse 1
        const du = rayLocal.direction.z;   // transverse 2
        const dw = rayLocal.direction.x;   // barrel (axial)

        const candidates: {t: number, type: 'wall'|'taper'|'front'|'back', r?: number}[] = [];

        // 1. Taper intersection (cone from xFront to xTaperEnd)
        const dxTaper = xTaperEnd - xFront;
        if (dxTaper > 1e-6) {
            const k = (bodyR - frontRadius) / dxTaper;
            const M = frontRadius - k * xFront; // R(w) = M + k*w
            const A_cone = dt * dt + du * du - k * k * dw * dw;
            const B_cone = 2 * (ot * dt + ou * du - M * k * dw - k * k * ow * dw);
            const C_cone = ot * ot + ou * ou - M * M - 2 * M * k * ow - k * k * ow * ow;
            
            if (Math.abs(A_cone) > 1e-12) {
                const disc = B_cone * B_cone - 4 * A_cone * C_cone;
                if (disc >= 0) {
                    const t1 = (-B_cone - Math.sqrt(disc)) / (2 * A_cone);
                    const t2 = (-B_cone + Math.sqrt(disc)) / (2 * A_cone);
                    if (t1 > 1e-6) {
                        const hw1 = ow + t1 * dw;
                        if (hw1 >= xFront && hw1 <= xTaperEnd) {
                            const rAtW = M + k * hw1;
                            if (rAtW > 0) candidates.push({t: t1, type: 'taper'});
                        }
                    }
                    if (t2 > 1e-6) {
                        const hw2 = ow + t2 * dw;
                        if (hw2 >= xFront && hw2 <= xTaperEnd) {
                            const rAtW = M + k * hw2;
                            if (rAtW > 0) candidates.push({t: t2, type: 'taper'});
                        }
                    }
                }
            } else if (Math.abs(B_cone) > 1e-12) {
                const t = -C_cone / B_cone;
                if (t > 1e-6) {
                    const hw = ow + t * dw;
                    if (hw >= xFront && hw <= xTaperEnd) {
                        const rAtW = M + k * hw;
                        if (rAtW > 0) candidates.push({t: t, type: 'taper'});
                    }
                }
            }
        }

        // 2. Main Cylinder intersection (transverse YZ)
        const A_cyl = dt * dt + du * du;
        const B_cyl = 2 * (ot * dt + ou * du);
        const C_cyl = ot * ot + ou * ou - bodyR * bodyR;
        if (A_cyl > 1e-12) {
            const disc = B_cyl * B_cyl - 4 * A_cyl * C_cyl;
            if (disc >= 0) {
                const t1 = (-B_cyl - Math.sqrt(disc)) / (2 * A_cyl);
                const t2 = (-B_cyl + Math.sqrt(disc)) / (2 * A_cyl);
                if (t1 > 1e-6) {
                    const hw1 = ow + t1 * dw;
                    if (hw1 >= xTaperEnd && hw1 <= xBack) candidates.push({t: t1, type: 'wall'});
                }
                if (t2 > 1e-6) {
                    const hw2 = ow + t2 * dw;
                    if (hw2 >= xTaperEnd && hw2 <= xBack) candidates.push({t: t2, type: 'wall'});
                }
            }
        }

        // 3. Intersect planes x = xFront, x = xBack (barrel end-caps)
        let tFront = Infinity;
        let tBack = Infinity;
        if (Math.abs(dw) > 1e-12) {
            tFront = (xFront - ow) / dw;
            tBack = (xBack - ow) / dw;
        }

        if (tFront > 1e-6) {
            const hitT = ot + tFront * dt;
            const hitU = ou + tFront * du;
            const r2 = hitT * hitT + hitU * hitU;
            if (r2 <= frontRadius * frontRadius) candidates.push({t: tFront, type: 'front', r: Math.sqrt(r2)});
        }
        if (tBack > 1e-6) {
            const hitT = ot + tBack * dt;
            const hitU = ou + tBack * du;
            const r2 = hitT * hitT + hitU * hitU;
            if (r2 <= bodyR * bodyR) candidates.push({t: tBack, type: 'back', r: Math.sqrt(r2)});
        }

        if (candidates.length === 0) return null;

        candidates.sort((c1, c2) => c1.t - c2.t);
        const bboxHit = candidates[0];

        let isBlocked = true;

        if (bboxHit.type === 'wall' || bboxHit.type === 'taper') {
            isBlocked = true;
        } else if (bboxHit.type === 'front') {
            if (bboxHit.r !== undefined && bboxHit.r <= opticalFrontRadius) {
                isBlocked = false;
            }
        } else if (bboxHit.type === 'back') {
            if (bboxHit.r !== undefined && bboxHit.r <= a) {
                isBlocked = false;
            }
        }

        if (isBlocked) {
            const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(bboxHit.t));
            let normal = new Vector3(1, 0, 0);
            if (bboxHit.type === 'front') normal.set(-1, 0, 0);
            else if (bboxHit.type === 'wall') normal.set(0, point.y, point.z).normalize();
            
            return {
                t: bboxHit.t,
                point,
                normal,
                localPoint: point,
                isBlocked: true
            };
        }

        // --- 2. OPTICAL INTERSECTION (ABBE SINE CONDITION) ---
        // Abbe Reference Sphere: Center C = (-f, 0, 0), R = f (X-forward)
        if (Math.abs(dw) < 1e-12) return null;

        let tHit = -1;
        let normal = new Vector3();

        const owC = rayLocal.origin.x + f; // offset from sphere center along X
        const b = owC * dw + rayLocal.origin.y * rayLocal.direction.y + rayLocal.origin.z * rayLocal.direction.z;
        const c = (owC * owC + rayLocal.origin.y * rayLocal.origin.y + rayLocal.origin.z * rayLocal.origin.z) - f * f;
        const disc = b * b - c;

        const returnBlocked = () => {
            const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(bboxHit.t));
            return {
                t: bboxHit.t,
                point,
                normal: (bboxHit.type === 'front') ? new Vector3(-1, 0, 0) : new Vector3(1, 0, 0),
                localPoint: point,
                isBlocked: true
            };
        };

        if (disc < 0) return returnBlocked();

        const t1 = -b - Math.sqrt(disc);
        const t2 = -b + Math.sqrt(disc);

        // Only want hits on the correct hemisphere of Abbe sphere (x >= -f)
        const checkFace = (t: number) => {
            if (t <= 1e-6) return false;
            const pt = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
            return pt.x >= -f - 1e-4; 
        };

        if (checkFace(t1)) tHit = t1;
        else if (checkFace(t2)) tHit = t2;

        if (tHit <= 0) return null;

        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(tHit));
        
        // Exclude rays outside clear aperture (transverse YZ)
        const rt2 = point.y * point.y + point.z * point.z;
        if (rt2 > this.apertureRadius * this.apertureRadius) {
            return returnBlocked();
        }

        if (point.x > 0.001) return returnBlocked(); // Must hit the front hemisphere (x <= 0)

        // Normal of sphere at hit point, radially outward from center (-f, 0, 0)
        normal.set(point.x + f, point.y, point.z).normalize();
        if (normal.dot(rayLocal.direction) > 0) normal.negate();

        return { t: tHit, point, normal, localPoint: point.clone() };
    }

    /**
     * Interact: 
     * Exact vectorial momentum shift (Hamiltonian map) for perfect Aplanatic focusing.
     * p_out = p_in - (r / f)
     * No paraxial approximations.
     */
    interact(ray: Ray, hit: HitRecord): InteractionResult {
        if (hit.isBlocked) {
            return { rays: [] };
        }

        const dirInLocal = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const hitLocal = hit.localPoint!;
        const opl = ray.opticalPathLength + hit.t;

        // Vectorial momentum map: transverse = Y,Z; axial = X
        const py_in = dirInLocal.y;
        const pz_in = dirInLocal.z;
        
        // Momentum kick towards the axis (transverse coordinates)
        const py_out = py_in - (hitLocal.y / this.focalLength);
        const pz_out = pz_in - (hitLocal.z / this.focalLength);
        
        const pT_sq = py_out * py_out + pz_out * pz_out;
        if (pT_sq > 1.0) {
            return { rays: [] }; // Evanescent/TIR
        }

        // Axial momentum (X) maintains propagation direction
        const px_out = Math.sign(dirInLocal.x) * Math.sqrt(1.0 - pT_sq);

        const dirOutLocal = new Vector3(px_out, py_out, pz_out).normalize();
        const dirOutWorld = dirOutLocal.transformDirection(this.localToWorld).normalize();

        // Exact OPL phase shift
        const h2 = hitLocal.y * hitLocal.y + hitLocal.z * hitLocal.z;
        const deltaOPL = -h2 / (2 * this.focalLength);

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: dirOutWorld,
                opticalPathLength: opl + deltaOPL
            })]
        };
    }

    /**
     * ABCD matrix for Solver 2 (Gaussian Beam Propagation).
     * Standard thin-lens: [[1, 0], [-1/f, 1]]
     *
     * TODO: For Solver 2, this is sufficient because Gaussian beams
     * are paraxial. The aplanatic correction is irrelevant for the
     * q-parameter transform (which is inherently paraxial).
     */
    getABCD(): [number, number, number, number] {
        return [1, 0, -1 / this.focalLength, 1];
    }

    /** Formatted label for visualization. */
    get label(): string {
        const immersionStr = this.immersionIndex > 1.3
            ? (this.immersionIndex > 1.4 ? ' Oil' : ' Water')
            : '';
        return `${this.magnification}x / ${this.NA}${immersionStr}`;
    }
}

// --- Visualizer ----------------------------------------------------

export const ObjectiveVisualizer = ({ component }: { component: Objective }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);

    const f = component.focalLength;
    const a = component.apertureRadius;
    const wd = component.workingDistance;
    const bodyR = Math.max(a + 1, component.diameter / 2);

    const parfocalDistance = 35;
    const zFront = -f + wd;
    const zBack = Math.max(-f + parfocalDistance, zFront + 20);
    const zTaperEnd = zFront + Math.min(15, (zBack - zFront) * 0.6);

    const immersionIdx = component.immersionIndex || 1;
    const maxSin = component.NA / immersionIdx;
    const maxTan = maxSin / Math.sqrt(1 - maxSin * maxSin);
    const opticalFrontRadius = wd * maxTan;
    const frontRadius = Math.max(opticalFrontRadius + 0.5, 2);
    const barrelLength = zBack - zFront;

    const getObjectiveBandColor = (mag: number) => {
        if (mag <= 4) return '#ff0000';
        if (mag <= 10) return '#ffd700';
        if (mag <= 20) return '#00ff00';
        if (mag <= 40) return '#00bfff';
        if (mag <= 60) return '#0000ff';
        return '#ffffff';
    };

    const lathePoints = useMemo(() => {
        const pts = [];
        pts.push(new Vector2(opticalFrontRadius, zFront));
        pts.push(new Vector2(frontRadius, zFront));
        if (zTaperEnd > zFront) pts.push(new Vector2(bodyR, zTaperEnd));
        if (zBack > zTaperEnd) pts.push(new Vector2(bodyR, zBack));
        pts.push(new Vector2(a, zBack));
        if (zBack > 0 && zFront < 0) pts.push(new Vector2(a, 0));
        pts.push(new Vector2(opticalFrontRadius, zFront));
        return pts;
    }, [opticalFrontRadius, zFront, frontRadius, bodyR, zTaperEnd, zBack, a]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[0, 0, -Math.PI / 2]} renderOrder={1}>
                <cylinderGeometry args={[a, a, 0.5, 32]} />
                <meshBasicMaterial color="#b388ff" transparent opacity={0.3} side={DoubleSide} depthWrite={false}/>
            </mesh>
            <mesh position={[(zFront + 0.01) / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={1}>
                <cylinderGeometry args={[a, opticalFrontRadius, Math.abs(zFront - 0.01), 32, 1, true]} />
                <meshStandardMaterial color="#88ccff" transparent opacity={0.15} depthWrite={false} roughness={0.1} side={DoubleSide} />
            </mesh>
            {wd > 0.1 && (
                <mesh position={[(-f + zFront) / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={1}>
                    <cylinderGeometry args={[frontRadius, 0.1, wd, 32]} />
                    <meshBasicMaterial color="#00ffcc" transparent opacity={0.15} wireframe={false} depthWrite={false} />
                </mesh>
            )}
            <mesh rotation={[0, 0, -Math.PI / 2]} renderOrder={2}>
                <latheGeometry args={[lathePoints, 32]} />
                <meshStandardMaterial color="#222222" roughness={0.8} metalness={0.2} side={DoubleSide} transparent opacity={0.5} depthWrite={false} />
            </mesh>
            <mesh position={[zTaperEnd + 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={3}>
                <cylinderGeometry args={[bodyR + 0.1, bodyR + 0.1, 3, 32, 1, true]} />
                <meshStandardMaterial color={getObjectiveBandColor(component.magnification)} transparent opacity={0.8} depthWrite={false} roughness={0.3} side={DoubleSide} />
            </mesh>
            <mesh position={[(zFront + zBack) / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                <cylinderGeometry args={[bodyR * 1.5, bodyR * 1.5, barrelLength + 10, 8]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} depthWrite={false} colorWrite={false} />
            </mesh>
            {isSelected && (
                <mesh position={[(zFront + zBack) / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                    <cylinderGeometry args={[bodyR * 1.15, bodyR * 1.15, barrelLength + 2, 32]} />
                    <meshBasicMaterial color="#b388ff" transparent opacity={0.3} wireframe />
                </mesh>
            )}
        </group>
    );
};