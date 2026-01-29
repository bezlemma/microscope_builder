# Implementation Plan

-Please see PhysicsPlan.md and Tests.md to complete your plan.

-Creating a microscope builder simulator "Bez's Microscope Builder" to help me and others design and build microscopes.

-Vite + Typescript, compiled with bun.

-3D Viewer, but by default seen from above so that it looks like a 2D viewer, only occasionally will user rotate to third dimension to check if rays make sense in third dimension.

-Focus on Solver 1 and UI to begin with, as everything else will be built on top of that and we want to make sure that works.

-Convert this document, and both PDFs into your implementation plan, and the order of implementation is the layout for your tasks document.



# Order of implementation

\[] Implement Solver 1
\[] UI / UX / Components / Tests for Solver 1
\[] Test beam expander for Solver 1 using browser.
\[] Test light source + sample + infinity objective + tube lens + camera rays in browser
\[] Test everything in the browser yourself
\[] Pause for user feedback

Do not go past this point until user has verified that both tests work, and that basic UI functionality is working.

\[] Implement Solver 2
\[] Tests for Solver 1 and Solver 2, final test using browser.
\[] Pause for user feedback

\[] Implement Solver 3 using WebGPU
\[] Tests for Solver 3, final test using browser, confirm image generation.
\[] Create a brightfield transmission microscope, confirm sample looks correct in camera view
\[] Create epifluorescence microscope, confirm rays look correct, confirm sample looks correct in camera view
\[] Pause for user feedback

