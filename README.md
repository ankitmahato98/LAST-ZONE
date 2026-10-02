<div align="center">

# LAST ZONE

**A single-player 3D battle royale built with Three.js.**

Foundation release: renderer, procedural world, third-person controller and a device-agnostic input layer.

`npm install` → `npm run dev` → open the printed URL → press **Deploy**.

</div>

---

## What this build is

This is the **foundation** of the game, not a finished match. It ships a runnable
world you can immediately run, jump and explore in, plus the architecture that
weapons, loot, inventory, the shrinking zone, a lobby and (later) multiplayer
plug into without a rewrite.

**Included**

| Area | What it does |
| --- | --- |
| Renderer | WebGL2 via Three.js, ACES tone mapping, sRGB output, PCF soft shadows, a sun whose shadow camera follows the player, fog and a procedurally painted sky (no external assets) |
| World | Deterministic height-field terrain (seed based), a flat test arena with walls/crates/platforms/towers, scattered trees, boulders and grass, all with matching collision |
| Player | Third-person kinematic controller: walk/sprint/strafing, jump with coyote time and jump buffering, step-up onto ledges, slope limits, wall sliding, capsule-vs-box/cylinder collision |
| Camera | Damped orbit camera with collision (never clips through the ground or walls), zoom, sprint FOV kick |
| Character | Stylised humanoid assembled from primitives with a hand-authored rig (walk cycle, sprint lean, air pose, landing squash) |
| Input | One `intent` object fed by keyboard, mouse (pointer lock *or* drag fallback) and multi-touch controls - gameplay never knows which device is talking |
| UI | Deploy/pause menu, HUD with crosshair and adaptive control hints, on-screen touch stick + jump/sprint/pause buttons, F3 debug overlay |
| Engineering | Fixed-timestep simulation decoupled from rendering, service registry, event bus, 34 automated tests (world, movement, end-to-end boot) |

**Not included yet** (by design, so the foundation stays reviewable):
weapons, shooting, loot, inventory, the shrinking zone, bots, match flow,
audio, and **no multiplayer of any kind**. There are no stubs or dead
placeholder systems for these - the extension points are real and documented
below.

---

## Quick start

```bash
# 1. install dependencies (Node.js 20.19+)
npm install

# 2. start the dev server (hot reload, host 0.0.0.0:5173)
npm run dev

# 3. open http://localhost:5173 and press "Deploy"
```

Other scripts:

```bash
npm test          # 34 unit + integration tests (Node's built-in test runner)
npm run build     # production bundle into dist/
npm run preview   # serve the built bundle on http://localhost:4173
```

No build step is required for development, no external services or API keys are
used, and the game runs entirely offline.

---

## Controls

### Desktop

| Action | Key / mouse |
| --- | --- |
| Move | `W` `A` `S` `D` (or arrow keys) |
| Sprint | `Shift` |
| Jump | `Space` |
| Look | Mouse - click the view once to capture the cursor (pointer lock); `Esc` releases it |
| Look without a mouse | `I` `K` pitch, `J` `L` yaw |
| Zoom | Mouse wheel |
| Pause / menu | `Esc` |
| Debug overlay | `F3` |
| Toggle the touch pad | `T` |

If pointer lock is unavailable (embedded iframes, some kiosks), the game
automatically falls back to **drag to look** - hold the left mouse button and
drag.

### Mobile / touch

| Action | Gesture |
| --- | --- |
| Move | Drag anywhere in the lower-left half - a floating stick appears under your thumb |
| Look | Drag anywhere in the right half |
| Jump | `Jump` button (hold to jump again on landing) |
| Sprint | `Run` button (tap to toggle) |
| Pause | ⏸ button, top right |

The touch pad hides itself when keyboard/mouse input is used and reappears when
you touch the screen. Force it with `?touch=1`, hide it with `?touch=0`.

---

## Project layout

