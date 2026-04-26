# Microscope Builder Engine

Reference for re-implementing a similar optics simulator. Covers the physics engine, scene graph, solvers, component contracts, animation, and serialization. GUI / visualizer / aesthetic details are intentionally omitted.

---

## 1. Conventions

### Coordinate system

- **World space:** right-handed, **Z-up**. `+Z` is "up" off the optical table; `XY` is the table plane.
- **Distance unit:** millimeters everywhere.
- **Component-local space:** every component has a local frame whose `+Z` is the **optical axis** ("the W axis" in user-facing labels). Local `X`/`Y` form the transverse `(u, v)` plane. The convention `pointAlong(dx, dy, dz)` orients the component so its local `+Z` points along the given world direction.

### Units summary

| Quantity        | Unit                       |
| --------------- | -------------------------- |
| Position, size  | mm                         |
| Wavelength on a `Ray` | **meters (SI)** — multiply by `1e9` for nm |
| Wavelength in `SpectralProfile`, `Cauchy` lookups | **nm** |
| Time, animation period | ms |
| Angle (galvo, rotation, scan) | radians (degrees only at UI/serialize boundary) |
| Intensity / power | arbitrary linear units; conserved by Snell + Fresnel |
| Optical path length (OPL) | mm (so `phase = 2π · OPL / λ` with both in mm) |

### Ray data model

`Ray` (see `src/physics/types.ts`) is the unit of forward propagation. Critical fields:

| Field                     | Notes                                                          |
| ------------------------- | -------------------------------------------------------------- |
| `origin: Vector3`         | mm, world coords                                               |
| `direction: Vector3`      | unit vector, world coords                                      |
| `wavelength: number`      | **meters**                                                     |
| `intensity: number`       | linear power weight; child rays scale this                     |
| `polarization`            | 2-D Jones vector `{ x: Complex, y: Complex }` in world XY      |
| `opticalPathLength`       | mm, accumulated through all media                              |
| `footprintRadius`         | mm, Gaussian beam radius at the ray's current position         |
| `coherenceMode`           | `Coherent` / `Incoherent`; only coherent rays interfere        |
| `isMainRay`               | the bundle's center ray; used for rendering and split logic    |
| `isBackward`              | true for Solver 3 reverse rays (camera → source)               |
| `sourceId`                | tags the originating source to keep bundles separable          |
| `interactionDistance`, `interactionComponentId` | cached during tracing for the segment that follows |

`childRay(parent, overrides)` constructs a child for the next segment and **strips visualization-only fields** (`entryPoint`, `internalPath`, `terminationPoint`, `exitSurfaceId`) so internal-mesh artifacts don't bleed across components. Always use it instead of spreading manually.

### Polarization (Jones calculus)

Each ray carries a 2-D complex Jones vector in the world `(x, y)` basis. Mirrors apply a `π` phase flip (`E → −E`); waveplates apply rotated `diag(1, ±1)` (half) or `diag(1, ∓i)` (quarter) matrices; PBSes split into S/P fractions and unit-normalize each output Jones so that downstream `|E|² = intensity · |Jones|²` is not double-counted. See `Mirror.interact`, `Waveplate.interact`, `PolarizingBeamSplitter.interact`.

> The current `PolarizingBeamSplitter` implementation reads `polarization.x` / `polarization.y` directly in **world** frame rather than transforming into the surface frame. That means the split fraction depends on world orientation, not on the actual incidence plane. Easiest workaround in presets: feed it the polarization the code expects, e.g. with a `Waveplate('half', …, π/4)` upstream.

---

## 2. Architecture overview

```
        ┌─────────────────────────────┐
        │  presets / user actions     │  build OpticalComponent[]
        └──────────────┬──────────────┘
                       ▼
                componentsAtom ────────── componentRegistry
                       │                     (factory, type names,
                       ▼                      serializer round-trip)
        ┌─────────────────────────────┐
        │  PropertyAnimator (frame)   │  mutates component fields,
        │                             │  bumps version counter
        └──────────────┬──────────────┘
                       ▼
        ┌─────────────────────────────┐
        │  SourceRayFactory           │  emits forward Ray bundles
        └──────────────┬──────────────┘
                       ▼
        ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
        │  Solver1    │  │  Solver2    │  │  Solver3    │
        │  forward    │  │  Gaussian   │  │  backward / │
        │  ray trace  │  │  beamlets   │  │  imaging    │
        └─────────────┘  └─────────────┘  └─────────────┘
```

