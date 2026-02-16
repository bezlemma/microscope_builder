## 1. Core Philosophy: 

Three tenants:
1. The "Source of Truth" - The Scene Graph is the only Truth. 
2. The UI is faithful viewport to this truth.
3. Physics over Heuristics. Components do not "know" they are part of a microscope.

## 2. Coordinate Systems & Units
Two distinct coordinate systems to decouple positioning from geometry.

### A. World Space (The Optics Table)
$(x, y, z)$. Defines the position of components and the path of rays traveling between components.
Positive $z$ is "Up" off the table. $xy$-axis The Table Surface.

### B. Light Space (Component Frame)

Used for calculating intersections and surface physics after coordinate transforms. This simplifies the math by normalizing all components to a standard orientation.

$(u, v, w)$.

$W$-axis: The Optical Axis.The direction light travels through the component.
For a lens, this is the axis of symmetry.

$UV$ axis: The Transverse Plane. The cross-section of the component.
Equation for a standard lens surface: $w = \text{sag}(u, v)$.

Any time this transform occurs in the code, great care should be used! This can cause a lot of errors if we use this coordinate space anywhere else by accident.

### C. Units
Position: Millimeters (mm).
Wavelength: Meters (SI) (e.g., $532 \times 10^{-9}$).
Angles: Radians.

## 3. Architecture: Data vs. Systems
The engine is structured like a game engine (ECS pattern). Data is passive; Systems are active.

### A. The Data

The Surface Trait:
Every physical object must implement:intersect(ray_local: Ray) -> Option<HitRecord>
Input: A ray already transformed into Local Space $(u, v, w)$.
Output: Interaction point $t$, Normal vector $\vec{N}$.

The world→local transform happens in a single **template method** (`chkIntersection`) on the base `OpticalComponent` class. This is the **only place** coordinate transforms occur. The method also cleans near-zero floating-point artifacts from the rotation matrix (e.g., `cos(π/2) ≈ 6.12e-17 → 0`) using a `1e-12` epsilon. The `HitRecord` carries both world-space and local-space hit data (`localPoint`, `localNormal`, `localDirection`) so that `interact()` can work in whichever space is most natural without round-tripping through the matrix again.

Output: A list of result rays.
Refraction: Returns 1 ray (new direction).
Splitter: Returns 2+ rays.
Blocker/Opaque: Returns 0 rays (Ray terminates).
Polarizers/Waveplates: Apply matrix multiplication to ray.polarization.
Dichroics/Splitters: Logic here handles probabilistic reflection (50/50 splitter) or wavelength-dependent reflection (Dichroic).
Dispersion/Color: $n$ is calculated using the Sellmeier Equation or a lookup table based on the input wavelength.
Fluorescence (Stokes Shift): Material defines excitation_wavelength ($\lambda_{ex}$) and emission_wavelength ($\lambda_{em}$). Used by Solver 3 to cross-reference Excitation Beam intensity against Emission Ray wavelength.
Includes saturation_intensity to model non-linear bleaching effects.
Absorption: The material returns an absorption coefficient $\mu$ (units: $mm^{-1}$).


### B. Solver 1: Ray-Tracing Engine

Deterministic Vector Ray Tracing via a recursive tree tracer.

Algorithm:
1. For each source ray, find the nearest intersection across all components (`t > 0.001` to prevent self-intersection).
2. Call `component.interact(ray, hit)` to get child rays.
3. For each child ray, recurse. If `interact()` returns an empty list, the ray terminates. If it returns 2+ rays, the path forks into separate branches.
4. Maximum recursion depth: 20 (prevents infinite TIR loops).
5. NaN safety: source rays and mid-trace rays are validated; corrupted rays terminate immediately.
6. Zero-intensity rays (e.g., TIR-trapped inside a prism) are kept for visualization but not traced further.

Output: `Ray[][]` — an array of ray paths, where each path is an ordered sequence of ray segments.

Physics:

