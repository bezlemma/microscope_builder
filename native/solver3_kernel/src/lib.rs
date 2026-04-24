pub const SOLVER3_KERNEL_ABI_VERSION: u32 = 1;
pub const PACKED_COMPONENT_MATRIX_STRIDE: u32 = 16;
pub const PACKED_COMPONENT_BOUNDS_STRIDE: u32 = 6;
pub const PACKED_DETECTOR_BASIS_STRIDE: u32 = 12;
pub const PACKED_BEAM_SEGMENT_SCALAR_STRIDE: u32 = 27;
pub const PACKED_CAMERA_SAMPLE_STRIDE: u32 = 10;
pub const PACKED_SURFACE_PARAM_STRIDE: u32 = 8;

pub const SURFACE_KIND_UNSUPPORTED: u8 = 0;
pub const SURFACE_KIND_FLAT_DISC: u8 = 1;        // params: inner_r, outer_r, absorbs_ring (1|0)
pub const SURFACE_KIND_THICK_LENS: u8 = 2;       // params: R1, R2, thickness, aperture, ior

pub const STATUS_OK: u32 = 0;
pub const STATUS_UNSUPPORTED_ABI: u32 = 1;
pub const STATUS_UNIMPLEMENTED: u32 = 2;

#[repr(C)]
pub struct Solver3PacketHeader {
    pub abi_version: u32,
    pub trace_component_count: u32,
    pub beam_branch_count: u32,
    pub beam_segment_count: u32,
    pub detector_kind: u32,
}

#[no_mangle]
pub extern "C" fn solver3_kernel_abi_version() -> u32 {
    SOLVER3_KERNEL_ABI_VERSION
}

#[no_mangle]
pub extern "C" fn solver3_trace_component_matrix_stride() -> u32 {
    PACKED_COMPONENT_MATRIX_STRIDE
}

#[no_mangle]
pub extern "C" fn solver3_trace_component_bounds_stride() -> u32 {
    PACKED_COMPONENT_BOUNDS_STRIDE
}

#[no_mangle]
pub extern "C" fn solver3_detector_basis_stride() -> u32 {
    PACKED_DETECTOR_BASIS_STRIDE
}

#[no_mangle]
pub extern "C" fn solver3_beam_segment_scalar_stride() -> u32 {
    PACKED_BEAM_SEGMENT_SCALAR_STRIDE
}

#[no_mangle]
pub extern "C" fn solver3_camera_sample_stride() -> u32 {
    PACKED_CAMERA_SAMPLE_STRIDE
}

#[no_mangle]
pub extern "C" fn solver3_surface_param_stride() -> u32 {
    PACKED_SURFACE_PARAM_STRIDE
}

#[no_mangle]
pub extern "C" fn solver3_validate_packet_header(header: *const Solver3PacketHeader) -> u32 {
    if header.is_null() {
        return STATUS_UNSUPPORTED_ABI;
    }

    let header = unsafe { &*header };
    if header.abi_version != SOLVER3_KERNEL_ABI_VERSION {
        return STATUS_UNSUPPORTED_ABI;
    }

    STATUS_OK
}

#[no_mangle]
pub extern "C" fn solver3_render_camera_stub(_header: *const Solver3PacketHeader) -> u32 {
    STATUS_UNIMPLEMENTED
}

fn rng_next(state: &mut u64) -> f64 {
    *state = state
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1);
    let bits = *state >> 11;
    (bits as f64) / ((1u64 << 53) as f64)
}

fn normalize3(x: f64, y: f64, z: f64) -> (f64, f64, f64) {
    let len = (x * x + y * y + z * z).sqrt();
    if len <= 1e-12 {
        return (0.0, 0.0, 1.0);
    }
    (x / len, y / len, z / len)
}

#[no_mangle]
pub extern "C" fn solver3_erf(mut x: f64) -> f64 {
    let sign = if x >= 0.0 { 1.0 } else { -1.0 };
    x = x.abs();
    let p = 0.3275911;
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;
    let t = 1.0 / (1.0 + p * x);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * (-x * x).exp();
    sign * y
}

