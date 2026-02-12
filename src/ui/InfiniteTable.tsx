import React from 'react';
import { DoubleSide } from 'three';
import { useAtom } from 'jotai';
import { selectionAtom } from '../state/store';

export const InfiniteTable: React.FC = () => {
  const [, setSelection] = useAtom(selectionAtom);
  // A very large plane to simulate infinity
  const size = 10000; 
  
  // Custom Shader for the Hole Pattern
  // Frags based on world position (or UV scaled)
  // UV 0..1 covers 'size' units.
  // We want holes every 25 units.
  // freq = size / 25.
  

  return (
    <mesh 
        position={[0, 0, -25]} 
        receiveShadow
        onClick={() => setSelection(null)}
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
      
      // Background color #333 (0.2), Hole color #000 (0.0)
      vec3 bgColor = vec3(0.2);
      vec3 holeColor = vec3(0.0);
      
      vec3 finalColor = mix(bgColor, holeColor, circle);
      
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `;

  return (
    <shaderMaterial 
      attach="material"
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      side={DoubleSide}
    />
  );
}
