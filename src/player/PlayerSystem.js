import { CharacterConfig } from './CharacterConfig.js';
import { PlayerController } from './PlayerController.js';

/** The local pawn: one validated entry placement, then normal single-run control. */
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
    this.controllable = true;
    this.spawned = false;
    this.fallEliminated = false;
  }

  async init(game) {
    this.game = game;
    this.world = game.services.require('world');
    this.controller = new PlayerController({ world: this.world, config: this.config });
    this.controller.events.on('jump', (payload) => game.bus.emit('player:jump', payload));
    this.controller.events.on('land', (payload) => game.bus.emit('player:land', payload));
    this._unsubscribe = [
      game.bus.on('combat:player:eliminated', () => this.setControllable(false)),
    ];
    this._placeAtMatchEntry();
  }

  get state() { return this.controller?.state ?? null; }
  get position() { return this.controller?.state.position ?? null; }
  get velocity() { return this.controller?.state.velocity ?? null; }
  get yaw() { return this.controller?.state.yaw ?? 0; }
  get onGround() { return this.controller?.state.onGround ?? false; }
  get speed() { return this.controller?.state.speed ?? 0; }
  get body() { return this.config.body; }

  fixedUpdate(dt) {
    const input = this.game.services.get('input');
    const camera = this.game.services.get('camera3p');
    const intent = this.controllable ? input?.intent ?? NEUTRAL_INTENT : NEUTRAL_INTENT;
    const yaw = camera?.yaw ?? this.controller.state.yaw;
    this.controller.update(dt, intent, yaw);

    if (this.controller.state.position.y < this.fallLimit && !this.fallEliminated) {
      this.fallEliminated = true;
      this.game.bus.emit('player:fellOutOfWorld', { position: this.position.clone() });
      const combat = this.game.services.get('combat');
      if (combat && !combat.isEliminated) {
        combat.damagePlayer(Math.max(1, combat.health), { source: 'fell-out-of-world' });
      } else {
        this.setControllable(false);
      }
    }
  }

  setControllable(controllable) {
    if (this.controllable === controllable) return this.controllable;
    this.controllable = controllable;
    if (!controllable) this.controller.state.velocity.set(0, 0, 0);
    this.game?.bus.emit('player:controllable', { controllable });
    return this.controllable;
  }

  _placeAtMatchEntry() {
    if (this.spawned) throw new Error('Player entry placement may only happen once per run');
    const spawn = this.world.sampleSpawn(this.body, this.spawnTester);
    this.spawnPoint = spawn.clone?.() ?? { ...spawn };
    this.controller.placeAt(spawn, this.config.spawnYaw ?? 0);
    this.spawned = true;
    this.game?.bus.emit('player:spawned', { position: spawn });
    return spawn;
  }

  teleport(x, z, y = null) {
    const height = y ?? this.world.heightAt(x, z);
    this.controller.teleport(x, height, z);
    this.game?.bus.emit('player:teleport', { x, z, y: height });
  }

  dispose() {
    for (const off of this._unsubscribe ?? []) off();
    this._unsubscribe = [];
  }
}
