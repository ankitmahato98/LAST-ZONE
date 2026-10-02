/**
 * Tiny service locator.
 *
 * Systems receive the registry at construction time and resolve what they need
 * lazily (`services.require('player')`). This keeps construction order free and
 * makes it trivial to swap an implementation, e.g. a network driven
 * `RemotePlayer` instead of the local `Player`, once multiplayer lands.
 */
export class ServiceRegistry {
  constructor() {
    /** @type {Map<string, unknown>} */
    this._services = new Map();
  }

  register(name, instance) {
    if (this._services.has(name)) {
      throw new Error(`Service "${name}" is already registered`);
    }
    this._services.set(name, instance);
    return instance;
  }

  /** Register or replace - useful for hot swapping implementations. */
  set(name, instance) {
    this._services.set(name, instance);
    return instance;
  }

  get(name) {
    return this._services.get(name);
  }

  require(name) {
    const service = this._services.get(name);
    if (service === undefined) {
      throw new Error(`Service "${name}" is not registered (available: ${this.names().join(', ')})`);
    }
    return service;
  }

  has(name) {
    return this._services.has(name);
  }

  names() {
    return [...this._services.keys()];
  }
}
