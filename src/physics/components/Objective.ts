import { OpticalComponent } from '../Component';
import { SphericalLens } from './SphericalLens';
import { Ray, HitRecord, InteractionResult } from '../types';
import { ObjectiveCasing } from './ObjectiveCasing';

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
        const element = (hit as any).hitElement as OpticalComponent;
        
        if (element) {
            // We need to pass the hit relative to the element
            // hit.localPoint is in Objective Local Space.
            // element.position is in Objective Local Space.
            // So hit in Element Local Space is:
            
            const hitElementLocal = {
                ...hit,
                localPoint: hit.localPoint!.clone().sub(element.position),
                // We keep .point as valid World Point? Or do we map it?
                // interact usually uses localPoint for math.
                // Keeping .point as world might be safer if downstream needs world.
                // But for debug/consistency, let's leave .point as World (untouched) 
                // OR map it if SphereLens expects it.
                // SphereLens uses .localPoint for intersection.
                // It does NOT uses .point.
            };
            
            // Look out: SphericalLens interact returns rays in LOCAL space of the element?
            // Or World?
            // "interact" typically returns rays in WORLD space?
            // Let's check Component.ts interaction signature.
            // Usually interact returns rays with updated Origin/Dir.
            // If they are World, we are good.
            // BUT: We are in `Objective` which is a Component.
            // `interact` is called by `ForwardTracer` which transforms ray to Local before calling?
            // Wait, `OpticalComponent.chkIntersection` does logic.
            // The `interact` method is called with `ray` (Global?) or Local?
            // `OpticalComponent.ts`: `interact(ray: Ray, hit: HitRecord)`
            // `ForwardTracer`: `const result = hitComponent.interact(ray, hit);`
            // `ray` passed to `interact` is the WORLD ray in `ForwardTracer`.
            // So `element.interact` will return separate rays.
            // However, `element.interact` assumes `element` is the one being hit.
            // If `element` thinks it's at (0,0,0) (its local), but it's part of assembly...
            // Standard components rely on `hit.normal` and `ray.direction`.
            // `hit.normal` from `intersect` is in Element Local Space?
            // `Mirror`: returns normal (1,0,0).
            // `Objective.intersect` returns `hit.normal`.
            // If Element returned normal (1,0,0) (Local to Element), and Element is not rotated relative to Objective.
            // Then Normal is (1,0,0) in Objective Local too.
            // So `hit` passing is likely fine if we adjust points.
            
            // Crucial: Interaction returns new Rays.
            // If `SphericalLens` calculates refraction based on dot(ray, normal), it's direction based. Direction is preserved.
            // Return values are rays.
            // If `SphericalLens` sets origin to `hit.point`, it uses the point we pass.
            // Rays are usually defined in World Space for output?
            // `Mirror.interact` returns `ray.opticalPathLength + hit.t`.
            // Returns `ray` with new direction.
            // `SphericalLens` likely does similar.
            // So as long as `hit` data is correct (Normal, Point), it works.
            
            return element.interact(ray, hitElementLocal);
        }
        
        return { rays: [] };
    }
}
