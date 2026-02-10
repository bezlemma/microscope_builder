## 1. Core Philosophy: 
The "Source of Truth" - The Scene Graph is the only Truth. 

The UI is a viewport.

Physics over Heuristics. Components do not "know" they are part of a microscope. Any lens, including a complex Objective Lens is simply a collection of glass surfaces. It does not enforce focal lengths; the curvature of the glass enforces them physically.

No "Hybrid" Rays. We explicitly separate "Layout Rays" (Geometry) from "Imaging Rays" (Stochastic). They share no logic, only data.

## 2. Coordinate Systems & Units
We utilize two distinct coordinate systems to decouple positioning from geometry.

### A. World Space (The Optics Table)
Used for defining the position of components and the path of rays traveling between components.
Type: Right-handed 3D Cartesian $(x, y, z)$.

$Z$-axis: Height (Normal to the optical table).
Positive Z is "Up" off the table.

$XY$-axis The Table Surface.
Used for placing components (e.g., "The laser is at x=0, y=10").Origin: The center of the optical table.

### B. Light Space (Component Frame)

Used STRICTLY for calculating intersections and surface physics only after coordinate transforms. This simplifies the math by normalizing all components to a standard orientation.
Type: Right-handed 3D Cartesian $(u, v, w)$.

$W$-axis: The Optical Axis.The direction light travels through the component.
For a lens, this is the axis of symmetry.

$UV$ axis: The Transverse Plane. The cross-section of the component.
Equation for a standard lens surface: $w = \text{sag}(u, v)$.

Custom Surfaces: Any surface can be defined by a custom equation $w = f(u,v)$. The Normal vector is derived from the gradient of this function, enabling reflection/refraction on arbitrary shapes.

Any time this transform occurs in the code, great care should be used! This can cause a lot of errors if we use this coordinate space anywhere else by accident.

### C. Units
Position: Millimeters (mm).
Wavelength: Meters (SI) (e.g., $532 \times 10^{-9}$).
Angles: Radians.

## 3. Architecture: Data vs. Systems
The engine is structured like a game engine (ECS pattern). Data is passive; Systems are active.

### A. The Data (Traceable Components)
An "Objective" is not a single entity. It is an Assembly containing multiple Surfaces.
The Ray Struct:
To support polarization, spectral effects, and sensor-aware sampling, the fundamental Ray is defined as:struct Ray {
    origin: Vector3,
    direction: Vector3,
    wavelength: f64,
    polarization: JonesVector, // Complex {x, y}
    intensity: f64,
    optical_path_length: f64,  // Accumulated phase (distance * n). Critical for Solver 4.
    
    // Paper Insight: "Generalized Ray" parameters
    footprint_radius: f64,     // The spatial width of the ray (sigma/beta)
    coherence_mode: Coherence, // COHERENT (sum E-field) or INCOHERENT (sum Power)
    
    // Quantum Parameters (Solver 5)
    entanglement_id: Option<u64>, // Links this ray to a "Twin" ray (Signal <-> Idler)
}

enum Coherence { Coherent, Incoherent }

The Surface Trait:
Every physical object must implement:intersect(ray_local: Ray) -> Option<HitRecord>
Input: A ray already transformed into Local Space $(u, v, w)$.
Output: Interaction point $t$, Normal vector $\vec{N}$.
Note: For custom parametric surfaces, this solves $Ray(t) - Surface(u,v) = 0$ via Newton-Raphson.interact(ray: Ray, hit: HitRecord) -> Vec<RayInteraction>
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

The Transformation Logic:
Each Component stores a WorldToLocal matrix (4x4).API: Users chain methods like .rotate_z(45).translate(10, 0, 0).Under the Hood: These update the matrix. They do not change the geometry equations.
Intersection Pipeline:fn trace(ray_world) {
    // 1. Broad Phase (Fast)
    if !aabb_intersect(ray_world, component.bounds) { return None; }

    // 2. Narrow Phase (Exact)
    ray_local = component.world_to_local * ray_world;
    hit_local = component.intersect(ray_local); 
    hit_world = component.local_to_world * hit_local;
}


### B. Solver 1: The Layout Engine (Interactive UI)
Goal: Instant visual feedback. "Is my mirror aligned?" and "Is my waveplate working?"
Method: Deterministic Vector Ray Tracing.
Ray Count: Low (e.g., 3 rays per source: Center + Marginal +/- NA).Sources: Supports Point, Parallel, Divergent, and Ray sources by varying initial vectors.

Physics:

