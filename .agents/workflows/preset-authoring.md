---
description: How to create or edit preset scenes for the microscope builder
---

# Preset Authoring Conventions

## File Structure

```typescript
import { OpticalComponent } from '../physics/Component';
// ... component imports

/**
 * Preset Name — Short description.
 *
 * Beam path:
 *   Source → Component1 → Component2 → ... → Detector
 */
export function createXScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    const component = new Foo("Name");
    component.setPosition(x, y, 0);
    component.pointAlong(dx, dy, dz);  // comment explaining direction
    scene.push(component);

    // ... more components

    return scene;
}
```

## Rules

1. **Export**: Always `export function createXScene()`, never `export const = () =>`.
2. **Construction**: Sequential `const` declarations with `scene.push()`. Never IIFE arrays.
3. **Naming**: Give each component a descriptive `const` name (e.g., `focusingLens`, not `c`).
4. **Comments**: Start with a JSDoc header showing the beam path. Comment each component's purpose.

## Rotation: `pointAlong(dx, dy, dz)`

Use `pointAlong` for ALL axis-aligned components. This sets the component's local +Z to the given direction.

### Convention
- **Scene is viewed top-down from +Z.** Labels face the viewer automatically.
- `pointAlong(1, 0, 0)` → component faces/emits along +X
- `pointAlong(-1, 0, 0)` → component faces -X (toward beam coming from left)
- `pointAlong(0, -1, 0)` → component faces -Y (downward)

### What direction should each component type point?
| Component | pointAlong direction |
|-----------|---------------------|
| Laser/Lamp | Direction of emission (beam travel direction) |
| Lens | Along the optical axis (beam travel direction) |
| Camera | **Toward the incoming beam** (opposite to beam travel) |
| Filter | Along beam or toward beam (either works for detection) |
| Aperture | Along beam direction |
| Sample | Toward the incoming beam |
| Objective | Toward the sample |

### When to use `setRotation` instead
Only for **compound angles** that can't be expressed as a single axis direction:
- 45° fold mirrors
- Dichroic beam splitters at 45°
- Prisms with custom tilt angles

## Preset URL Access
// turbo
Presets can be loaded directly via URL: `http://localhost:5173/microscope/?preset=PresetName`