fn transform_point(matrix: &[f64], point: (f64, f64, f64)) -> (f64, f64, f64) {
    (
        matrix[0] * point.0 + matrix[4] * point.1 + matrix[8] * point.2 + matrix[12],
        matrix[1] * point.0 + matrix[5] * point.1 + matrix[9] * point.2 + matrix[13],
        matrix[2] * point.0 + matrix[6] * point.1 + matrix[10] * point.2 + matrix[14],
    )
}

fn transform_direction(matrix: &[f64], dir: (f64, f64, f64)) -> (f64, f64, f64) {
    normalize3(
        matrix[0] * dir.0 + matrix[4] * dir.1 + matrix[8] * dir.2,
        matrix[1] * dir.0 + matrix[5] * dir.1 + matrix[9] * dir.2,
        matrix[2] * dir.0 + matrix[6] * dir.1 + matrix[10] * dir.2,
    )
}

fn ray_aabb_t_near(origin: (f64, f64, f64), dir: (f64, f64, f64), bounds: &[f64]) -> Option<f64> {
    let mut t_min = f64::NEG_INFINITY;
    let mut t_max = f64::INFINITY;
    let axes = [
        (origin.0, dir.0, bounds[0], bounds[3]),
        (origin.1, dir.1, bounds[1], bounds[4]),
        (origin.2, dir.2, bounds[2], bounds[5]),
    ];

    for (o, d, b_min, b_max) in axes {
        if d.abs() <= 1e-12 {
            if o < b_min || o > b_max {
                return None;
            }
            continue;
        }

        let inv_d = 1.0 / d;
        let mut t1 = (b_min - o) * inv_d;
        let mut t2 = (b_max - o) * inv_d;
        if t1 > t2 {
            std::mem::swap(&mut t1, &mut t2);
        }
        t_min = t_min.max(t1);
        t_max = t_max.min(t2);
        if t_max < t_min {
            return None;
        }
    }

    if t_max <= 0.0 {
        return None;
    }

    Some(t_min.max(0.0))
}

fn insert_candidate(
    indices: &mut [i32],
    t_nears: &mut [f64],
    count: &mut usize,
    max_candidates: usize,
    component_index: i32,
    t_near: f64,
) {
    let mut insert_at = 0usize;
    while insert_at < *count && t_nears[insert_at] <= t_near {
        insert_at += 1;
    }

    if *count < max_candidates {
        let upper = *count;
        for i in (insert_at..upper).rev() {
            indices[i + 1] = indices[i];
            t_nears[i + 1] = t_nears[i];
        }
        indices[insert_at] = component_index;
        t_nears[insert_at] = t_near;
        *count += 1;
        return;
    }

    if insert_at >= max_candidates {
        return;
    }

    for i in (insert_at..max_candidates - 1).rev() {
        indices[i + 1] = indices[i];
        t_nears[i + 1] = t_nears[i];
    }
    indices[insert_at] = component_index;
    t_nears[insert_at] = t_near;
}

