// React is implicitly used by JSX
import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { useAtom } from 'jotai';
import { EditorControls } from './ui/EditorControls'
import { OpticalTable } from './ui/OpticalTable'
import { Sidebar } from './ui/Sidebar'
// import { OpticalTableSurface } from './ui/OpticalTableSurface' // Replaced by InfiniteTable
import { InfiniteTable } from './ui/InfiniteTable'
import { AxesWidget } from './ui/AxesWidget'
import { Inspector } from './ui/Inspector'
import { GlobalRotation } from './ui/GlobalRotation'
import { ViewerPanels } from './ui/ViewerPanels'
import { DragDropHandler } from './ui/DragDropHandler'
import { ControlsHelp } from './ui/ControlsHelp'
import { loadPresetAtom, PresetName, rayConfigAtom } from './state/store';

// URL-friendly slug → PresetName mapping
const presetSlugMap = new Map<string, PresetName>(
  Object.values(PresetName).map(name => [
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''),
    name as PresetName
  ])
);

function App() {
  const [, loadPreset] = useAtom(loadPresetAtom);
  const [, setRayConfig] = useAtom(rayConfigAtom);

  // URL-based preset loading: ?preset=EpiFluorescence or ?preset=epi-fluorescence
  // Also supports ?solver2=on to auto-enable Solver 2
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const presetParam = params.get('preset');
    if (presetParam) {
      // Try exact enum match first, then slug match
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
      // Small delay to let preset load first
      setTimeout(() => {
        setRayConfig(prev => ({ ...prev, solver2Enabled: true }));
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
      <Sidebar />
      <div style={{ flex: 1, position: 'relative', backgroundColor: '#000' }}>

        {/* Top-Down Engineering View - Orthographic, Z-up per PhysicsPlan.md */}
        {/* World Space: X/Y = table surface, Z = height (up) */}
        <Canvas orthographic camera={{ position: [0, 0, 600], zoom: 2, up: [0, 1, 0], near: 0.1, far: 10000 }}>
          <color attach="background" args={['#111']} />
          <ambientLight intensity={0.5} />
          <pointLight position={[100, 100, 100]} intensity={1.0} />
          <Environment preset="warehouse" />

          <EditorControls />
          <GlobalRotation />
          <DragDropHandler />

          {/* Visuals */}
          <InfiniteTable />
          <OpticalTable />
          <AxesWidget />
        </Canvas>

        <Inspector />
        <ViewerPanels />
        <ControlsHelp />
      </div>
    </div>
  )
}

export default App

