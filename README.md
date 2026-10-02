<div align="center">

# LAST ZONE

**A single-player 3D battle royale built with Three.js.**

Current build: renderer, procedural world, third-person controller, a device-agnostic input layer
and a **third-person combat prototype** (one rifle, hitscan, ammo, reload, health, elimination and
training dummies) — playable in the browser **and as a signed Android APK**.

`npm install` → `npm run dev` → open the printed URL → press **Deploy**.
Android: `npm run android:apk`, or let CI build it (see [Android APK](#android-apk)).

</div>

---

## What this build is

This is a **playable prototype**, not a finished match. It ships a world you can
run, jump and shoot in, plus the architecture that further weapons, loot,
inventory, the shrinking zone, a lobby and (later) multiplayer plug into without
a rewrite.

**Included**

| Area | What it does |
| --- | --- |
| Renderer | WebGL2 via Three.js, ACES tone mapping, sRGB output, PCF soft shadows, a sun whose shadow camera follows the player, fog and a procedurally painted sky (no external assets) |
| World | Deterministic height-field terrain (seed based), a flat test arena with walls/crates/platforms/towers, scattered trees, boulders and grass, all with matching collision |
| Player | Third-person kinematic controller: walk/sprint/strafing, jump with coyote time and jump buffering, step-up onto ledges, slope limits, wall sliding, capsule-vs-box/cylinder collision |
| Camera | Damped orbit camera with collision (never clips through the ground or walls), zoom, sprint FOV kick |
| Character | Stylised humanoid assembled from primitives with a hand-authored rig (walk cycle, sprint lean, air pose, landing squash) |
| Combat | Data-driven rifle (automatic, 8.5 rps, 30-round magazine), hitscan hit detection against actors *and* world geometry, damage falloff, headshots, spread that reacts to movement/aim/sustained fire, recoil that kicks the camera, tracers, muzzle flash and bullet impacts |
| Health | A reusable `Health` pool + `Damageable` hitboxes: player and dummies share one code path; fall damage, spawn protection and an elimination state that locks control |
| Targets | Eight training dummies around the arena with health bars, hit flashes, a fall-over death and automatic rebuild |
| Input | One `intent` object fed by keyboard, mouse (pointer lock *or* drag fallback) and multi-touch controls - gameplay never knows which device is talking |
| UI | Deploy/pause menu, dynamic reticle that tracks weapon spread, health/ammo/reload readouts, hit markers, damage vignette, elimination banner, adaptive control hints, on-screen touch stick + fire/jump/aim/run/reload/pause buttons, F3 debug overlay |
| Engineering | Fixed-timestep simulation decoupled from rendering, service registry, event bus, 101 automated tests (world, movement, combat, Android shell integration, and end-to-end boot + combat playthroughs under jsdom) |
| Android | The same production bundle wrapped with Capacitor: landscape immersive fullscreen, keep-awake, back-button pause, adaptive launcher icon and splash, release signing through CI secrets (see [Android APK](#android-apk)) |

**Not included yet** (by design, so the build stays reviewable):
further weapons, loot, inventory, the shrinking zone, bots, match flow,
audio, and **no multiplayer of any kind**. There are no stubs or dead
placeholder systems for those - the extension points are real and documented
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
npm test             # 101 unit + integration tests (Node's built-in test runner)
npm run build        # production bundle into dist/
npm run preview      # serve the built bundle on http://localhost:4173

npm run android:sync     # build the game, then copy dist/ into the Android project
npm run android:assemble # debug APK (no signing secrets needed)
npm run android:apk      # signed release APK (needs signing credentials, see below)
npm run android:open     # open the project in Android Studio
```

No build step is required for development, no external services or API keys are
used, and the game runs entirely offline.

---

## Android APK

The APK is **the same game**, not a port: Vite builds `dist/`, Capacitor copies that
exact bundle into `android/app/src/main/assets/public/`, and the WebView runs it.
No gameplay code is forked, simplified or replaced for Android.

### What the Android build adds

| Concern | How it is handled |
| --- | --- |
| App identity | Label **LAST ZONE**, application ID / namespace `com.lastzone.game`, `versionName` 0.2.0 (`versionCode` 2) |
| Screen | `sensorLandscape`, immersive fullscreen (system bars hidden, swipe to reveal transiently), `resizeableActivity="false"`, cutout/edge-to-edge insets respected |
| Power | `FLAG_KEEP_SCREEN_ON` while the game is in the foreground |
| Back gesture | Pauses the match through the existing menu; a second Back from the pause menu exits |
| Touch | The existing multi-touch controls (stick, look area, fire/aim/jump/run/reload), now with `viewport-fit=cover`, `dvh` sizing and no long-press selection on the canvas |
| Hardware | OpenGL ES 2.0+ required (WebGL2 in practice), large heap, hardware acceleration |
| Branding | Adaptive launcher icon (anydpi-v26 vector + raster fallbacks) and splash screens for every density, drawn from the in-game zone-ring mark - regenerate with `tools/generate-android-icons.sh` |
| Offline | Everything is bundled locally; `androidScheme: https`, no network permission use beyond the manifest declaration |

### Toolchain

| Component | Version |
| --- | --- |
| Capacitor | 7 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/app`) |
| Gradle / Android Gradle Plugin | 8.11.1 / 8.7.2 (wrapper is committed) |
| JDK | 21 (Capacitor 7 compiles with `sourceCompatibility 21`) |
| Android SDK | compileSdk 35, targetSdk 35, minSdk 23 (Android 6+) |

### Building locally

```bash
npm install
npm run android:sync        # npm run build + cap sync android
npm run android:open        # ... or open Android Studio and press Run
npm run android:assemble    # debug APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Install on a device/emulator with `adb install -r <apk>`, or sideload it.

A **release** build must be signed. Gradle reads the credentials from
`android/keystore.properties` (git-ignored) or from the environment, and refuses to
produce an unsigned release APK:

```bash
# 1. one-time: create a keystore (keep it out of the repo!)
keytool -genkeypair -v -keystore release.keystore -alias lastzone \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype PKCS12

# 2. local release builds - android/keystore.properties
cat > android/keystore.properties <<'EOF'
storeFile=/absolute/path/to/release.keystore
storePassword=********
keyAlias=lastzone
keyPassword=********
EOF

# 3. build
npm run android:apk        # android/app/build/outputs/apk/release/app-release.apk
```

`android/keystore.properties` may point at a keystore anywhere on disk; the
environment variables `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` work too (and take a back seat to
the properties file when both exist).

### Signing in CI

`.github/workflows/android-release.yml` builds the signed release APK on every push
to `main` (and on demand via *Run workflow*). Add these four repository secrets under
**Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w 0 release.keystore` (macOS: `base64 -i release.keystore`) - a single line |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias (`lastzone` above) |
| `ANDROID_KEY_PASSWORD` | key password |

The workflow runs the test suite, builds the production game, syncs it into the
Android project, decodes the keystore into `$RUNNER_TEMP`, verifies that it opens and
contains the requested alias, runs `./gradlew assembleRelease`, checks that the APK is
signed **and** that `assets/public/` really contains the built game, then uploads:

```
artifact:  last-zone-release-apk
path:      android/app/build/outputs/apk/release/app-release.apk
```

If any of the four secrets is missing the workflow fails immediately with a message
naming the missing secret(s) - it never falls back to an unsigned or debug build.

### Credential rules (enforced, not just documented)

* The keystore, `keystore.properties` and every `*.jks` / `*.keystore` / `*.p12` file
  are in `.gitignore` (root and Android). Nothing signing-related is ever committed.
* No password, alias or path is hardcoded in `build.gradle`, the workflow or the
  game source. Passwords reach Gradle through the environment, never through
  command-line arguments.
* CI decodes the keystore only for the duration of the build, into `$RUNNER_TEMP`
  (outside the checkout, never uploaded); `keytool` is invoked with
  `-storepass:env` so the password never appears in a process listing, and its
  output is discarded so nothing sensitive reaches the logs.
* Losing the keystore means losing the ability to update an installed APK - back it
  up somewhere safe and private.

### Android notes

* First launch shows the splash art while the WebGL context and shaders warm up, then
  hands over to the deploy menu.
* The deploy/pause menu is reachable at any time with the ⏸ button or the Back
  gesture; the match resumes where it left off.
* Debugging: `chrome://inspect` over `adb` sees the WebView once
  `webContentsDebuggingEnabled` is turned on in `capacitor.config.json` (it is off by
  default so release builds stay quiet).
* To change the application ID, edit it in `capacitor.config.json` *and*
  `android/app/build.gradle`, then re-run `npm run android:sync`.

---

## Controls

### Desktop

| Action | Key / mouse |
| --- | --- |
| Move | `W` `A` `S` `D` (or arrow keys) |
| Sprint | `Shift` |
| Jump | `Space` |
| Look | Mouse - click the view once to capture the cursor (pointer lock); `Esc` releases it |
| **Fire** | **Left mouse button** (hold for automatic fire) or `F` |
| **Aim down sights** | **Right mouse button** (hold) or `Q` |
| **Reload** | `R` (also happens automatically when the magazine runs dry) |
| Look without a mouse | `I` `K` pitch, `J` `L` yaw |
| Zoom | Mouse wheel |
| Pause / menu | `Esc` |
| Debug overlay | `F3` |
| Take 25 damage (test the hurt/elimination feedback) | `H` |
| Toggle the touch pad | `T` |

Aiming pulls the camera over the shoulder, zooms the field of view, tightens the
crosshair and lets you strafe while keeping the weapon pointed at the reticle.

If pointer lock is unavailable (embedded iframes, some kiosks), the game
automatically falls back to **drag to look** - hold the left mouse button and
drag.

### Mobile / touch

| Action | Gesture |
| --- | --- |
| Move | Drag anywhere in the lower-left half - a floating stick appears under your thumb |
| Look / aim | Drag anywhere in the right half |
| **Fire** | **`Fire` button** (hold for automatic fire, tap for a single shot) |
| **Aim** | `Aim` button (tap to toggle) |
| **Reload** | `Reload` button (tap) |
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
├── capacitor.config.json      # Android shell config (appId, webDir, splash, scheme)
├── public/favicon.svg
├── android/                   # Capacitor Android project (Gradle, manifest, icons)
├── tools/
│   └── generate-android-icons.sh  # regenerates launcher icons + splash screens
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
│   ├── combat/
│   │   ├── CombatSystem.js    # the glue: intent -> weapon -> trace -> damage -> events
│   │   ├── Hitscan.js         # pure ray/shape hit detection (no three.js)
│   │   ├── Health.js          # reusable hit-point pool with events
│   │   ├── Damageable.js      # id + live position + cylinder hitbox + health
│   │   ├── Target.js          # training dummies + the target system
│   │   ├── CombatEffects.js   # pooled tracers, muzzle flash, impacts
│   │   └── weapons/
│   │       ├── Weapon.js      # magazine/cooldown/reload/spread state machine
│   │       ├── WeaponTypes.js # registry: definitions -> weapon instances
│   │       ├── WeaponModels.js# procedural weapon meshes (+ `muzzle` node)
│   │       └── WeaponView.js  # hip/aim/recoil posing on the character
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
│   │   ├── HudSystem.js       # brand mark + adaptive control hints
│   │   ├── CombatHud.js       # reticle, health, ammo, hit markers, banner
│   │   └── DebugOverlay.js    # F3 readout (movement + combat telemetry)
│   ├── platform/
│   │   └── nativeApp.js       # Capacitor shell glue (Android back button); inert on the web
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

### Combat

Combat is layered so that adding a weapon never means touching the shooting code:

```
 intent (primary/aim/reload)          input/InputSystem.js
        |
        v
 Weapon            magazine, cooldown, reload timer, spread, falloff
        |
        v
 Hitscan           ray vs. actor cylinders + world collider  (pure math)
        |
        v
 Damageable/Health damage, death, events
        |
        v
 CombatSystem      drives the above, publishes bus events
        |
        +--> CombatEffects   tracer, muzzle flash, impact spark  (pooled, no GC)
        +--> WeaponView      hip/aim/recoil pose on the character
        +--> CombatHud       reticle, health, ammo, hit markers, banner
```

Two decisions worth knowing:

* **Shots are traced from the camera and drawn from the muzzle.** Tracing from the
  muzzle would make the impact point disagree with the reticle up close; drawing
  from the muzzle keeps the tracer honest with the weapon model.
* **The player is a `Damageable` too.** Bot weapons (later) can shoot the player
  through exactly the same code path this build uses for dummies.

### Adding a weapon

1. Add an entry to `WEAPONS` in `src/config/settings.js`:

   ```js
   shotgun: {
     id: 'shotgun', name: 'Breacher', kind: 'hitscan',
     automatic: false, damage: 9, headshotMultiplier: 1.5, fireRate: 1.2,
     magazineSize: 6, reserveAmmo: 42, reloadTime: 2.6, range: 45,
     pellets: 8,                       // already supported by the fire loop
     spread: { standing: 0.05, moving: 0.07, aiming: 0.04, perShot: 0, max: 0.08, recovery: 3 },
     recoil: { vertical: 0.03, horizontal: 0.012 },
     muzzle: { x: 0.19, y: 1.29, z: -0.62 },
     model: 'rifle',
   }
   ```
2. (Optional) add a builder for a new `model` in `combat/weapons/WeaponModels.js`
   that returns a group with a child named `muzzle`.
3. Call `combat.equipWeapon('shotgun')` - for example from a future loot pickup.

That is the whole change; `tests/combat-e2e.test.js` proves it by registering and
firing a brand new weapon without touching a single combat source file.

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

WEAPONS.rifle       // damage, fire rate, magazine, reload, spread, recoil, model
HEALTH              // player max health, fall damage, spawn protection
COMBAT              // range, falloff, recoil ceiling, effect lifetimes, aim feel
TARGETS             // how many training dummies, where, how tough
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
* `tests/combat.test.js` - the combat primitives in isolation: health pools and
  death events, hitbox maths, ray/sphere/cylinder/box intersection, world rays
  and surface normals, cover blocking shots, spread cones, magazine/cooldown/
  reload/spread/damage-falloff weapon behaviour, weapon registration, dummy
  damage-death-rebuild, weapon view posing and pooled effects.
* `tests/game.test.js` - end-to-end: boots the real `createGame()` wiring under
  jsdom with a headless renderer, then drives it with synthetic keyboard and
  pointer events (menu, WASD, sprint, jump, camera drag/zoom, virtual stick,
  touch look, pause, respawn, debug overlay) and asserts the player never ends up
  inside geometry.
* `tests/native-app.test.js` - the Android shell integration: the platform check,
  and the back-button policy (pause a live match, exit only from the pause menu)
  exercised through an injected Capacitor `App` plugin, no device required.
* `tests/combat-e2e.test.js` - combat through the *real* game, using only player
  entry points: pointer-lock mouse fire, `F` key fire, aiming, recoil, reload
  (key + button), auto-reload on empty, fire-rate measurement, headshots,
  kills and dummy rebuilds, cover, the elimination flow and respawn, the combat
  HUD readouts, mobile fire/aim/reload buttons, and a 20 second soak of mixed
  input that must not throw.

The headless renderer is injected through `createGame({ rendererFactory })`, so
tests exercise the same wiring the browser uses - only the GPU is replaced.

---

## Where the next features plug in

The foundation was shaped by what comes next; each of these is a real extension
point, not a stub:

| Feature | Where it goes |
| --- | --- |
| **More weapons** | Data only: see "Adding a weapon" above. A `Loadout`/`WeaponSystem` would sit next to `CombatSystem` and call `equipWeapon()`. |
| **Projectiles** | `Weapon.type.kind` is already read from data. A `ProjectileSystem` can reuse `Damageable`, the same damage/event helpers and `CombatEffects` for the trail. |
| **Loot** | `WorldSystem` already owns runtime map mutation: spawn `LootContainer` objects into `worldGroup`, register their colliders with the same `Collider`, and call `combat.equipWeapon()` / `weapon.addReserve()` on pickup. |
| **Inventory** | Register an `inventory` service; the HUD mounts its own widget into `#ui-root` and subscribes to its events. `CharacterView` already has a right-hand attach point for held items. |
| **The zone** | New `src/world/ZoneSystem.js` using `lateFixedUpdate` to apply area damage via `combat.damagePlayer()` - the same entry point fall damage uses - and update the fog/light tint through `SceneEnvironment`. |
| **Bots** | Give them a `PlayerController`, a `Damageable` and a `Weapon`: hit detection, damage and death already work against any registered damageable. |
| **Lobby / match flow** | Replace `MenuSystem`'s single `close()` action with a match service that owns spawn selection (`world.sampleSpawn()` already returns validated points) and round timers. |
| **Multiplayer** | The controller already takes an intent and returns state: feed remote intents into additional `PlayerController` instances (one per peer) and render them with `CharacterView` (its `colors` option exists for team tints). Swap the input source for network snapshots - nothing in movement, camera or rendering assumes a single player. |
| **Audio** | Subscribe to `weapon:fired`, `combat:hit`, `combat:kill`, `player:jump`, `player:land`, `world:ready` and the renderer's context events. |

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Blank screen / boot error | The game needs **WebGL2**. Check `chrome://gpu` or `about:support`; update the browser or enable hardware acceleration. |
| "Press Deploy" but the cursor stays free | Pointer lock is blocked in embedded frames. The game falls back to **drag to look** - hold the left mouse button. Note that while dragging, a *quick tap* fires and a *drag* looks. |
| Shots seem to miss | Check the F3 overlay: `spread` grows while moving and after sustained fire. Stand still or aim down sights (`RMB`/`Q`) to tighten it. |
| Movement feels too fast/slow | Tune `PLAYER.walkSpeed`, `sprintSpeed`, `groundAcceleration` in `src/config/settings.js`. |
| Low FPS on a phone | Add `?quality=mobile` (or set `QUALITY.mobile`); reduce `shadowMapSize` / `terrainSegments` further. |
| Dev server not reachable from another device | It already binds `0.0.0.0`; open `http://<your-lan-ip>:5173`. |
| Android build: "Release signing is not configured" | Provide `android/keystore.properties` or the four `ANDROID_*` environment variables; debug builds (`npm run android:assemble`) need nothing. |
| Android build: "Alias ... was not found in the keystore" | The `ANDROID_KEY_ALIAS` secret does not match the alias inside the uploaded keystore. |
| Android build: "Missing signing secret(s)" | Add the four secrets listed in [Signing in CI](#signing-in-ci), then re-run the workflow. |

Tested in current Chrome, Edge, Firefox and Safari (desktop and mobile) — the
only requirement is a WebGL2-capable browser, no accounts, no backend, no
external APIs.

---

## Roadmap

1. ~~**Combat**: a weapon, hitscan hit detection, ammo, reload, health, elimination.~~ ✅ *(this build)*
1b. ~~**Android packaging**: signed release APK via Capacitor + GitHub Actions.~~ ✅ *(this build)*
2. **Weapon variety**: a second and third weapon (projectiles, shotgun pellets), weapon switching, pickups.
3. **Loot & inventory**: world spawns, pickups, hotbar, healing items.
4. **The zone**: shrinking play area with escalating damage and a minimap.
5. **Match flow**: lobby, drop-in, timer, placement screen.
6. **Bots**, then **netcode** (authoritative server, client prediction) on top of
   the intent/state split that already exists.

## License

Released under the MIT License - see [LICENSE](LICENSE).