#[no_mangle]
pub extern "C" fn solver3_generate_camera_samples(
    header_ptr: *const Solver3PacketHeader,
    detector_basis_ptr: *const f64,
    detector_scalars_ptr: *const f64,
    detector_ints_ptr: *const u32,
    row_offsets_ptr: *mut u32,
    output_ptr: *mut f64,
    sample_count: u32,
    seed: u64,
) -> u32 {
    if solver3_validate_packet_header(header_ptr) != STATUS_OK {
        return 0;
    }
    if detector_basis_ptr.is_null()
        || detector_scalars_ptr.is_null()
        || detector_ints_ptr.is_null()
        || row_offsets_ptr.is_null()
        || output_ptr.is_null()
    {
        return 0;
    }

    let basis = unsafe { std::slice::from_raw_parts(detector_basis_ptr, PACKED_DETECTOR_BASIS_STRIDE as usize) };
    let scalars = unsafe { std::slice::from_raw_parts(detector_scalars_ptr, 3) };
    let ints = unsafe { std::slice::from_raw_parts(detector_ints_ptr, 3) };
    let row_offsets = unsafe { std::slice::from_raw_parts_mut(row_offsets_ptr, ints[1] as usize + 1) };
    let output = unsafe { std::slice::from_raw_parts_mut(output_ptr, sample_count as usize * PACKED_CAMERA_SAMPLE_STRIDE as usize) };

    let width = scalars[0];
    let height = scalars[1];
    let sin_theta_max = scalars[2].min(1.0).max(0.0);
    let res_x = ints[0] as usize;
    let res_y = ints[1] as usize;
    let spp = ints[2] as usize;
    let expected = res_x.saturating_mul(res_y).saturating_mul(spp);
    if expected != sample_count as usize {
        return 0;
    }

    let pos = (basis[0], basis[1], basis[2]);
    let forward = (basis[3], basis[4], basis[5]);
    let u_axis = (basis[6], basis[7], basis[8]);
    let v_axis = (basis[9], basis[10], basis[11]);

    let mut state = if seed == 0 { 0x9e3779b97f4a7c15 } else { seed };
    let mut index = 0usize;

    for py in 0..res_y {
        row_offsets[py] = index as u32;
        for px in 0..res_x {
            let u = (((px as f64) + 0.5) / (res_x as f64) - 0.5) * width;
            let v = (((py as f64) + 0.5) / (res_y as f64) - 0.5) * height;
            let sensor_point = (
                pos.0 + u_axis.0 * u + v_axis.0 * v,
                pos.1 + u_axis.1 * u + v_axis.1 * v,
                pos.2 + u_axis.2 * u + v_axis.2 * v,
            );

            for _ in 0..spp {
                let phi = rng_next(&mut state) * std::f64::consts::PI * 2.0;
                let sin_theta = sin_theta_max * rng_next(&mut state).sqrt();
                let cos_theta = (1.0 - sin_theta * sin_theta).sqrt();
                let (dx, dy, dz) = normalize3(
                    forward.0 * cos_theta + u_axis.0 * (sin_theta * phi.cos()) + v_axis.0 * (sin_theta * phi.sin()),
                    forward.1 * cos_theta + u_axis.1 * (sin_theta * phi.cos()) + v_axis.1 * (sin_theta * phi.sin()),
                    forward.2 * cos_theta + u_axis.2 * (sin_theta * phi.cos()) + v_axis.2 * (sin_theta * phi.sin()),
                );
                let pol_angle = rng_next(&mut state) * std::f64::consts::PI;
                let base = index * PACKED_CAMERA_SAMPLE_STRIDE as usize;
                output[base] = px as f64;
                output[base + 1] = py as f64;
                output[base + 2] = sensor_point.0;
                output[base + 3] = sensor_point.1;
                output[base + 4] = sensor_point.2;
                output[base + 5] = dx;
                output[base + 6] = dy;
                output[base + 7] = dz;
                output[base + 8] = pol_angle.cos();
                output[base + 9] = pol_angle.sin();
                index += 1;
            }
        }
    }
    row_offsets[res_y] = index as u32;
    index as u32
}

