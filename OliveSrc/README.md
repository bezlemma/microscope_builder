# Olive Optics Simulator - Architectural Overview

This document explains the core architecture of the Olive Optics Simulator, based on an analysis of its production code.

## 1. Hybrid Simulation Engine
The simulator uses a dual-path approach for ray tracing:

- **CPU Path (Three.js/JS)**: Used for interactive gizmos, 2D cross-sections, and UI-driven calculations.
- **GPU Path (WebGPU/WGSL)**: Used for high-volume ray tracing (up to 2 million rays). This path handles complex physical interactions like:
  - **Aspheric Surfaces**: Using a cylinder-constrained Newton-Raphson solver.
  - **Refraction**: Supporting Sellmeier, Schott, and Power Series dispersion formulas.
  - **Diffraction**: Supporting multi-order gratings.
  - **Binary/Fresnel Elements**: Using ring-zone logic.

## 2. Key Components

### `RayTracerGPU` (src/simulation/RayTracerGPU.js)
The orchestrator that bridges JavaScript and the GPU. It:
1.  Packs scene data (Sources, Surfaces) into linear memory buffers.
2.  Handles the strict byte-alignment required by WGSL structs (e.g., the 136-float `Surface` struct).
3.  Manages the "Indirect Draw" buffer, allowing the GPU to determine how many ray segments were actually generated.

### `Intersections.wgsl` (src/simulation/Intersections.wgsl)
The high-performance core. Unlike standard ray tracers that use recursive calls (not supported in WGSL), it uses an **iterative bounce loop** with a pre-allocated `RaySegment` buffer to store the light paths.

### `Physics` (src/core/Physics.js)
Contains the mathematical models for physical properties:
- **Refractive Index**: Implements standard glass data formulas (Sellmeier type 1/2, Schott).
- **Polarization**: Calculations for Jones matrices and retarders.

## 3. Data Flow
1.  **State Change**: User moves a lens in the UI (Vue/Pinia).
2.  **Sync**: `ElementStore` updates the shared scene model.
3.  **Bake**: `RayTracerGPU` transforms the object-oriented scene into flat `Float32Arrays`.
4.  **Compute**: The WebGPU kernel calculates ray-surface intersections for every ray in parallel.
5.  **Render**: Three.js draws the resulting `RaySegment` buffer using an instanced line shader.

## 4. Comparison Points for your Simulator
- **Optimization**: This simulator avoids JS overhead during tracing by offloading the math to a WebGPU Compute Shader.
- **Surface Complexity**: Support for Aspheric polynomials (A4-A16) is a high-end feature not found in basic simulators.
- **Integration**: The tight coupling between the CAD-like editor (Konva.js/Three.js) and the physical solver.
