import { Game } from './Game.js';
import { RENDER, WORLD, getLaunchFlags, getQualitySettings } from '../config/settings.js';
import { configureMaterials } from '../world/materials.js';

import { InputSystem } from '../input/InputSystem.js';
import { KeyboardBindings } from '../input/KeyboardBindings.js';
import { TouchControls } from '../input/TouchControls.js';
import { PointerLook } from '../input/PointerLook.js';

import { RendererSystem } from '../render/RendererSystem.js';
import { SceneEnvironment } from '../render/SceneEnvironment.js';

import { Terrain } from '../world/Terrain.js';
import { Arena } from '../world/Arena.js';
import { WorldSystem } from '../world/WorldSystem.js';
import { RayWorldSpawnTester } from '../world/SpawnTester.js';

import { PlayerSystem } from '../player/PlayerSystem.js';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera.js';
import { CharacterView } from '../player/CharacterView.js';

import { CombatSystem } from '../combat/CombatSystem.js';
import { CombatEffects } from '../combat/CombatEffects.js';
import { TargetSystem } from '../combat/Target.js';

import { LootSystem } from '../loot/LootSystem.js';
import { InventorySystem } from '../inventory/InventorySystem.js';

import { HudSystem } from '../ui/HudSystem.js';
import { CombatHud } from '../ui/CombatHud.js';
import { InventoryHud } from '../ui/InventoryHud.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { MenuSystem } from '../ui/MenuSystem.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';

/**
 * Builds the whole game: services -> systems -> boot.
 *
 * The wiring is spelled out in one place so it stays obvious which system owns
 * what, and where new systems plug in later:
 *
 *   weapons   -> add an entry to WEAPONS in config + a model builder; the loot
 *                tables pick it up automatically (weapon ids are loot ids)
 *   loot      -> LootSystem rolls `world.lootAnchors` from the data loot tables
 *                and owns the world entities; nothing spawns by hand
 *   inventory -> InventorySystem routes pickups/drops into the Inventory and
 *                consumables into Vitals; the HUD only listens
 *   items     -> add an entry to loot/items/ItemData.js (+ a loot table weight)
 *   zone      -> game.addSystem(new ZoneSystem()) after the world; it can damage
 *                the player through `combat.damagePlayer()` like fall damage does
 *   lobby     -> replace MenuSystem's Play action with a lobby handshake
 *   netcode   -> feed remote intents into extra PlayerController instances; the
 *                player's own damageable is already registered for hit detection
 *
 * @returns {Promise<{ game: Game, loading: LoadingScreen }>}
 */
export async function createGame({
  canvas = document.getElementById('game-canvas'),
  uiRoot = document.getElementById('ui-root'),
  /**
   * Renderer factory. The default builds the real WebGL renderer; tests pass a
   * headless stub so the exact same wiring can run without a GPU.
   */
  rendererFactory = (options) => new RendererSystem(options),
} = {}) {
  if (!canvas) throw new Error('createGame: #game-canvas not found');
  if (!uiRoot) throw new Error('createGame: #ui-root not found');

  const flags = getLaunchFlags();
  const quality = getQualitySettings(flags.profile);
  const loading = new LoadingScreen();

  const game = new Game({
    canvas,
    uiRoot,
    settings: {
      profile: flags.profile,
      quality,
      maxPixelRatio: Math.min(RENDER.maxPixelRatio, quality.maxPixelRatio),
      world: WORLD,
      startDebug: flags.debug,
    },
  });

  game.services.register('loading', loading);
  game.services.register('quality', quality);
  configureMaterials({ pbr: quality.pbrMaps !== false, size: quality.textureSize ?? 256 });

  // --- Input ------------------------------------------------------------
  // Keyboard/mouse and touch both write into the same intent object, so the
  // simulation never knows (or cares) which device produced the input.
  const input = game.addSystem(new InputSystem());
  game.services.register('input', input);

  const keyboard = game.addSystem(new KeyboardBindings({ input }));
  const pointerLook = game.addSystem(new PointerLook({ canvas, input }));
  const touch = game.addSystem(
    new TouchControls({
      uiRoot,
      input,
      forceVisible: flags.touch ? true : flags.noTouch ? false : null,
    }),
  );
  game.services.register('keyboard', keyboard);
  game.services.register('pointerLook', pointerLook);
  game.services.register('touchControls', touch);

  // --- Rendering --------------------------------------------------------
  const renderer = game.addSystem(rendererFactory({ canvas }));
  game.services.register('renderer', renderer);

  const environment = game.addSystem(
    new SceneEnvironment({ scene: renderer.scene, quality, world: WORLD, renderConfig: RENDER }),
  );
  game.services.register('environment', environment);

  // --- World ------------------------------------------------------------
  const terrain = new Terrain({ world: WORLD, quality });
  const arena = new Arena({ world: WORLD, terrain, quality });
  const world = game.addSystem(new WorldSystem({ terrain, arena, quality }));
  game.services.register('world', world);
  game.services.register('spawnTester', new RayWorldSpawnTester({ world }));

  // --- Player -----------------------------------------------------------
  // The simulation pawn is registered before its presentation so that views
  // can read the player state during their own init.
  const player = game.addSystem(new PlayerSystem({ spawnTester: game.services.get('spawnTester') }));
  game.services.register('player', player);

  const character = game.addSystem(new CharacterView());
  game.services.register('characterView', character);

  // --- Camera -----------------------------------------------------------
  const camera = game.addSystem(new ThirdPersonCamera({ camera: renderer.camera, input }));
  game.services.register('thirdPersonCamera', camera);
  game.services.register('camera3p', camera);

  // --- Combat -----------------------------------------------------------
  // Order matters: effects and targets exist before the combat system resolves
  // them, and combat runs after the player/camera so it reads the current frame's
  // aim direction.
  const effects = game.addSystem(new CombatEffects());
  game.services.register('combatEffects', effects);

  const targets = game.addSystem(new TargetSystem({ seed: WORLD.seed }));
  // TargetSystem registers its own service (`targets`) during init.

  const combat = game.addSystem(new CombatSystem({ seed: WORLD.seed }));
  game.services.register('combat', combat);

  // --- Loot + inventory -------------------------------------------------
  // Loot owns the physical pickups, inventory owns the loadout. Both resolve
  // the services they need lazily, so the registration order here is only about
  // update order: loot announces `loot:nearby` before the inventory reacts to
  // the interact action in the same fixed step.
  const loot = game.addSystem(new LootSystem({ seed: WORLD.seed }));
  game.services.register('loot', loot);

  const inventory = game.addSystem(new InventorySystem({ seed: WORLD.seed }));
  game.services.register('inventory', inventory);

  // --- UI ---------------------------------------------------------------
  const hud = game.addSystem(new HudSystem({ uiRoot }));
  const combatHud = game.addSystem(new CombatHud({ uiRoot }));
  game.services.register('combatHud', combatHud);
  const inventoryHud = game.addSystem(new InventoryHud({ uiRoot }));
  game.services.register('inventoryHud', inventoryHud);
  const debug = game.addSystem(new DebugOverlay({ uiRoot, game }));
  const menu = game.addSystem(new MenuSystem({ uiRoot, pointerLook, touch, input }));
  game.services.register('hud', hud);
  game.services.register('debugOverlay', debug);
  game.services.register('menu', menu);

  await game.init();
  return { game, loading };
}
