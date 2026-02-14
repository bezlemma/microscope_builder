// React is implicitly used by JSX
import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
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

function App() {

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
      </div>
    </div>
  )
}

export default App
