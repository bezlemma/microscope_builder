import React from 'react';
import { DoubleSide, Vector2 } from 'three';
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
  
  const repeat = size / 25;

  return (
    <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, -25, 0]} 
        receiveShadow
        onClick={(e) => {
            // Only clear if we clicked the table directly, not a child component (propagation stop check)
            // However, e.stopPropagation() is usually called by child components.
            // So if this fires, it likely bubbled up or hit direct.
            // If dragging, we might trigger click? 
            // Let's assume click on table = deselect.
            // R3F event propagation: children intersect first. If they stop, this won't fire.
            // Ensure components stop propagation? They usually do.
            setSelection(null);
        }}
    >
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
  const uniforms = {
    uColor: { value: new Vector2(0.2, 0.2) }, // Dark Grey
    uHoleColor: { value: new Vector2(0.0, 0.0) }, // Black
    uSpacing: { value: 25.0 },
    uRadius: { value: 3.5 } // Hole radius
  };

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
