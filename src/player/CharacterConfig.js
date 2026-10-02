import { PLAYER } from '../config/settings.js';

/**
 * Per-character tuning.
 *
 * The defaults come from `config/settings.js`; anything can be overridden per
 * spawn. Bots, a heavier class or a future network-driven pawn all get their
 * own instance, while the controller code stays identical.
 */
export class CharacterConfig {
  constructor(overrides = {}) {
    const base = { ...PLAYER, spawn: { ...PLAYER.spawn } };
    Object.assign(this, base, overrides);
    if (overrides.spawn) this.spawn = { ...base.spawn, ...overrides.spawn };
  }

  /** Collision body used by the physics helpers. */
  get body() {
    return {
      radius: this.radius,
      height: this.height,
      stepHeight: this.stepHeight,
    };
  }

  clone(overrides = {}) {
    return new CharacterConfig({ ...this, ...overrides });
  }
}