#### Snell's law
The new ray direction $\vec{v}_{out}$ given incoming direction $\vec{v}_{in}$, surface normal $\vec{N}$, and index ratio $r = \frac{n_1}{n_2}$.
$$\vec{v}_{out} = r \vec{v}_{in} + \left( r c - \sqrt{1 - r^2 (1 - c^2)} \right) \vec{N}$$
Where: $c = -\vec{N} \cdot \vec{v}_{in}$ (Cosine of incident angle).
Total Internal Reflection occurs if the term under the square root $1 - r^2(1 - c^2) < 0$. In this case, the ray reflects instead.

If interact() returns an empty list (e.g., hitting a wall, the back of a mirror, or a closed iris), the ray path ends immediately at that point.

-Thick-Optic Interaction (The `OpticMesh` Engine): For thick refractive components (spherical lenses, cylindrical lenses, prisms), the physics mesh is a **separate internal mesh** from the visual renderer. Both share the same geometry generation (e.g., `generateProfile()` → `LatheGeometry`), but the physics mesh lives inside the component and is invisible to the UI. The raycaster uses `three-mesh-bvh` for acceleration and `THREE.DoubleSide` so rays can hit glass surfaces from inside during exit. Crucially, the mesh's interpolated vertex normals are replaced at query time by an **analytical `normalFn` callback** provided by each component — e.g., for a spherical lens, the normal is computed as `normalize(hitPoint - sphereCenter)`, not interpolated from neighboring triangle vertices. This eliminates refraction errors at surface discontinuities (rim ↔ optical surface) that plagued the original shared-mesh approach.

The `OpticMesh.interact()` method handles the full entry→exit cycle: detect entry/exit via dot-product test, refract at entry (Air→Glass), internal raycast to find exit surface, refract at exit (Glass→Air), and TIR loop (up to 10 internal bounces). This unified method is used by `SphericalLens`, `CylindricalLens`, and `PrismLens`.

-Polarization (Jones Calculus): The Ray carries a Jones Vector. Every interaction updates it (Reflections flip phase, Waveplates retard components).
-No intensity/flux calculations.
-No interference (requires detector screen sampling) or diffraction (requires wave/Gaussian propagation).

### C. Solver 2: E&M Wave-Equation Engine

Goal: Visualize beam waist, focus quality, and diffraction limits. Allows you to simulate interference and diffraction.

The Full Wave Equation: Describing how ripples move in a pond (or light moves in every direction) is computationally expensive because you have to calculate every point in space (like FDTD simulations).

The Shortcut (Gaussian Beams): If you assume the light is moving mostly in one direction (a "beam"), the Wave Equation has an exact, analytical solution known as the Gaussian Beam.

The $q$ Parameter: This single complex number, $q(z)$, captures the entire state of that wave solution (how wide it is, how curved the wavefront is, and its phase).Method: Analytical Solution to the Paraxial Helmholtz Equation (Gaussian Beam Propagation) along a Geometric Skeleton.

Architecture - The "Ray Tree" Strategy:
To handle beam splitters and complex folding paths (like snouty objectives), Solver 2 operates on the Ray Tree generated by Solver 1.

Branching: If Solver 1 splits a ray (e.g., at a Beam Splitter), Solver 2 clones the $q$-parameter state and propagates two independent beams.

Path Integration: For complex objectives with internal reflections, Solver 2 walks the exact connected segments of the tree, accumulating physical distance $z$ through every fold and turn. This ensures the diffraction calculation matches the true physical path length.

Absorption Tracking: As it walks the segments, Solver 2 also tracks the Axial Power $P(z)$. If a segment is inside a material with absorption $\mu$, the power decays exponentially: $P(z_{end}) = P(z_{start}) \cdot e^{-\mu \Delta z}$.
Data: Tracks Complex Beam Parameter $q(z)$ AND the Jones Vector $\vec{J}$ AND Axial Power $P(z)$.
Astigmatism Support (Cylindrical Lenses): We track $q_x$ and $q_y$ independently.
$\frac{1}{q_x(z)} = \frac{1}{R_x(z)} - i \frac{\lambda}{\pi w_x(z)^2}$$\frac{1}{q_y(z)} = \frac{1}{R_y(z)} - i \frac{\lambda}{\pi w_y(z)^2}$
Light Sheet: A cylindrical lens affects $q_y$ but leaves $q_x$ unchanged, creating a sheet ($w_y \to 0, w_x \to \text{const}$).
$\vec{J}$: Polarization state inherited from the Solver 1 Skeleton.
$P(z)$: Total beam power, subject to Beer-Lambert decay.

