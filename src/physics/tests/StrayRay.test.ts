import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import { SphericalLens } from "../../parts/SphericalLens";
import { Ray, Coherence } from "../types";
import { Solver1 } from "../Solver1";

/**
 * Stray Ray Detection Test
 * 
 * Fires a bundle of parallel rays through a lens and checks that
 * ALL output rays converge consistently — no outlier directions.
 * 
 * A "stray ray" is one that diverges instead of converging, or has
 * a dramatically wrong deflection for its input offset.
 */
describe("Stray Ray Detection", () => {

    function makeRay(x: number, y: number, z: number): Ray {
        return {
            origin: new Vector3(x, y, z),
            direction: new Vector3(1, 0, 0),
            wavelength: 550e-9,
            intensity: 1,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: Coherence.Incoherent,
            sourceId: 'test'
        };
    }

    test("Plano-convex focusing lens: no stray rays in parallel bundle", () => {
        // Exact lens from TransmissionFluorescence preset (corrected aperture)
        const lens = new SphericalLens(1 / 25, 12.7, 5.3, "Focusing Lens", 12.9, 1e9, 1.517);
        lens.setPosition(0, 0, 0);

        const solver = new Solver1([lens]);

        // Fire a grid of parallel rays across the beam
        const rays: Ray[] = [];
        const offsets = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
        for (const y of offsets) {
            for (const z of offsets) {
                if (y * y + z * z <= 4.1) {
                    rays.push(makeRay(-30, y, z));
                }
            }
        }

        const paths = solver.trace(rays);

        // Collect output directions
        const strayRays: string[] = [];

        for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            if (path.length < 2) continue;

            const outRay = path[path.length - 1];
            const inputY = rays[i].origin.y;
            const inputZ = rays[i].origin.z;

            // Skip on-axis ray
            if (Math.abs(inputY) < 0.01 && Math.abs(inputZ) < 0.01) continue;

            // For a CONVERGING lens:
            // Ray at y>0 should get dir.y < 0 (converge)
            // Ray at z>0 should get dir.z < 0 (converge)
            const wrongSignY = (inputY > 0.1 && outRay.direction.y > 0.01) ||
                               (inputY < -0.1 && outRay.direction.y < -0.01);
            const wrongSignZ = (inputZ > 0.1 && outRay.direction.z > 0.01) ||
                               (inputZ < -0.1 && outRay.direction.z < -0.01);

            if (wrongSignY || wrongSignZ) {
                strayRays.push(
                    `Ray ${i} at (${inputY}, ${inputZ}): dir=(${outRay.direction.y.toFixed(5)}, ${outRay.direction.z.toFixed(5)}) — ` +
                    `WRONG SIGN (diverges instead of converges)`
                );
            }
        }

        if (strayRays.length > 0) {
            console.log("\n--- STRAY RAYS DETECTED ---");
            for (const s of strayRays) console.log(`  ${s}`);
        }

        expect(strayRays.length).toBe(0);
    });

    test("Z-symmetry: z=+1 and z=-1 should produce mirror-symmetric deflection", () => {
        const lens = new SphericalLens(1 / 25, 12.7, 5.3, "Lens", 12.9, 1e9, 1.517);

        const rayPlus = makeRay(-30, 0, 1);
        const rayMinus = makeRay(-30, 0, -1);

        const hitPlus = lens.intersect(rayPlus);
        const hitMinus = lens.intersect(rayMinus);

        expect(hitPlus).not.toBeNull();
        expect(hitMinus).not.toBeNull();

        if (hitPlus && hitMinus) {
            const resPlus = lens.interact(rayPlus, hitPlus);
            const resMinus = lens.interact(rayMinus, hitMinus);

            const dirZPlus = resPlus.rays[0].direction.z;
            const dirZMinus = resMinus.rays[0].direction.z;

            // Should be opposite signs and approximately equal magnitude
            expect(dirZPlus).toBeLessThan(-0.01); // converges: z=+1 → dir.z < 0
            expect(dirZMinus).toBeGreaterThan(0.01); // converges: z=-1 → dir.z > 0
            expect(Math.abs(dirZPlus + dirZMinus)).toBeLessThan(0.005); // nearly mirror-symmetric
        }
    });
});
