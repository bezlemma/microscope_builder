// React is implicitly used by JSX
import React, { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { BackSide, Box3, Vector3, PerspectiveCamera } from 'three'

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
        <group userData={{ svgExport: 'skip' }}>
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
        </group>
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
import {
  activePresetAtom,
  animationPlayingAtom,
  appRouteAtom,
  componentsAtom,
  isDraggingAtom,
  loadPresetAtom,
  loadSceneAtom,
  PresetName,
  rayConfigAtom,
  setBundleDataEnabledAtom,
  uiLockedAtom,
} from './state/store';
import { Splash } from './ui/Splash';
import { loadSceneFromUrlHash } from './state/ubzSerializer';
import { MobileActionBar } from './ui/MobileActionBar';
import { PresetTooltip } from './ui/PresetTooltip';
import { TutorialDomOverlay } from './ui/TutorialDomOverlay';
import { MeasureOverlay } from './ui/MeasureOverlay';
import { SvgSceneExporter } from './ui/SvgSceneExporter';
import { ComponentContextMenu } from './ui/ComponentContextMenu';
import { AlignmentHoverHighlight } from './ui/AlignmentHoverHighlight';

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

function presetSlug(name: PresetName): string {
  if (name === PresetName.Tutorial2) return 'tutorial2';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// URL-friendly slug → PresetName mapping
const presetSlugMap = new Map<string, PresetName>(
  Object.values(PresetName).flatMap(name => {
    const preset = name as PresetName;
    const slug = presetSlug(preset);
    return [
      [slug, preset],
      [name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), preset],
    ] as [string, PresetName][];
  })
);

function matchPresetSlug(raw: string | null): PresetName | undefined {
  if (!raw) return undefined;
  const normalized = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const exactMatch = Object.values(PresetName).find(
    (name) => name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === normalized
  ) as PresetName | undefined;
  return exactMatch || presetSlugMap.get(raw.toLowerCase());
}

function presetFromHash(): PresetName | undefined {
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!rawHash || rawHash.startsWith('scene=')) return undefined;
  if (rawHash.startsWith('preset=')) {
    return matchPresetSlug(decodeURIComponent(rawHash.slice('preset='.length)));
  }
  return matchPresetSlug(decodeURIComponent(rawHash));
}

// ── Capture-mode helpers ───────────────────────────────────────────────
// When the URL has `?capture=1`, render the scene with a perspective camera
// at a 3/4 angle and no table grid. Used by scripts/capture-presets.mjs.
const isCaptureMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('capture') === '1';
};

/** Inside-canvas component: computes scene bounds from all visible meshes
 *  (skipping the table grid + tagged helpers) and parks a perspective camera
 *  in a 3/4-view that fits everything in frame. Runs once components mount. */
const CaptureFramer: React.FC = () => {
  const { scene, set, size } = useThree();
  const [components] = useAtom(componentsAtom);
  useEffect(() => {
    if (components.length === 0) return;
    // Give R3F a few frames to lay out the meshes before measuring.
    const id = window.setTimeout(() => {
      const box = new Box3();
      scene.traverse(obj => {
        // Skip helpers, ray-overlays, and the (already-hidden-in-capture) table.
        if (!obj.visible) return;
        const data = obj.userData || {};
        if (data.svgExport === 'skip') return;
        const isMesh = (obj as { isMesh?: boolean }).isMesh === true;
        if (!isMesh) return;
        const expanded = new Box3().setFromObject(obj);
        if (expanded.isEmpty()) return;
        box.union(expanded);
      });
      if (box.isEmpty()) return;
      const center = box.getCenter(new Vector3());
      const dims = box.getSize(new Vector3());
      // Radius of a sphere enclosing the box; pad so nothing kisses the edge.
      const radius = Math.max(0.5 * Math.hypot(dims.x, dims.y, dims.z), 80);
      const fovDeg = 32;
      const fovRad = (fovDeg * Math.PI) / 180;
      const aspect = Math.max(0.5, size.width / Math.max(1, size.height));
      // Account for both vertical and horizontal FOV so wide scenes still fit.
      const distV = radius / Math.tan(fovRad / 2);
      const fovHoriz = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
      const distH = radius / Math.tan(fovHoriz / 2);
      const distance = Math.max(distV, distH) * 1.15;
      // 3/4 angle: azimuth 30° around the Z axis, elevation 32° above the table.
      const azimuth = Math.PI / 6;
      const elevation = (32 * Math.PI) / 180;
      const horiz = distance * Math.cos(elevation);
      const dx = horiz * Math.sin(azimuth);
      const dy = -horiz * Math.cos(azimuth);
      const dz = distance * Math.sin(elevation);
      const cam = new PerspectiveCamera(fovDeg, aspect, 0.1, 50000);
      cam.position.set(center.x + dx, center.y + dy, center.z + dz);
      cam.up.set(0, 0, 1);
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      set({ camera: cam });
    }, 2200);
    return () => window.clearTimeout(id);
  }, [components, scene, set, size.width, size.height]);
  return null;
};

const NAVIGATION_KEYS = new Set([
  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D', 'r', 'R', 'f', 'F',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '[', ']',
]);