```
LAST-ZONE/
├── index.html                 # single canvas + UI mount point
├── vite.config.js             # dev/build config (host 0.0.0.0, relative base)
├── public/favicon.svg
├── src/
│   ├── main.js                # entry point: createGame -> warm up -> start
│   ├── config/settings.js     # ALL tuning values (speeds, camera, quality, bindings)
│   ├── core/
│   │   ├── Game.js            # system pipeline + lifecycle
│   │   ├── Loop.js            # fixed-step simulation, decoupled render loop
│   │   ├── events.js          # event bus + event names
│   │   ├── services.js        # service registry (dependency lookup)
│   │   └── engine.js          # the one place the game is wired together
│   ├── input/
│   │   ├── InputSystem.js     # merges every device into one `intent`
│   │   ├── KeyboardBindings.js# key code -> action binding table
│   │   ├── PointerLook.js     # pointer lock + drag fallback
│   │   └── TouchControls.js   # virtual stick, look area, action buttons
│   ├── physics/Collider.js    # oriented boxes, cylinders, height field, push-out
│   ├── world/
│   │   ├── Terrain.js         # analytic height field + vertex-coloured mesh
│   │   ├── Arena.js           # the test arena (data-driven placements)
│   │   ├── Nature.js          # instanced trees, boulders, grass
│   │   ├── WorldSystem.js     # owns the map, collision world and spawns
│   │   ├── SpawnTester.js     # spawn validation strategies
│   │   └── materials.js       # shared material library
│   ├── player/
│   │   ├── PlayerController.js# movement simulation (no scene graph, no DOM)
│   │   ├── CharacterConfig.js # per-character tuning
│   │   ├── CharacterView.js   # rig + animation
│   │   ├── ThirdPersonCamera.js
│   │   └── PlayerSystem.js    # the local pawn: intent in, state out
│   ├── render/
│   │   ├── RendererSystem.js  # WebGL renderer, scene, camera, render pass
│   │   └── SceneEnvironment.js# sky, fog, sun, shadows
│   ├── ui/
│   │   ├── LoadingScreen.js   # boot overlay + shader warm-up
│   │   ├── MenuSystem.js      # deploy/pause menu
│   │   ├── HudSystem.js       # crosshair, brand, control hints
│   │   └── DebugOverlay.js    # F3 readout
│   ├── utils/                 # math, seeded RNG, value noise, DOM helpers
│   └── styles/main.css        # UI design system
└── tests/                     # node:test suites + jsdom/headless helpers
```

---

## Architecture

### The system pipeline

`Game` owns a list of **systems**. Registration order is update order, and a
system implements as many of these hooks as it needs:

```
init(game)              async setup; everything is reached through the service registry
fixedUpdate(dt, tick)   simulation, always the same dt (default 1/60s)
lateFixedUpdate(dt)     post-movement passes (world boundaries, ...)
update(dt)              per-frame presentation work
render(dt)              drawing, always after every update()
resize(w, h, dpr)
dispose()
```

`core/engine.js` wires them in one readable place:

```
input -> keyboard/mouse/touch -> renderer -> environment -> world -> player
     -> character view -> camera -> HUD -> debug -> menu
```

Two production concerns are already handled here:

* **Fixed timestep.** Movement, jumping and collisions are identical at 30fps and
  144fps; the render loop interpolates and clamps the accumulator (a tab switch
  causes a hitch, never a teleport).
* **Dependency inversion.** Systems never import each other: they read published
  interfaces from the service registry (`world`, `player`, `camera3p`, ...) and
  communicate through the event bus (`player:jump`, `world:ready`, ...).

### The input intent

Every device writes into `InputSystem`, which merges them once per simulation
step into a single object:

```js
intent.move    // { x, y } -1..1 (strafe, forward)
intent.look    // { x, y } pixels accumulated this step
intent.zoom    // wheel / pinch steps
intent.jumpQueued, jumpHeld, sprintHeld
intent.active  // 'keyboard' | 'touch'
```

`PlayerController.update(dt, intent, cameraYaw)` is pure simulation: it never
touches the DOM, the scene graph or a device. That is what makes bots, replays
and network-driven pawns possible later without touching movement code.

### World generation

Terrain height is an analytic function of `(x, z)`:

```js
h = fbm(x, z) * flatten(distance) + rim(distance)
```

The mesh is just a sampling of it, so the simulation gets exact ground height
with a few multiplications instead of raycasts, and a given seed always produces
the same map. `config/settings.js` exposes the noise scales and amplitudes.

---

## Tuning the game

Everything lives in **`src/config/settings.js`**:

```js
WORLD.size          // 420m square map
PLAYER.walkSpeed    // 5.2 m/s
PLAYER.sprintSpeed  // 8.4 m/s
PLAYER.jumpSpeed    // 7.2 m/s  (apex ~1.08m, flight ~0.6s)
PLAYER.stepHeight   // 0.5m ledges can be walked up
PLAYER.maxSlope     // 0.62 (~32 deg) - steeper terrain blocks movement
CAMERA.distance / sensitivity / limits
BINDINGS            // key code -> action table (remappable at runtime)
QUALITY.desktop / QUALITY.mobile   // pixel ratio, shadow map, prop counts
```

