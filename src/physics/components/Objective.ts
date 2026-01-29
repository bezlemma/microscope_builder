import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { SphericalLens } from './SphericalLens';
import { Ray, HitRecord, InteractionResult } from '../types';

export class Objective extends OpticalComponent {
    elements: OpticalComponent[] = [];

    constructor(focalLength: number = 20, name: string = "20x Objective (Physically 10x)") {
        super(name);
        
        // High-Quality 10x Achromat Objective (4 Elements, 3 Groups)
        // Design: Singlet + Singlet + Doublet
        // Focal Length f = 20mm. WD = 8mm.
        
        // --- Reference: Global Coordinates assuming Obj Center X=10 ---
        // Sample at X=0.
        // WD=8mm => Front Vertex at X=8.
        // Objective Center (X=10). Front Vertex Local Z = -2.

        // Refractive Indices
        const nLaCrown = 1.788;
        const nFlint = 1.785;
        const nBK7 = 1.517;

        // Group 1: Singlet (Lanthanum Crown) - Meniscus
        // R1: 0.338*f = 6.76 (Convex/Right)
        // R2: 0.428*f = 8.56 (Concave/Right)
        // T: 0.274*f = 5.48
        // Local Pos: Front Vertex at -2. Center at -2 + 5.48/2 = 0.74.
        const g1 = new SphericalLens(0, 6, 5.48, "Group 1 (Meniscus)", 6.76, 8.56, nLaCrown);
        g1.setPosition(0, 0, 0.74);
        this.elements.push(g1);

        // Gap 1: 0.215*f = 4.30
        // Previous Back Vertex: -2 + 5.48 = 3.48
        // Next Front Vertex: 3.48 + 4.30 = 7.78

        // Group 2: Singlet (Lanthanum Crown) - Biconvex
        // R3: 2.752*f = 55.04 (Convex/Right)
        // R4: -2.007*f = -40.14 (Convex/Left)
        // T: 0.164*f = 3.28
        // Center: 7.78 + 3.28/2 = 9.42
        const g2 = new SphericalLens(0, 7, 3.28, "Group 2 (Biconvex)", 55.04, -40.14, nLaCrown);
        g2.setPosition(0, 0, 9.42);
        this.elements.push(g2);

        // Gap 2 (Stop): 0.591*f = 11.82
        // Previous Back Vertex: 7.78 + 3.28 = 11.06
        // Next Front Vertex: 11.06 + 11.82 = 22.88

        // Group 3: Cemented Doublet (Flint + Crown)
        // Element 3 (Flint) - Meniscus?
        // R5: 2.964*f = 59.28 (Convex)
        // R6: 0.793*f = 15.86 (Concave - Interface)
        // T: 0.110*f = 2.20
        // Center: 22.88 + 2.20/2 = 23.98
        const g3a = new SphericalLens(0, 7, 2.20, "Group 3a (Flint)", 59.28, 15.86, nFlint);
        g3a.setPosition(0, 0, 23.98);
        this.elements.push(g3a);

        // Element 4 (Crown) - Biconvex
        // R7: 15.86 (Matches R6)
        // R8: -2.007*f = -40.14 (Convex)
        // T: 0.192*f = 3.84
        // Start: 22.88 + 2.20 = 25.08
        // Center: 25.08 + 3.84/2 = 27.00
        const g3b = new SphericalLens(0, 7, 3.84, "Group 3b (Crown)", 15.86, -40.14, nBK7);
        g3b.setPosition(0, 0, 27.00);
        this.elements.push(g3b);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        let bestHit: HitRecord | null = null;
        let closestT = Infinity;

        // Iterate over elements
        for (const element of this.elements) {
            // Transform Ray to Element Local Space
            // Element position is relative to Objective.
            // Assumption: No relative rotation for internal elements (aligned on axis).
            
            const rayElementOrigin = rayLocal.origin.clone().sub(element.position);
            const rayElement: Ray = {
                ...rayLocal,
                origin: rayElementOrigin
                // Direction is same if no rotation
            };

            const hit = element.intersect(rayElement);
            
            if (hit) {
                // Transform hit point back to Objective Local Space
                // hit.point is in Element Local Space
                // pointObj = pointElem + elemPos
                
                // Element.intersect returns t relative to ray start.
                // t is distance. Distance doesn't change with translation.
                // However, we must ensure t is correct.
                
                // hit.point (Element Local) -> Objective Local
                const pointObj = hit.point.clone().add(element.position);
                
                // Recalculate t in Objective Space to be safe (distance from rayLocal.origin)
                const tObj = pointObj.distanceTo(rayLocal.origin);

                if (tObj < closestT) {
                    closestT = tObj;
                    bestHit = {
                        ...hit,
                        t: tObj,
                        point: pointObj,
                        localPoint: pointObj, // Hit in Objective Local Space
                        // Storing reference to hit element for interaction
                        // We can carry it via a custom property or just find it again in interact?
                        // Better to attach it to the HitRecord if possible, or assume stable sort?
                        // Hack: Since interact takes the same ray, we can re-intersect or store metadata.
                        // Let's store metadata in a temporary way? No, HitRecord is standard.
                        // We will implement interact to check who was hit.
                        // OR: We can just return the interaction result directly? No, signature is separate.
                        // Let's trust that 'interact' will re-find the hit or we modify HitRecord type?
                        // Modifying HitRecord type is invasive.
                        // We can encode index in 'faceIndex' or similar if unused?
                        // Or just re-run intersection in interact (inefficient but safe).
                    };
                    // Tag the hit with the element
                    (bestHit as any).hitElement = element;
                }
            }
        }

        return bestHit;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Retrieve the element that was hit
        const element = (hit as any).hitElement as SphericalLens;
        
        if (!element) {
            console.log('[Objective.interact] No hitElement found, absorbing ray');
            return { rays: [] };
        }
        
        console.log(`[Objective.interact] Hit element: ${element.name}`);
        
        // The Objective handles the World <-> Objective Local transform.
        // Elements inside the Objective have position offsets but no independent rotation.
        // We need to call element.interact, but the element's worldToLocal is identity.
        // So we need to do the transform ourselves.
        
        // Transform ray to Objective Local Space
        const rayLocalDir = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const rayLocalOrigin = ray.origin.clone().applyMatrix4(this.worldToLocal);
        
        console.log(`[Objective.interact] rayLocalDir: ${rayLocalDir.x.toFixed(3)}, ${rayLocalDir.y.toFixed(3)}, ${rayLocalDir.z.toFixed(3)}`);
        
        // Create a "virtual" ray in Objective Local Space
        const rayObjLocal: Ray = {
            ...ray,
            origin: rayLocalOrigin,
            direction: rayLocalDir
        };
        
        // Adjust hit to Element Local Space (subtract element position)
        const hitElementLocal = {
            ...hit,
            localPoint: hit.localPoint!.clone().sub(element.position),
            // Normal was computed in element local space, should be fine
        };
        
        // Call element's interact method directly, but with careful handling:
        // The element uses its own worldToLocal (identity), so we need to pass data
        // that's already in element local space.
        
        // Actually, let's manually do the refraction here since the element's
        // worldToLocal is broken. We'll trace through the element ourselves.
        
        const nAir = 1.0;
        const nGlass = element.ior;
        
        // Get radii
        let R1, R2;
        if (element.r1 !== undefined && element.r2 !== undefined) {
            R1 = element.r1;
            R2 = element.r2;
        } else {
            const R = (2 * (element.ior - 1)) / element.curvature;
            R1 = R;
            R2 = -R;
        }
        
        // 1. Refract at Front (ray direction is in Objective Local space)
        const dirIn = rayLocalDir;
        // CRITICAL: hit.normal is in WORLD space (transformed by chkIntersection)
        // We need to transform it to Objective Local space to match dirIn
        const normal1 = hit.normal.clone().transformDirection(this.worldToLocal).normalize();
        
        console.log(`[Objective.interact] normal1 (local): ${normal1.x.toFixed(3)}, ${normal1.y.toFixed(3)}, ${normal1.z.toFixed(3)}`);
        console.log(`[Objective.interact] hitPointElemLocal: will be at ${hit.localPoint!.x.toFixed(2)}, ${hit.localPoint!.y.toFixed(2)}, ${hit.localPoint!.z.toFixed(2)}`);
        console.log(`[Objective.interact] element.position: ${element.position.x.toFixed(2)}, ${element.position.y.toFixed(2)}, ${element.position.z.toFixed(2)}`);
        console.log(`[Objective.interact] R2=${element.r2}, thickness=${element.thickness}`);
        
        const refract = (incident: Vector3, normal: Vector3, n1: number, n2: number): Vector3 | null => {
            const r = n1 / n2;
            const cosI = -normal.dot(incident);
            const sinT2 = r * r * (1 - cosI * cosI);
            if (sinT2 > 1) return null;
            const cosT = Math.sqrt(1 - sinT2);
            return incident.clone().multiplyScalar(r).add(normal.clone().multiplyScalar(r * cosI - cosT)).normalize();
        };
        
        const dirInside = refract(dirIn, normal1, nAir, nGlass);
        if (!dirInside) {
            console.log('[Objective.interact] FAIL: Refract at front returned null (TIR?)');
            return { rays: [] };
        }
        
        // 2. Propagate to Back Surface in Element Local Space
        // Element position is relative to Objective center
        // hit.localPoint is in Objective Local, subtract element position to get Element Local
        const hitPointElemLocal = hit.localPoint!.clone().sub(element.position);
        
        console.log(`[Objective.interact] hitPointElemLocal: ${hitPointElemLocal.x.toFixed(2)}, ${hitPointElemLocal.y.toFixed(2)}, ${hitPointElemLocal.z.toFixed(2)}`);
        console.log(`[Objective.interact] dirInside: ${dirInside.x.toFixed(3)}, ${dirInside.y.toFixed(3)}, ${dirInside.z.toFixed(3)}`);
        console.log(`[Objective.interact] R2=${R2}, thickness=${element.thickness}`);
        
        const center2ElemLocal = new Vector3(0, 0, element.thickness/2 + R2);
        const absR2 = Math.abs(R2);
        
        console.log(`[Objective.interact] center2ElemLocal: ${center2ElemLocal.x.toFixed(2)}, ${center2ElemLocal.y.toFixed(2)}, ${center2ElemLocal.z.toFixed(2)}, absR2=${absR2}`);
        
        // Intersect back sphere
        const oc = hitPointElemLocal.clone().sub(center2ElemLocal);
        const b = oc.dot(dirInside);
        const c = oc.dot(oc) - absR2 * absR2;
        const h = b * b - c;
        
        console.log(`[Objective.interact] oc=${oc.x.toFixed(2)},${oc.y.toFixed(2)},${oc.z.toFixed(2)}, b=${b.toFixed(2)}, c=${c.toFixed(2)}, h=${h.toFixed(2)}`);
        
        if (h < 0) {
            console.log('[Objective.interact] FAIL: No back surface intersection (h < 0)');
            return { rays: [] };
        }
        
        const sqrtH = Math.sqrt(h);
        let t2 = -b - sqrtH;
        if (t2 < 0.001) t2 = -b + sqrtH;
        if (t2 < 0.001) {
            console.log(`[Objective.interact] FAIL: t2=${t2.toFixed(4)} < 0.001`);
            return { rays: [] };
        }
        
        console.log(`[Objective.interact] t2=${t2.toFixed(4)} (distance to back surface)`);
        
        const hit2ElemLocal = hitPointElemLocal.clone().add(dirInside.clone().multiplyScalar(t2));
        console.log(`[Objective.interact] hit2ElemLocal: ${hit2ElemLocal.x.toFixed(2)}, ${hit2ElemLocal.y.toFixed(2)}, ${hit2ElemLocal.z.toFixed(2)}`);
        
        const normal2 = hit2ElemLocal.clone().sub(center2ElemLocal).normalize();
        if (normal2.dot(dirInside) > 0) normal2.multiplyScalar(-1);
        
        // 3. Refract at Back
        const dirOutLocal = refract(dirInside, normal2, nGlass, nAir);
        if (!dirOutLocal) {
            console.log('[Objective.interact] FAIL: Refract at back returned null (TIR?)');
            return { rays: [] };
        }
        
        console.log('[Objective.interact] SUCCESS: ray passed through element');
        
        // Transform back to world space
        // hit2 in Element Local -> add element.position -> Objective Local -> transform to World
        const hit2ObjLocal = hit2ElemLocal.clone().add(element.position);
        const hit2World = hit2ObjLocal.clone().applyMatrix4(this.localToWorld);
        const dirOutWorld = dirOutLocal.clone().transformDirection(this.localToWorld).normalize();
        
        return {
            rays: [{
                ...ray,
                origin: hit2World,
                direction: dirOutWorld,
                opticalPathLength: ray.opticalPathLength + (t2 * nGlass)
            }]
        };
    }
}