#[no_mangle]
pub extern "C" fn solver3_generate_first_hit_hints(
    header_ptr: *const Solver3PacketHeader,
    world_to_local_ptr: *const f64,
    local_bounds_ptr: *const f64,
    component_count: u32,
    sample_scalars_ptr: *const f64,
    sample_count: u32,
    max_candidates: u32,
    candidate_counts_ptr: *mut u8,
    candidate_indices_ptr: *mut i32,
    candidate_t_near_ptr: *mut f64,
) -> u32 {
    if solver3_validate_packet_header(header_ptr) != STATUS_OK {
        return 0;
    }
    if world_to_local_ptr.is_null()
        || local_bounds_ptr.is_null()
        || sample_scalars_ptr.is_null()
        || candidate_counts_ptr.is_null()
        || candidate_indices_ptr.is_null()
        || candidate_t_near_ptr.is_null()
        || max_candidates == 0
    {
        return 0;
    }

    let component_count_usize = component_count as usize;
    let sample_count_usize = sample_count as usize;
    let max_candidates_usize = max_candidates as usize;

    let world_to_local = unsafe {
        std::slice::from_raw_parts(
            world_to_local_ptr,
            component_count_usize * PACKED_COMPONENT_MATRIX_STRIDE as usize,
        )
    };
    let local_bounds = unsafe {
        std::slice::from_raw_parts(
            local_bounds_ptr,
            component_count_usize * PACKED_COMPONENT_BOUNDS_STRIDE as usize,
        )
    };
    let sample_scalars = unsafe {
        std::slice::from_raw_parts(
            sample_scalars_ptr,
            sample_count_usize * PACKED_CAMERA_SAMPLE_STRIDE as usize,
        )
    };
    let candidate_counts = unsafe { std::slice::from_raw_parts_mut(candidate_counts_ptr, sample_count_usize) };
    let candidate_indices = unsafe {
        std::slice::from_raw_parts_mut(
            candidate_indices_ptr,
            sample_count_usize * max_candidates_usize,
        )
    };
    let candidate_t_near = unsafe {
        std::slice::from_raw_parts_mut(
            candidate_t_near_ptr,
            sample_count_usize * max_candidates_usize,
        )
    };

    for sample_index in 0..sample_count_usize {
        let sample_base = sample_index * PACKED_CAMERA_SAMPLE_STRIDE as usize;
        let origin = (
            sample_scalars[sample_base + 2],
            sample_scalars[sample_base + 3],
            sample_scalars[sample_base + 4],
        );
        let direction = (
            sample_scalars[sample_base + 5],
            sample_scalars[sample_base + 6],
            sample_scalars[sample_base + 7],
        );

        let hint_base = sample_index * max_candidates_usize;
        let hint_indices = &mut candidate_indices[hint_base..hint_base + max_candidates_usize];
        let hint_t_nears = &mut candidate_t_near[hint_base..hint_base + max_candidates_usize];
        for i in 0..max_candidates_usize {
            hint_indices[i] = -1;
            hint_t_nears[i] = f64::INFINITY;
        }

        let mut count = 0usize;
        for component_index in 0..component_count_usize {
            let matrix_base = component_index * PACKED_COMPONENT_MATRIX_STRIDE as usize;
            let bounds_base = component_index * PACKED_COMPONENT_BOUNDS_STRIDE as usize;
            let local_origin = transform_point(
                &world_to_local[matrix_base..matrix_base + PACKED_COMPONENT_MATRIX_STRIDE as usize],
                origin,
            );
            let local_direction = transform_direction(
                &world_to_local[matrix_base..matrix_base + PACKED_COMPONENT_MATRIX_STRIDE as usize],
                direction,
            );

            if let Some(t_near) = ray_aabb_t_near(
                local_origin,
                local_direction,
                &local_bounds[bounds_base..bounds_base + PACKED_COMPONENT_BOUNDS_STRIDE as usize],
            ) {
                insert_candidate(
                    hint_indices,
                    hint_t_nears,
                    &mut count,
                    max_candidates_usize,
                    component_index as i32,
                    t_near,
                );
            }
        }

        candidate_counts[sample_index] = count.min(u8::MAX as usize) as u8;
    }

    sample_count
}

// ─── Analytic narrow-phase intersects ────────────────────────────────
//
// Replaces per-component JS intersect() calls for two common surface families:
//   - FLAT_DISC: plane at local z=0, optionally annular (Aperture) or simple
//     disc (Filter, Card, BeamSplitter, DichroicMirror, PolarizingBS).
//   - THICK_LENS: two spherical refracting surfaces clipped by a circular
//     aperture (SphericalLens).  Matches SphericalLens.generateProfile's
//     sphere-centre convention: frontCenter = (0,0,-t/2 + R1), backCenter =
//     (0,0,+t/2 + R2), where R>0 is a convex surface from outside.

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct AnalyticHit {
    pub t: f64,                // parametric distance along local-direction
    pub point: [f64; 3],       // local-frame hit point
    pub normal: [f64; 3],      // local-frame outward normal
    pub is_blocked: u8,        // 1 if absorbed by ring/housing
    pub _pad: [u8; 7],
}

fn ray_flat_disc(
    origin: (f64, f64, f64),
    direction: (f64, f64, f64),
    inner_r: f64,
    outer_r: f64,
    absorbing_ring: bool,
) -> Option<AnalyticHit> {
    let dw = direction.2;
    if dw.abs() < 1e-6 {
        return None;
    }
    let t = -origin.2 / dw;
    if t < 0.001 {
        return None;
    }
    let hx = origin.0 + direction.0 * t;
    let hy = origin.1 + direction.1 * t;
    let r_sq = hx * hx + hy * hy;
    if r_sq > outer_r * outer_r {
        return None;
    }
    let blocked = absorbing_ring && r_sq >= inner_r * inner_r;
    let n_sign = if dw < 0.0 { 1.0 } else { -1.0 };
    Some(AnalyticHit {
        t,
        point: [hx, hy, 0.0],
        normal: [0.0, 0.0, n_sign],
        is_blocked: if blocked { 1 } else { 0 },
        _pad: [0; 7],
    })
}

