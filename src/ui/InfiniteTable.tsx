import React from 'react';
import { DoubleSide } from 'three';
import { useAtom } from 'jotai';
import { selectionAtom, selectedRodAtom } from '../state/store';

export const InfiniteTable: React.FC = () => {
  const [, setSelection] = useAtom(selectionAtom);
  const [, setSelectedRod] = useAtom(selectedRodAtom);
  // A very large plane to simulate infinity
  const size = 10000;

  // Click handler: clear both component and rod selection on empty-space click.
  const handleClick = () => {
    setSelection([]);
    setSelectedRod(null);
  };

  return (
    <mesh
      position={[0, 0, -42]} // Shifted down so components at Z=0 are 42mm above table (ORCA height)
      receiveShadow
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