/**
 * R3F's default `frameloop="always"` redraws the full WebGL scene as fast as
 * Chrome allows, even when the optical trace only changes at the throttled
 * animation cadence. Demand rendering keeps idle frames at zero and explicitly
 * drives frames only while something visible is moving.
 */
const DemandRenderHeartbeat: React.FC = () => {
  const invalidate = useThree(state => state.invalidate);
  const [animationPlaying] = useAtom(animationPlayingAtom);
  const [rayConfig] = useAtom(rayConfigAtom);
  const [isDragging] = useAtom(isDraggingAtom);
  const [activePreset] = useAtom(activePresetAtom);
  const pressedNavKeysRef = React.useRef(new Set<string>());
  const transientUntilRef = React.useRef(0);

  const tutorialPulseActive =
    activePreset === PresetName.Tutorial || activePreset === PresetName.Tutorial2;
  const waveViewActive = rayConfig.beamFieldEnabled && rayConfig.viewerMode === 'wave';
  const continuous = animationPlaying || isDragging || waveViewActive || tutorialPulseActive;

  useEffect(() => {
    const inputFocused = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = (el as HTMLElement).tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const bumpTransient = (durationMs = 900) => {
      transientUntilRef.current = performance.now() + durationMs;
      invalidate();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!NAVIGATION_KEYS.has(event.key) || inputFocused()) return;
      pressedNavKeysRef.current.add(event.key);
      bumpTransient(250);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressedNavKeysRef.current.delete(event.key);
      pressedNavKeysRef.current.delete(event.key.toLowerCase());
      pressedNavKeysRef.current.delete(event.key.toUpperCase());
      bumpTransient(250);
    };
    const onPointer = () => bumpTransient(900);
    const onWheel = () => bumpTransient(450);
    const onBlur = () => {
      pressedNavKeysRef.current.clear();
      bumpTransient(100);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('pointermove', onPointer, true);
    window.addEventListener('pointerup', onPointer, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('pointerup', onPointer, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [invalidate]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;

    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const interacting =
        pressedNavKeysRef.current.size > 0 || now < transientUntilRef.current;
      if (continuous || interacting) {
        invalidate();
      }
      timeoutId = window.setTimeout(tick, continuous ? 33 : interacting ? 16 : 120);
    };

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [continuous, invalidate]);

  return null;
};

const LockOverlay: React.FC = () => {
  const [, setUiLocked] = useAtom(uiLockedAtom);
  return (
    <button
      type="button"
      onClick={() => setUiLocked(false)}
      title="Unlock editing UI"
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 30,
        width: 42,
        height: 42,
        borderRadius: 8,
        border: '1px solid #666',
        background: 'rgba(20, 20, 20, 0.95)',
        color: '#64ffda',
        cursor: 'pointer',
        fontSize: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 2px 10px rgba(0,0,0,0.45)',
      }}
    >
      🔓
    </button>
  );
};

