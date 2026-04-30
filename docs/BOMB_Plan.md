# BOMB Physics Engine

This is a program to help plan, lay out, understand and tweak optical tables when building microscope setups. Physical fidelity and ease of use are key. The program is not for the design of new optical parts or automated optimizations. It's meant to augment actually sitting at an optical table and trying things, but in a digital environment you don't need to buy expensive parts to try something, and you don't risk blinding yourself looking at what the laser is doing.

Main inspirations are UniRW 2026 and Wave Tracing 2026

Wave Tracing 2026 uses rods instead of rays for tracing. This lets paths have some non-locality, and we can program interactions with things like small apertures. The rods carry phase, amplitude, and polarization through the entire optical path.

UniRW 2026 uses an E&M solver to compute the coherent field at specific planes. We use this at the sample, at viewing cards, and at cameras — anywhere the user needs to see wave-optical reality rather than geometric paths.

Three distinct terms are used throughout this plan to avoid ambiguity:

- **Rod**: the computational primitive. A Steinberg-style elliptical cone with finite cross-section, carrying amplitude, phase, polarization, wavelength, and bandwidth. This is what the Rod Tracer traces. A rod is *not* a classical ray — it has non-local awareness of nearby geometry.
- **Laser beam**: the macroscopic physical thing that comes out of a laser or lamp. A laser beam is represented by hundreds of rods distributed across its cross-section.
- **Bundle**: a group of co-traveling rods from the same source, used for visualization. Bundles are drawn as filled regions bounded by their outermost rods, and can display aggregate properties like phase, polarization, and wavelength.


## 1. Core Philosophy:

1. The program must be as physically accurate as possible.
2. Parts do not "know" they are part of a particular microscope. No `if (isConfocal)` anywhere.
3. All data that is being calculated should be represented to the user. The UI is always a faithful viewport to the physics and data.
4. When necessary, layers of solvers can be enabled to tackle niche optics.
5. The simulation runs two passes every frame. A forward pass populates the scene with rod packets from every source. A reverse pass launches one probe packet per detector pixel that intercepts the forward field wherever they meet. Both passes accumulate coherently across frames — longer the user inspects a scene, sharper the image. There are no single-shot pipelines and no "Generate Image" button.

## General Approach

BOMB is a browser-based optical table simulator. The user places components — lenses, mirrors, apertures, samples, detectors — on a virtual table and sees physically correct light propagation, PSFs, and microscope images.

- A microscope consists of light sources (lasers, lamps), samples (flourescent, or not), and detectors (cameras, PMTs, viewing cards). There are many parts (lenses, mirrors, apertures) that may be on the table as well. What we care about is going from light sources, through samples, to the detectors.

- Strictly speaking, only the light source is necessary for anything to happen. A light source with parts might demonstrate a laser beam expander. A light source with a detector and no sample might teach you about a PSF. But a sample without a detector is not particularly interesting.

- This is built as an application for a computer web browser, with secondary use on a phone browser. Current architecture: Vite + React + TypeScript, Three.js + R3F for visualization, compiled with Bun. Higher solvers may be implemented in Rust and compiled to WebAssembly for browser execution.

- We are constantly iterating on this, changing solvers, architectures, even languages, so modularity is key.


## Units and Coordinates

Position: millimeters (mm).
Wavelength: meters (SI) (e.g., $532 \times 10^{-9}$).
Angles: radians.

**World Space (The Optics Table)**: $(x, y, z)$. Positive $z$ is "up" off the table. The $xy$-plane is the table surface.

**Light Space (Part Frame)**: $(u, v, w)$. The $w$-axis is the optical axis — the direction light travels through the component. For a lens, this is the axis of symmetry. The $uv$-plane is the transverse plane. Equation for a standard lens surface: $w = \text{sag}(u, v)$.

These two coordinate systems must never be mixed. World-to-local and local-to-world transforms happen at the boundary of each part's `interact()` call. Rods are always stored in world coordinates.

## Controls

Bare left click is reserved for interacting with objects, and should not do anything else (should not rotate the camera for instance).
Right click is reserved for a menu one day, and should not do anything else.
Shift+left click or middle click+drag should pan.
Ctrl+left click should rotate.
If selecting an object, alt-left click should snap to the object being centered on the nearest hole.
Holding left click and then using scroll wheel rotates the part along its $z$ (up, world) axis by Lets 5 degrees per scroll click.

Be careful when implementing these, Three.js has a tendency to override this stuff.

# Solver Architecture

BOMB runs two passes every animation frame: a **forward pass** and a **reverse pass**. Both use Steinberg-style elliptical Gaussian rod packets as their transport primitive.

**The forward pass** launches rods from every source (laser, lamp, etc.) using a hex-lattice Gabor frame, propagates them through the scene, and records their final state as a set of forward-rod packets distributed through space. Rods interact with smooth surfaces (refraction, reflection) and with thin-mask silhouette edges (direct amplitude reduction, no angular children). The forward rods collectively represent the scene's electromagnetic field — except inside sample volumes, where the forward field is represented as dense PPS slice fields (§Step 2, below).

**The reverse pass** launches one probe packet per detector pixel per frame. Each reverse packet propagates upstream through the scene. Wherever it meets the forward field, it collects a contribution via one of three **intercept operators**:

1. **Free-space intercept** — complex Gaussian overlap between the reverse packet and a forward rod packet.
2. **Silhouette-edge intercept (BDW)** — Maggi–Rubinowicz line integral along the rim, weighted by the forward-field value at each rim point.
3. **Sample-volume intercept** — Step 4 adjoint readback of the PPS slice field at each slice the reverse packet crosses.

The three contributions sum coherently (within each sourceId×wavelength group) into the pixel's complex field buffer. Across frames, those buffers accumulate — display intensity is the squared magnitude of the per-group complex sum, divided by the squared frame count, summed across groups.

The forward pass does not know the reverse pass exists. The reverse pass reads the forward field via a BVH snapshot built at the end of each forward pass. The two are decoupled in software but share a single physical model: rods discretize the coherent field, and the intercept operators are the standard adjoint readback of that field.

**Why this architecture:** a detector pixel's response is an integral over the field it receives. In the classical ray-tracing picture, that integral is approximated by sampling the forward field at the detector plane. For most optical scenes this works, but for any scene where important contributions arrive via geometric paths the forward sampling misses (Poisson shadow, dark-field imaging, non-trivial pupil masks), forward-only sampling cannot produce the right answer. Reverse packets that intercept the forward field along their entire path — including at edges, where they trigger the BDW operator — recover the missing contributions automatically.

**Why Steinberg rods (not classical rays) matter for this architecture:**

A classical ray passing through an aperture carries the same phase whether it passed 1μm or 1mm from the edge. A Steinberg rod whose cone overlapped the edge carries a *different* phase — modified by the UTD diffraction interaction. Reverse packets whose cones clip a silhouette edge invoke the BDW operator directly, reading the forward field at the rim and producing the boundary-wave contribution that fills diffraction shadows. Classical rays cannot do this; Gaussian packets are essential.