/// Intersect a ray with a single spherical cap centred at (0, 0, apex_z + r)
/// with signed radius r, clipped to circle of aperture_r in XY.
/// Returns the smallest positive t where the hit is within the aperture AND
/// on the cap (same hemisphere as the apex).  The normal returned is the raw
/// sphere-outward vector — callers flip it based on which lens surface it is.
///
/// For a planar surface (|r| >= 1e8), falls back to plane z = apex_z and
/// returns an outward normal of (0,0,+1).
fn ray_sphere_cap(
    origin: (f64, f64, f64),
    direction: (f64, f64, f64),
    apex_z: f64,
    r: f64,
    aperture_r: f64,
) -> Option<(f64, [f64; 3], [f64; 3])> {
    if r.abs() >= 1e8 {
        let dw = direction.2;
        if dw.abs() < 1e-6 {
            return None;
        }
        let t = (apex_z - origin.2) / dw;
        if t < 0.001 {
            return None;
        }
        let hx = origin.0 + direction.0 * t;
        let hy = origin.1 + direction.1 * t;
        if hx * hx + hy * hy > aperture_r * aperture_r {
            return None;
        }
        return Some((t, [hx, hy, apex_z], [0.0, 0.0, 1.0]));
    }

    let cz = apex_z + r;
    let ox = origin.0;
    let oy = origin.1;
    let oz = origin.2 - cz;
    let b = ox * direction.0 + oy * direction.1 + oz * direction.2;
    let c = ox * ox + oy * oy + oz * oz - r * r;
    let disc = b * b - c;
    if disc < 0.0 {
        return None;
    }
    let sqrt_disc = disc.sqrt();
    let t1 = -b - sqrt_disc;
    let t2 = -b + sqrt_disc;

    // Cap hemisphere test: for r>0 the cap is the side with z < cz (so
    // (hz - cz) * r < 0); for r<0 the cap is z > cz.  Either way the product
    // is negative on the cap.
    let mut best: Option<(f64, [f64; 3], [f64; 3])> = None;
    for t in [t1, t2] {
        if t < 0.001 {
            continue;
        }
        let hx = origin.0 + direction.0 * t;
        let hy = origin.1 + direction.1 * t;
        let hz = origin.2 + direction.2 * t;
        if hx * hx + hy * hy > aperture_r * aperture_r {
            continue;
        }
        if (hz - cz) * r > 0.0 {
            continue;
        }
        if best.map_or(true, |b| t < b.0) {
            let inv_r = 1.0 / r.abs();
            let nx = hx * inv_r;
            let ny = hy * inv_r;
            let nz = (hz - cz) * inv_r;
            best = Some((t, [hx, hy, hz], [nx, ny, nz]));
        }
    }
    best
}

fn ray_thick_lens(
    origin: (f64, f64, f64),
    direction: (f64, f64, f64),
    r1: f64,
    r2: f64,
    thickness: f64,
    aperture_r: f64,
) -> Option<AnalyticHit> {
    let front_apex = -thickness * 0.5;
    let back_apex = thickness * 0.5;

    // At the front surface the lens-outward normal points -z.  Sphere-outward
    // already points -z for R1>0 (centre on +z side of apex) and +z for R1<0,
    // so multiply by sign(R1) to land consistently on the lens-outward side.
    // Planar front has the explicit (0,0,1) normal; flip to -z.
    let front = ray_sphere_cap(origin, direction, front_apex, r1, aperture_r).map(|(t, p, n)| {
        let sign = if r1.abs() >= 1e8 { -1.0 } else { r1.signum() };
        (t, p, [n[0] * sign, n[1] * sign, n[2] * sign])
    });
    // At the back surface lens-outward points +z.  Sphere-outward points +z
    // when R2<0 (centre on -z side) and -z when R2>0, so multiply by -sign(R2).
    let back = ray_sphere_cap(origin, direction, back_apex, r2, aperture_r).map(|(t, p, n)| {
        let sign = if r2.abs() >= 1e8 { 1.0 } else { -r2.signum() };
        (t, p, [n[0] * sign, n[1] * sign, n[2] * sign])
    });

    let hit = match (front, back) {
        (Some(f), Some(b)) => {
            if f.0 < b.0 { f } else { b }
        }
        (Some(f), None) => f,
        (None, Some(b)) => b,
        (None, None) => return None,
    };

    Some(AnalyticHit {
        t: hit.0,
        point: hit.1,
        normal: hit.2,
        is_blocked: 0,
        _pad: [0; 7],
    })
}

