import * as THREE from 'three';
import { Collider } from '../physics/Collider.js';
import { Nature } from './Nature.js';
import { IslandMap } from './IslandMap.js';
import { INITIAL_DROP_REGIONS } from './MapData.js';
import { Random } from '../utils/rng.js';
import { PLAYER, WORLD } from '../config/settings.js';
import { nextFrame } from '../utils/dom.js';

/** Owns island generation, collision, POI lookup and validated map metadata. */
export class WorldSystem {
  constructor({ terrain, arena, nature = null, islandMap = null, quality, config = WORLD, playerConfig = PLAYER }) {
    this.name = 'world';
    this.terrain = terrain;
    this.arena = arena;
    this.quality = quality;
    this.nature = nature;
    this.islandMap = islandMap;
    this.config = config;
    this.playerConfig = playerConfig;

    this.group = new THREE.Group();
    this.group.name = 'world-root';
    this.collider = null;
    this._spawnIndex = -1;
    this._currentPoiId = null;
    this.dropRegions = [];
    this.futureLootLocations = [];
  }

  async init(game) {
    this.game = game;
    const renderer = game.services.require('renderer');
    const loading = game.services.get('loading');

    loading?.setStatus('Raising the island…');
    await nextFrame();
    this.terrain.build();
    this.arena.build();

    loading?.setStatus('Building towns and routes…');
    await nextFrame();
    this.islandMap ??= new IslandMap({ terrain: this.terrain, quality: this.quality });
    this.islandMap.build();

    loading?.setStatus('Growing forests and fields…');
    await nextFrame();
    this.nature ??= new Nature({ world: this.config, terrain: this.terrain, quality: this.quality });
    this.nature.build();

    this.group.add(this.terrain.mesh, this.arena.group, this.islandMap.group, this.nature.group);
    renderer.worldGroup.add(this.group);

    loading?.setStatus('Indexing the island…');
    await nextFrame();
    this.collider = new Collider({
      heightSampler: this.terrain,
      boxes: [...this.arena.boxes, ...this.islandMap.boxes],
      cylinders: [...this.arena.cylinders, ...this.islandMap.cylinders, ...this.nature.cylinders],
      worldLimit: this.config.playableRadius,
    });
    this.dropRegions = this._buildDropRegions();
    this.futureLootLocations = this._buildFutureLootMetadata();

    game.bus.emit('world:ready', this.stats);
    game.bus.emit('world:catalog', {
      pois: this.poiCatalog,
      dropRegions: this.dropRegions,
      futureLootLocations: this.futureLootLocations,
    });
  }

  get poiCatalog() {
    return this.islandMap?.poiCatalog ?? [];
  }

