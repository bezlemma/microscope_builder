\# Bez's Optics and Microscope Builder: BOMB



This is a program to help plan, lay out, understand and tweak optical tables when building microscope setups. Physical fidelity and ease of use are key. It's meant to augment actually sitting at an optical table and trying things, but in a digital environment.



\## 1. Core Philosophy:



1\. The program must be as physically accurate as possible.

2\. Parts do not "know" they are part of a particular microscope. No `if (isConfocal)` anywhere.

3\. All data that is being calculated should be represented to the user. The UI is always a faithful viewport to the physics and data.

4\. If niche logic is being used, such as a new solver, this must be visually represented to the user.





\## General Approach



BOMB is a browser-based optical table simulator. The user places components — lenses, mirrors, apertures, samples, detectors — on a virtual table and sees physically correct light propagation, PSFs, and microscope images.



This is built as an application for a computer web browser, with secondary use on a phone browser. Current architecture: Vite + React + TypeScript, Three.js + R3F for visualization, compiled with Bun. Portions will be implemented in Rust and compiled to WebAssembly for browser execution.



\- We are constantly iterating on this, changing solvers, architectures, even programming languages, so modularity is key.





\## Units and Coordinates



Position: millimeters (mm).

Wavelength: meters (SI) (e.g., $532 \\times 10^{-9}$).

Angles: radians.



\*\*World Space (The Optics Table)\*\*: $(x, y, z)$. Positive $z$ is "up" off the table. The $xy$-plane is the table surface.



\*\*Light Space (Part Frame)\*\*: $(u, v, w)$. The $w$-axis is the optical axis — the direction light travels through the component. For a lens, this is the axis of symmetry. The $uv$-plane is the transverse plane. Equation for a standard lens surface: $w = \\text{sag}(u, v)$.



These two coordinate systems must never be mixed. World-to-local and local-to-world transforms happen at the boundary of each part's `interact()` call. Rods are always stored in world coordinates.



\## Controls



Bare left click is reserved for interacting with objects, and should not do anything else (should not rotate the camera for instance).

Right click is reserved for a menu one day, and should not do anything else.

Shift+left click or middle click+drag should pan.

Ctrl+left click should rotate.

If selecting an object, alt-left click should snap to the object being centered on the nearest hole.

Holding left click and then using scroll wheel rotates the part along its $z$ (up, world) axis by Lets 5 degrees per scroll click.



Be careful when implementing these, Three.js has a tendency to override this stuff.


## Things I would like to do:


Snouty Microscope (From paper?)

Single Objective Light Sheet

Lattice Light Sheet

Poisson Spot Optics Demo (but how? Need some non-local tracing ability)

Optical Trap

Thin Films (but how?)

Optimizers (e.g. coupling problems, PSF problems)

PolScope demo



## TODO: Engine / Physics Backlog

1. Port the full Solver 3 reverse-trace path into the flat, packed Rust/WASM CPU backend. This includes camera sampling, PMT sampling, sample fluorescence, beam-field lookup, `traceBackward`, and enough component interactions that the JS backend becomes a fallback rather than the main implementation.

2. Build the real WebGPU compute renderer on the same packed scene/ray representation. The current WebGPU path should become actual batched ray tracing and image accumulation, not only buffer setup and CPU fallback.

3. Expand packed component physics coverage beyond the current small interaction subset. Lenses, objectives, dichroics, filters, samples, medium volumes, mesh optics, scanner optics, and detector interactions need packed/WASM/GPU-compatible implementations.

4. Use a scene-level acceleration structure for every ray-tracing path. Solver 3 has an accelerator, but Solver 1, forward preview tracing, and remaining UI trace paths should stop doing mostly linear candidate walks.

5. Finish the zero-copy worker transfer design. SharedArrayBuffer or equivalent transfer paths should cover camera rendering, PMT raster, progressive accumulation, and worker merge buffers without repeated full-buffer copies.

6. Add adaptive sampling to PMT raster scans. Quiet or dark PMT pixels should stop early while high-variance pixels keep accumulating, matching the camera progressive renderer behavior.

7. Implement objective, coverslip, and immersion-medium physics as real scene media. Objective NA should affect acceptance and focusing, and immersion regions should also affect OPL and ray propagation between sample and objective.

8. Remove non-physical mesh fallback paths. The current lens/prism gap and TIR rescue fallbacks should be replaced by robust surface traversal instead of pass-through or grazing approximations.






