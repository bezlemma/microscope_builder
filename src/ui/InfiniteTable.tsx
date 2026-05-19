import React, { useMemo, useRef, useState } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three';
import { useAtom } from 'jotai';
import {
  componentsAtom,
  measurementAtom,
  pendingCatalogPlacementAtom,
  railPlacementAtom,
  selectedRodAtom,
  selectionAtom,
  uiLockedAtom,
} from '../state/store';
import { useIsMobile } from './useIsMobile';
import {
  selectedComponentIdsInTableRect,
  tableSelectionRectFromPoints,
  type TableSelectionRect,
} from './marqueeSelection';

type MarqueePoint = { x: number; y: number };

interface MarqueeDrag {
  pointerId: number;
  start: MarqueePoint;
  current: MarqueePoint;
  screenStart: { x: number; y: number };
  active: boolean;
}

const MARQUEE_THRESHOLD_PX = 4;

function marqueePlaneGeometry(rect: TableSelectionRect): BufferGeometry {
  const width = Math.max(0.001, rect.maxX - rect.minX);
  const height = Math.max(0.001, rect.maxY - rect.minY);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    -width / 2, -height / 2, 0,
    width / 2, -height / 2, 0,
    width / 2, height / 2, 0,
    -width / 2, height / 2, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function marqueeOutlineGeometry(rect: TableSelectionRect): BufferGeometry {
  const width = Math.max(0.001, rect.maxX - rect.minX);
  const height = Math.max(0.001, rect.maxY - rect.minY);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    -width / 2, -height / 2, 0,
    width / 2, -height / 2, 0,
    width / 2, -height / 2, 0,
    width / 2, height / 2, 0,
    width / 2, height / 2, 0,
    -width / 2, height / 2, 0,
    -width / 2, height / 2, 0,
    -width / 2, -height / 2, 0,
  ], 3));
  return geometry;
}

