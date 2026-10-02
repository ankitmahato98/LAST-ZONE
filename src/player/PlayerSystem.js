import { CharacterConfig } from './CharacterConfig.js';
import { PlayerController } from './PlayerController.js';

/**
 * The local player actor.
 *
 * Thin system wrapper around `PlayerController`: it resolves the services the
 * controller needs (world, input, camera), owns respawning, and publishes the
 * player's own events on the global bus so UI/audio/analytics can react.
 *
 * For multiplayer this is the pawn that would be driven by local input or by
 * remote snapshots - the controller itself never changes.
 */
const NEUTRAL_INTENT = Object.freeze({
  move: { x: 0, y: 0 },
  jumpQueued: false,
  jumpHeld: false,
  sprintHeld: false,
});

export class PlayerSystem {
  constructor({ config = new CharacterConfig(), spawnTester = null, fallLimit = -40 } = {}) {
    this.name = 'player';
    this.config = config;
    this.spawnTester = spawnTester;
    this.fallLimit = fallLimit;
    this.controller = null;
    this.spawnPoint = null;
    /** Cleared while eliminated or paused: the pawn stops taking input. */
    this.controllable = true;
  }

  async init(game) {
    this.game = game;
    this.world = game.services.require('world');

    this.controller = new PlayerController({ world: this.world, config: this.config });
    this.controller.events.on('jump', (payload) => game.bus.emit('player:jump', payload));
    this.controller.events.on('land', (payload) => game.bus.emit('player:land', payload));

    // Combat (or any future system) can take control away without the player
    // system knowing anything about combat.
    this._unsubscribe = [
      game.bus.on('combat:player:eliminated', () => this.setControllable(false)),
      game.bus.on('combat:player:restored', () => this.setControllable(true)),
    ];

    this.respawn();
  }

  // -------------------------------------------------------------- accessors --

  // The accessors are null-safe: systems created before `init()` (or in tests
  // with a different system order) can probe the player without crashing.

  get state() {
    return this.controller?.state ?? null;
  }

  get position() {
    return this.controller?.state.position ?? null;
  }

  get velocity() {
    return this.controller?.state.velocity ?? null;
  }

  get yaw() {
    return this.controller?.state.yaw ?? 0;
  }

  get onGround() {
    return this.controller?.state.onGround ?? false;
  }

  get speed() {
    return this.controller?.state.speed ?? 0;
  }

  get body() {
    return this.config.body;
  }

  // ------------------------------------------------------------- simulation --

  fixedUpdate(dt) {
    const input = this.game.services.get('input');
    const camera = this.game.services.get('camera3p');

    const intent = this.controllable ? input?.intent ?? NEUTRAL_INTENT : NEUTRAL_INTENT;
    const yaw = camera?.yaw ?? this.controller.state.yaw;
    this.controller.update(dt, intent, yaw);

    if (this.controller.state.position.y < this.fallLimit) {
      this.game.bus.emit('player:fellOutOfWorld', { position: this.position });
      this.respawn();
    }
  }

  // ---------------------------------------------------------------- control --

  /** Enables/disables input for this pawn (elimination, cutscenes, pause). */
  setControllable(controllable) {
    if (this.controllable === controllable) return this.controllable;
    this.controllable = controllable;
    if (!controllable) this.controller.state.velocity.set(0, 0, 0);
    this.game?.bus.emit('player:controllable', { controllable });
    return this.controllable;
  }

  /** Places the player at the next validated spawn point. */
  respawn(position = null) {
    const spawn = position ?? this.world.sampleSpawn(this.body, this.spawnTester);
    this.spawnPoint = spawn;
    this.controller.respawn(spawn, this.config.spawnYaw ?? 0);
    this.game?.bus.emit('player:respawn', { position: spawn });
    return spawn;
  }

  dispose() {
    for (const off of this._unsubscribe ?? []) off();
    this._unsubscribe = [];
  }

  teleport(x, z, y = null) {
    const height = y ?? this.world.heightAt(x, z);
    this.controller.teleport(x, height, z);
    this.game?.bus.emit('player:teleport', { x, z, y: height });
  }
}