-Snell's Law (Vector Form).Ray Termination (Blocking/Opacity).
If interact() returns an empty list (e.g., hitting a wall, the back of a mirror, or a closed iris), the ray path ends immediately at that point.
This prevents rays from passing through opaque objects like camera bodies or optical posts.

-Hard Reflections.
We ignore the partial reflection that happens at glass interfaces (the Fresnel effect where ~4% of light reflects). If a surface is a Mirror, it reflects 100%. If it is a Lens, it Refracts 100%.
The Math: The reflection vector $\vec{R}$ is the incident vector $\vec{I}$ flipped over the normal $\vec{N}$.$$\vec{R} = \vec{I} - 2(\vec{I} \cdot \vec{N})\vec{N}$$
Why: In the Layout Engine, we want clean lines. We don't want to spawn millions of faint "ghost rays" reflecting off every lens surface, which would clutter the UI.

-Polarization (Jones Calculus): The Ray carries a Jones Vector. Every interaction updates it (Reflections flip phase, Waveplates retard components).
Visualization: The UI can draw polarization arrows or color-code rays to show state changes instantly.

-No intensity/flux calculations.
-No interference (requires detector screen sampling) or diffraction (requires wave/Gaussian propagation).

### C. Solver 2: The Wave-Equation Engine (Paraxial)

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

### D. Solver 3: The Incoherent Imaging Engine
Goal: Generate the actual pixels the camera sees for standard Microscopy (Fluorescence, Brightfield, Darkfield). Fast and robust.
Method: Reverse Stochastic Path Tracing (Monte Carlo) with Incoherent Integration.
Direction: Camera -> Sample (Backward Tracing).
Algorithm:
Sensor: Select pixel $(x,y)$. Map to World Space position.
Initial State: 
Radiance = 0, Throughput = 1.0.
Polarization: Jones = Camera_Analyzer_State.Footprint: Footprint = Pixel_Size. 
(Trick 1: Backward Gaussian).
Aperture: Sample a random point on the Objective's Entrance Pupil.
Trace: Shoot ray into the system.Integration (Unified Incoherent):
Ray enters Sample Volume.
Step Marching: $dL$.

#### i. Transmission (Shadows & Scattering):
Absorption = Material_Mu_a(P) * dL.
Throughput *= exp(-Absorption).
Scattering (Darkfield Support):
Check prob P_scat = Material_Mu_s(P) * dL.
If scattered: Ray.Direction = SamplePhaseFunction(). This allows the ray to turn and "find" a light source that was previously hidden (e.g., darkfield condenser).

#### ii. Emission (The Glow - Stokes Shift Logic):
The ray (Camera $\lambda_{em}$) hits a fluorophore.
Look up material property: excitation_lambda ($\lambda_{ex}$).

The Cross-Channel Query: Ask Solver 2 for intensity of $\lambda_{ex}$ at this point.
Ex_Intensity = Solver2.Query(P, lambda_ex).
Emission = Fluorophore_Density(P) * Ex_Intensity * dL.Radiance += Emission * Throughput.
Termination (The Global Field Query):
When the ray exits the Sample Volume (or hits no other geometry):
It performs a generic query of the Global Light Field generated by Solver 2.

Optimization (Acceleration Structure): For high-resolution sensors (>512px), use a Light Field BVH. For low-resolution (<256px), Brute Force checking of all beams is acceptable.
The Query: Iterate through nearby active Solver 2 Beam Segments matching Ray.wavelength ($\lambda_{em}$).
Spatial Check: Is point $P$ within beam width $w(z)$?
Angular Check: Is ray direction $D$ aligned with beam direction (within divergence $\theta$)?Source_Intensity = Sum(Matching_Beams).
Incoherent Summation: Final = Radiance + (Throughput * Source_Intensity).Polarization_Alignment = | dot(Ray.Jones, Source.Jones) |^2.Final_Pixel += Throughput * Source_Intensity * Polarization_Alignment.

### E. Solver 4: The Coherent Imaging Engine
Goal: Visualize complex interference phenomena (Phase Contrast, Holography, DIC). Slower, experimental "Hard Mode".
Method: Reverse Stochastic Path Tracing with Coherent Amplitude Summation.
Key Difference: Tracks Complex Electric Field $E$ instead of Intensity $I$. Sums amplitudes before squaring.
Algorithm: Sensor & Trace: Same as Solver 3.
Integration (Splitting Logic):
When a ray hits a Phase Object (Sample with refractive index gradient $\nabla n$):Deterministic Split:
Ray A (Direct/Ballistic): Continues straight. Accumulates Phase: $\phi += n(P) \cdot dL$.
Ray B (Diffracted/Scattered): Scatters based on $\nabla n$. Accumulates Phase: $\phi += n(P) \cdot dL$.
Both rays are traced independently back to the source.
Termination (Coherent Handshake):
When rays hit the Source Field (Solver 2):Amplitude = sqrt(Source_Intensity).Phase = Ray.
Accumulated_Optical_Path_Length.
Complex_E = Amplitude * exp(i * k * Phase).
Recombination:
E_total = E_Direct + E_Diffracted.Final_Pixel_Intensity = |E_total|^2.
Effect: If the Direct ray passes through a Phase Ring (shifting phase by $\pi/2$), the interference term $2 \text{Re}(E_1 E_2^*)$ becomes non-zero, creating the halo contrast characteristic of Phase Contrast microscopy.