  get stats() {
    return {
      boxes: this.collider?.boxes.length ?? 0,
      cylinders: this.collider?.cylinders.length ?? 0,
      props: this.nature?.counts ?? { trees: 0, rocks: 0, grass: 0 },
      pois: this.poiCatalog.length,
      buildings: this.islandMap?.buildingCount ?? 0,
      landmarks: this.islandMap?.landmarkCount ?? 0,
      roads: this.islandMap?.group.children.filter((child) => child.name.startsWith('road-')).length ?? 0,
      validatedDropCandidates: this.dropRegions.reduce((total, region) => total + region.candidates.length, 0),
      futureLootAnchors: this.futureLootLocations.length,
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
    return this.terrain.isLandAt(x, z, 1);
  }

  isWithinBounds(x, z, radius = 0) {
    return Math.hypot(x, z) <= this.config.playableRadius - radius
      && this.terrain.isLandAt(x, z, radius);
  }

  /** Ground height including walkable roofs, bridges and cover. */
  groundHeightAt(x, z, feetY, body) {
    return this.collider.groundHeightAt(x, z, feetY, body);
  }

  /** Keeps an actor on the actual island side of its irregular coastline. */
  constrain(position, radius = 0) {
    const distance = Math.hypot(position.x, position.z);
    const angle = Math.atan2(position.z, position.x);
    const coastLimit = this.terrain.coastlineRadiusAt(angle) - radius - 2.4;
    const limit = Math.min(this.config.playableRadius - radius, coastLimit);
    if (distance <= limit && this.terrain.isLandAt(position.x, position.z, radius + 0.4)) return false;

    const safeLimit = Math.max(1, limit);
    const scale = safeLimit / (distance || 1);
    position.x *= scale;
    position.z *= scale;
    return true;
  }

  /**
   * The local run enters once in the small Central City arrival plaza.
   * Distributed alternatives live only in validated `dropRegions` metadata
   * for a future match-start design; elimination never calls this method.
   */
  sampleSpawn(
    body = { radius: this.playerConfig.radius, height: this.playerConfig.height, stepHeight: this.playerConfig.stepHeight },
    tester = null,
  ) {
    const plates = this.arena.spawnPoints;
    for (let i = 0; i < plates.length; i += 1) {
      this._spawnIndex = (this._spawnIndex + 1) % plates.length;
      const candidate = plates[this._spawnIndex].clone();
      if (this._trySpawn(candidate, body, tester)) return candidate;
    }

    // Failsafe for a future layout edit: find a clear point near the start plaza.
    for (let ring = 1; ring <= 10; ring += 1) {
      const radius = 8 + ring * 3;
      for (let step = 0; step < 16; step += 1) {
        const angle = (step / 16) * Math.PI * 2;
        const candidate = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        if (this._trySpawn(candidate, body, tester)) return candidate;
      }
    }

    throw new Error('[world] could not find a clear initial player position');
  }

  _trySpawn(candidate, body, tester) {
    if (!this.isWithinBounds(candidate.x, candidate.z, body.radius)) return false;
    if (this.slopeAt(candidate.x, candidate.z) > 0.48) return false;
    if (tester) {
      const probe = { x: candidate.x, y: candidate.y, z: candidate.z };
      if (!tester.test(probe, body)) return false;
      candidate.y = probe.y;
      return true;
    }
    candidate.y = this.heightAt(candidate.x, candidate.z);
    return this.collider.isClear(candidate.x, candidate.z, candidate.y, body);
  }

  /** Named settlement at the player's current island location, if any. */
  getPoiAt(x, z) {
    let nearest = null;
    let nearestRatio = Infinity;
    for (const poi of this.poiCatalog) {
      const distance = Math.hypot(x - poi.center.x, z - poi.center.z);
      const ratio = distance / poi.radius;
      if (ratio <= 1 && ratio < nearestRatio) {
        nearest = { poi, distance };
        nearestRatio = ratio;
      }
    }
    return nearest;
  }

  _buildDropRegions() {
    const body = {
      radius: this.playerConfig.radius,
      height: this.playerConfig.height,
      stepHeight: this.playerConfig.stepHeight,
    };
    return INITIAL_DROP_REGIONS.map((definition) => {
      const [centerX, centerZ] = definition.center;
      const random = new Random(`${this.config.seed}:drop-region:${definition.id}`);
      const candidates = [];
      const attempts = definition.candidateCount * 36;
      for (let i = 0; i < attempts && candidates.length < definition.candidateCount; i += 1) {
        const angle = random.range(0, Math.PI * 2);
        const radius = Math.sqrt(random.range(0.04, 1)) * definition.radius;
        const x = centerX + Math.cos(angle) * radius;
        const z = centerZ + Math.sin(angle) * radius;
        if (!this.isWithinBounds(x, z, body.radius + 2)) continue;
        if (this.slopeAt(x, z) > 0.48) continue;
        if (candidates.some((candidate) => Math.hypot(candidate.x - x, candidate.z - z) < 10)) continue;
        const y = this.heightAt(x, z);
        if (!this.collider.isClear(x, z, y, body)) continue;
        candidates.push({ x: round2(x), y: round2(y), z: round2(z) });
      }
      return {
        id: definition.id,
        name: definition.name,
        center: { x: centerX, z: centerZ },
        radius: definition.radius,
        candidateCount: definition.candidateCount,
        candidates,
        validated: candidates.length > 0,
      };
    });
  }

  _buildFutureLootMetadata() {
    const kinds = ['cover-edge', 'upper-route', 'interior'];
    const locations = [];
    for (const region of this.dropRegions) {
      for (let i = 0; i < Math.min(3, region.candidates.length); i += 1) {
        locations.push({
          id: `${region.id}-future-anchor-${i + 1}`,
          poiId: region.id,
          poiName: region.name,
          kind: kinds[i % kinds.length],
          position: { ...region.candidates[i] },
          enabled: false,
          metadataOnly: true,
        });
      }
    }
    return locations;
  }

  // --------------------------------------------------------------- updates --

  update() {
    const player = this.game?.services.get('player');
    if (!player?.position) return;
    const nearby = this.getPoiAt(player.position.x, player.position.z)?.poi ?? null;
    const id = nearby?.id ?? null;
    if (id === this._currentPoiId) return;
    this._currentPoiId = id;
    this.game.bus.emit('world:poi', { poi: nearby, position: player.position.clone() });
  }

  lateFixedUpdate() {
    const player = this.game?.services.get('player');
    if (!player?.position) return;
    if (this.constrain(player.position, this.playerConfig.radius)) {
      this.game.bus.emit('world:boundary', { position: player.position });
    }
  }

  dispose() {
    this.terrain.dispose();
    this.arena.dispose();
    this.islandMap?.dispose();
    this.nature?.dispose();
    this.group.clear();
    this.dropRegions.length = 0;
    this.futureLootLocations.length = 0;
  }
}

function round2(number) {
  return Math.round(number * 100) / 100;
}
