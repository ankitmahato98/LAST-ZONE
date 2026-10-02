import * as THREE from 'three';
import { Collider } from '../physics/Collider.js';
import { Nature } from './Nature.js';
import { PLAYER, WORLD } from '../config/settings.js';
import { nextFrame } from '../utils/dom.js';

/**
 * Owns the map: builds the ground and props, keeps the collision world and
 * hands out spawn points.
 *
 * It is also the natural home for everything that will later mutate the map at
 * runtime - loot spawns, the shrinking zone, destructible cover - without those
 * systems needing to know how the terrain is generated.
 */
export class WorldSystem {
  constructor({ terrain, arena, nature = null, quality, config = WORLD, playerConfig = PLAYER }) {
    this.name = 'world';
    this.terrain = terrain;
    this.arena = arena;
    this.quality = quality;
    this.nature = nature;
    this.config = config;
    this.playerConfig = playerConfig;

    this.group = new THREE.Group();
    this.group.name = 'world-root';
    this.collider = null;
    this._spawnIndex = 0;
  }

  async init(game) {
    this.game = game;
    const renderer = game.services.require('renderer');
    const loading = game.services.get('loading');

    loading?.setStatus('Generating terrain\u2026');
    await nextFrame();
    this.terrain.build();
    this.arena.build();

    loading?.setStatus('Scattering props\u2026');
    await nextFrame();
    this.nature ??= new Nature({ world: this.config, terrain: this.terrain, quality: this.quality });
    this.nature.build();

    this.group.add(this.terrain.mesh, this.arena.group, this.nature.group);
    renderer.worldGroup.add(this.group);

    loading?.setStatus('Building collision\u2026');
    await nextFrame();
    this.collider = new Collider({
      heightSampler: this.terrain,
      boxes: [...this.arena.boxes],
      cylinders: [...this.arena.cylinders, ...this.nature.cylinders],
      worldLimit: this.config.playableRadius,
    });

    game.bus.emit('world:ready', this.stats);
  }

  get stats() {
    return {
      boxes: this.collider?.boxes.length ?? 0,
      cylinders: this.collider?.cylinders.length ?? 0,
      props: this.nature?.counts ?? { trees: 0, rocks: 0, grass: 0 },
    };
  }

  // ------------------------------------------------------------- sampling --

  heightAt(x, z) {
    return this.terrain.heightAt(x, z);
  }

  slopeAt(x, z) {
    return this.terrain.slopeAt(x, z);
  }

  isInside(x, z) {
    return this.terrain.isInside(x, z, 1);
  }

  isWithinBounds(x, z, radius = 0) {
    return Math.hypot(x, z) <= this.config.playableRadius - radius;
  }

  /** Ground height including walkable props (crates, platforms). */
  groundHeightAt(x, z, feetY, body) {
    return this.collider.groundHeightAt(x, z, feetY, body);
  }

  /** Keeps an actor inside the playable circle (invisible map boundary). */
  constrain(position, radius = 0) {
    const limit = this.config.playableRadius - radius;
    const distance = Math.hypot(position.x, position.z);
    if (distance <= limit) return false;
    const scale = limit / (distance || 1);
    position.x *= scale;
    position.z *= scale;
    return true;
  }

  /**
   * A legal, ground-snapped spawn point. Arena spawn plates are tried first,
   * then a spiral search around the centre as a safety net - the game must
   * never fail to place the player.
   */
  sampleSpawn(
    body = { radius: this.playerConfig.radius, height: this.playerConfig.height },
    tester = null,
  ) {
    const plates = this.arena.spawnPoints;
    for (let i = 0; i < plates.length; i += 1) {
      this._spawnIndex = (this._spawnIndex + 1) % plates.length;
      const candidate = plates[this._spawnIndex].clone();
      if (this._trySpawn(candidate, body, tester)) return candidate;
    }

    for (let ring = 1; ring <= 8; ring += 1) {
      const radius = 6 + ring * 4;
      for (let step = 0; step < 12; step += 1) {
        const angle = (step / 12) * Math.PI * 2;
        const candidate = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        if (this._trySpawn(candidate, body, tester)) return candidate;
      }
    }

    console.warn('[world] no validated spawn found - using the configured spawn');
    const fallback = new THREE.Vector3(this.playerConfig.spawn.x, 0, this.playerConfig.spawn.z);
    fallback.y = this.heightAt(fallback.x, fallback.z);
    return fallback;
  }

  _trySpawn(candidate, body, tester) {
    if (tester) {
      const probe = { x: candidate.x, y: candidate.y, z: candidate.z };
      if (!tester.test(probe, body)) return false;
      candidate.y = probe.y;
      return true;
    }
    candidate.y = this.heightAt(candidate.x, candidate.z);
    return this.collider.isClear(candidate.x, candidate.z, candidate.y, body);
  }

  /**
   * Applied after movement: the player can never walk out of the map.
   * Future actors (bots, vehicles) get appended here - or better, register
   * themselves with an `actors` service that this loop iterates.
   */
  lateFixedUpdate() {
    const player = this.game?.services.get('player');
    if (!player) return;
    if (this.constrain(player.position, this.playerConfig.radius)) {
      this.game.bus.emit('world:boundary', { position: player.position });
    }
  }

  dispose() {
    this.terrain.dispose();
    this.arena.dispose();
    this.nature?.dispose();
    this.group.clear();
  }
}