### F. Solver 5: The Quantum Correlation Engine
Goal: Visualize Quantum phenomena relying on non-local correlations (Ghost Imaging) or modified statistics (Squeezed Light).
Method: Forward/Backward Hybrid Tracing with Coincidence Tracking.
Key Concept: Rays are not independent. They exist in Entangled Pairs.
Scenario: Ghost Imaging
Source (SPDC): Generates Ray Pair $(A, B)$ with entanglement_id.Ray A (Signal): Sent to Object.Ray B (Idler): Sent to Camera.
Trace Ray A:
Interacts with Object (Blocked/Passed).Hits Bucket Detector (Single Pixel, no spatial info).Result: Stores Detection_State = True/False for entanglement_id.
Trace Ray B:
Travels freely to Camera (Array).Hits Pixel $(x,y)$.
Coincidence Logic:
Camera Pixel $(x,y)$ adds intensity only if Ray_A_Detection_State == True.
Result: The image of the object appears on the camera, despite the camera ray never touching the object.Scenario: Squeezed Light / Sub-Shot NoiseStandard solvers use Poissonian random number generation for photon counts ($Var = N$).
Solver 5 modifies the Monte Carlo estimator to sample from Sub-Poissonian distributions ($Var < N$) based on the Squeezing Parameter of the source.
Visual Result: Images appear "cleaner" (higher SNR) at lower light levels than physically allowed by classical physics.

### G. The Solver Handshake: Infinite Resolution
How do we simulate a 1-micron sample spot inside a 1-meter table without running out of RAM? We rely on Analytic Queries, not voxel grids.
The Query: When Solver 3/4 steps through a sample at a specific point $P_{sample}(x,y,z)$, it queries Solver 2.The Calculation: Solver 2 does not look up a value in a texture. It performs an on-the-fly geometric calculation:
-Find the nearest Beam Segment (from the Ray Tree) matching the queried wavelength.
-Project $P_{sample}$ onto the beam axis to find $z_{local}$ and $r_{local}$ (distance from axis).-Evaluate the Astigmatic Gaussian Intensity Equation, including Beer-Lambert Decay:$$I(x_{loc}, y_{loc}, z) = P(z) \frac{w_{0x} w_{0y}}{w_x(z) w_y(z)} \exp \left( -2 \left( \frac{x_{loc}^2}{w_x(z)^2} + \frac{y_{loc}^2}{w_y(z)^2} \right) \right)$$
Where $P(z)$ is the axial power at depth $z$, already attenuated by the absorption coefficient $\mu$ of the medium:$$P(z) = P_{entry} \cdot e^{-\mu z_{local}}$$
The Result: Infinite spatial resolution with physically correct absorption depth and Light Sheet support (Astigmatism).

## 4. Specific Optical Corrections

The "Infinity Space" Problem

Camera is just a flat sensor. It detects where rays hit.
The Tube Lens: Must be a physical lens component placed before the camera.
The Objective: A Lens Assembly (Curved Front Element + Paraxial Phase Sheet).Result: Light leaving the objective is parallel (Infinity Space). Light hitting the Tube Lens focuses onto the Camera.
Benefit: If the user removes the Tube Lens, the image becomes a blur (correct behavior).

Dichroics & Filters
Reflectance is a function of wavelength.
During Path Tracing (Solver 3), the ray carries a specific target_wavelength (e.g., Emission Green).If it hits a Dichroic (Long-pass Red), the Green ray reflects.

Phase Contrast (Coherent Splitting)
Goal: Visualize phase objects (transparent cells) by converting phase delay to amplitude contrast.
Mechanism: * Condenser Annulus: Source of light.
Phase Ring: Physical object at Objective BFP with Transmission < 1.0 and Phase Shift $\pi/2$.
Simulation: Requires Solver 4 (Coherent Imaging).
At the sample, rays split into Direct (Undiffracted) and Scattered (Diffracted).Direct Ray: Travels straight $\to$ Hits Phase Ring at BFP $\to$ Phase Shifted.
Scattered Ray: Scatters $\to$ Misses Phase Ring at BFP $\to$ No Shift.
Recombination: At the detector, $E_{total} = E_{direct} + E_{scattered}$. Interference creates contrast.

