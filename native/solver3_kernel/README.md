# Solver 3 Native Kernel Scaffold

This crate is the initial Rust-side anchor for the reverse-trace port.

It does not implement the camera or PMT reverse solver yet. What it does do is:

- pin the current packet ABI version
- pin the packed array strides used by the TypeScript host
- expose a minimal exported interface that a wasm loader can validate before dispatch

The current production path is still the JavaScript backend in `src/physics/solver3Host.ts`.
The next port step is to move a camera render entry point from that backend into this crate,
reading the packed scene, detector, and beam packets defined on the TypeScript side.
