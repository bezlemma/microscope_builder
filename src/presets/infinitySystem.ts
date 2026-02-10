import { OpticalComponent } from '../physics/Component';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Camera } from '../physics/components/Camera';
import { PointSource } from '../physics/components/PointSource';
// import { Laser } from '../physics/components/Laser';
import { Objective } from '../physics/components/Objective';

export const createInfinitySystemScene = (): OpticalComponent[] => {
    const scene: OpticalComponent[] = [];

    // 1. Point Source at Front Focal Plane
    // Optimization Script Result: Best Source X = 0.72 (Distance 19.28mm from V1)
    // Residual divergeance slope ~ 0.000006 (Strictly Parallel)
    const pointSource = new PointSource("Sample Point Source");
    pointSource.setPosition(0.72, 0, 0); 
    pointSource.coneAngle = 5; 
    pointSource.rayCount = 15;
    scene.push(pointSource);

    // 2. Sample (Mickey Mouse) - Removed to prevent ray occlusion
    // The PointSource acts as the "Sample Emitter" for this demo.
    
    // 3. Objective (Aplanatic Phase Surface)
    // Replaces old 4-element achromat. Parameters match:
    // EFL ~20mm (200/10), NA=0.25, WD=11.6mm (from previous analysis)
    const objective = new Objective({
        magnification: 10,
        NA: 0.25,
        workingDistance: 11.6,
        tubeLensFocal: 200,
        name: '10x/0.25 Objective'
    });
    objective.setPosition(20, 0, 0);
    objective.setRotation(0, Math.PI / 2, 0);
    scene.push(objective);
    
    // 4. Tube Lens (Achromatic Doublet)
    // Spaced 200mm from Objective
    // Objective ends approx X=50.
    // Infinity Space: 50 to 250 (200mm gap).
    const tubePos = 250;
    
    // Element A (Positive) f=100
    const tubeA = new SphericalLens(1/100, 25, 4, "Tube Element A");
    tubeA.setPosition(tubePos, 0, 0);
    tubeA.setRotation(0, Math.PI / 2, 0);
    scene.push(tubeA);

    // Element B (Negative/Corrector) f=-200
    const tubeB = new SphericalLens(-1/200, 25, 2, "Tube Element B");
    tubeB.setPosition(tubePos + 4, 0, 0); // Cemented
    tubeB.setRotation(0, Math.PI / 2, 0);
    scene.push(tubeB);

    // 5. Camera
    // Focal length of tube doublet ~ 200mm
    // Camera at TubePos + f.
    // Adjusted empirically if needed, but 200mm is target.
    const camera = new Camera(50, 25, "CMOS Sensor");
    camera.setPosition(tubePos + 200, 0, 0); // X=450
    camera.setRotation(0, -Math.PI / 2, 0); // Face -X
    scene.push(camera);

    return scene;
};