Quality is picked from the device (`?quality=mobile|desktop` forces one).
Launch flags: `?debug=1` opens the F3 overlay immediately, `?touch=1|0` forces
the touch pad on or off.

---

## Tests

```bash
npm test
```

* `tests/world.test.js` - terrain determinism and seeding, arena flatness, map
  boundaries, prop scattering rules, collider push-out (including rotated boxes),
  walkable box tops, spawn validation.
* `tests/movement.test.js` - walking/sprinting/strafing, stopping, jump apex,
  **jump buffering**, walls and wall sliding, stepping up platforms, jumping onto
  a crate, cylinder collision, character facing, steep slopes blocking movement.
* `tests/game.test.js` - end-to-end: boots the real `createGame()` wiring under
  jsdom with a headless renderer, then drives it with synthetic keyboard and
  pointer events (menu, WASD, sprint, jump, camera drag/zoom, virtual stick,
  touch look, pause, respawn, debug overlay) and asserts the player never ends up
  inside geometry.

The headless renderer is injected through `createGame({ rendererFactory })`, so
tests exercise the same wiring the browser uses - only the GPU is replaced.

---

## Where the next features plug in

The foundation was shaped by what comes next; each of these is a real extension
point, not a stub:

| Feature | Where it goes |
| --- | --- |
| **Weapons** | New `src/weapons/WeaponSystem.js` added to `engine.js`; read `intent.primaryHeld` (already wired from mouse/stick buttons) and use the camera's forward vector; hit detection can use `world.collider` plus `THREE.Raycaster`. |
| **Loot** | `WorldSystem` already owns runtime map mutation: spawn `LootContainer` objects into `worldGroup`, register their colliders with the same `Collider`, and publish `loot:spawned` on the bus for the UI. |
| **Inventory** | Register an `inventory` service; the HUD mounts its own widget into `#ui-root` and subscribes to its events. `CharacterView` can attach a held-item bone to `this.arms.right`. |
| **Shrinking zone** | New `src/world/ZoneSystem.js` using `lateFixedUpdate` (it already runs after movement) to apply damage/area checks; render the ring as a shader-less mesh and update the fog/light tint through `SceneEnvironment`. |
| **Lobby / match flow** | Replace `MenuSystem`'s single `close()` action with a match service that owns spawn selection (`world.sampleSpawn()` already returns validated points) and round timers. |
| **Multiplayer** | The controller already takes an intent and returns state: feed remote intents into additional `PlayerController` instances (one per peer) and render them with `CharacterView` (its `colors` option exists for team tints). Swap the input source for network snapshots - nothing in movement, camera or rendering assumes a single player. |
| **Audio** | Subscribe to `player:jump`, `player:land`, `world:ready` and the renderer's context events. |

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Blank screen / boot error | The game needs **WebGL2**. Check `chrome://gpu` or `about:support`; update the browser or enable hardware acceleration. |
| "Press Deploy" but the cursor stays free | Pointer lock is blocked in embedded frames. The game falls back to **drag to look** - hold the left mouse button. |
| Movement feels too fast/slow | Tune `PLAYER.walkSpeed`, `sprintSpeed`, `groundAcceleration` in `src/config/settings.js`. |
| Low FPS on a phone | Add `?quality=mobile` (or set `QUALITY.mobile`); reduce `shadowMapSize` / `terrainSegments` further. |
| Dev server not reachable from another device | It already binds `0.0.0.0`; open `http://<your-lan-ip>:5173`. |

Tested in current Chrome, Edge, Firefox and Safari (desktop and mobile) — the
only requirement is a WebGL2-capable browser.

---

## Roadmap

1. **Combat**: weapons, hitscan/projectile handling, damage and downed state.
2. **Loot & inventory**: world spawns, pickups, hotbar, healing items.
3. **The zone**: shrinking play area with escalating damage and a minimap.
4. **Match flow**: lobby, drop-in, timer, placement screen.
5. **Bots**, then **netcode** (authoritative server, client prediction) on top of
   the intent/state split that already exists.

## License

Released under the MIT License - see [LICENSE](LICENSE).