### Representation Consistency Rule

Rods are a phase-space packet representation of the optical field.

The E&M solver reconstructs a continuous field from rods using packet synthesis.

Field-to-rod readback uses the adjoint packet operator.

Changing rod count must converge to the same physical field.

This ensures that rods approximate a well-defined electromagnetic field rather than an arbitrary sampling.


## Rod Tracer

### Forward Tracing

Forward tracing launches rods from light sources at every animation frame, with a per-frame Halton-offset applied to the source hex-lattice. Rods split at beam splitters, partial reflections, and dichroics; terminate at blockers and absorbers; escape to infinity if they miss all geometry. Thin-mask silhouette edges (aperture, slit, blocker rim) reduce each clipped rod's direct amplitude by the truncated-Gaussian transmission fraction. Edge diffraction shows up in the final image via the reverse pass, not via forward angular children.

### Reverse Tracing

Reverse tracing launches one Gaussian probe packet per detector pixel per frame. The packet starts at the pixel centre (with sub-pixel Halton jitter between frames), pointed along the detector's inward normal, with initial σ = half the pixel pitch and collimated Q-state (flat wavefront). The packet propagates upstream through the scene. At every interaction it does one of the following:

- **Free space** (most of the scene): BVH query finds forward rods whose 3σ cone support overlaps the reverse packet somewhere along its propagation segment. For each overlapping forward rod, one 2D Gaussian overlap integral on the natural shared plane (through the forward rod's centroid, perpendicular to its direction) gives a complex contribution. Accumulate into the pixel's buffer for that `(sourceId, wavelength)`.
- **Silhouette edge** (aperture, slit, blocker rim): the reverse packet's cone clips the edge. Fire the BDW operator: line integral along the clipped edge, weighted by the forward-field value at each rim point (read from forward rods via single-point Step-4 adjoint), UTD coefficient, and reverse-packet Gaussian envelope at the rim. Accumulate into the same buffer; continue tracing past the edge.
- **Smooth refractive or reflective surface**: reverse packet refracts (reciprocal Snell + reciprocal Fresnel) or reflects. Packet Q updates. Continue tracing.
- **Beam splitter / dichroic**: reverse packet splits into two children, each taking one reciprocal input arm.
- **Sample volume**: at each PPS slice the reverse packet crosses, 2D adjoint readback integrates the packet against the PPS-propagated forward field; add to coherent buffer. Scalar $|b_p|^2 \cdot S(\rho) \cdot \Delta z$ adds to the incoherent buffer at the same slice for fluorescence emission.

The reverse packet terminates when it exits the scene bounding box, its accumulated amplitude drops below a weight threshold, or it reaches a maximum bounce depth.

**Reverse tracing runs continuously, every frame, for every detector in the scene.** There is no "Generate Image" button. Cameras and PMTs support a "snapshot" action that freezes the current accumulated buffer at higher resolution, but the pipeline is always live.


### The Rod Primitive: Elliptical Cone

Following Steinberg (Wave Tracing 2026), the transport primitive is an **elliptical cone** — a ray with a finite, elliptical cross-section that grows linearly with propagation distance.

The reference implementation is in Steinberg's source: `src/math/elliptic_cone.cpp` (cone geometry, construction via `cone_through_ellipse` and `cone_through_ellipsoid`) and `src/beam/beam.cpp` (surface footprint computation via `surface_footprint_ellipsoid`).

An elliptical cone is defined by six quantities:

- **Ray**: origin $\mathbf{o} \in \mathbb{R}^3$ and unit direction $\hat{\mathbf{d}}$. This is the centroid of the rod.
- **Major axis direction** $\hat{\mathbf{u}}_0$: a unit vector perpendicular to $\hat{\mathbf{d}}$, defining the orientation of the elliptical cross-section in the transverse plane. The minor axis is $\hat{\mathbf{v}}_0 = \hat{\mathbf{d}} \times \hat{\mathbf{u}}_0$.
- **Reference radius** $l_U$: the semi-major axis length (mm) of the cross-section at the reference point.
- **Half-angle** $\tan\alpha$: the tangent of the cone's half-opening angle. Controls how fast the cross-section grows with distance.
- **Eccentricity parameters** $e_u, e_v$ with $e_u \cdot e_v = 1$: control the ellipticity. A round rod has $e_u = e_v = 1$.

At propagation distance $t$ from the origin, the cross-section is an ellipse with semi-axes:

$$a(t) = (l_U + t \cdot \tan\alpha) \cdot e_u$$
$$b(t) = (l_U + t \cdot \tan\alpha) \cdot e_v$$

The cross-section grows linearly with $t$ because it is a cone. For optical-wavelength rods ($\tan\alpha \sim \lambda/w \sim 5 \times 10^{-4}$), growth is slow: ~50μm per 100mm of propagation. This is the wave-optical non-local awareness radius — the region of space a photon "knows about" for diffraction purposes.

**The cone half-angle $\tan\alpha$ does not change at refractive surfaces.** It represents the wavelength-scale non-locality, not the geometric divergence. The visible convergence or divergence of the macroscopic laser beam on the table is emergent from the ensemble of rod centroids.


#### Gaussian Wavefront Envelope

Each cone carries a **Gaussian wavefront** that weights the rod's amplitude across its cross-section:

$$A(u, v) = A_0 \exp\!\left(-\frac{u^2}{2\sigma_u^2} - \frac{v^2}{2\sigma_v^2}\right)$$

where $(u, v)$ are coordinates in the rod's local transverse frame (along $\hat{\mathbf{u}}_0$ and $\hat{\mathbf{v}}_0$), and $\sigma_u, \sigma_v$ are the Gaussian widths. The cone's geometric boundary extends to approximately $3\sigma$ (>99% of energy), following Steinberg's `beam_cross_section_envelope` constant in `src/beam/gaussian_wavefront.hpp`.

This envelope is used in two places:
1. **Free-space diffraction**: edges near the rod center contribute more strongly than edges at the periphery, weighted by $A(u_\text{edge}, v_\text{edge})$. See `src/interaction/fsd/fraunhofer/free_space_diffraction.cpp`.
2. **Surface footprint**: the rod's footprint on a surface is the cone-surface intersection, weighted by the Gaussian envelope. See `src/beam/beam.cpp: surface_footprint_ellipsoid()`.


#### Rod State

Each rod carries:

| Field | Type | Description |
|-------|------|-------------|
| origin | Vec3 | Centroid position (mm, world) |
| direction | Vec3 (unit) | Propagation direction (world) |
| majorAxis | Vec3 (unit) | Transverse major axis $\hat{\mathbf{u}}_0$ (⊥ direction, world) |
| majorLength | f32 | Semi-major axis at reference $l_U$ (mm) |
| tanAlpha | f32 | Cone half-angle tangent |
| eU, eV | f32, f32 | Eccentricity ($e_u \cdot e_v = 1$) |
| wavelength | f32 | Central wavelength (m, SI) |
| bandwidth | f32 | Spectral bandwidth (m, SI). Zero for laser rods. ~10nm for lamp or fluorescence rods. |
| powerWeight | f32 | Optical power assigned to this rod packet |
| phase | f32 | Accumulated on-axis phase at the central wavelength (radians) |
| OPL | f32 | Total optical path length (mm). The E&M Solver can compute $\phi(\lambda) = 2\pi \cdot \text{OPL} / \lambda$ for any $\lambda$ within the rod's bandwidth. |
| polarization | Jones (4 × f32) | $E_u$: re, im; $E_v$: re, im. Transverse to the rod's propagation direction. The E&M Solver promotes this to a full 3-component field when constructing the field on a grid. |
| sourcePosition | Vec3 | Position on the source where this rod originated (mm, world). Used for visualization metadata. |
| sourceId | string | Originating source component ID. Also identifies which independent emitter this rod belongs to. |

`powerWeight` is the primary conserved optical quantity for source discretization. The same physical beam represented with more rods must converge to the same reconstructed field; changing rod count is a refinement of the representation, not a change to the source itself.


### Coherence Model

There is no explicit coherence factor or coherence label. The E&M Solver reconstructs the field from all rods present at the evaluation plane:

$$\mathbf{E}(\boldsymbol{\rho}) = \sum_j q_j \, \mathbf{b}_j(\boldsymbol{\rho})$$

where $\mathbf{b}_j$ is the finite field packet associated with rod $j$ and $q_j$ is its complex coefficient.

Coherence and incoherence emerge from the phase relationships among those coefficients — not from labels assigned at the source.

**Why this works:** Two rods from a coherent laser that pass through the same optics arrive with smoothly related phases and directions. Their packets add constructively or destructively in a structured way, producing interference. Two rods that passed through a diffuser may have scrambled phases and directions; their cross-terms fluctuate rapidly and produce speckle, which is physically correct for coherent light through a static scatterer.

**Temporal coherence** is captured by the spectral dependence of the rod phases through stored OPL. Two broadband rods with different OPL values accumulate different phases at each wavelength within their bandwidth. When the solver runs at multiple wavelengths and sums intensities, temporally incoherent contributions wash out naturally.

**Polarization coherence** falls out from the vector sum: orthogonally polarized contributions do not interfere, parallel components do.

**Independent emitters:** Physically independent emitters have no fixed phase relationship. These are handled differently depending on how many there are:

- **For a laser**: one emitter. One pipeline run is exact.
- **For a lamp**: each spatial source point on the filament or LED is an independent emitter. These are enumerated explicitly: run the pipeline once per source point and sum the resulting intensities. This is a controlled approximation to partially coherent illumination whose accuracy improves as source-point sampling is refined.
- **For fluorescence**: each emitting voxel is an independent emitter. There are too many voxels to enumerate, so fluorescence is handled by the backward detection PPS in Step 3, which computes the incoherent fluorescence image deterministically.

Rods carry `sourceId` to identify which independent emitter they belong to. The `sourcePosition` field is retained for visualization metadata and is not used directly in the coherence computation.

**Coherent frame accumulation.** The reverse pass accumulates complex contributions into a per-detector, per-coherent-group buffer every frame. Within a group, contributions sum as $\mathbf E_{\text{group}}^{(N)} = \sum_{f=1}^N \mathbf E_{\text{group}}^{(f)}$, and display intensity uses $|\mathbf E_{\text{group}}^{(N)}/N|^2$. This preserves all interference structure across frames. Summing intensities per frame and averaging later would destroy inter-frame coherence and reduce the accumulation to noise averaging — which is why the complex sum is the core primitive.


### Rod-Surface Interaction

At every surface, each rod independently computes its own interaction. There is no global rod management.

#### Constructing the Outgoing Cone After a Surface Hit

After any interaction (refraction, reflection, diffraction), the outgoing rod is constructed following the algorithm in `src/math/elliptic_cone.cpp: cone_through_ellipse()`:

1. Compute the **surface footprint**: intersect the incoming cone with the surface plane. The intersection is an ellipse. Extract its principal axes and semi-axis lengths via SVD of the projected cross-section.
2. **Construct the outgoing cone** passing through this footprint ellipse with the new propagation direction. The eccentricity and major axis orientation come from the SVD of the footprint projected into the outgoing rod's transverse frame.
3. **Preserve $\tan\alpha$**.
4. **Compute self-intersection distance** to avoid hitting the same surface on the next trace step.


#### Smooth Refractive Surfaces (Lenses, Prisms)

1. **Centroid intersection**: trace the centroid ray against the actual curved surface geometry (ray-sphere for spherical surfaces, ray-plane for flat faces, ray-mesh for general shapes via BVH). This gives hit point $\mathbf{p}$ and local surface normal $\hat{\mathbf{n}}$.

2. **Vectorial Snell's law** at the centroid, using the rod's central wavelength $\lambda_\text{center}$ (exact, not paraxial). The refractive index used is $n = n(\lambda_\text{center})$, allowing dispersion when refractive index models provide wavelength-dependent values.

$$\hat{\mathbf{d}}_t = \frac{n_1}{n_2}\hat{\mathbf{d}}_i + \left(\frac{n_1}{n_2}\cos\theta_i - \cos\theta_t\right)\hat{\mathbf{n}}$$

where $\cos\theta_i = -\hat{\mathbf{d}}_i \cdot \hat{\mathbf{n}}$ and $\cos\theta_t = \sqrt{1 - (n_1/n_2)^2(1 - \cos^2\theta_i)}$. If $\cos^2\theta_t < 0$: total internal reflection.

Steinberg's dielectric BSDF implementation: `src/bsdf/dielectric.cpp`.

3. **Fresnel coefficients**:

$$r_s = \frac{n_1\cos\theta_i - n_2\cos\theta_t}{n_1\cos\theta_i + n_2\cos\theta_t}, \quad r_p = \frac{n_2\cos\theta_i - n_1\cos\theta_t}{n_2\cos\theta_i + n_1\cos\theta_t}$$

$$t_s = 1 + r_s, \quad t_p = \frac{n_1}{n_2}(1 + r_p)$$

Before applying the Fresnel matrix, the rod's polarization basis must be rotated into the local s–p frame defined by the plane of incidence. After the interaction, the polarization basis is rotated back into the rod's transverse $(u, v)$ frame associated with the new propagation direction. Between interactions, the polarization basis is parallel-transported with the rod direction so that polarization remains transverse to the propagation vector.

Jones vector updated: $\mathbf{J}_\text{out} = \text{diag}(t_s, t_p) \cdot \mathbf{J}_\text{in}$ (in the s–p frame).

If reflected power $R = (|r_s|^2 + |r_p|^2)/2$ exceeds a threshold (e.g. 0.5%), spawn a reflected child rod.

4. **Outgoing cone**: construct via `cone_through_ellipse` (see above).

5. **Phase and OPL update**: $\text{OPL} \mathrel{+}= n \cdot d$ where $d$ is propagation distance. Phase at central wavelength: $\phi \mathrel{+}= k_0 \, n \, d$ where $k_0 = 2\pi/\lambda_\text{center}$. The E&M Solver can recompute phase at any wavelength within the bandwidth from the stored OPL.

Each rod in the ensemble hits at a different point on the lens surface, sees a different surface normal, and refracts at a different angle. Focusing, aberration, coma — all emergent.

A rod does not need to spread at a dispersive surface (prism). It traces using its central wavelength. The ensemble of rods at different wavelengths produces the correct dispersion: different-wavelength rods refract at slightly different angles, and the macroscopic beam visibly fans out.


#### Reflective Surfaces (Mirrors)

Outgoing direction:

$$\hat{\mathbf{d}}_r = \hat{\mathbf{d}}_i - 2(\hat{\mathbf{d}}_i \cdot \hat{\mathbf{n}})\hat{\mathbf{n}}$$

The same polarization frame rotation applies: rotate into the s–p frame, apply the reflection Jones matrix $\text{diag}(r_s, r_p)$, rotate back into the new rod frame. For a perfect mirror, $r_s = -1, r_p = 1$.


#### Blockers and Opaque Surfaces

The rod terminates. In the ensemble, rods that hit a blocker die and rods that miss continue. The clipped beam shape is emergent.


#### Apertures and Edges — Free-Space Diffraction (FSD)

When a rod's cone overlaps an edge (the centroid may pass through freely, but the cross-section clips the edge), the UTD rod-matter interaction occurs. Following Steinberg's FSD pipeline, implemented in `src/interaction/fsd/free_space_diffraction.cpp` (UTD-based) and `src/interaction/fsd/fraunhofer/free_space_diffraction.cpp` (Fraunhofer-based):

**1. Edge detection.** BVH cone traversal (in `src/ads/bvh8w.cpp`) finds all triangles and edges overlapping the rod's cross-section, even those the centroid misses. Each edge is recorded in the intersection record.

**2. Aperture construction.** For each detected edge:
- Project endpoints into the rod's local transverse frame $(u, v)$.
- Clamp to the rod's cross-section ellipse (ellipse-segment intersection).
- Subdivide: any segment longer than ~$\frac{1}{3}$ of the cross-section radius is split.
- Only silhouette edges: $(\hat{\mathbf{d}} \cdot \hat{\mathbf{n}}_1)$ and $(\hat{\mathbf{d}} \cdot \hat{\mathbf{n}}_2)$ have opposite signs.

**3. Gaussian amplitude weighting.** Each edge segment is weighted by $A(u_j, v_j)$ from the rod's Gaussian wavefront evaluated at the segment's transverse position. See `src/interaction/fsd/fraunhofer/free_space_diffraction.cpp` where `wave_function.amplitude_magnitude()` is called per segment.

**4. UTD diffraction coefficients.** For each wedge edge with exterior angle $\alpha$ (implementation in `src/interaction/fsd/utd.hpp`):
- Incidence angle $\phi_i$ and diffraction angle $\phi_o$ relative to wedge faces.
- Keller cone angle: $\cos\beta = \hat{\mathbf{d}}_i \cdot \hat{\mathbf{e}}$ (rod direction dotted with edge tangent).
- UTD coefficients $D_h, D_s$ for hard and soft polarizations.

**5. Importance sampling.** Scattered direction sampled from a mixture of Gaussians centered on the Keller cone directions (reflection-like at $\phi_o = \pi + \phi_i$ and transmission-like at $\phi_o = \pi - \phi_i$), with width $\sigma = \sqrt{C / (k \cdot r_i)}$ where $C \approx 45$. See `src/interaction/fsd/free_space_diffraction.cpp: sample()`.

**6. Zeroth-order (direct) lobe.** The unscattered rod is one sampling outcome, with probability proportional to its power via the aperture scattering function (ASF). This ensures energy conservation.

Rods that clear all edges entirely pass through unmodified.


#### Beam Splitters and Dichroics

The rod splits into two children (reflected + transmitted):
- **50/50 beam splitter**: both children get amplitude scaled by $\sqrt{0.5}$.
- **Dichroic**: $R(\lambda), T(\lambda)$ from wavelength-dependent coating. Each rod's split depends on its central wavelength.

Both children inherit phase, OPL, bandwidth, `sourcePosition`, and `sourceId`.


#### Wave Plates

Jones matrix applied to each rod's polarization:

**Half-wave** (fast axis at angle $\theta$):
$$\mathbf{J}_{\lambda/2} = \begin{pmatrix} \cos 2\theta & \sin 2\theta \\ \sin 2\theta & -\cos 2\theta \end{pmatrix}$$

**Quarter-wave**:
$$\mathbf{J}_{\lambda/4} = e^{-i\pi/4}\begin{pmatrix} \cos^2\theta + i\sin^2\theta & (1-i)\sin\theta\cos\theta \\ (1-i)\sin\theta\cos\theta & \sin^2\theta + i\cos^2\theta \end{pmatrix}$$

**Linear polarizer**:
$$\mathbf{J}_\text{pol} = \begin{pmatrix} \cos^2\theta & \sin\theta\cos\theta \\ \sin\theta\cos\theta & \sin^2\theta \end{pmatrix}$$


### Visualization

There are several visualizations, selected by a tab in the Solver Selector on the top right of the UI, which can be used.

#### Default — Rod View

The default is to simply draw all rods.

Each rod is drawn with a:
- line thickness
- color (by wavelength)
- opacity between 50% to 100%, with 50% being the lowest intensity in the scene and 100% being the highest intensity in the scene.

Line blending of colors is such that three rods, RGB, visually make white. A lamp for instance creates N distinct color rods, but in a manner such that the resulting light always looks white until hit by a filter or a prism or something that acts preferentially on certain wavelengths.

#### Enhanced Viewers: Bundle Views

Bundle views show properties that would be hard to show per-rod.

**Bundle detection**: rods from the same source exiting the same surface in similar directions are grouped.

The bundle is drawn as a transparent wavelength-colored region bounded by outermost marginal rods. Inside the bundle is an animation of one of the properties of the bundle.

##### View 1: The Wave View

An animation is drawn of a representation of the E&M wave. The amplitude of the wave is normalized such that the max amplitude of a segment is the width of the bundle. The wavelength is increased ~10,000× so that instead of 500 nm, it is 5 mm. The viewer shows phase shifts at lenses (or wherever else they occur) and polarization by the angles at which the wave is drawn.



---



# The E&M Solver

The E&M Solver computes the coherent electromagnetic field at specific planes and through the sample volume. It reads the Rod Tracer's output — rods with their amplitudes, phases, polarizations, wavelengths, and bandwidths — and produces dense field data.

## Step 1: Rods → Coherent Field at a Plane (Packet Synthesis)

The E&M solver reconstructs the electromagnetic field from rods using **finite wave packets**, not point sources.

Each rod represents a local packet of the optical field.

The complex vector field on the evaluation plane is

E(rho) = sum_j q_j b_j(rho)

where

- q_j = complex coefficient carried by rod j
- b_j = rod packet basis function

### Rod coefficient

q_j = sqrt(2 η P_j / cos(theta_j)) exp(i φ_j)

where

- P_j = rod powerWeight
- φ_j = accumulated phase
- θ_j = rod angle relative to plane normal
- η = medium impedance

### Packet shape

b_j(rho) =
P(θ_j,φ_j) J_j
g_j(rho − rho_j)
exp(i k_perp_j · (rho − rho_j))

where

| symbol | meaning |
|---|---|
| rho_j | rod intersection with plane |
| k_perp_j | transverse wavevector |
| J_j | rod Jones vector |
| P(θ,φ) | Richards–Wolf polarization promotion matrix |
| g_j | normalized Gaussian footprint |

∫ |g_j|² d²rho = 1

### Packet width

The spatial width of each packet is determined from the rod cone footprint on the evaluation plane.

Let $a_j$ and $b_j$ be the semi-axes of the ellipse formed by intersecting the rod cone with the evaluation plane.

The packet width is

σ_u = a_j / 2
σ_v = b_j / 2

The Gaussian footprint is

g_j(u,v) = (1 / √(2π σ_u σ_v)) exp( -u² / (2σ_u²) - v² / (2σ_v²) )

This ties the packet footprint to the rod's physical spatial support. Increasing rod density therefore refines the field representation without changing the physical beam.

The Gaussian footprint approximates the rod cone footprint on the plane.

### Richards–Wolf promotion

The matrix P(θ,φ) maps a rod's Jones vector into a 3-component vector field, producing longitudinal fields at high NA.

### Why packet synthesis is used

This representation

- preserves rod direction as phase gradient
- conserves power under rod refinement
- avoids singular Green kernels
- produces correct vectorial focusing behavior
- admits a clean adjoint operator for reverse readback

If the Gaussian Step 1 basis is not yet accurate enough for some diffraction case, that is an open conformance gap in Step 1. The fix is to improve the rod state, interaction physics, or packet synthesis so this same basis converges. The fix is not to route those scenes through a separate production-path Fresnel card solver.



## Step 2: Field Propagation Through the Sample (PPS)

The sample region is solved using a pseudospectral propagation solver.

Propagation uses the angular spectrum method.

For each field component

E(kx,ky,z+dz) = E(kx,ky,z) exp(i kz dz)

where

kz = sqrt((n k0)^2 − kx^2 − ky^2)

For spatial frequencies where $k_x^2 + k_y^2 > (n k_0)^2$, the quantity $k_z$ becomes imaginary. These components correspond to evanescent waves and are propagated as $k_z = i\kappa$, so the propagation factor becomes $\exp(-\kappa \, dz)$, which causes exponential decay of sub-wavelength spatial frequencies. This prevents numerical blowup from evanescent modes.

Material interaction occurs slice by slice

E_after = T(x,y,z) E_before

Fluorescence excitation

S(r) = |E_ex(r)|^2

or for oriented dipoles

S(r) = |p_hat · E_ex(r)|^2



## Step 3: Fluorescence Model

Fluorescence emission is modeled using vector dipole physics.

Three emission models are supported.

1. **Isotropic fast-rotating fluorophore**

S(r) = |E_ex(r)|^2

2. **Fixed dipole**

S(r) = |p_hat · E_ex(r)|^2

3. **Orientation distribution**

S(r) = ∫ f(p_hat) |p_hat · E_ex(r)|^2 dΩ

Detection weighting is applied using the adjoint detection field D(r).

I(r) = S(r) |D(r)|^2

or for fixed dipoles

I(r) = |p_hat · E_ex|^2 |p_hat · D|^2

This captures polarization-dependent excitation and detection.

### Emission spectrum

Fluorescence emission is generally broadband. The solver samples the emission spectrum using a small number of representative wavelengths.

For each emission wavelength $\lambda_{\text{em},i}$ the backward detection PPS is run independently and the resulting intensities are summed:

$$I_\text{total} = \sum_i w_i \, I(\lambda_{\text{em},i})$$

where $w_i$ are spectral weights derived from the fluorophore emission spectrum.


## Step 4: Reverse Rod Readback

Reverse rods read the field using the **adjoint of Step 1**.

For a reverse rod packet b0(rho)

q̂ = ∫ b0*(rho) · E(rho) d²rho

Implementation

1. extract local field patch
2. multiply by conjugated packet
3. integrate

The reverse rod carries q̂ back through the optical system.



## Step 5: Camera Image Formation

Reverse rods reach the camera plane.

Each rod contributes its complex value to the pixel corresponding to its impact.

For coherent channels

E_pixel = sum_j q_j

Intensity

I = |E|²

Fluorescence intensity from Step 3 is added to the same pixel grid.

Final image

I_total = I_transmission + I_fluorescence

### Alternate Detector Launch Formulation (Candidate)

The default reverse-imaging formulation launches reverse rods from detector pixels and uses stochastic culling until a target number of successful rods is achieved. An equivalent detector-launched implementation is also allowed, provided it converges to the same physical image operator:

- Each camera pixel may be treated as a known detector response function on the camera plane rather than as a free angular launch cone.
- The implementation may realize that detector response by launching one or more deterministic narrow Steinberg rods/packets per pixel.
- These detector rods still launch from the detector. They do not assume knowledge of the rest of the optical table ahead of time.
- The detector rods should normally start with centerlines aligned to the local detector normal. Their finite rod state (`majorAxis`, `majorLength`, `tanAlpha`, `e_u`, `e_v`, polarization basis) carries the local packet extent and angular content.
- This is not permission to use arbitrarily broad rods. Detector-launched rods must remain narrow enough that local interaction assumptions at lenses, mirrors, apertures, and sample boundaries remain valid.
- If one detector rod would become too broad for valid transport, the detector response must be represented by multiple narrower rods/packets, using deterministic refinement rather than one oversized cone.
- A separate detector angular-response model may be added if a real sensor has nontrivial angular sensitivity. This must be modeled explicitly as detector physics, not folded into an arbitrary free launch cone parameter.
- For coherent channels, returned reverse-rod complex values may be assembled on the camera plane by packet-based detector-plane synthesis before intensity is taken.
- Fluorescence remains incoherent and is added on the same detector pixel grid after coherent detector-plane assembly.
- This alternate formulation is acceptable only if changing detector packet count/refinement converges to the same physical image, and only if the adjoint relation between field-to-rod readback and rod-to-field synthesis is preserved.

Interpretation rule:

- "Detector-launched reverse rods" includes both stochastic per-pixel directional launches and deterministic narrow-packet detector launches, as long as the transport primitive remains the Steinberg rod and the converged camera image is the same physical operator.


## Samples and the E&M Solver

Every sample in BOMB always has three physical properties, all of which are always active:

- **Transmission** (refractive index): the local refractive index $n(\mathbf{r})$ imposes a phase delay $\Delta\phi = k_0 \cdot \Delta n \cdot \Delta z$ on light passing through. This is what makes brightfield and phase contrast work.
- **Absorption**: the local absorption coefficient $\alpha(\mathbf{r})$ attenuates the field amplitude by $\exp(-\alpha \Delta z / 2)$. This is what makes absorptive samples visible in brightfield.
- **Fluorescence**: the local excitation cross-section $\sigma_\text{abs}(\lambda_\text{ex})$, emission wavelength $\lambda_\text{em}$, and quantum yield $Q_y$ determine how much fluorescence is generated at each point.

There is no "fluorescence mode" or "brightfield mode." A sample that has refractive index variation, absorption, *and* fluorescence will produce transmission contrast, absorption contrast, and fluorescence simultaneously. All three are computed at every slice and summed at the detector.

**Why the sample runs PPS internally:** forward rods are spaced ~10–50 μm apart, coarser than the sample's micron-scale structure. The sample therefore promotes the incoming forward rod set into a dense PPS slice field at its entrance plane, propagates slice-by-slice under the angular spectrum operator, and stores the resulting slice fields. Reverse packets from detectors, when they enter the sample volume on their upstream path, intercept the PPS slice fields directly — no special "sample boundary readback" is needed. The sample is just another region of the scene where the forward-field representation is a dense grid rather than a rod set.


## Where the E&M Solver is Invoked

### Every frame, for every detector

The pipeline is identical for cards, cameras, and PMTs. It differs only in pixel pitch, readout (card displays a 2D field; camera/PMT sensors bin to pixels; PMT may accumulate over a scan), and trigger (all three are continuous by default; cameras and PMTs expose a snapshot action).

1. **Source launch.** Each source emits its per-frame rod set with Halton-offset hex-lattice jitter. Rods are tagged with `sourceId` and wavelength.
2. **Forward propagation.** Rods propagate through the scene: refraction, reflection, thin-mask clipping, beam-splitter split, wave-plate Jones. When a rod enters a sample volume, the incoming packet set drives PPS synthesis at the entrance plane; PPS propagates through slices; rods exit at the sample's far boundary. Forward rods outside sample volumes remain discrete packets.
3. **Forward-field snapshot.** Build a BVH over all forward-rod packet cones and a map of PPS slice fields keyed by sample ID.
4. **Reverse pass.** For each detector pixel, launch one reverse packet. Traverse upstream, firing the three intercept operators (§Reverse Tracing). Accumulate into the detector's coherent and incoherent buffers.
5. **Display.** Materialize each detector's accumulated buffers into a visible image: coherent buffers divided by frame count, squared, summed across groups; incoherent buffer divided by frame count; summed.

### Snapshot actions

Cameras and PMTs can take a "snapshot" that temporarily bumps the per-frame reverse rod count to a higher value (deterministic packet-launch mode, full sensor resolution), runs the reverse pass to a specified frame-count target, and freezes the resulting image to a separate buffer the user can save. The underlying operator is the same as the continuous pipeline.

## Architecture Summary

| Operator | Invoked when | Backend | Output |
|---|---|---|---|
| Forward source launch | Every frame | TS | Per-source hex-lattice rod set, Halton-jittered |
| Forward rod propagation + surface interactions | Every frame | TS | Forward-rod packets throughout the scene |
| PPS sample volume | Every frame (if sample exists) | Rust/WASM worker | Dense slice fields inside sample |
| Forward-rod BVH build | Every frame, end of forward pass | TS | Spatial index for intercept queries |
| Reverse-packet launch per pixel | Every frame, every detector | TS | One reverse packet per pixel |
| Free-space intercept (Op 4a) | Per reverse packet, per BVH hit | TS | Coherent pixel contribution |
| Reverse-FSD at edge (Op 4b) | Per reverse packet, per edge clip | TS | Coherent pixel contribution (BDW) |
| Sample-volume intercept (Op 4c) | Per reverse packet, per sample traversed | TS | Coherent + incoherent pixel contributions |
| Coherent accumulation | Every frame, per detector | TS | Per-group complex field buffers |
| Display materialization | Every frame | TS | \|E\|² tone-mapped canvas |


# Refinement and Convergence Rules

These are not optional implementation details. They define whether the rod / field representation is physically acceptable.

## Required convergence properties

1. **Rod-count convergence**  
   Increasing the number of rods for the same physical source must converge to the same reconstructed field and image.

2. **Source partition invariance**  
   The same source represented by different source-plane tilings must converge to the same answer.

3. **Interface-plane stability**  
   Modestly moving the rod-to-field interface plane must not materially change the downstream result once proper field propagation is used.

4. **Matched forward / reverse operators**  
   The field-to-rod readback must be the adjoint of the rod-to-field synthesis operator.

5. **Progressive-accumulation convergence.** The displayed image at frame $N$ equals $|\sum_f \mathbf E_f / N|^2$ within each coherent group, summed across groups incoherently, plus the scalar incoherent accumulator divided by $N$. As $N \to \infty$, the image converges to the analytic answer. Per-frame jitter patterns must be chosen (Halton low-discrepancy sequences) so that this convergence is visible — the user sees the image sharpen in wall-clock time, not just as rod count grows.

6. **Intercept symmetry.** Free-space intercept between a forward rod and a reverse packet is a symmetric bilinear inner product. Swapping "forward" and "reverse" labels (with appropriate direction and Q-state updates) gives the same complex coefficient up to conjugation. The BDW operator must respect Keller reciprocity: scattering from direction $\phi_i$ to $\phi_o$ equals scattering from $\phi_o$ to $\phi_i$ for a symmetric wedge.

If any of these fail, the result is a discretization artifact rather than physical optics.

# Validation Tests

These tests must be run and verified during development to ensure the E&M Solver produces physically correct results. Failures in any of these indicate a fundamental bug.

## Test 1: Gouy Phase Through Focus

**Setup:** Single lens (f = 50mm) with a collimated laser input. Place viewing cards at several z-positions through the focal region: z = -2mm, -1mm, -0.5mm, 0 (focus), +0.5mm, +1mm, +2mm relative to the focal point.

**Expected result:** The E&M Solver on each card should show the on-axis phase advancing by a total of ~π radians as the card moves from well before focus to well after focus. This is the Gouy phase anomaly. The axial phase profile should follow $\phi_\text{Gouy}(z) = -\arctan(z/z_R)$ where $z_R = \pi w_0^2 / \lambda$ is the Rayleigh range.

**Why this tests the architecture:** The Rod Tracer tracks OPL geometrically ($\text{OPL} = n \cdot d$) and does not explicitly compute Gouy phase. The packet synthesis representation combined with coherent superposition must reproduce the Gouy phase automatically. If this test fails, it means the packet synthesis is not correctly reconstructing the focal field from the rod data, and the rod-to-field transition (Step 1) has a fundamental problem.

## Test 2: Airy Disk at Focus

**Setup:** Single lens with circular aperture, collimated laser input. Viewing card at the focal plane.

**Expected result:** The E&M Solver should show the Airy disk pattern: central maximum with radius $r_\text{Airy} = 1.22 \lambda / (2 \cdot \text{NA})$, with correct ring positions and relative intensities.

## Test 3: Brightfield Contrast of a Phase Object

**Setup:** Brightfield microscope (lamp → condenser → phase object → objective → camera). The sample is a pure phase object (no absorption, no fluorescence) — e.g., a glass bead with known $\Delta n$.

**Expected result:** With full condenser NA, the phase object should be nearly invisible (correct for brightfield — phase objects don't produce contrast without a phase ring). With a phase ring inserted at the objective's back focal plane, the phase object should become visible. This tests the full angular decomposition pipeline: the reverse rods must correctly separate the scattered (high-angle) and unscattered (low-angle) field components, and the phase ring must act differently on them.

## Test 4: Mach-Zehnder Interferometer Fringe Visibility vs. Path Difference

**Setup:** Mach-Zehnder interferometer with lamp (broadband) source. One arm has an adjustable delay.

**Expected result:** Fringe visibility should follow the temporal coherence envelope: $V(\Delta\text{OPL}) \approx |\text{sinc}(\Delta\nu \cdot \Delta\text{OPL}/c)|$. At zero path difference: high-contrast fringes. At $\Delta\text{OPL} > \lambda^2/\Delta\lambda$ (the coherence length): fringes wash out. This tests the polychromatic computation and temporal coherence.

## Test 5: Diffraction from a Single Slit

**Setup:** Laser → slit aperture (width $a$) → viewing card at distance $L$.

**Expected result:** The E&M Solver on the card should show the single-slit diffraction pattern with minima at $x_m = m \lambda L / a$. This tests both the UTD rod-edge interaction (which modifies rod phases near the slit edges) and the packet synthesis (which reconstructs the pattern).

## Test 6: Energy Conservation Through the Sample

**Setup:** Collimated laser beam through a non-absorbing, non-fluorescent phase-only sample. Viewing cards before and after the sample.

**Expected result:** Total integrated intensity on the card after the sample equals total integrated intensity before the sample (within numerical tolerance). The PPS propagation must conserve energy. Standard multislice does NOT conserve energy for strongly scattering samples — this is why PPS is specified.

## Test 7: Rod-Count Convergence on a Viewing Card

**Setup:** Fixed source, fixed optics, fixed card position. Reconstruct the same card field using $N$, $2N$, and $4N$ rods.

**Expected result:** The reconstructed field and integrated intensity converge as rod count increases. The answer should stabilize; increasing rod count should refine the result, not change the physical beam.

This test must be run in two forms:

- an operator-level fixture where the packet synthesis is fed a controlled analytic rod set
- a production-path test that uses the actual source launch, rod tracing, and card hit collection path

Both must pass before Step 1 can be considered converged in production.

## Test 8: Source Partition Invariance

**Setup:** Represent the same Gaussian beam using different source-plane tilings and adaptive samplings.

**Expected result:** The reconstructed field on the same card or sample plane agrees within tolerance across all source tilings.

This must be checked at the same source-launch boundary used by production. If multiple production launch families exist, compare them directly. If only one launch family is exposed in production, compare it against alternate source-plane samplings built at that same boundary using the same rod coefficient and packet semantics.

## Test 9: Adjoint Consistency of Step 1 and Step 4

**Setup:** For a chosen plane, numerically test the forward packet synthesis operator and the reverse packet readback operator on random test data.

**Expected result:** The discrete inner-product relation holds to numerical tolerance. This verifies that Step 4 is the matched adjoint of Step 1.

## Test 11: Forward-Reverse Agreement in a No-Edge Scene

**Setup:** Collimated laser → free-space viewing card. No blocker, no aperture, no sample.

**Expected result:** A single-frame forward-Step-1 synthesis at the card plane and a single-frame reverse-intercept pass at the same card pixels must agree to within 1% L1 error. Both are evaluating the same operator via different discretisations.

**Why this tests the architecture:** validates that the free-space intercept operator is the adjoint of Step 1 synthesis. If this fails, nothing else in the reverse pipeline can be trusted.

## Test 10: Interface-Plane Stability

**Setup:** Reconstruct the field at one plane from rods, propagate to the sample, and compare against reconstruction at a nearby plane followed by the corresponding propagation.

**Expected result:** The downstream field and image agree within tolerance. Results should not depend strongly on the arbitrary choice of rod-to-field interface plane.



# UI

## Optical table.

The optical table is a brushed-metal hole-grid table, with 25 mm between each black hole. The table is placed at -50 mm to give the objects at 0 mm some space to float above the table.

## 3D

The program starts in an above-view environment where everything looks 2D (orthographic). It can be rotated, and then it snaps into a full 3D perspective, and snaps back when it returns to the 2D plane again.
The Three.js axis selector gizmo is in the bottom right, desktop only, not mobile.

## Left Sidebar

- fixed left column
- presets section at the bottom for optical table presets.
- parts section at the top for dragging parts onto the table
- parts are collected into similar groups such as: "lenses" "mirrors" "blockers" "detectors" "light sources"
- Auto-collapsed/auto-collapsing when viewed on mobile due to limited screen space

## Properties browser (right bar)

Floating right-side panel that appears when a part is clicked. Each part has different properties in the properties browser.
- editable component name at the top,
- trash icon delete button with red hover,
- compact numeric fields for `X`, `Y`, `Z`, rotation, each can be locked with a little lock icon so that dragging on the table can no longer change that option
- scrub-friendly inputs for many values,
- collapsible advanced sections instead of giant walls of controls,
- pin button for keeping image/profile viewers visible after deselection.


## Solver / visibility panel

A separate solver panel floating right-side card that disappears when the properties browser is open.

Important behaviors:
- header text `Physics Solvers`
- rod-count slider


# Architecture

TypeScript Front-End + Rust/WASM Physics Core.

- **TypeScript / React / R3F** owns the scene graph, part authoring, inspectors, dragging, serialization, diagnostics UI, and forward Rod Tracer visualization.
- **Rust compiled to WebAssembly** owns the heavy numerical kernels for the reverse Rod Tracer and the E&M Solver.
- **Web Workers** host the Rust/WASM solver instances so long-running wave/image solves do not block the UI thread.


# Parts

Every draggable part lives in exactly one file under `src/parts/`, and that file owns the part's geometry, rendering, defaults, inspector schema, serialization hooks, and local operator behavior. Shared code may provide generic math, solver, caching, and UI infrastructure, but it must not contain duplicated part-specific knowledge.


## Light Sources

### Laser Source
- cubic black housing
- properties include selectable wavelength (default 488), beam diameter (default 1 mm), and power (default 5 mW)

The laser emits rods arranged in concentric rings around the beam axis or another adaptive source-plane tiling. Each rod represents a finite source-plane cell and carries a `powerWeight` equal to the optical power assigned to that cell.

Sampling density may still be higher near the beam center where intensity is largest, but that is an efficiency choice, not the physical definition of the beam. The physical Gaussian beam profile is defined by the source field and the per-rod power weights, not only by rod density.

All rods from the same laser line carry the same wavelength and start with the same nominal direction (parallel to the source optical axis), but their `powerWeight` values generally differ across the beam profile.

**Refinement rule:** changing the rod count must not change the physical beam except by reducing discretization error.

### Lamp Source
- cubic grey housing
- properties include beam diameter, angular spread (default 0 degrees), and power.

The lamp emits from a spatially extended filament or LED source. The emitter is modeled as multiple spatial source points distributed across its area, each acting as an independent emitter.

Each source point launches its own set of rods. As with the laser, each rod represents a finite source-plane cell and carries a `powerWeight` equal to the optical power assigned to that cell.

The source profile at each emitter point may be super-Gaussian:

$$I(r) \propto \exp\!\left(-(r/w)^{2n}\right) \quad \text{with } n \approx 3$$

This gives a flat top with smooth edges, appropriate for LEDs or lamps.

**Multi-wavelength sources:**

For the physics solver, a lamp is represented by a small set of wavelength samples across the source spectrum. Each wavelength launches its own rods and is propagated independently when chromatic effects matter. The viewport may render these samples as RGB / white for user display, but the physics layer should keep the spectral sampling separate from the display model.

For partial coherence, the full imaging pipeline runs once per source point and the resulting intensities are summed.

**Optional preview approximation:** for fast preview only, reverse-path geometry for nearby wavelengths may be reused when chromatic effects are negligible. This must not be the default for physically faithful image generation.


## Samples and Sample Holders

### Mickey
Three spheres making a Mickey. Default visual scale is 1 mm diameter.

### 2D Sample holder (implemented as `Sample` in src/parts/Sample.ts)
A thin framed slide form factor for simple transmission and epi setups.

### X-Chamber sample holder

- transparent chamber walls (`#778899`) with circular bore holes,
- dark bottom plate
- Mickey specimen floating in the center
- objectives *snap* to the four side ports and face inward,

### Fluorescence of Samples
Fluorescence is not a source in the same sense as a laser or lamp. It's generated by the sample when illuminated.


## Detectors

### Camera
sensor in the front of the camera, dark purple reflective color
The word "camera" on the top face so that the orientation of the camera is understood

Cameras are detector planes with a pixel sensor. The reverse pass runs continuously; the user sees the live image in the pinned viewer. A snapshot action captures the current buffer at higher resolution for saving.

In properties bar there is a camera view that can also be pinned so that it becomes its own floating card on the bottom left.
- if scan frames exist, allow `AVG` / `MAX` projections and a frame scrubber.

**Pinned viewer panels**
- bottom-left floating cards
- show only the viewer canvas plus a tiny title and close button,
- stack horizontally.

### PMT
sensor in the front of the camera, dark purple reflective color
In properties bar there are two programmed ties to animated X/Y scan axes, if that is hooked up, then creates a pinnable image (similar to Camera Part)


## Other Parts
### Abstract Polygon

The abstract polygon has a certain number of sides, and can be glass, mirror or blocker (or dichroic etc.) A 3 sided glass polygon would be a prism. A 5 sided reflective polygon might be a beam scanner. Several components are made out of this abstract type. In the properties interface any vertex of the polygon can be moved, and any line segment can be dragged to create a positive or negative curvature, so that an abstract polygon could actually be a 4 sided mirror with inward facing curvature.

Used to make:
	#### Prism
	#### Polygon Scanner

### Abstract Plane
Similar to abstract polygon, but built for thin rectangular objects such as a blocker, or a mirror. Can again be given curvature by dragging the flat point or a tilt by dragging one vertex vs the other.

Used to make:
	#### Blocker
	#### Mirror
	#### Curved Mirror

### Filter
- tint is driven by the dominant pass wavelength

### Spherical Lens

### Achromatic Doublet


### Aperture
The circular aperture/iris

### Slit Aperture

### Beam Splitter

### Ideal Lens

### Dichroic Mirror

### Objective (Special Part)

Microscope objectives are not modeled as stacks of catalog lenses. Instead they are modeled as **ideal aplanatic objective operators** defined by real manufacturer parameters.

This avoids requiring proprietary lens prescriptions while still reproducing the correct physical behavior of microscope imaging.

Each objective is defined by:

| Parameter | Description |
|---|---|
| magnification (M) | nominal magnification (e.g. 20×) |
| NA | numerical aperture |
| immersionIndex | refractive index of immersion medium |
| tubeLensFocalLength | design tube lens focal length (e.g. 200 mm Nikon, 180 mm Olympus) |
| workingDistance | working distance |
| coverslipThickness | design coverslip thickness |
| fieldNumber | usable image circle diameter |
| aberrationModel | optional Zernike phase at pupil |

Derived quantities:


f_obj = tubeLensFocalLength / M


Maximum collection angle:


NA = n_imm sin(theta_max)


Objective pupil radius:


R_pupil = f_obj sin(theta_max)


The objective obeys the **sine condition**


r_pupil = f_obj sin(theta)


where `theta` is the ray angle at the sample.

### Objective behavior

The objective performs three physical operations.

1. **Rod mapping**

- rods entering the objective are refracted according to the sine condition
- rods outside the pupil are clipped

2. **Pupil function**

The objective defines a pupil transmission


P(r,phi) = A(r,phi) exp(i Phi_ab(r,phi))


where

- `A` is aperture support
- `Phi_ab` is aberration phase

3. **Vectorial focusing**

Near the sample plane the E&M solver reconstructs the field using packet synthesis and then propagates it using the vectorial Richards–Wolf equivalent representation of the pupil. The rod tracer therefore determines which angular components reach the pupil, while the E&M solver performs the actual vectorial focusing computation.

This model reproduces

- finite NA
- pupil clipping
- vectorial focusing
- aberrations
- correct PSF structure

without needing the internal lens prescription.



### Pupil Mask

Some optical elements operate directly in a pupil plane rather than through edge diffraction.

Examples:

- phase contrast rings
- annular illumination stops
- apodization filters
- spatial light modulators
- phase plates

A pupil mask is defined by

| property | description |
|---|---|
| transmission(x,y) | amplitude transmission |
| phase(x,y) | phase delay |
| jones(x,y) | optional 2×2 polarization operator |

If rods pass through a pupil mask the mask modifies the rod state.

If the E&M solver reconstructs a field at the pupil plane the mask multiplies the field


E_out(x,y) = T(x,y) exp(i Phi(x,y)) E_in(x,y)


This allows modeling distributed pupil phase or amplitude structures.

### Wave Plate

### Card Inspector

**Card geometry**
- Default 20 mm tall × 20 mm wide × 1 mm thick
- Configurable to other dimensions.

Cards are detector planes. They run the reverse pass every frame, accumulating into per-group complex field buffers. Display is the materialized buffer ($|E|^2$, tone-mapped). Forward rods pass through unchanged.

- Overlay controls in the top-right: auto-scale ⊕, zoom reset ↺, small monospace zoom indicator.
- Readout panel below the canvas in full mode:
  - per-wavelength power breakdown using wavelength-colored bullets,
  - total power,
  - beam diameter,
  - Jones vector.
- Anything else known about the beam at that plane.
- The viewer should preserve the old analytical overlays: 1/e² rings, polarization ellipse, crosshair, and wavelength-aware beam color.



# Presets

## Microscopes

### Brightfield
### Epi
### Light Sheet
### Transmission


## Optics

### Beam Expander
### Interferometer

## Tests

### Blank