/// Batch analytic narrow-phase: for each sample ray, walks its candidate list
/// (from `solver3_generate_first_hit_hints`) and, for each candidate whose
/// surface_kind is supported, computes the analytic hit in local frame.
/// The best (smallest positive t) supported hit per ray is written to the
/// output buffer; if no supported hit fits but unsupported candidates exist,
/// the caller must fall back to the JS path.
///
/// Output layout per ray (stride = 8 f64):
///   [0] best_t_world   (positive = valid Rust hit; NaN = no supported hit; negative = blocked)
///   [1] best_component_index_supported  (as f64; -1 if none)
///   [2..5] best hit point in LOCAL frame
///   [5..8] best hit normal in LOCAL frame
///   [8] unused / reserved
///
/// Returns the number of rays that found a Rust-supported best hit.
#[no_mangle]
pub extern "C" fn solver3_analytic_narrow_phase(
    header_ptr: *const Solver3PacketHeader,
    world_to_local_ptr: *const f64,
    local_to_world_ptr: *const f64,
    surface_kinds_ptr: *const u8,
    surface_params_ptr: *const f64,
    component_count: u32,
    sample_scalars_ptr: *const f64,
    sample_count: u32,
    candidate_counts_ptr: *const u8,
    candidate_indices_ptr: *const i32,
    max_candidates: u32,
    output_ptr: *mut f64,
) -> u32 {
    if solver3_validate_packet_header(header_ptr) != STATUS_OK {
        return 0;
    }
    if world_to_local_ptr.is_null()
        || local_to_world_ptr.is_null()
        || surface_kinds_ptr.is_null()
        || surface_params_ptr.is_null()
        || sample_scalars_ptr.is_null()
        || candidate_counts_ptr.is_null()
        || candidate_indices_ptr.is_null()
        || output_ptr.is_null()
    {
        return 0;
    }

    let cc = component_count as usize;
    let sc = sample_count as usize;
    let mc = max_candidates as usize;

    let world_to_local = unsafe {
        std::slice::from_raw_parts(world_to_local_ptr, cc * PACKED_COMPONENT_MATRIX_STRIDE as usize)
    };
    let _local_to_world = unsafe {
        std::slice::from_raw_parts(local_to_world_ptr, cc * PACKED_COMPONENT_MATRIX_STRIDE as usize)
    };
    let surface_kinds = unsafe { std::slice::from_raw_parts(surface_kinds_ptr, cc) };
    let surface_params = unsafe { std::slice::from_raw_parts(surface_params_ptr, cc * PACKED_SURFACE_PARAM_STRIDE as usize) };
    let samples = unsafe { std::slice::from_raw_parts(sample_scalars_ptr, sc * PACKED_CAMERA_SAMPLE_STRIDE as usize) };
    let cand_counts = unsafe { std::slice::from_raw_parts(candidate_counts_ptr, sc) };
    let cand_indices = unsafe { std::slice::from_raw_parts(candidate_indices_ptr, sc * mc) };
    let output = unsafe { std::slice::from_raw_parts_mut(output_ptr, sc * 8) };

    let mut found = 0u32;
    for sample_idx in 0..sc {
        let sample_base = sample_idx * PACKED_CAMERA_SAMPLE_STRIDE as usize;
        let origin = (samples[sample_base + 2], samples[sample_base + 3], samples[sample_base + 4]);
        let direction = (samples[sample_base + 5], samples[sample_base + 6], samples[sample_base + 7]);

        let out_base = sample_idx * 8;
        output[out_base] = f64::NAN;
        output[out_base + 1] = -1.0;

        let cand_count = cand_counts[sample_idx] as usize;
        let cand_base = sample_idx * mc;
        let mut best_t = f64::INFINITY;
        let mut best: Option<AnalyticHit> = None;
        let mut best_idx: i32 = -1;

        for k in 0..cand_count.min(mc) {
            let comp_idx = cand_indices[cand_base + k];
            if comp_idx < 0 {
                break;
            }
            let ci = comp_idx as usize;
            let kind = surface_kinds[ci];
            if kind == SURFACE_KIND_UNSUPPORTED {
                // Any unsupported candidate ahead of the current best invalidates
                // our Rust answer — we can't know if it would have been closer.
                // Bail for this ray.
                best = None;
                best_idx = -2; // sentinel: "unsupported blocker"
                break;
            }
            let matrix_base = ci * PACKED_COMPONENT_MATRIX_STRIDE as usize;
            let local_origin = transform_point(&world_to_local[matrix_base..matrix_base + 16], origin);
            let local_direction = transform_direction(&world_to_local[matrix_base..matrix_base + 16], direction);
            let param_base = ci * PACKED_SURFACE_PARAM_STRIDE as usize;
            let params = &surface_params[param_base..param_base + PACKED_SURFACE_PARAM_STRIDE as usize];
            let hit = match kind {
                SURFACE_KIND_FLAT_DISC => ray_flat_disc(
                    local_origin,
                    local_direction,
                    params[0],
                    params[1],
                    params[2] >= 0.5,
                ),
                SURFACE_KIND_THICK_LENS => ray_thick_lens(
                    local_origin,
                    local_direction,
                    params[0],
                    params[1],
                    params[2],
                    params[3],
                ),
                _ => None,
            };
            if let Some(h) = hit {
                if h.t > 0.001 && h.t < best_t {
                    best_t = h.t;
                    best = Some(h);
                    best_idx = comp_idx;
                }
            }
        }

        if let Some(h) = best {
            output[out_base] = h.t;
            output[out_base + 1] = best_idx as f64;
            output[out_base + 2] = h.point[0];
            output[out_base + 3] = h.point[1];
            output[out_base + 4] = h.point[2];
            output[out_base + 5] = h.normal[0];
            output[out_base + 6] = h.normal[1];
            output[out_base + 7] = h.normal[2];
            if h.is_blocked != 0 {
                output[out_base] = -output[out_base]; // negative t flags blocked
            }
            found += 1;
        } else if best_idx == -2 {
            output[out_base + 1] = -2.0; // unsupported candidate seen; JS must take over
        }
    }

    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_constants_match_expected_packet_layout() {
        assert_eq!(solver3_kernel_abi_version(), 1);
        assert_eq!(solver3_trace_component_matrix_stride(), 16);
        assert_eq!(solver3_trace_component_bounds_stride(), 6);
        assert_eq!(solver3_detector_basis_stride(), 12);
        assert_eq!(solver3_beam_segment_scalar_stride(), 27);
        assert_eq!(solver3_camera_sample_stride(), 10);
    }

    #[test]
    fn validates_packet_headers() {
        let header = Solver3PacketHeader {
            abi_version: SOLVER3_KERNEL_ABI_VERSION,
            trace_component_count: 2,
            beam_branch_count: 1,
            beam_segment_count: 4,
            detector_kind: 1,
        };
        assert_eq!(solver3_validate_packet_header(&header), STATUS_OK);
        let bad = Solver3PacketHeader { abi_version: 999, ..header };
        assert_eq!(solver3_validate_packet_header(&bad), STATUS_UNSUPPORTED_ABI);
    }

    #[test]
    fn generates_camera_samples_for_each_pixel_sample() {
        let header = Solver3PacketHeader {
            abi_version: SOLVER3_KERNEL_ABI_VERSION,
            trace_component_count: 2,
            beam_branch_count: 1,
            beam_segment_count: 4,
            detector_kind: 1,
        };
        let basis = [
            0.0, 25.0, 0.0,
            0.0, -1.0, 0.0,
            -1.0, 0.0, 0.0,
            0.0, 0.0, -1.0,
        ];
        let scalars = [4.0, 4.0, 0.2];
        let ints = [4u32, 3u32, 2u32];
        let sample_count = ints[0] * ints[1] * ints[2];
        let mut row_offsets = vec![0u32; ints[1] as usize + 1];
        let mut output = vec![0.0f64; sample_count as usize * PACKED_CAMERA_SAMPLE_STRIDE as usize];

        let generated = solver3_generate_camera_samples(
            &header,
            basis.as_ptr(),
            scalars.as_ptr(),
            ints.as_ptr(),
            row_offsets.as_mut_ptr(),
            output.as_mut_ptr(),
            sample_count,
            12345,
        );

        assert_eq!(generated, sample_count);
        assert_eq!(row_offsets, vec![0, 8, 16, 24]);
        assert_eq!(output[0], 0.0);
        assert_eq!(output[1], 0.0);
        assert!(output[5].is_finite());
        assert!(output[6].is_finite());
        assert!(output[7].is_finite());
        assert!(output[8].is_finite());
        assert!(output[9].is_finite());
    }

    #[test]
    fn generates_sorted_first_hit_hints_from_packed_bounds() {
        let header = Solver3PacketHeader {
            abi_version: SOLVER3_KERNEL_ABI_VERSION,
            trace_component_count: 2,
            beam_branch_count: 0,
            beam_segment_count: 0,
            detector_kind: 1,
        };
        let world_to_local = [
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            -20.0, 0.0, 0.0, 1.0,
        ];
        let local_bounds = [
            -1.0, -1.0, -1.0, 1.0, 1.0, 1.0,
            -2.0, -2.0, -2.0, 2.0, 2.0, 2.0,
        ];
        let samples = [
            0.0, 0.0,
            -10.0, 0.0, 0.0,
            1.0, 0.0, 0.0,
            1.0, 0.0,
        ];
        let mut counts = [0u8; 1];
        let mut indices = [-1i32; 2];
        let mut t_nears = [f64::INFINITY; 2];

        let generated = solver3_generate_first_hit_hints(
            &header,
            world_to_local.as_ptr(),
            local_bounds.as_ptr(),
            2,
            samples.as_ptr(),
            1,
            2,
            counts.as_mut_ptr(),
            indices.as_mut_ptr(),
            t_nears.as_mut_ptr(),
        );

        assert_eq!(generated, 1);
        assert_eq!(counts[0], 2);
        assert_eq!(indices, [0, 1]);
        assert!(t_nears[0] <= t_nears[1]);
        assert!((t_nears[0] - 9.0).abs() < 1e-6);
        assert!((t_nears[1] - 28.0).abs() < 1e-6);
    }

    #[test]
    fn flat_disc_passes_through_center_and_blocks_outside_opening() {
        // Aperture-style: inner opening 2mm, outer housing 10mm.
        let hit = ray_flat_disc((0.0, 0.0, -5.0), (0.0, 0.0, 1.0), 2.0, 10.0, true).unwrap();
        assert!((hit.t - 5.0).abs() < 1e-9);
        assert_eq!(hit.is_blocked, 0);

        // Through the annulus (blocked).
        let hit2 = ray_flat_disc((4.0, 0.0, -5.0), (0.0, 0.0, 1.0), 2.0, 10.0, true).unwrap();
        assert_eq!(hit2.is_blocked, 1);

        // Outside the housing: no hit.
        assert!(ray_flat_disc((15.0, 0.0, -5.0), (0.0, 0.0, 1.0), 2.0, 10.0, true).is_none());
    }

    #[test]
    fn thick_lens_hits_front_sphere_for_on_axis_ray() {
        // Biconvex, symmetric: R1=50, R2=-50, t=5, aperture=12
        let hit = ray_thick_lens((0.0, 0.0, -20.0), (0.0, 0.0, 1.0), 50.0, -50.0, 5.0, 12.0).unwrap();
        // Front apex at -2.5, ray enters at exactly that.
        assert!((hit.t - 17.5).abs() < 1e-6);
        // Outward normal on the front surface (convex) is -z on axis.
        assert!((hit.normal[2] + 1.0).abs() < 1e-6);
    }

    #[test]
    fn thick_lens_planoconvex_hits_flat_surface() {
        // Plano-convex: R1 huge (flat), R2=-50, t=3, aperture=12
        let hit = ray_thick_lens((0.0, 0.0, -10.0), (0.0, 0.0, 1.0), 1e9, -50.0, 3.0, 12.0).unwrap();
        // Flat front apex at -1.5.
        assert!((hit.t - 8.5).abs() < 1e-6);
    }
}