The engine is **frame-by-frame, snapshot-driven**. There's no temporal integrator: animation works by mutating component properties between frames and re-running the relevant solver(s). Each `OpticalComponent` carries a `version` integer that's bumped on mutation; downstream caches (Solver 3's snapshot, scan accumulators) compare versions to decide whether to reuse stale results.

Three solvers stack:

- **Solver 1** is the geometry/photon engine: discrete rays, multi-bounce, branching at splitters. It produces both the visualized light paths and the coordinates Solver 2/3 build on.
- **Solver 2** wraps each Solver 1 segment in a Gaussian beam envelope so the rendered "beam" has a width that grows / focuses correctly. It is now derived from Solver 1 ray geometry plus per-ray footprint radii (no separate q-parameter integration except for legacy fallbacks).
- **Solver 3** is the imaging engine: backward Monte-Carlo rays from each detector pixel/PMT sample, integrated against the forward beam field and the sample's fluorescence model. It runs in a separate worker (or WASM backend) and supports progressive accumulation.

---

## 3. Scene graph: `OpticalComponent`

`src/physics/Component.ts` defines the abstract base every component subclasses.

### Identity & transform

```ts
id: string                  // UUID, persists across serialize / deserialize
name: string                // user-editable display name
position: Vector3           // world mm
rotation: Quaternion        // world orientation
panAngle, tiltAngle, rollAngle: number   // radians; round-trip with rotation
axisLock: { x, y, z: boolean }           // dragging constraint; Z locked by default
```

`pointAlong(dx, dy, dz)` orients the component so its local `+Z` axis points along world `(dx, dy, dz)`. It's the canonical preset-authoring API: e.g. `objective.pointAlong(0, -1, 0)` makes the objective face down. Pan/tilt/roll scalars are kept in sync with the quaternion via `recomputeRotation()` for use by the animator.

### Geometry & dirty tracking

```ts
bounds: Box3                // local AABB; broadphase culling
isGhost?: boolean           // true → ignored by solvers (UI hints, drag previews)
isSubComponent?: boolean    // true → managed by a parent (e.g. galvo child mirrors); not serialized standalone
version: number             // bumped on any mutation; consumers compare to detect change
absorptionCoeff: number     // Beer–Lambert μ in mm⁻¹; default 0
kind?: KernelComponentKind  // discriminator used by snapshot layer ('aperture', 'sample', 'pmt', …)
```

`updateMatrices()` lazily recomputes `localToWorld` / `worldToLocal` if `version` has changed.

### Ray-tracing contract

Every concrete component implements two methods. The base class drives them through `chkIntersection`:

```ts
chkIntersection(rayWorld: Ray): HitRecord | null
    → transforms ray into local space
    → calls this.intersect(localRay)
    → transforms HitRecord back to world (point + normal)

intersect(localRay: Ray): HitRecord | null
    → component-specific surface geometry; returns null if missed
    → can set hit.isBlocked = true to mark a "hit but absorb" (apertures, objective barrel)

interact(ray: Ray, hit: HitRecord): InteractionResult
    → component-specific physics; returns
        { rays: Ray[], passthrough?: boolean }
    → empty rays = absorbed
    → passthrough true + 1 ray = optimization hint to Solver 1 (transparent media)
```

`HitRecord` carries `t` (distance), `point` (world), `normal` (world), `localPoint`, optional `localNormal`, and `isBlocked`. Components that need exact local-frame data should populate `localPoint` and `localNormal` to avoid double-transforming.

### Composite components

Some components manage internal sub-components that participate in tracing on their own. They expose `getManagedSubcomponents(): OpticalComponent[]` and mark each child with `isSubComponent = true`. The canonical example is `DualGalvoScanHead`: it returns null from `intersect`/`interact` and instead positions two `Mirror` children whose hits the tracer sees directly. Presets must `scene.push(scanHead, scanHead.mirror1, scanHead.mirror2)`. The serializer auto-recreates these sub-components by calling `parent.getManagedSubcomponents()` after constructing the parent, so persisting them standalone would create orphan duplicates (and the serializer skips `isSubComponent` for that reason).

### Paraxial transfer (Solver 2 fallback)

Components may implement:

```ts
getParaxialTransform(): [A, B, C, D]
getParaxialProfile?(rayDir): { tangential, sagittal, apertureRadius? }
```

These ABCD matrices are no longer the primary Solver 2 path (beamlet footprints from Solver 1 supersede them) but remain useful for analytical sanity checks and astigmatic optics like `CylindricalLens`.

---

## 4. Solver 1 — forward ray tracer

`src/physics/Solver1.ts`.

```ts
const solver = new Solver1(scene);    // filters out isGhost components
const paths = solver.trace(sourceRays);
```

Algorithm per source ray:

1. **NaN guard.** Skip rays whose origin or direction has any NaN.
2. **Recursive trace** with `maxDepth = 20`.
3. At each step, scan all components, call `chkIntersection`, take the **nearest hit with `t > 0.001 mm`** (epsilon avoids self-intersection).
4. If the hit component is an emitter (Laser, Lamp, point sources, etc.) terminate the path.
5. Call `nearestComponent.interact(ray, hit)` → list of child rays.
   - Empty list → terminate.
   - One child + `passthrough: true` → continue inline without branching the path.
   - Otherwise → branch: each child seeds its own sub-path.
6. Drop child rays whose `intensity < 1e-6` (still recorded as terminal segments for visualization).

Output: `Ray[][]` — one array per surviving path, in interaction order.

Important consequences:

- The tracer has **no "visited components" set**. A ray *can* re-enter the same component, which is what makes the Yu et al. "Nisam" angle-doubling layout work: the beam bounces off the resonant scan mirror twice.
- Rendering and physics share the same path data. Any field stored on a `Ray` will show up in renderer logic too — that's why `childRay()` strips visualization-only fields.
- `traceWithBeamSegments(sources)` runs the same trace and additionally builds `GaussianBeamSegment[]` per branch by interpolating `footprintRadius` along each segment.

---

## 5. Solver 2 — Gaussian beam envelopes

`src/physics/Solver2.ts`.

In current code Solver 2 is mostly a wrapper that consumes Solver 1 ray geometry and per-ray footprint radii to draw beam envelopes. The legacy q-parameter pathway is still available for components that implement `getParaxialTransform` and is exercised by tests.

A `GaussianBeamSegment` carries: start/end positions (world mm), separate `qStart` / `qEnd` for tangential and sagittal axes (so astigmatism survives), `footprintStart` / `footprintEnd` (mm), `power`, `wavelength` (SI meters), and `refractiveIndex`. To draw the beam at any point on the segment, interpolate the footprints linearly; only fall back to evaluating `w(z) = √(−λ/(π · Im(1/q)))` from q if the footprints are missing.

Solver 2 is gated by `rayConfig.solver2Enabled`; toggling it on costs more per-frame work but produces correct beam widths through compound optics.

---

## 6. Solver 3 — backward / imaging

`src/physics/Solver3.ts` plus `solver3Host.ts`, `solver3Kernel.ts`, `solver3Worker.ts`, `solver3WasmBackend.ts`, `solver3WasmLoader.ts`, and the snapshot/packet/sampling helpers.

### Architecture

Solver 3 is split for hot-loop performance:

- **Host** (`solver3Host.ts`) builds an immutable `Solver3KernelContext` from the live scene plus the latest forward beam segments. It packs the scene + beam field into typed-array packets (`kernelPackets.ts`) so a worker thread or WASM module can consume them without DOM touchpoints.
- **Backend** is one of two implementations of `Solver3KernelBackend`: `JsSolver3Backend` (the reference, runs in the main thread or in `solver3Worker.ts`) or `WasmSolver3Backend` (lazy-loaded native module). Both expose the same surface: `renderCamera`, `renderCameraGenerator` (progressive), `renderPMTPixel`, `traceBackward`, `renderCameraSamples` (sample-driven progressive accumulation).
- **Kernel** (`solver3Kernel.ts`) is the actual ray/Monte-Carlo logic.

### What the kernel does per pixel

Camera path (`renderPackedCameraSamples`):

1. For each pixel sample, build a `Ray` from the camera basis (origin = sample point on the sensor, direction toward the scene through the sample's `(u, v, NA)`), once **per active wavelength** (sample emission, lamp wavelengths, beam-field wavelengths).
2. Mark `isBackward = true` and feed it into `traceBackward(startRay, originatorId)`.
3. Accumulate the returned `radiance` into the emission image and `excitation` into the excitation image. Reservoir-sample winning paths into a bundle for visualization.

PMT path (`renderPMTPixel`):

1. Find the first aperture along the PMT's optical axis (`searchRay` from PMT origin along `forward`).
2. With probability 0.9, importance-sample a backward ray aimed at a uniform point inside that aperture's clear opening. With probability 0.1, sample uniformly inside the PMT's own NA cone (handles paths that don't go through the pinhole).
3. Run `traceBackward` per sample × wavelength, average the radiances. The "1.0" fallback aperture radius used to hard-code over-large pinhole targeting and produce blank PMT images; the real `openingRadius` is now read from the snapshot (see `Aperture.openingDiameter / 2`).

### `traceBackward` and the sample

`traceBackward` walks the same components as Solver 1, but in reverse: at each hit it calls `interact` with `isBackward: true` on the ray. Behaviour is component-specific — a mirror still reflects, an objective applies its inverse aplanatic mapping, an aperture still blocks, a sample contributes fluorescence.

When a backward ray reaches a `Sample`, the kernel:

1. Computes the chord through the sample's spheres via `sample.computeChordSegments(worldRay)`.
2. Multiplies the per-segment chord length by the absorption coefficient (Beer–Lambert) and the excitation field strength at that location, looked up from the cached forward beam segments (`BeamFieldSnapshot`).
3. Weights by `fluorescenceEfficiency` and the sample's `excitationSpectrum.getTransmission(λ_excitation_nm)`.
4. Returns `radiance` (emission contribution) plus `excitation` (raw S2 field magnitude at the sample) plus the path for visualization.

### Snapshots

`createTraceSceneSnapshot(scene)` (`sceneSnapshot.ts`) wraps each component in a `KernelTraceComponent` carrying just what the kernel needs: `id`, `kind`, `position`, `absorptionCoeff`, `openingRadius` (for apertures), and bound `chkIntersection` / `interact` closures. Samples additionally expose `fluorescenceEfficiency`, `absorption`, `getEmissionWavelength()`, `getExcitationWavelength()`, `emissionTransmission(nm)`, `computeChordLength()`, `computeChordSegments()`, and `getVolumeIntersection()`. `BeamFieldSnapshot` is the cached forward beam segments grouped by branch.

### Progressive accumulation

`renderCameraGenerator` yields `{ progress }` between rounds so the UI can paint partial images. Each round runs `renderPackedCameraSamples` over a new batch of camera samples; the kernel composites them into the existing emission/excitation buffers via running averages and bumps `cameraImageTickAtom` so React-side viewers repaint. PMT raster scans are driven by an outer loop that mutates galvo channels per pixel and re-runs `traceBackward`, accumulating into `pmt.scanImage`.

---

## 7. Source ray emission

`src/physics/SourceRayFactory.ts` produces the source rays Solver 1 traces. One call per frame:

```ts
const sources = createSourceRays(components, rayCount, mode /* 'full' | 'main-only' */);
```

For each source component:

1. Compute origin (component position pushed slightly along its forward direction so the ray starts outside its housing).
2. Compute direction = local `+Z` rotated into world.
3. Always emit a **center main ray** with `isMainRay: true`.
4. In `'full'` mode, emit `rayCount` additional ring rays sampled from a 2-D Gaussian transverse profile:
   - Radii from inverse-CDF stratification of the Gaussian.
   - Azimuths from the golden-angle (Fibonacci) spiral so the bundle is even at any count.
   - Inner rings have 12 rays, outer ring has 24 rays; counts snap to ring boundaries.
5. Total power is divided **evenly** across `1 + rayCount` rays so that `Σ intensity = power` exactly. (Earlier versions kept the center ray at full P, producing a 2× hot dot on axis.)

Default polarization for all sources: linear along world `+x` (`{ x: {re:1, im:0}, y: {re:0, im:0} }`). Insert a half-wave plate (fast axis 45°) upstream if you need linear-Y instead.

Source-specific notes:

- **Laser**: single wavelength, `beamRadius` is the 1/e² Gaussian waist.
- **Lamp**: multi-wavelength incoherent broadband; emits a separate bundle per spectral line, tagged `sourceId = "${lampId}_${nm}nm"`. Has its own `additiveOpacity` for white-balance compositing.
- **Point sources** (`PointSource2D` / `PointSource3D` / `ConeSource3D` / `WedgeSource2D`): isotropic / cone / wedge / 2-D fan. `coneAngle` is the half-angle (radians).
- **StructuredSource**: rasterizes an ASCII glyph (or arbitrary bitmap) into a pattern of lit pixels; emits a parallel collimated ray from each pixel.

---

## 8. Components catalog

This section gives one entry per concrete `OpticalComponent` subclass. Each entry: physical model • constructor • intersect geometry • interact physics • notable state. Files are under `src/physics/components/`.

### 8.1 Sources

| Class | Model | Constructor (key args) | Notes |
| ----- | ----- | ---------------------- | ----- |
| `Laser` | Coherent monochromatic source | `Laser(name)`; sets `wavelength` (532 nm default), `beamRadius`, `power` | AABB housing absorbs external rays. Ray emission via `SourceRayFactory`. |
| `Lamp` | Broadband incoherent multi-line | `Lamp(name)`; `spectralWavelengths[]`, `power`, `beamRadius`, `sourcePointCount` | Emits a separate ring bundle per wavelength. |
| `PointSourceBase` | Abstract emitter | `PointSourceBase(name)` | `intersect()` returns null; subclasses define angular sampling. |
| `PointSource2D` | Radial fan in local XZ | inherits | For 2-D pedagogical demos. |
| `PointSource3D` | 4π isotropic point | inherits | Backward-trace target for fluorophores. |
| `ConeSource3D` | Cone with `halfAngle` | inherits | Mimics fiber output / NA-limited point. |
| `WedgeSource2D` | 2-D fan with `subtendedAngle` | inherits | Slice of a cone in local XZ. |
| `StructuredSource` | Pattern emitter (ASCII glyph) | rasterises `asciiChar` over `diameter` mm aperture | One collimated ray per lit pixel. |

### 8.2 Lenses

| Class | Model | Notes |
| ----- | ----- | ----- |
| `SphericalLens` | Thick spherical lens (BVH-ray-cast `OpticMesh`, two surfaces with R₁, R₂) | Supports lens presets via `setFromLensType`. Wavelength-dependent IOR via Cauchy. Tangential and sagittal share the same transform. |
| `CylindricalLens` | Plano- or bi-cylindrical (curved in local Y only) | `getParaxialProfile(rayDir)` returns separate tangential / sagittal transforms. |
| `IdealLens` | Aberration-free thin phase sheet `Δφ = −h²/(2f)` | One radius (`focalLength`), circular aperture. ABCD = `[1, 0, −1/f, 1]`. Use this for paraxial scopes; no chromatic aberration. |
| `AchromatDoublet` | Cemented crown + flint (R₁/R₂/R₃, two thicknesses, two IORs, ~10 μm cement gap) | Both surfaces have full Snell + Fresnel. Wavelength-dependent IORs via Cauchy from reference. |
| `PrismLens` | Triangular prism via `AbstractPolygonOptic` | Per-face curvature and refractive/reflective/absorbing modes. Returns separate tangential/sagittal transfer matrices computed by tracing through the polygon. |
| `Objective` | Aplanatic phase surface satisfying the Abbe sine condition `sin θ = h / f` | See §9.2. |
| `ObjectiveCasing` | Visual barrel only | `intersect()` null, `interact()` passthrough. No effect on light. |

### 8.3 Mirrors and beam splitters

| Class | Model | Notes |
| ----- | ----- | ----- |
| `Mirror` | Flat circular reflector, two faces (front/back) | Reflects on the front face, absorbs on the back. π phase flip on reflection. `reflectAt(x,y,z, dIn, dOut)` orients the mirror to deflect a known beam. Aperture is finite, so the same mirror can be hit twice in one ray path. |
| `CurvedMirror` | Spherical concave/convex; sag-based front + flat back + cylindrical rim | `f = R/2`. ABCD `[1, 0, −2/R, 1]`. |
| `BeamSplitter` | Non-polarizing splitter at `splitRatio` (default 0.5) | Both transmitted and reflected children inherit polarization. π phase flip on reflection. |
| `PolarizingBeamSplitter` | Splits ray by S/P polarization | Reflects S (`E_y`), transmits P (`E_x`); both outputs are unit-Jones. (Caveat in §1.) |
| `DichroicMirror` | Wavelength-selective splitter, transmission from `SpectralProfile` | Transmitted intensity = `intensity · T(λ)`, reflected = `intensity · (1 − T(λ))`. |

### 8.4 Scanners

| Class | Model | Notes |
| ----- | ----- | ----- |
| `GalvoScanHead` | Single galvanometer with `scanX`, `scanY` (radians, mechanical) | Reflective plane; outgoing ray gets `2·scanX` / `2·scanY` rotation about local Y / X (mirror-doubling). Beam exits from the pivot regardless of scan angle. |
| `DualGalvoScanHead` | Two close-coupled `Mirror` sub-components separated by `mirrorSpacing` | Owns its children; `getAnimationChannels()` returns sinusoidal channels for `scanX`, `scanY`. The pair gives proper conjugate scanning for confocal preset. |
| `PolygonScanner` | N-faceted reflective polygon (extends `AbstractPolygonOptic`) | `numFaces`, `inscribedRadius`, `faceHeight`, `scanAngle` (rotation around extrusion axis). |
| `AOD` | Acousto-optic deflector | `interact()` outputs both 0th-order (intensity·(1−η)) and 1st-order deflected ray (intensity·η, deflected by `deflectionAngle` about local Y). |
| `AbstractPolygonOptic` | Editable polygon profile + extrusion | Parent class for `PrismLens` and `PolygonScanner`. Per-face curvature / mode (refractive, reflective, absorbing). |

### 8.5 Polarization

| Class | Model | Notes |
| ----- | ----- | ----- |
| `Waveplate` | Half-wave / quarter-wave / linear polarizer | Modes `'half'`, `'quarter'`, `'polarizer'`. `fastAxisAngle` in radians. Polarizer mode attenuates intensity (projection); waveplates leave intensity alone. |
| `FaradayIsolator` | Non-reciprocal 45° rotator | Forward: throughput = `insertionLoss` (≈0.95). Backward: throughput = `10^(-extinctionDB/10)`. The **same** rotation is applied both directions, hence the asymmetry. |
| `PupilMaskElement` | Amplitude / phase mask in a pupil plane | `mode = 'uniform'/'annulus'/'phaseRing'`. Internally a normalized bitmap (`resolution × resolution`); `interact` samples the mask at the local hit point and applies amplitude × phase via Jones rotation. |

### 8.6 Apertures and blockers

| Class | Model | Notes |
| ----- | ----- | ----- |
| `Aperture` | Annular iris/tube: clear inner bore + opaque ring/barrel inside outer housing | `thickness` controls body length along the optical axis. `intersect` flags `isBlocked = true` for ring, barrel, and bore-wall hits; clear-bore cap hits pass through so targeting still sees the aperture. `openingDiameter`/2 is exposed as `openingRadius` on the kernel snapshot for Solver 3 importance sampling. |
| `SlitAperture` | Rectangular slit | `getParaxialProfile()` returns axis-asymmetric apertures (only X is clipped). |
| `DoubleSlit` | Two parallel rectangular slits separated by `slitSeparation` | For interference demos. Pass / absorb. |
| `Blocker` | Solid opaque cylinder | All hits absorbed. |
| `Diffuser` | Frosted glass | `interact` scatters the outgoing ray uniformly within a cone (`coneHalfAngle`) using a deterministic seed from the hit point. |

### 8.7 Filters

| Class | Model | Notes |
| ----- | ----- | ----- |
| `Filter` | Spectral transmission filter | `intensity *= profile.getTransmission(λ_nm)` if above a minimum threshold; otherwise absorbed. |

### 8.8 Detectors

| Class | Model | Notes |
| ----- | ----- | ----- |
| `Camera` | 2-D imaging sensor (`sensorResX × sensorResY`) | Solver 3 stores `solver3Image` (emission), `forwardImage` (excitation), optional `scanFrames` for time-series. `samplesPerPixel` controls Monte-Carlo budget. |
| `PMT` | Point detector with `axisBindings` to two animated properties (galvo `scanX`/`scanY`) | Raster-scans by setting bound channels per pixel and reading total radiance. Stores `scanImage` (emission), `scanExcitationImage` (excitation). `sensorNA` is the acceptance cone for backward sampling. |
| `QPD` | 4-quadrant photodiode | Bins each forward hit into one of A/B/C/D quadrants by local position; reports `signalX`, `signalY`, `signalSum`. Reset via `resetAccumulator()`. |
| `Card` | Probe / viewing screen | Records every hit (`hits[]` plus optional beam profiles). When `opaque = false` it passes rays through; when true it terminates them. |

### 8.9 Samples & media

| Class | Model | Notes |
| ----- | ----- | ----- |
| `Sample` | The "Mickey Mouse" specimen — three spheres at canonical positions | `intersect` is the holder AABB; `interact` is pass-through (no TIR trapping). The work happens in Solver 3: `computeChordSegments(worldRay)` returns the in-sphere intervals so the kernel can integrate Beer–Lambert absorption × `fluorescenceEfficiency × excitationSpectrum.getTransmission(λ)`. Emission wavelength is sampled from `emissionSpectrum`. `specimenOffset` and `specimenRotation` move the specimen inside the holder for animation/scanning. |
| `SampleChamber` | "X" sample holder cube with bores on each face | Subclass of `Sample`; adds `snapPorts` for placing components flush against a face, and `fillMediumIndex` (default 1.33 = water) so Solver 3 treats the cavity as immersion. |
| `MediumVolume` | Refractive volume (box or tapered "bridge" cone) | Snell refraction at every face with full Fresnel: spawns a transmitted ray (intensity × (1 − R)) and, when R > 0.01, a reflected ray (intensity × R). Wavelength-dependent IOR via Cauchy. **Caveat:** the Fresnel reflection is the source of "back-reflection ghosts" if you naively wrap the objective/sample in a bridge — see the `confocal` preset for the rationale for keeping the bridge disabled. |

### 8.10 Hardware / annotation

| Class | Model | Notes |
| ----- | ----- | ----- |
| `Rail` | Two-point optical rail | Non-optical (`intersect` returns null). Used for snap placement and presentation. `axisLock` constrains Z. Static `TABLE_Z = -42` mm. |
| `Annotation` | Text / arrow / curved arrow overlay | No physics; `intersect` null, `interact` empty. Carries `kind`, `text`, `length`, `fontSize`, `color`. |

---

## 9. Notable physics specifics

### 9.1 Mirror / lens orientation in presets

The convention `pointAlong(normalize(d_in − d_out))` orients a mirror to deflect a beam from `d_in` to `d_out`. `Mirror.reflectAt(x, y, z, d_in, d_out)` is the convenience helper. Don't compute mirror normals by hand — both Sidebar workflows and the preset library rely on this formula.

### 9.2 Objective: Abbe sine condition

`Objective` is a **single zero-thickness aplanatic surface** — not a stack of glass. It rigorously satisfies `sin θ = h / f` at any NA, so it is free of spherical aberration and coma at all field heights. The intersection is a sphere of radius `f` centered at `(0, 0, −f)` in local space, clipped to the clear aperture and the physical barrel cone. The interaction maps:

- **Forward** (ray from sample side, `dirIn.z > 0`): take the ray's projection onto the front focal plane `z = −f`; emit a parallel beam in the direction `(s_x/f, s_y/f, +√(1 − s_x²/f² − s_y²/f²))`.
- **Backward** (ray from image side, `dirIn.z < 0`): the incoming direction *is* the parallel-beam direction, so the conjugate sample point is `(f·d.x, f·d.y, −f)`; emit a converging ray from the hit point toward that conjugate.

Because all hit points lie on the reference sphere, the OPL through the objective is constant at `f · n_immersion`, so no per-height phase correction is added.

`focalLength = tubeLensFocal / magnification`, `apertureRadius = focalLength · NA`, `maxAngle = arcsin(NA / immersionIndex)`. The barrel taper plus cylinder accurately blocks rays that miss the clear aperture, including from below.

`immersionIndex` currently affects the maximum acceptance angle and OPL, but does **not** modify the propagation of other rays through the workspace volume. Until a `MediumVolume` system is wired up around the objective, presets that need oil/water immersion should treat the index as a post-hoc OPL adjustment.

### 9.3 Spectral profiles and dispersion

`SpectralProfile` (`src/physics/SpectralProfile.ts`) is the universal wavelength filter for `Filter`, `DichroicMirror`, sample excitation/emission. Presets:

- `longpass(cutoffNm, edgeSteepness)` → `T(λ) = sigmoid(λ − cutoff)`
- `shortpass(cutoffNm, edgeSteepness)` → `T(λ) = sigmoid(cutoff − λ)`
- `bandpass(cutoffNm, [{center, width}], edgeSteepness)` → product of two opposed sigmoids
- `multiband(...)` → max over multiple bands

`edgeSteepness` is the transition width in nm (smaller = sharper rolloff). Bands are stored as `{center: nm, width: FWHM nm}`.

`src/physics/dispersion.ts` provides Cauchy-equation refractive-index lookups:

```ts
n(λ) = a + b/λ²
cauchyIorFromReference(n_ref_at_550nm, λ_in_meters, { abbeNumber, family })
```

`abbeNumber` defaults are computed from a glass/liquid family table. Used by every component that has a real `ior` field (`SphericalLens`, `AchromatDoublet`, `PrismLens`, `MediumVolume`).

### 9.4 Math helpers (`src/physics/math_solvers.ts`)

| Function                                | Purpose                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `reflectVector(I, N)`                   | `R = I − 2(N·I)N`                                                                        |
| `refractPhaseSurface(I, N, ∇φ, n1, n2)` | Generalised Snell with a tangential phase gradient (used by `IdealLens`, masks)          |
| `intersectAABB(o, d, box)`              | Slab method, robust to direction components of zero                                       |
| `solveQuadratic(A, B, C)`               | Sorted real roots                                                                         |
| `cleanVec(v, eps)`                      | Snap near-zero components to exactly zero (kills NaN-from-degenerate-geometry)            |
| `erf(x)`                                | Abramowitz & Stegun 7.1.26 (1.5e-7 accurate)                                              |

---

## 10. Animation: `PropertyAnimator`

`src/physics/PropertyAnimator.ts` defines:

```ts
interface AnimationChannel {
    id: string;
    targetId: string;        // component.id
    property: string;        // 'panAngle' | 'tiltAngle' | 'rollAngle' |
                             // 'position.x' | 'rotation.y' | 'scanX' | 'scanY' | …
    from: number; to: number;
    easing: 'linear' | 'sinusoidal' | 'discrete';
    periodMs: number;        // ms per full cycle
    repeat: boolean;         // if false, hold at `to` after one cycle
    discreteSteps?: number;  // for filter wheels / step functions
    restoreValue?: number;   // applied when channel is removed
}
```

`evaluateEasing(t)` normalizes time to `[0, 1]` per cycle (or clamps if `!repeat`). Sinusoidal channels oscillate around `(from + to)/2` with amplitude `(to − from)/2`; discrete channels step through `discreteSteps` integer positions. `setProperty` knows how to dispatch to scalar fields, `position.{x|y|z}`, `rotation.{x|y|z}` (legacy Euler), and the galvo-specific `scanX`/`scanY` (which require neither matrix re-build nor mesh invalidation). Every mutation bumps `component.version` so caches downstream invalidate.

A preset hands its `channels` array to `loadPresetAtom`, which adds each one to the global animator. Per frame, the UI advances the animator clock, the animator mutates components, and the solvers re-run. There is no temporal physics — each frame is a fresh snapshot.

---

## 11. State management (Jotai)

`src/state/store.ts` wires everything together. Atoms are grouped by purpose:

- **Scene**: `componentsAtom` (the live `OpticalComponent[]`), `selectionAtom` (multi-select IDs), `pinnedViewersAtom` (Set of component IDs whose detector viewers are visible), `activeZLevelAtom` (which Z-slice is "active" for placing new components — never used to coerce existing component positions, see §3 axis-lock semantics).
- **Presets**: `activePresetAtom` (current `PresetName` or null), `presetDescriptionAtom`, `loadPresetAtom` (write-only action).
- **Loading scenes from outside** (URL hash, file picker): `loadSceneAtom`.
- **Undo**: `undoStackAtom` (max 20), `pushUndoAtom`, `undoAtom`. Snapshots use `serializeScene` / `deserializeScene` so undo is structurally identical to load-from-file.
- **Animation**: `animatorAtom`, `animationPlayingAtom`, `animationSpeedAtom`.
- **Forward tracer config**: `rayConfigAtom` (`rayCount`, `solver2Enabled`, `viewerMode: 'rods' | 'wave'`, opacity bounds).
- **Solver 3 lifecycle**: `solver3RenderTriggerAtom`, `solver3RenderingAtom`, `cameraImageTickAtom` (forces React to repaint progressive images that are mutated in place), `scanAccumTriggerAtom` / `scanAccumProgressAtom` for PMT raster scans.
- **Cameras / view**: `isOrthoAtom`, `cameraBlendAtom`, `mobileCameraModeAtom`, `resetViewSignalAtom`, `zoomToComponentAtom`.

`PresetResult`:

```ts
interface PresetResult {
    scene: OpticalComponent[];
    description?: string;
    channels?: AnimationChannel[];
    animationPlaying?: boolean;
    animationSpeed?: number;
    rayCount?: number;          // override DEFAULT_RAY_CONFIG.rayCount
}
```

`loadPresetAtom(presetName)`:
1. Sets `activePresetAtom`.
2. Replaces the URL with `?preset=<slug>` via `history.replaceState` (drops any leftover `#scene=` hash).
3. Clears undo stack, resets ray config (with optional `rayCount` override), zeroes Z-level.
4. Calls the registered factory.
5. Replaces `componentsAtom` with the new scene, sets description.
6. Resets the animator and adds preset channels.
7. Pins detectors (`Camera` and PMTs with axis bindings) and bumps `solver3RenderTriggerAtom` so the first image is rendered without manual intervention. For OpenSPIM specifically, `Sample` and `SampleChamber` are also auto-pinned.
8. If channels are present and there are PMTs, kicks off `scanAccumTriggerAtom` so scans start automatically.

`loadSceneAtom(components)` is the deserialization path — clears animation, presets, undo, view config, then `set(componentsAtom, components)` and clears the URL.

---

## 12. Component factory & registry

`src/physics/ComponentRegistry.ts` is the canonical map between **type name strings** (used in `.ubz` and the URL-hash format) and **constructors / instance checks**. The order of entries matters: more specific subclasses (`CurvedMirror` before `Mirror`, `DichroicMirror` before `Mirror`) must come first so `getComponentTypeName(comp)` returns the right tag for an `instanceof` check.

`createComponentForType(type, …)` (in `src/ui/componentFactory.ts`) is the inverse — it builds a fresh component from a short string id (`'achromatDoublet'`, `'mirror'`, etc.) and is what drag-and-drop / palette UI calls. New component classes must be added to **both** the registry (for serialize/deserialize) and the factory (for UI placement).

---

## 13. Serialization (`.ubz` format)

`src/state/ubzSerializer.ts`. `.ubz` is a plain-text INI-flavoured format — one block per component, blank lines separating blocks:

```
# Microscope Builder Scene (.ubz)
# Saved: 2026-04-25T01:12:34.567Z

[Laser]
id = 6baacca0-30a0-4653-b134-75c94f515f87
name = 488 nm Laser
position = -232.5, 112.5, 0
rotation = 1.5707963, 1.5707963, 0
wavelength = 488
beamRadius = 0.1
power = 1

[AchromatDoublet]
…
```

Conventions:

- Vectors → comma-separated floats.
- `rotation` is **Euler angles in radians**, derived from the live quaternion via `new Euler().setFromQuaternion(…)`.
- `axisLock` is omitted when locks are at defaults (`{x: false, y: false, z: true}`); otherwise serialised as `axisLock = x,y,z`.
- Spectra serialise as `prefix.preset = …`, `prefix.cutoffNm = …`, `prefix.edgeSteepness = …`, `prefix.bands = center:width;center:width`.
- `Sample` adds `excitation.*` and `emission.*` blocks plus `fluorescenceEfficiency`, `absorption`, `specimenRotation`, `specimenOffset`.

The serializer **skips** any component with `isGhost` or `isSubComponent === true`. Sub-components are rebuilt from the parent on load (`scene.push(...comp.getManagedSubcomponents())` after construction).

`encodeSceneToUrlHash(scene)` runs the text through UTF-8 → base64 → URL-safe substitution (`+/=` → `-_~`). `loadSceneFromUrlHash()` reverses it. `generateSceneUrl(components)` returns `<base>#scene=<encoded>`. Both are wired into `App.tsx`'s startup effect: a `#scene=` hash always wins over `?preset=…`, so a Share link can be opened on top of any default preset.

---

## 14. What you'd need to recreate this

Minimum viable port:

1. **Math + types.** `Vector3`, `Quaternion`, `Box3` (Three.js or your own); `Ray`, `HitRecord`, `InteractionResult`, `JonesVector`, `Complex` types. Helpers: `reflectVector`, `intersectAABB`, `cleanVec`.
2. **`OpticalComponent` base class.** `id`, `position`, `rotation`, `panAngle/tilt/roll`, `axisLock`, `bounds`, `version`, `chkIntersection` driving `intersect` / `interact`. Provide `pointAlong`, `setPosition`, `setRotation`, `updateMatrices`, `recomputeRotation`.
3. **A handful of starter components** to bootstrap a useful scene: `Laser`, `Mirror`, `IdealLens`, `Aperture`, `Camera` (for image), `Sample` (with chord intersection + emission spectrum), `SpectralProfile`. These give you a forward and backward pipeline end-to-end.
4. **Solver 1.** Recursive depth-limited ray tracer with NaN guard, branching, and the passthrough optimization. Filter `isGhost` up front.
5. **`SourceRayFactory`.** Center ray + Gaussian ring sampling per source; per-wavelength bundles for any multi-line source.
6. **Solver 3 + scene snapshot + worker.** Backward Monte-Carlo from each detector pixel; importance sampling toward the first aperture in front of the detector; sample chord integration for fluorescence; progressive accumulation with a `version` check to discard stale frames.
7. **`PropertyAnimator`** so the same scene can drive scans, oscillating mirrors, and live moving optics without re-running the whole simulation lifecycle.
8. **Component registry + serializer** so you can persist scenes and share URLs round-trip.
9. **Solver 2** can be deferred — most beam visualization works fine from Solver 1 footprints alone.

After that, the rest of the components are independent: each one is a self-contained `intersect` + `interact` pair plus optional `getParaxialTransform` / `getAnimationChannels` / `getManagedSubcomponents`. You can grow the catalog incrementally without touching the engine.