Physics:
Diffraction: The beam width $w(z)$ naturally expands as it propagates, simulating the wave nature of light.
Hard Aperture Diffraction (Clipping Rule):
Whenever a beam passes through an aperture of radius $a$, we compute the ratio $T = a / w(z)$.If $T < 2.0$ (Clipping): The aperture acts as a spatial filter. The beam is "reset" at this plane.

New State: $w_{new} = a$, $R_{new} = \infty$ (at the aperture plane).
Effect: A narrow waist ($w_0 = a$) creates a highly divergent beam downstream ($\theta = \lambda / \pi a$). This correctly simulates the loss of resolution (blurring) when stopping down a condenser or objective iris, without needing explicit component labelling.

Vector Interference: 
When summing beams (e.g., at a detector or intersection), we sum the Vector Fields, not just Scalar Intensity.
$\vec{E}_{total} = \vec{E}_1 + \vec{E}_2$$I = |\vec{E}_{total}|^2 = |\vec{E}_1|^2 + |\vec{E}_2|^2 + 2 \text{Re}(\vec{E}_1 \cdot \vec{E}_2^*)$
Result: If beams are orthogonally polarized ($\vec{E}_1 \perp \vec{E}_2$), the dot product is zero, and no interference fringes appear (correct physics). If parallel, fringes appear.

Implementation: Uses ABCD Matrices derived from the Surface curvature to transform $q_{in} \to q_{out}$.Constraint: Only valid near the optical axis (Paraxial approximation).
Usage: Overlays a semi-transparent "beam" mesh on the layout.

Metadata Extraction for ABCD Matrices: Ideal components (`IdealLens`, `Objective`) provide `getABCD()` methods that return the standard thin-lens matrix directly. For thick lenses (`SphericalLens`), the component already knows its `R1`, `R2`, and `ior`, so the ABCD matrix can be computed from the component's own parameters rather than from mesh metadata.

### D. Solver 3: Imaging Engine
Generates the pixels the camera sees for standard Microscopy (Fluorescence, Brightfield, Darkfield) using Reverse Stochastic Path Tracing (Monte Carlo) with Incoherent Integration.

By utilizing sealed, watertight meshes for the collision boundaries, Backward Tracing is highly robust. The raycaster strictly defines the entry and exit points of a glass volume, ensuring that step marching ($dL$) for absorption ($\mu_a$) and scattering phase functions perfectly matches the physical boundaries of the component, eliminating math leaks during Monte Carlo integration.