## 6. Advanced Component Definitions

Ideal Components (The "Thin" Approximation)
Definition: A surface that obeys the ideal lens equation $\frac{1}{f} = \frac{1}{d_o} + \frac{1}{d_i}$ without geometric thickness.
Implementation: A Phase Surface.
Geometry: Flat plane ($w=0$).
Interaction: Instead of Snell's Law, it explicitly alters the ray's angle: $\vec{v}_{out} = \vec{v}_{in} - \frac{h}{f} \hat{r}$, where $h$ is distance from axis.
Usage: For simplified "textbook" simulations or defining generic objectives.

Thick Lenses (Defined by Focal Length)
Definition: Real spherical lenses defined by user-friendly parameters like "Front Focal Distance" (FFD).
Builder Logic: Component Catalog. The Physics Engine only understands Curvature ($R$) and Index ($n$). The UI provides a "Catalog" of commercial objectives (e.g., Nikon 10x, 20x). Dragging one instantiates a Compound Component containing the specific sequence lenses needed to make that objective. Users do not parametrically generate objectives; they select them.

Blockers & Apertures
Definition: Objects that stop light.
Implementation: Opaque Surface.
Geometry: Any shape (Plane for walls/irises, Cylinder for posts).Interaction: interact() returns an empty vector.
Result: The ray is terminated. Solver 1 stops drawing the line. Solver 2 stops the beam mesh (or resets it if clipping, see 3.C).

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

## 7. Extended Physics Support
Polarization (Jones Calculus)Data: The Ray struct carries a complex Jones Vector $\vec{J} = \begin{bmatrix} E_x \\ E_y \end{bmatrix}$.
Interaction: Every component implements get_jones_matrix(ray) -> Matrix2x2.Linear Polarizer: Projects vector onto axis.
Waveplate: Adds phase delay to one axis ($e^{i\phi}$).
Reflection: Applies Fresnel coefficients for $s$ (perpendicular) and $p$ (parallel) polarization states separately.
Visualization: Users can visualize "Intensity" ($|\vec{J}|^2$) or specific components.

Non-Linear Optics (Two-Photon & SHG)Two-Photon Excitation (2PE):Handled in Solver 3 (Imaging).Integration logic changes from Intensity * Density to (Intensity^2) * Density.
Requirement: Requires Solver 2 to have computed a valid 3D intensity map $I(x,y,z)$.Second Harmonic Generation (SHG):Handled as a probabilistic wavelength shift event.
Inside an SHG Crystal Volume: Prob_Convert = Efficiency * Intensity * PhaseMatch(angle).If event triggers: Ray.wavelength /= 2.

## 8. Mathematical Appendix: The Generalized Solvers

### 8.1 Broad Phase (AABB Collision)
The "Eye" of the Engine. Before performing expensive matrix transforms, we check if the ray passes near the object using an Axis-Aligned Bounding Box (Slab Method).
Resolution Note: This is an Analytic Solver, not a discrete step solver. It has infinite resolution. Even if a wall is $10^{-9}$ mm thick, the math detects the intersection accurately. It does not "skip" thin or small objects.
Given: Ray $P(t) = O + t \vec{D}$ (where $\vec{D}$ is the normalized Direction Vector), Box $[min, max]$.
Logic: For each axis ($x, y, z$), find the entry ($t_0$) and exit ($t_1$) distances.
$$t_0 = \frac{Box_{min} - O}{\vec{D}}, \quad t_1 = \frac{Box_{max} - O}{\vec{D}}$$
Intersection: The ray hits if the max of the entry points is less than the min of the exit points.
$$t_{enter} = \max(t_{0x}, t_{0y}, t_{0z}), \quad t_{exit} = \min(t_{1x}, t_{1y}, t_{1z})$$$$\text{Hit} \iff t_{enter} \le t_{exit} \land t_{exit} > 0$$

### 8.2 Narrow Phase (Local Sphere Intersection)
Once inside the Local Frame $(u,v,w)$, intersecting a spherical lens surface is a quadratic equation.
Sphere Equation: $u^2 + v^2 + (w - R)^2 = R^2$ (Sphere centered at $0,0,R$).
Ray Equation: $P(t) = O + tD$.
Substitute & Expand:$$A t^2 + B t + C = 0$$$$A = |\vec{D}|^2 = 1 \text{ (if normalized)}$$$$B = 2 (\vec{O} \cdot \vec{D} - D_w R)$$$$C = |\vec{O}|^2 - 2 O_w R$$
Solve: $t = \frac{-B \pm \sqrt{B^2 - 4AC}}{2A}$.
Result: Smallest positive $t$ is the intersection point on the glass.