function App() {
  const [, loadPreset] = useAtom(loadPresetAtom);
  const [, loadScene] = useAtom(loadSceneAtom);
  const [, setBundleDataEnabled] = useAtom(setBundleDataEnabledAtom);
  const [uiLocked] = useAtom(uiLockedAtom);
  const [appRoute, setAppRoute] = useAtom(appRouteAtom);
  const captureMode = useMemo(() => isCaptureMode(), []);

  // iOS Safari reports `100vh` as the full screen height, not the visible
  // viewport after the URL / toolbar chrome is applied. R3F uses the measured
  // canvas size to compute orthographic zoom, so keep an explicit CSS variable
  // synced to the real visual viewport.
  useEffect(() => {
    const setAppHeight = () => {
      const viewport = window.visualViewport;
      const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
      document.documentElement.style.setProperty('--app-height', `${height}px`);
    };

    setAppHeight();
    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', setAppHeight);
    window.visualViewport?.addEventListener('resize', setAppHeight);
    window.visualViewport?.addEventListener('scroll', setAppHeight);
    return () => {
      window.removeEventListener('resize', setAppHeight);
      window.removeEventListener('orientationchange', setAppHeight);
      window.visualViewport?.removeEventListener('resize', setAppHeight);
      window.visualViewport?.removeEventListener('scroll', setAppHeight);
    };
  }, []);

  // Safari still emits proprietary gesture events for browser pinch-zoom in
  // some WebKit builds even when the canvas has touch-action:none.
  useEffect(() => {
    const preventBrowserGesture = (event: Event) => event.preventDefault();
    const options: AddEventListenerOptions = { passive: false };
    document.addEventListener('gesturestart', preventBrowserGesture, options);
    document.addEventListener('gesturechange', preventBrowserGesture, options);
    document.addEventListener('gestureend', preventBrowserGesture, options);
    return () => {
      document.removeEventListener('gesturestart', preventBrowserGesture, options);
      document.removeEventListener('gesturechange', preventBrowserGesture, options);
      document.removeEventListener('gestureend', preventBrowserGesture, options);
    };
  }, []);

  // URL-based scene/preset loading.
  //   #scene=<base64> — full custom scene (from the Share button); takes priority
  //   #preset=brightfield — built-in preset
  //   ?preset=brightfield — legacy preset URL, still accepted
  //   ?beamField=on — auto-enable Beam field
  useEffect(() => {
    // Try a Share-link scene first; if it loads, skip the preset path so the
    // user-shared scene wins over any preset hint left in the same URL.
    try {
      const restored = loadSceneFromUrlHash();
      if (restored && restored.length > 0) {
        loadScene(restored);
        setAppRoute('editor');
        return;
      }
    } catch (e) {
      console.warn('Failed to restore scene from URL hash:', e);
    }

    const params = new URLSearchParams(window.location.search);
    const match = presetFromHash() || matchPresetSlug(params.get('preset'));
    if (match) {
      loadPreset(match);
      setAppRoute('editor');
    }

    const beamFieldParam = params.get('beamField');
    if (beamFieldParam === 'on' || beamFieldParam === '1' || beamFieldParam === 'true') {
      setTimeout(() => {
        setBundleDataEnabled(true);
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

    if (appRoute === 'splash') {
      return <Splash />;
    }

    if (captureMode) {
      // Headless capture: just the scene, perspective camera, no table grid,
      // no UI chrome. scripts/capture-presets.mjs grabs canvas.toDataURL().
      return (
        <div style={{ width: '100vw', height: 'var(--app-height, 100dvh)', background: 'radial-gradient(circle at center, #0a0e17 0%, #000000 100%)' }}>
          <CanvasErrorBoundary>
            <Canvas
              dpr={[1, 2]}
              gl={{ alpha: true, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
              camera={{ fov: 32, position: [400, -500, 350], up: [0, 0, 1], near: 0.1, far: 50000 }}
            >
              <ambientLight intensity={0.65} />
              <hemisphereLight args={['#d7e7ff', '#171717', 0.45]} />
              <pointLight position={[100, 100, 100]} intensity={1.0} />
              <Environment frames={1} resolution={512} background={false} environmentIntensity={0.8}>
                <StarrySky />
              </Environment>
              <CaptureFramer />
              <OpticalTable />
              <EffectComposer>
                <Bloom luminanceThreshold={1.0} mipmapBlur luminanceSmoothing={0.9} intensity={0.15} />
              </EffectComposer>
            </Canvas>
          </CanvasErrorBoundary>
        </div>
      );
    }

    return (
      <div style={{ width: '100vw', height: 'var(--app-height, 100dvh)', display: 'flex' }}>
        {!uiLocked && <Sidebar />}
        <div style={{
          flex: 1,
          position: 'relative',
          background: 'radial-gradient(circle at center, #0a0e17 0%, #000000 100%)'
        }}>

          {!uiLocked && <PresetTooltip />}
          {!uiLocked && <TutorialDomOverlay />}

          {/* Advanced mobile toolbar layered on top */}
          {!uiLocked && <MobileActionBar />}

          <CanvasErrorBoundary>
          {/* Top-Down Engineering View - Orthographic, Z-up per PhysicsPlan.md */}
          <Canvas
            orthographic
            frameloop="demand"
            dpr={[1, 1.5]}
            // The live editor should not preserve the swap buffer: animated
            // scenes redraw continuously, and retaining a readback-capable
            // drawing buffer puts avoidable pressure on Chrome's compositor/GPU
            // memory. Capture mode above keeps preserveDrawingBuffer enabled
            // for scripts/capture-presets.mjs, where toDataURL() needs it.
            gl={{ alpha: true, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }}
            camera={{ position: [0, 0, 600], zoom: 2, up: [0, 1, 0], near: 0.1, far: 10000 }}
            onCreated={(state) => { (window as unknown as { __r3f?: unknown }).__r3f = state; }}
          >
            <ambientLight intensity={0.65} />
            <hemisphereLight args={['#d7e7ff', '#171717', 0.45]} />
            <pointLight position={[100, 100, 100]} intensity={1.0} />
            {/* Procedural starry-night environment — metallic mirrors reflect
                this cube map so they show dark sky + scattered star points. */}
            <Environment frames={1} resolution={512} background={false} environmentIntensity={0.8}>
              <StarrySky />
            </Environment>

            <DemandRenderHeartbeat />
            <EditorControls />
            <SvgSceneExporter />
            {!uiLocked && <GlobalRotation />}
            {!uiLocked && <DragDropHandler />}
            {!uiLocked && <RailPlacementOverlay />}
            {!uiLocked && <MeasureOverlay />}
            <AxesCameraPublisher />

            {/* Visuals */}
            <InfiniteTable />
            {!uiLocked && <AltSnapIndicator />}
            <OpticalTable />
            {!uiLocked && <AlignmentHoverHighlight />}

          </Canvas>
        </CanvasErrorBoundary>

        {!uiLocked && <AxesWidget />}
        {!uiLocked && <Inspector />}
        {uiLocked && <LockOverlay />}
        <ViewerPanels />
        {!uiLocked && <ZLevelBar />}
        {!uiLocked && <ControlsHelp />}
        {!uiLocked && <ComponentContextMenu />}
      </div>
    </div>
  )
}

export default App
