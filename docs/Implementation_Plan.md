# Implementation Plan

-Please see PhysicsPlan.md and Tests.md to complete your plan.

-Creating a microscope builder simulator "Bez's Microscope Builder" to help me and others design and build microscopes.

-Vite + Typescript, compiled with bun.

-Focus on Solver 1 and UI to begin with, as everything else will be built on top of that and we want to make sure that works.


# UI

- Elements simply float, there are no posts supporting them from the table
- The camera is such that the program looks actually 2D when seen from above, and only when user rotates the camera to an angle does it look 3D.
- No lens objects should have housing. So that you can see the light source go through the lens.
- Any complicated thing that does have housing such as an objective should be transparent, so that you can see the light source go through the subcomponents.

# Order of implementation

[DONE] Implement Solver 1
[DONE] UI / UX / Components / Tests for Solver 1
[DONE] Test beam expander for Solver 1 using browser.
[] Test light source + sample + infinity objective + tube lens + camera.
    - Test in browser
    - Create a Mickey Mouse geometry for the sample, where the mickey main sphere is 1 mm in diameter, the ears are 300 um in diamter. The ears are placed above the main sphere in the +Z direction, so that the camera sees the shadow of the mickey. The sample should sit in a sample holder, the sample itself is probably too small to be visibsle, but the sample holder will be visible. In the properties viewer for the mickey mouse sample, you can see the 3D orientation of the mickey sample in the world view coordinate system. 
[] Pause for user feedback

Do not go past this point until user has verified that both tests work, and that basic UI functionality is working.

[] Implement Solver 2
[] Tests for Solver 1 and Solver 2, final test using browser.
[] Pause for user feedback

[] Implement Solver 3 using WebGPU
[] Tests for Solver 3, final test using browser, confirm image generation.
[] Create a brightfield transmission microscope, confirm sample looks correct in camera view
[] Create epifluorescence microscope, confirm rays look correct, confirm sample looks correct in camera view
[] Pause for user feedback

