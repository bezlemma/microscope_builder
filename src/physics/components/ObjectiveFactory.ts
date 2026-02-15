import { OpticalComponent } from '../Component';
import { SphericalLens } from './SphericalLens';
import { Vector3, Euler } from 'three';

/**
 * ObjectiveFactory
 * Creates complex multi-element objectives as a flat list of OpticalComponents.
 * This ensures that Solver1 (which does not recurse into children) can trace all elements.
 */
export class ObjectiveFactory {

    /**
     * Creates a high-quality 4-element Achromat Objective.
     * Design properties based on ABCD Matrix Analysis:
     * - EFL: ~16.22 mm
     * - FFL (Working Distance): ~11.62 mm (from Front Vertex)
     * - Total Length: ~30.92 mm
     * 
     * @param position - World position of the Front Vertex (Surface 1)
     * @param rotationEuler - Rotation in Euler angles [x, y, z] (default facing +X)
     */
    static createAchromat(position: Vector3, rotationEuler: Vector3 = new Vector3(0, Math.PI/2, 0)): OpticalComponent[] {
        const components: OpticalComponent[] = [];
        
        // Refractive Indices
        const nLaCrown = 1.788;
        const nFlint = 1.785;
        const nBK7 = 1.517;

        // Origin at Front Vertex for local calculations
        let localW = 0;
        
        // Helper to add lens relative to Front Vertex
        const addLens = (
            curvature: number, 
            aperture: number, 
            thickness: number, 
            name: string, 
            r1: number, 
            r2: number, 
            ior: number
        ) => {
            const lens = new SphericalLens(curvature, aperture, thickness, name, r1, r2, ior);
            
            // Calculate center position of this lens element
            // localW is at the FRONT face of this element.
            // Center is at localW + thickness/2.
            const centerLocalW = localW + thickness / 2;
            
            // Transform to World Space
            // In local space, w is the optical axis (mapped to Vector3.z).
            // The rotation transforms local w into world space.
            
            // Start with vector (0, 0, centerLocalW) in local space (w = optical axis)
            // Standard SphericalLens: optical axis is local w (Vector3.z)
            // If we rotate the Lens object, its local w points in the direction of rotation.
            
            // P_world = P_ref + Rotation * (0, 0, centerLocalW)
            // Standard "Face X" rotation is (0, PI/2, 0).
            // A vector (0,0,1) rot(0, PI/2, 0) becomes (1, 0, 0). Correct.
            
            const euler = new Euler(rotationEuler.x, rotationEuler.y, rotationEuler.z);
            const offset = new Vector3(0, 0, centerLocalW).applyEuler(euler);
            const worldPos = position.clone().add(offset);
            
            lens.setPosition(worldPos.x, worldPos.y, worldPos.z);
            lens.setRotation(rotationEuler.x, rotationEuler.y, rotationEuler.z);
            
            components.push(lens);
            
            // Advance cursor along optical axis
            localW += thickness;
            return lens;
        };
        
        // Helper for Air Gap
        const addGap = (dist: number) => {
            localW += dist;
        };

        // --- Construction ---
        
        // Group 1: Singlet (Lanthanum Crown) - Meniscus
        // R1=6.76, R2=8.56, t=5.48
        addLens(0, 6, 5.48, "Obj G1 (Meniscus)", 6.76, 8.56, nLaCrown);
        
        // Gap 1
        addGap(4.30);
        
        // Group 2: Singlet (Lanthanum Crown) - Biconvex
        // R3=55.04, R4=-40.14, t=3.28
        // Note: R4 is -40.14 (convex to left). In SphericalLens, r2 is -R. 
        // If surface is convex left, center is to Right? No, center is to Left. R<0.
        // Standard convention: R>0 Center Right.
        // Left Surface Convex (bulging left): Center Right -> R>0.
        // Right Surface Convex (bulging right): Center Left -> R<0.
        //
        // Our Analysis Input:
        // Surf 3 (G2 Front): R=55.04 (Convex Right -> Bulging Left). Correct.
        // Surf 4 (G2 Back): R=-40.14 (Convex Left (Bulging Right)). Correct.
        //
        // SphericalLens Constructor Convention:
        // r1: Front radius. 
        // r2: Back radius.
        addLens(0, 7, 3.28, "Obj G2 (Biconvex)", 55.04, -40.14, nLaCrown);
        
        // Gap 2
        addGap(11.82);
        
        // Group 3: Cemented Doublet
        // Group 3a: Flint
        // R5=59.28, R6=15.86, t=2.20
        addLens(0, 7, 2.20, "Obj G3a (Flint)", 59.28, 15.86, nFlint);
        
        // Gap 3 (Cemented - Add micro-gap to prevent epsilon miss)
        addGap(0.01); 
        
        // Group 3b: Crown
        // R7=15.86, R8=-40.14, t=3.84
        addLens(0, 7, 3.84, "Obj G3b (Crown)", 15.86, -40.14, nBK7);
        
        return components;
    }
}
