// React is implicitly used by JSX
import React, { useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { BackSide } from 'three'

/**
 * Procedural "starry night" cube map for mirror reflections. Renders a dark
 * navy inner sphere with scattered small emissive point "stars" at various
 * brightnesses. drei's <Environment> captures this to a cube texture once and
 * uses it as the scene envMap.
 */
const StarrySky: React.FC = () => {
    const stars = useMemo(() => {
        // Deterministic pseudo-random so the sky is stable across renders.
        let seed = 0x1a2b3c4d;
        const rand = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
        const R = 80;
        const count = 320;
        const out: { pos: [number, number, number]; size: number; color: string }[] = [];
        for (let i = 0; i < count; i++) {
            // Uniform points on a sphere via z,φ sampling.
            const z = rand() * 2 - 1;
            const phi = rand() * Math.PI * 2;
            const r = Math.sqrt(1 - z * z);
            const pos: [number, number, number] = [r * Math.cos(phi) * R, r * Math.sin(phi) * R, z * R];
            // Most stars are tiny and faint; ~15% are brighter/larger so the sky has variety.
            const bright = rand() < 0.15;
            const size = bright ? 0.35 + rand() * 0.4 : 0.12 + rand() * 0.18;
            const warmth = rand();
            const r8 = Math.round(225 + warmth * 30);
            const g8 = Math.round(230 + warmth * 25);
            const b8 = Math.round(255 - warmth * 40);
            const color = `rgb(${r8},${g8},${b8})`;
            out.push({ pos, size, color });
        }
        return out;
    }, []);
    return (
        <>
            {/* Inner black sphere = night-sky background. BackSide so we see
                it from inside the cube-cam's capture point. */}
            <mesh scale={100}>
                <sphereGeometry args={[1, 32, 32]} />
                <meshBasicMaterial color="#03051a" side={BackSide} />
            </mesh>
            {stars.map((s, i) => (
                <mesh key={i} position={s.pos}>
                    <sphereGeometry args={[s.size, 6, 6]} />
                    <meshBasicMaterial color={s.color} />
                </mesh>
            ))}
        </>
    );
};
import { useAtom } from 'jotai';
import { EditorControls } from './ui/EditorControls'
import { OpticalTable } from './ui/OpticalTable'
import { Sidebar } from './ui/Sidebar'
import { InfiniteTable } from './ui/InfiniteTable'
import { AxesWidget, AxesCameraPublisher } from './ui/AxesWidget'
import { Inspector } from './ui/Inspector'
import { GlobalRotation } from './ui/GlobalRotation'
import { ViewerPanels } from './ui/ViewerPanels'
import { DragDropHandler } from './ui/DragDropHandler'
import { ControlsHelp } from './ui/ControlsHelp'
import { ZLevelBar } from './ui/ZLevelBar'
import { RailPlacementOverlay } from './ui/RailPlacementOverlay'
import { AltSnapIndicator } from './ui/AltSnapIndicator'
import { loadPresetAtom, PresetName, setBundleDataEnabledAtom } from './state/store';
import { MobileActionBar } from './ui/MobileActionBar';

// ── Canvas Error Boundary ──────────────────────────────────
class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100%', height: '100%', backgroundColor: '#1a0000', color: '#ff4444',
          flexDirection: 'column', gap: 12, padding: 24,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Canvas Error</div>
          <div style={{ fontSize: 12, color: '#aa4444', maxWidth: 400, textAlign: 'center' }}>
            {this.state.error?.message ?? 'Unknown error'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: '#442222', border: '1px solid #664444', borderRadius: 6,
              color: '#ff8888', padding: '8px 16px', cursor: 'pointer', fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// URL-friendly slug → PresetName mapping
const presetSlugMap = new Map<string, PresetName>(
  Object.values(PresetName).map(name => [
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''),
    name as PresetName
  ])
);

function App() {
  const [, loadPreset] = useAtom(loadPresetAtom);
  const [, setBundleDataEnabled] = useAtom(setBundleDataEnabledAtom);

  // URL-based preset loading: ?preset=EpiFluorescence or ?preset=epi-fluorescence
  // Also supports ?solver2=on to auto-enable Solver 2
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const presetParam = params.get('preset');
    if (presetParam) {
      const exactMatch = Object.values(PresetName).find(
        (n) => n.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === presetParam.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
      );
      const match = exactMatch || presetSlugMap.get(presetParam.toLowerCase());
      if (match) {
        loadPreset(match);
      }
    }

    const solver2Param = params.get('solver2');
    if (solver2Param === 'on' || solver2Param === '1' || solver2Param === 'true') {
      setTimeout(() => {
        setBundleDataEnabled(true);
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
        <Sidebar />
        <div style={{ 
          flex: 1, 
          position: 'relative', 
          background: 'radial-gradient(circle at center, #0a0e17 0%, #000000 100%)' 
        }}>
  
          {/* Advanced mobile toolbar layered on top */}
          <MobileActionBar />
  
          <CanvasErrorBoundary>
          {/* Top-Down Engineering View - Orthographic, Z-up per PhysicsPlan.md */}
          <Canvas orthographic gl={{ alpha: true }} camera={{ position: [0, 0, 600], zoom: 2, up: [0, 1, 0], near: 0.1, far: 10000 }}>
            <ambientLight intensity={0.65} />
            <hemisphereLight args={['#d7e7ff', '#171717', 0.45]} />
            <pointLight position={[100, 100, 100]} intensity={1.0} />
            {/* Procedural starry-night environment — metallic mirrors reflect
                this cube map so they show dark sky + scattered star points. */}
            <Environment frames={1} resolution={512} background={false} environmentIntensity={0.8}>
              <StarrySky />
            </Environment>

            <EditorControls />
            <GlobalRotation />
            <DragDropHandler />
            <RailPlacementOverlay />
            <AxesCameraPublisher />

            {/* Visuals */}
            <InfiniteTable />
            <AltSnapIndicator />
            <OpticalTable />

            <EffectComposer>
              <Bloom luminanceThreshold={1.0} mipmapBlur luminanceSmoothing={0.9} intensity={0.15} />
            </EffectComposer>
          </Canvas>
        </CanvasErrorBoundary>

        <AxesWidget />
        <Inspector />
        <ViewerPanels />
        <ZLevelBar />
        <ControlsHelp />
      </div>
    </div>
  )
}

export default App
