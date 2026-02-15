# Implementation Plan

-Please see PhysicsPlan.md and Tests.md to complete your plan.

-Vite + Typescript, compiled with bun.


# UI

- Elements simply float, there are no posts supporting them from the table
- The camera is such that the program looks actually 2D when seen from above, and only when user rotates the camera to an angle does it look 3D.
- No lens objects should have housing. So that you can see the light source go through the lens.
- Any complicated thing that does have housing such as an objective should be transparent, so that you can see the light source go through the subcomponents.

# Order of implementation

[DONE] Implement Solver 1
[DONE] UI / UX / Components / Tests for Solver 1

[DONE] Implement Solver 2
[DONE] Tests for Solver 1 and Solver 2

[] Implement Solver 3 using WebGPU
[] Tests for Solver 3, final test using browser, confirm image generation.
[] Create a brightfield transmission microscope, confirm sample looks correct in camera view
[] Create epifluorescence microscope, confirm rays look correct, confirm sample looks correct in camera view
[] Pause for user feedback

