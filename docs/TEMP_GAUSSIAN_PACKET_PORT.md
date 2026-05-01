# Temporary Gaussian Packet Port Notes

This note exists so the BOMB-to-microscope_builder_4 port survives context
compaction. It is intentionally temporary and should be folded into permanent
engine docs after the packet model stabilizes.

## Boundary

We are porting the parts of BOMB where a geometric ray is also the centerline
of a Gaussian Packet. We are not porting wave tracing, cone expansion,
field-to-ray reconstruction, reverse readback, or intermediate wave solvers.

Allowed:

- Source launch that creates stable Gaussian Packet quadrature samples.
- Packet metadata on every ray: power, phase, q-state, sigma, curvature, axes,
  source cell area, medium index.
- Centerline-only packet transport through existing interactions.
- Final-plane reconstruction at detectors, cards, or optical plane inspectors.

Not allowed in this port:

- Using packet support radius for object intersection.
- Creating diffracted child rays from aperture edges.
- Rebuilding rays from a reconstructed field.
- Passing a wave field to another optical plane.
- Native kernels before the TypeScript path is validated.

## Design

`Ray` remains the engine primitive. A ray is now interpreted as the centerline
of a Gaussian Packet. Intersections stay geometric and use the centerline only.
Every child ray is finalized through `childRay`, so each component inherits and
updates packet fields without each component having to duplicate boilerplate.

The first port layer is:

- `gaussianPacketState.ts`: pure q-parameter math from BOMB.
- `coherentPacketLaunch.ts`: source cell area to packet sigma/q.
- `rigorousSourceLaunchers.ts`: source launch for Laser, Lamp, StructuredSource.
- `rayTransport.ts`: packet q propagation and representative radius helpers.
- `types.ts`: canonical `createRay` / `childRay`.

## Current Implementation State

Implemented in the first pass:

- `Ray` carries packet metadata directly: q-state, transverse axes, sigma,
  curvature, power weight, source cell area, phase, medium index, and launch
  rigor.
- `createRay` and `childRay` finalize packet invariants. Legacy components can
  keep setting `intensity`; `childRay` keeps `powerWeight` aligned.
- Laser, lamp, and structured sources use rigorous coherent packet launchers and
  are marked `packetLaunchRigor: "rigorous"`.
- Point, cone, wedge, and PMT preview rays remain geometric source samples and
  are marked `packetLaunchRigor: "geometricFallback"`.
- Solver 1 centrally applies reflected packet frames and component paraxial q
  transforms after each component interaction. Non-identity component transforms
  now use the parent packet state at the hit plane, avoiding double-counted
  propagation through thick optics.
- Medium transitions update `currentMediumIndex` and convert q so physical
  packet width/curvature stay continuous across the boundary.
- Cards and Cameras now collect `packetHits` as terminal detector-plane records
  for final-plane field synthesis.
- Optical Plane View can collect virtual terminal packet hits at the selected
  landmark plane from traced ray paths.
- Terminal packet analysis computes a sampled PSF field, encircled-energy radii,
  radial MTF, inferred Strehl, and packet-validity status.
- QPD accumulation reads `powerWeight` rather than only legacy `intensity`.
- Component conformance tests cover split power, polarization filtering, packet
  radius versus geometric intersection, lens focusing, and objective focusing.

Still deliberately not implemented:

- Intermediate wave propagation from one reconstructed field to another.
- Recreating rays from a reconstructed field.
- Cone expansion or packet support-radius intersection.
- Native kernel packet transport before the TypeScript path is validated.
- Rigorous directional Gaussian Packet launches for point/cone/wedge sources;
  those sources remain explicit `geometricFallback` and are not PSF-valid.

## Expected Follow-Up

The PSF/MTF plane analyzer consumes terminal packet hits and synthesizes a field
on the chosen final plane. That field remains an endpoint diagnostic, not a new
transport state.