export const InfiniteTable: React.FC = () => {
  const [components] = useAtom(componentsAtom);
  const [, setSelection] = useAtom(selectionAtom);
  const [, setSelectedRod] = useAtom(selectedRodAtom);
  const [measurement] = useAtom(measurementAtom);
  const [railPlacement] = useAtom(railPlacementAtom);
  const [pendingCatalogPlacement] = useAtom(pendingCatalogPlacementAtom);
  const [uiLocked] = useAtom(uiLockedAtom);
  const isMobile = useIsMobile();
  const [marquee, setMarquee] = useState<MarqueeDrag | null>(null);
  const ignoreNextClick = useRef(false);
  // A very large plane to simulate infinity
  const size = 10000;

  const marqueeEnabled = !uiLocked
    && !isMobile
    && !measurement.active
    && !measurement.selectedId
    && !railPlacement.active
    && !pendingCatalogPlacement;

  const selectInsideMarquee = (start: MarqueePoint, current: MarqueePoint) => {
    const rect = tableSelectionRectFromPoints(start, current);
    setSelection(selectedComponentIdsInTableRect(components, rect));
    setSelectedRod(null);
  };

  const handlePointerDown = (event: any) => {
    if (!marqueeEnabled) return;
    const pointerType = event.nativeEvent?.pointerType ?? event.pointerType ?? 'mouse';
    const button = event.nativeEvent?.button ?? event.button ?? 0;
    const pointerId = event.pointerId ?? event.nativeEvent?.pointerId ?? 1;
    if (pointerType !== 'mouse' || button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;

    event.stopPropagation();
    const start = { x: event.point.x, y: event.point.y };
    setMarquee({
      pointerId,
      start,
      current: start,
      screenStart: {
        x: event.nativeEvent?.clientX ?? event.clientX ?? 0,
        y: event.nativeEvent?.clientY ?? event.clientY ?? 0,
      },
      active: false,
    });
    try { event.target.setPointerCapture(pointerId); } catch { /* pointer capture is best-effort */ }
  };

  const handlePointerMove = (event: any) => {
    const pointerId = event.pointerId ?? event.nativeEvent?.pointerId ?? 1;
    if (!marquee || pointerId !== marquee.pointerId) return;
    event.stopPropagation();

    const screenX = event.nativeEvent?.clientX ?? event.clientX ?? marquee.screenStart.x;
    const screenY = event.nativeEvent?.clientY ?? event.clientY ?? marquee.screenStart.y;
    const dx = screenX - marquee.screenStart.x;
    const dy = screenY - marquee.screenStart.y;
    const active = marquee.active || dx * dx + dy * dy >= MARQUEE_THRESHOLD_PX * MARQUEE_THRESHOLD_PX;
    const current = { x: event.point.x, y: event.point.y };

    setMarquee({ ...marquee, current, active });
    if (active) selectInsideMarquee(marquee.start, current);
  };

  const handlePointerUp = (event: any) => {
    const pointerId = event.pointerId ?? event.nativeEvent?.pointerId ?? 1;
    if (!marquee || pointerId !== marquee.pointerId) return;
    event.stopPropagation();
    try { event.target.releasePointerCapture(pointerId); } catch { /* noop */ }

    if (marquee.active) {
      selectInsideMarquee(marquee.start, { x: event.point.x, y: event.point.y });
      ignoreNextClick.current = true;
    }
    setMarquee(null);
  };

  // Click handler: clear both component and rod selection on empty-space click.
  const handleClick = (event: any) => {
    if (ignoreNextClick.current) {
      ignoreNextClick.current = false;
      event.stopPropagation();
      return;
    }
    if (uiLocked) return;
    setSelection([]);
    setSelectedRod(null);
  };

  const marqueeRect = marquee?.active
    ? tableSelectionRectFromPoints(marquee.start, marquee.current)
    : null;
  const marqueeFillGeometry = useMemo(
    () => marqueeRect ? marqueePlaneGeometry(marqueeRect) : null,
    [marqueeRect?.minX, marqueeRect?.maxX, marqueeRect?.minY, marqueeRect?.maxY],
  );
  const marqueeBorderGeometry = useMemo(
    () => marqueeRect ? marqueeOutlineGeometry(marqueeRect) : null,
    [marqueeRect?.minX, marqueeRect?.maxX, marqueeRect?.minY, marqueeRect?.maxY],
  );
  const marqueeCenter = marqueeRect
    ? [(marqueeRect.minX + marqueeRect.maxX) / 2, (marqueeRect.minY + marqueeRect.maxY) / 2, -38] as const
    : null;

  return (
    <>
      <mesh
        position={[0, 0, -42]} // Shifted down so components at Z=0 are 42mm above table (ORCA height)
        receiveShadow
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        userData={{ svgExport: 'skip' }}
      >
        {/* Table in XY plane per PhysicsPlan.md (Z = height above table) */}
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial
          color="#333"
          roughness={0.8}
          metalness={0.2}
        >
          {/* We use a texture or just relying on mapping?
              Writing a full custom shader material is cleaner for the holes.
              Let's switch to shaderMaterial or use an alphaMap.
              Actually, for simplicity and standard material lighting,
              let's just make a CanvasTexture or DataTexture and repeat it.
          */}
        </meshStandardMaterial>

        {/*
           Better approach for "Holes":
           A GridHelper is lines.
           Texture is best.
        */}
        <TableHoleMaterial size={size} />
      </mesh>

      {marqueeRect && marqueeCenter && marqueeFillGeometry && marqueeBorderGeometry && (
        <group position={marqueeCenter} userData={{ svgExport: 'skip' }}>
          <mesh geometry={marqueeFillGeometry}>
            <meshBasicMaterial
              color="#64ffda"
              transparent
              opacity={0.16}
              depthWrite={false}
              side={DoubleSide}
              toneMapped={false}
            />
          </mesh>
          <lineSegments geometry={marqueeBorderGeometry}>
            <lineBasicMaterial
              color="#dffcf6"
              transparent
              opacity={0.88}
              depthWrite={false}
              toneMapped={false}
            />
          </lineSegments>
        </group>
      )}
    </>
  );
};

// Shader Material component for the holes pattern
function TableHoleMaterial({ size }: { size: number }) {

  // Vertex Shader: Pass world pos or UV
  // Fragment Shader: dist = length(fract(vUv * repeat) - 0.5)
  // If dist < radius_fraction, color = black.

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    varying vec2 vUv;
    
    // Hardcoded for simplicity/speed
    float spacing = 25.0;
    float holeRadius = 3.5;
    float totalSize = ${size.toFixed(1)};

    // Procedural noise for brushed-metal grain
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    
    float brushedNoise(vec2 pos) {
      // Stretch along X to create directional brushing grain
      vec2 grain = vec2(pos.x * 0.3, pos.y * 2.0);
      vec2 i = floor(grain);
      vec2 f = fract(grain);
      // Smooth interpolation
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    
    void main() {
      // Calculate coordinates in mm
      vec2 pos = vUv * totalSize;
      
      // Local cell coordinates (0 to spacing)
      vec2 cellPos = mod(pos, spacing);
      
      // Distance from center of cell (spacing/2)
      float dist = length(cellPos - vec2(spacing/2.0));
      
      // Simple anti-aliased circle
      float edge = 1.0; // Softness
      float circle = smoothstep(holeRadius, holeRadius - edge, dist);
      
      // Distance from origin
      float distFromCenter = length((vUv - 0.5) * totalSize);
      
      // Brushed dark metal table surface. Bright enough to read without the
      // old Bloom pass, with subtle anisotropic grain like the previous look.
      float grain = brushedNoise(pos);
      float fineBrush = sin(pos.y * 1.9 + grain * 5.0) * 0.018
                      + sin(pos.y * 7.5) * 0.006;
      float broadBrush = sin(pos.y * 0.18) * 0.025;
      vec3 metalBase = vec3(0.24, 0.28, 0.30);
      vec3 bgColor = metalBase + vec3((grain - 0.5) * 0.075 + fineBrush + broadBrush);
      bgColor *= 1.0 - smoothstep(900.0, 2600.0, distFromCenter) * 0.14;
      bgColor = clamp(bgColor, vec3(0.10), vec3(0.42));
      
      // Glowing or deep holes
      vec3 holeColor = vec3(0.0, 0.0, 0.0);
      
      vec3 finalColor = mix(bgColor, holeColor, circle);
      
      // Slight radial fade, but never all the way to invisible: this table is
      // a working reference grid, not a decorative background.
      float fade = smoothstep(2600.0, 800.0, distFromCenter);
      float alpha = mix(0.36, 0.88, fade);
      
      gl_FragColor = vec4(finalColor, alpha);
    }
  `;

  return (
    <shaderMaterial
      attach="material"
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      side={DoubleSide}
      transparent={true}
    />
  );
}
