import React, { useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three';
import { useAtom } from 'jotai';
import {
  componentsAtom,
  measurementAtom,
  pendingCatalogPlacementAtom,
  railPlacementAtom,
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
const FALLBACK_POINTER_ID = 1;

type TablePointerEvent = ThreeEvent<PointerEvent>;

function pointerIdFromEvent(event: TablePointerEvent): number {
  return event.pointerId ?? event.nativeEvent.pointerId ?? FALLBACK_POINTER_ID;
}

function screenPointFromEvent(event: TablePointerEvent): MarqueePoint {
  return {
    x: event.nativeEvent.clientX ?? event.clientX ?? 0,
    y: event.nativeEvent.clientY ?? event.clientY ?? 0,
  };
}

function capturePointer(event: TablePointerEvent, pointerId: number): void {
  const target = event.target as Element & { setPointerCapture?: (id: number) => void };
  target.setPointerCapture?.(pointerId);
}

function releasePointer(event: TablePointerEvent, pointerId: number): void {
  const target = event.target as Element & { releasePointerCapture?: (id: number) => void };
  target.releasePointerCapture?.(pointerId);
}

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
  };

  const handlePointerDown = (event: TablePointerEvent) => {
    if (!marqueeEnabled) return;
    const pointerType = event.nativeEvent.pointerType ?? event.pointerType ?? 'mouse';
    const button = event.nativeEvent.button ?? event.button ?? 0;
    const pointerId = pointerIdFromEvent(event);
    if (pointerType !== 'mouse' || button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;

    event.stopPropagation();
    const start = { x: event.point.x, y: event.point.y };
    const screenStart = screenPointFromEvent(event);
    setMarquee({
      pointerId,
      start,
      current: start,
      screenStart,
      active: false,
    });
    capturePointer(event, pointerId);
  };

  const handlePointerMove = (event: TablePointerEvent) => {
    const pointerId = pointerIdFromEvent(event);
    if (!marquee || pointerId !== marquee.pointerId) return;
    event.stopPropagation();

    const screenPoint = screenPointFromEvent(event);
    const dx = screenPoint.x - marquee.screenStart.x;
    const dy = screenPoint.y - marquee.screenStart.y;
    const active = marquee.active || dx * dx + dy * dy >= MARQUEE_THRESHOLD_PX * MARQUEE_THRESHOLD_PX;
    const current = { x: event.point.x, y: event.point.y };

    setMarquee({ ...marquee, current, active });
    if (active) selectInsideMarquee(marquee.start, current);
  };

  const handlePointerUp = (event: TablePointerEvent) => {
    const pointerId = pointerIdFromEvent(event);
    if (!marquee || pointerId !== marquee.pointerId) return;
    event.stopPropagation();
    releasePointer(event, pointerId);

    if (marquee.active) {
      selectInsideMarquee(marquee.start, { x: event.point.x, y: event.point.y });
      ignoreNextClick.current = true;
    }
    setMarquee(null);
  };

  const handleClick = (event: TablePointerEvent) => {
    if (ignoreNextClick.current) {
      ignoreNextClick.current = false;
      event.stopPropagation();
      return;
    }
    if (uiLocked) return;
    setSelection([]);
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
        <TableHoleMaterial size={size} mobile={isMobile} />
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

function TableHoleMaterial({ size, mobile }: { size: number; mobile: boolean }) {
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
    float mobileTable = ${mobile ? '1.0' : '0.0'};

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
      
      float alpha = 1.0;
      vec3 bgColor;
      if (mobileTable > 0.5) {
        float dither = (hash(floor(pos * 0.9)) - 0.5) * 0.018
                     + (hash(floor(pos * 3.1)) - 0.5) * 0.006;
        bgColor = clamp(vec3(100.0 / 255.0 + dither), vec3(0.35), vec3(0.43));
      } else {
        // Brushed dark metal table surface. Bright enough to read without the
        // old Bloom pass, with subtle anisotropic grain like the previous look.
        float grain = brushedNoise(pos);
        float fineBrush = sin(pos.y * 1.9 + grain * 5.0) * 0.018
                        + sin(pos.y * 7.5) * 0.006;
        float broadBrush = sin(pos.y * 0.18) * 0.025;
        vec3 metalBase = vec3(0.24, 0.28, 0.30);
        float distFromCenter = length((vUv - 0.5) * totalSize);
        bgColor = metalBase + vec3((grain - 0.5) * 0.075 + fineBrush + broadBrush);
        bgColor *= 1.0 - smoothstep(900.0, 2600.0, distFromCenter) * 0.14;
        bgColor = clamp(bgColor, vec3(0.10), vec3(0.42));
        // Slight radial fade, but never all the way to invisible: this table is
        // a working reference grid, not a decorative background.
        float fade = smoothstep(2600.0, 800.0, distFromCenter);
        alpha = mix(0.36, 0.88, fade);
      }
      
      // Deep black bolt holes.
      vec3 holeColor = vec3(0.0, 0.0, 0.0);
      
      vec3 finalColor = mix(bgColor, holeColor, circle);
      
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