Some inspiration from this paper: 
"A Generalized Ray Formulation For Wave-Optics Rendering" - (https://arxiv.org/pdf/2303.15762) 
    Solver 1 finds the path (Sample). 
    Solver 2 calculates the physics (Solve). 
    Solver 3 rays carry a footprint_radius (equivalent to the paper's $\beta$). This represents the pixel's sensitivity cone. When a ray hits a diffractive surface, this footprint is used to filter the interference pattern, solving the sampling problem.

#### Potential optimization (Acceleration Structures (The )Light Field Grid)
To prevent Solver 3/4 from iterating through thousands of Solver 2 beams ($O(N)$), we rasterize the Light Field.
Structure: A sparse voxel grid (or Linear BVH) storing indices of active Beam Segments.
Grid Resolution: Coarse (e.g., $10mm^3$ cells).
Query Logic: Solver 3 finds the voxel for point $P$. It only iterates over the beams listed in that voxel.
Performance: Reduces complexity to $O(1)$ or $O(\log N)$, essential for real-time framerates in complex scenes (microlens arrays, diffusers).
Optimization Note: For low resolution sensors (<256px), simple Brute Force iteration is acceptable and easier to implement.

#### i. Transmission:
Absorption = Material_Mu_a(P) * dL.Throughput *= exp(-Absorption).
Scattering (Darkfield Support): Check prob P_scat = Material_Mu_s(P) * dL
If scattered: Ray.Direction = SamplePhaseFunction(). This allows the ray to turn and "find" a light source that was previously hidden (e.g., darkfield condenser).

#### ii. Emission:
The ray (Camera $\lambda_{em}$) hits a fluorophore.
Look up material property: excitation_lambda ($\lambda_{ex}$).

Ask Solver 2 for intensity of $\lambda_{ex}$ at this point.
Ex_Intensity = Solver2.Query(P, lambda_ex).Emission = Fluorophore_Density(P) * Ex_Intensity * dL.Radiance += Emission * Throughput.
Termination: When the ray exits the Sample Volume (or hits no other geometry), it performs a generic query of the Global Light Field generated by Solver 2.

### E. Solver 4: Coherent Imaging
Visualizes complex interference phenomena (Phase Contrast, Holography, DIC). using Reverse Stochastic Path Tracing with Coherent Amplitude Summation.

- Tracks Complex Electric Field $E$ instead of Intensity $I$. Sums amplitudes before squaring.

- When a ray hits a Phase Object (Sample with refractive index gradient $\nabla n$)
    - Ray A (Direct/Ballistic): Continues straight. Accumulates Phase: $\phi += n(P) \cdot dL$.
    - Ray B (Diffracted/Scattered): Scatters based on $\nabla n$. Accumulates Phase: $\phi += n(P) \cdot dL$.
Both rays are traced independently back to the source.

Termination: When rays hit the Source Field (Solver 2):Amplitude = sqrt(Source_Intensity).Phase = Ray.Accumulated_Optical_Path_Length.
Complex_E = Amplitude * exp(i * k * Phase).
Recombination: E_total = E_Direct + E_Diffracted.Final_Pixel_Intensity = |E_total|^2.
Effect: If the Direct ray passes through a Phase Ring (shifting phase by $\pi/2$), the interference term $2 \text{Re}(E_1 E_2^*)$ becomes non-zero, creating the halo contrast characteristic of Phase Contrast microscopy.

### F. Solver 5: The Quantum Correlation Engine
Visualizes Quantum phenomena relying on non-local correlations (Ghost Imaging) or modified statistics (Squeezed Light) using Forward/Backward Hybrid Tracing with Coincidence Tracking.

Scenario: Ghost Imaging
Source (SPDC): Generates Ray Pair $(A, B)$ with entanglement_id.Ray 
A (Signal): Sent to Object.Ray 
B (Idler): Sent to Camera.
Trace Ray A: Interacts with Object (Blocked/Passed).Hits Bucket Detector (Single Pixel, no spatial info).Result: Stores Detection_State = True/False for entanglement_id.
Trace Ray B: Travels freely to Camera (Array).Hits Pixel $(x,y)$.
Coincidence Logic: Camera Pixel $(x,y)$ adds intensity only if Ray_A_Detection_State == True.
Result: The image of the object appears on the camera, despite the camera ray never touching the object.

Scenario: Squeezed Light / Sub-Shot Noise
Standard solvers use Poissonian random number generation for photon counts ($Var = N$).
Solver 5 modifies the Monte Carlo estimator to sample from Sub-Poissonian distributions ($Var < N$) based on the Squeezing Parameter of the source.
Result: Images appear "cleaner" (higher SNR) at lower light levels than physically allowed by classical physics.

### G. Solver Handshake

When Solver 3/4 steps through a sample at a specific point $P_{sample}(x,y,z)$, it queries Solver 2.
-Find the nearest Beam Segment (from the Ray Tree) matching the queried wavelength.
-Project $P_{sample}$ onto the beam axis to find $z_{local}$ and $r_{local}$ (distance from axis).
-Evaluate the Astigmatic Gaussian Intensity Equation, including Beer-Lambert Decay:$$I(x_{loc}, y_{loc}, z) = P(z) \frac{w_{0x} w_{0y}}{w_x(z) w_y(z)} \exp \left( -2 \left( \frac{x_{loc}^2}{w_x(z)^2} + \frac{y_{loc}^2}{w_y(z)^2} \right) \right)$$
Where $P(z)$ is the axial power at depth $z$, already attenuated by the absorption coefficient $\mu$ of the medium:$$P(z) = P_{entry} \cdot e^{-\mu z_{local}}$$
The Result: Infinite spatial resolution with physically correct absorption depth and Light Sheet support (Astigmatism).

## Specific Optical Corrections

Phase Contrast (Coherent Splitting)
Goal: Visualize phase objects (transparent cells) by converting phase delay to amplitude contrast.
Phase Ring: Physical object at Objective BFP with Transmission < 1.0 and Phase Shift $\pi/2$.
Simulation: Requires Solver 4 (Coherent Imaging).
At the sample, rays split into Direct (Undiffracted) and Scattered (Diffracted).Direct Ray: Travels straight $\to$ Hits Phase Ring at BFP $\to$ Phase Shifted.
Scattered Ray: Scatters $\to$ Misses Phase Ring at BFP $\to$ No Shift.
Recombination: At the detector, $E_{total} = E_{direct} + E_{scattered}$. Interference creates contrast.

## Component Definitions

Thin Lenses
A phase surface that obeys the ideal lens equation $\frac{1}{f} = \frac{1}{d_o} + \frac{1}{d_i}$ without geometric 
Interaction: Instead of Snell's Law, it explicitly alters the ray's angle: $\vec{v}_{out} = \vec{v}_{in} - \frac{h}{f} \hat{r}$, where $h$ is distance from axis.
Usage: For simplified "textbook" simulations or defining generic objectives.

Thick Lenses
Spherical lenses parameterized by radii of curvature ($R_1$, $R_2$), center thickness, aperture diameter, and index of refraction ($n$). The `SphericalLens` component accepts these directly and provides `setFromLensType()` for common shape presets (biconvex, planoconvex, planoconcave, meniscus, etc.).

Blockers & Apertures
interact() returns an empty vector to terminate a ray when it intersects a blockers geometry.

Gradient-Index (GRIN) Media
Definition: Material where refractive index $n$ varies with position, e.g., $n(r) = n_0(1 - Ar^2)$.
Implementation: Volumetric Stepping Solver.
Standard linear ray tracing ($P = O + tD$) is invalid inside a GRIN material.
When a ray enters a GRIN volume, the engine switches to a Runge-Kutta (RK4) solver to integrate the Ray Equation: $\frac{d}{ds}(n \frac{d\vec{r}}{ds}) = \nabla n$.
The ray travels in curved arcs until it exits the volume.

Diffraction Gratings
Definition: A surface that splits light based on wavelength.
Implementation: A Diffractive Surface.
Interaction: Ignores standard reflection/refraction.
Applies the Grating Equation: $\sin\theta_m = \sin\theta_i + m\frac{\lambda}{d}$.
Visualization: The "Layout Solver" (Solver 1) splits the ray into primary orders ($m = -1, 0, +1$) to visualize the spread.
Custom Equations (Physics & Geometry)Custom Geometry: handled by the $w = \text{sag}(u,v)$ equation in Local Space.
Custom Physics: Handled by a "Shader" closure in the Surface trait.
The user can provide a function (Ray, HitRecord) -> Ray that overrides standard Snell's Law (e.g., for simulating metasurfaces or non-physical "magic" mirrors).

## Known Bug Patterns

When an `interact()` method creates a child ray using JavaScript's spread operator (`{ ...ray, origin: ..., direction: ... }`), it copies all properties from the incoming (parent) ray — including visualization-only fields like `internalPath`, `terminationPoint`, `entryPoint`, and `interactionDistance`. These fields describe the parent's rendering history, not the child's. The visualizer then draws prism geometry as part of the lens segment, causing phantom rays that appear to "jump back" to a previous component.
**Prevention:** Always use the `childRay()` helper from `types.ts` instead of raw `{ ...ray }` spreads:
**Rule:** If you add new visualization-only fields to the `Ray` interface, add them to `childRay()` in `types.ts`.

React's state lifecycle can call physics methods while position/rotation have been partially updated, producing identity or stale world↔local matrices. Rays then interact with the component as if it were at the origin.
**Fix:** `chkIntersection()` calls `updateMatrices()` before every intersection check, guaranteeing the transform is always fresh. This is slightly wasteful (recomputes even when nothing moved) but eliminates the entire class of stale-matrix bugs.
**Rule:** Never cache world↔local matrices across frames. Recompute on every physics query.
