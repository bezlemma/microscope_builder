# Implementation Plan

-Please see PhysicsPlan.md and Tests.md to complete your plan.

-Vite + Typescript, compiled with bun.

-Three.js for visualization. 


# Parts

Each part type (a type of mirror, a type of lens) should have it's own .tsx file, with all it's geometry, necessary calculations, properties, etc. handled within the single file. This is because a lot of coding goes into making a new part and making it behave correctly, and we tend to think about one part at a time rather than "all the orientations of all the blocker parts". So in the folder "Parts" we should have "Spherical Lens.tsx", "ViewingCard.tsx", "Camera.tsx" etc. 
 
The following parts exist:

Sources: 
    - Laser
    - Lamp
Lenses: 
    - Spherical Lens
    - Achromatic Doublet
    - Aspheric Lens
    - Cylindrical Lens
    - Ideal Lens
    - Objective
    - Prism
Mirrors:


# UI

- Elements simply float, there are no posts supporting them from the table

- The camera is such that the program looks actually 2D when seen from above, and only when user rotates the camera to an angle does it look 3D.

- Lens, objective, camera housing should be semi-transparent to the user, so that you can see the light source go through the subcomponents.

# Order of implementation

[DONE] Implement Solver 1
[DONE] UI / UX / Components / Tests for Solver 1

[DONE] Implement Solver 2
[DONE] Tests for Solver 1 and Solver 2

[DONE] Implement Solver 3 using CPU
[DONE] Tests for Solver 3, final test using browser, confirm image generation.
[DONE] Create a brightfield transmission microscope, confirm sample looks correct in camera view
[DONE] Create epifluorescence microscope, confirm sample looks correct in camera view
[]  Upgrade Solver 3 to WebGPU

