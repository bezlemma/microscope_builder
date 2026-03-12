pub const SOLVER3_KERNEL_ABI_VERSION: u32 = 1;
pub const PACKED_COMPONENT_MATRIX_STRIDE: u32 = 16;
pub const PACKED_COMPONENT_BOUNDS_STRIDE: u32 = 6;
pub const PACKED_DETECTOR_BASIS_STRIDE: u32 = 12;
pub const PACKED_BEAM_SEGMENT_SCALAR_STRIDE: u32 = 27;
pub const PACKED_CAMERA_SAMPLE_STRIDE: u32 = 10;

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
}