### 8.3 Refraction (Vector Snell's Law)
Used to calculate the new ray direction $\vec{v}_{out}$ given incoming direction $\vec{v}_{in}$, surface normal $\vec{N}$, and index ratio $r = \frac{n_1}{n_2}$.$$\vec{v}_{out} = r \vec{v}_{in} + \left( r c - \sqrt{1 - r^2 (1 - c^2)} \right) \vec{N}$$Where: $c = -\vec{N} \cdot \vec{v}_{in}$ (Cosine of incident angle).
Total Internal Reflection: Occurs if the term under the square root $1 - r^2(1 - c^2) < 0$. In this case, the ray reflects instead.

### 8.4 Acceleration Structures (The Light Field Grid)
To prevent Solver 3/4 from iterating through thousands of Solver 2 beams ($O(N)$), we rasterize the Light Field.
Structure: A sparse voxel grid (or Linear BVH) storing indices of active Beam Segments.
Grid Resolution: Coarse (e.g., $10mm^3$ cells).
Query Logic: Solver 3 finds the voxel for point $P$. It only iterates over the beams listed in that voxel.
Performance: Reduces complexity to $O(1)$ or $O(\log N)$, essential for real-time framerates in complex scenes (microlens arrays, diffusers).
Optimization Note: For low resolution sensors (<256px), simple Brute Force iteration is acceptable and easier to implement.

## 9. Ray Branching & Culling Strategy

When does a ray split? We use strict rules to prevent exponential explosion.

Deterministic Splits (True Branch):
The Logic: Any Surface.interact() that returns >1 ray triggers a split. This is not limited to specific "Beam Splitter" objects.

Custom Shapes: A user can define a custom geometric shape with a "Partial Mirror" material (e.g., 75% Reflect, 25% Transmit). Because the material interaction returns 2 rays, the engine will deterministically trace both paths.

Diffraction Gratings: Create child rays for orders $m = -1, 0, 1$.Result: Solver 1 adds all children to the trace queue. Solver 2 clones its state for each child.

Spectral Dispersion (Implicit Split):Prisms: Do not split a single ray. A Ray is monochromatic.

White Light Implementation: To simulate dispersion, a "White Light Source" is implemented as a Bundle Emitter. It creates 3+ discrete rays (Red, Green, Blue) with identical origins and directions. As they travel through the system, dispersion happens naturally because $n_{red} \neq n_{blue}$ in glass.

Stray Rays (Culling):Fresnel Reflections: A standard lens surface reflects ~4% of light. In Solver 1, we cull this reflection and only trace the refracted path.

Threshold: The split logic respects a "Significance Threshold" (e.g., >10% energy). If a custom coating reflects 25%, it splits. If it reflects 4%, it is culled unless "Debug Ghosts" is enabled.

## 10. Theoretical Validation: "Generalized Rays"
Our architecture is validated by recent research in Computer Graphics (e.g., NVIDIA 2023, "Generalized Rays"), which formalizes the optimal way to blend ray tracing with wave optics.

Trick 1: Backward Gaussian Beams (Sensor-Aware Sampling).
The Problem: Tracing infinitely thin rays backwards (Solver 3) causes aliasing artifacts when viewing diffractive surfaces (like gratings).
The Fix: Solver 3 rays carry a footprint_radius (equivalent to the paper's $\beta$). This represents the pixel's sensitivity cone. When a ray hits a diffractive surface, this footprint is used to filter the interference pattern, solving the sampling problem.

Trick 2: The "Sample-Solve" Hierarchy.
The Insight: The paper separates finding the path ("Sample") from calculating the wave physics ("Solve").Our Design: This validates our hierarchy. 
Solver 1 finds the path (Sample). 
Solver 2 calculates the physics (Solve). 
Solver 3 integrates the result.

Trick 3: Validity of Ray Tracing.
The Assumption: The paper validates that standard Ray Tracing is mathematically sound for propagating wave packets as long as the beam width is small compared to geometric features. This justifies our decision to "Slave" Solver 2 to Solver 1's geometric path.

## 11. Debugging Tools To assist in understanding why an image is black or distorted, the engine provides introspection tools.

### 11.1 The "Magic Card"
Goal: Visualize the invisible beam of Solver 2.
Action: User inserts a virtual card into the optical path.
Result: Displays the beam cross-section, polarization ellipse, and intensity profile graph at that specific Z-plane.