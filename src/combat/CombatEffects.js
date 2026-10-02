import * as THREE from 'three';
import { COMBAT } from '../config/settings.js';

/**
 * World-space combat feedback: tracers, muzzle flashes and bullet impacts.
 *
 * Everything is pooled and preallocated - firing must never allocate, or the
 * garbage collector shows up as a stutter in the middle of a fight. All three
 * effects are additive and fade by dimming their vertex colours, which needs no
 * per-instance materials.
 *
 * The muzzle flash lives *inside* the weapon's muzzle node (see
 * `attachMuzzleFlash`), so it inherits the weapon pose for free.
 */
export class CombatEffects {
  constructor({ config = COMBAT } = {}) {
    this.name = 'combatEffects';
    this.config = config;
    this.group = null;
    this._tracers = [];
    this._impacts = [];
  }

  init(game) {
    this.game = game;
    const renderer = game.services.require('renderer');

    this.group = new THREE.Group();
    this.group.name = 'combat-effects';
    renderer.worldGroup.add(this.group);

    this._buildTracers(12);
    this._buildImpacts(this.config.maxImpacts);
  }

  // -------------------------------------------------------------- tracers --

  _buildTracers(count) {
    for (let i = 0; i < count; i += 1) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(6), 3),
      );
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(6), 3));
      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      line.visible = false;
      line.renderOrder = 5;
      this.group.add(line);
      this._tracers.push({ line, life: 0, maxLife: 1, color: new THREE.Color() });
    }
  }

  /**
   * @param {{x:number,y:number,z:number}} from muzzle
   * @param {{x:number,y:number,z:number}} to impact / max range point
   */
  spawnTracer(from, to, { color = 0xffe6a8, life = this.config.tracerLifetime } = {}) {
    const tracer = this._tracers.find((t) => t.life <= 0) ?? this._tracers[0];
    tracer.life = life;
    tracer.maxLife = life;
    tracer.color.set(color);
    tracer.line.visible = true;

    const positions = tracer.line.geometry.attributes.position;
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    this._refreshTracerColor(tracer);
  }

  _refreshTracerColor(tracer) {
    const strength = Math.max(0, tracer.life / tracer.maxLife);
    const colors = tracer.line.geometry.attributes.color;
    for (let i = 0; i < 2; i += 1) {
      colors.setXYZ(i, tracer.color.r * strength, tracer.color.g * strength, tracer.color.b * strength);
    }
    colors.needsUpdate = true;
  }

  // -------------------------------------------------------------- impacts --

  _buildImpacts(count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.22,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.name = 'impacts';
    points.frustumCulled = false;
    points.renderOrder = 6;
    this.group.add(points);

    for (let i = 0; i < count; i += 1) {
      this._impacts.push({ life: 0, maxLife: 1, color: new THREE.Color(), index: i });
    }
    this.impactPoints = points;
  }

  spawnImpact(point, normal, { color = 0xffd9a0, life = this.config.impactLifetime, offset = 0.02 } = {}) {
    const slot = this._impacts.find((i) => i.life <= 0) ?? this._impacts[0];
    slot.life = life;
    slot.maxLife = life;
    slot.color.set(color);

    const positions = this.impactPoints.geometry.attributes.position;
    const nx = normal?.x ?? 0;
    const ny = normal?.y ?? 1;
    const nz = normal?.z ?? 0;
    positions.setXYZ(slot.index, point.x + nx * offset, point.y + ny * offset, point.z + nz * offset);
    positions.needsUpdate = true;
    this._refreshImpactColor(slot);
  }

  _refreshImpactColor(slot) {
    const strength = Math.max(0, slot.life / slot.maxLife);
    // Fade out and dim: a fresh hit is bright, an old one fades to black.
    const s = strength * strength;
    this.impactPoints.geometry.attributes.color.setXYZ(
      slot.index,
      slot.color.r * s,
      slot.color.g * s,
      slot.color.b * s,
    );
    this.impactPoints.geometry.attributes.color.needsUpdate = true;
  }

  // -------------------------------------------------------- muzzle flash --

  /**
   * Adds a flash quad to a muzzle node. Keeping it parented to the weapon means
   * it follows the pose, recoil and animation with zero extra work.
   */
  attachMuzzleFlash(muzzleNode, { color = 0xffcf7a, size = 0.32 } = {}) {
    const geometry = new THREE.PlaneGeometry(size, size);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flash = new THREE.Mesh(geometry, material);
    flash.name = 'muzzle-flash';
    flash.position.set(0, 0, -0.06);
    flash.visible = false;
    flash.renderOrder = 7;

    const light = new THREE.PointLight(color, 0, 6, 2);
    light.name = 'muzzle-light';
    flash.add(light);

    muzzleNode.add(flash);
    this.muzzleFlash = { mesh: flash, light, life: 0, maxLife: 0.05, baseSize: size };
    return flash;
  }

  spawnMuzzleFlash({ life = 0.05, scale = 1 } = {}) {
    const flash = this.muzzleFlash;
    if (!flash) return;
    flash.life = life;
    flash.maxLife = life;
    flash.mesh.visible = true;
    flash.mesh.rotation.z = Math.random() * Math.PI;
    flash.mesh.scale.setScalar(0.85 + scale * 0.35);
    flash.light.intensity = 9 * scale;
    flash.light.distance = 6 * scale;
  }

  // ------------------------------------------------------------ simulation --

  update(dt) {
    for (const tracer of this._tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      if (tracer.life <= 0) {
        tracer.line.visible = false;
        continue;
      }
      this._refreshTracerColor(tracer);
    }

    for (const slot of this._impacts) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      this._refreshImpactColor(slot);
    }

    const flash = this.muzzleFlash;
    if (flash?.life > 0) {
      flash.life -= dt;
      const strength = Math.max(0, flash.life / flash.maxLife);
      flash.mesh.material.opacity = strength;
      flash.light.intensity *= strength;
      if (flash.life <= 0) {
        flash.mesh.visible = false;
        flash.light.intensity = 0;
      }
    }
  }

  /** Clears every live effect - used on respawn and by tests. */
  clear() {
    for (const tracer of this._tracers) {
      tracer.life = 0;
      tracer.line.visible = false;
    }
    for (const slot of this._impacts) {
      slot.life = 0;
      this._refreshImpactColor(slot);
    }
    if (this.muzzleFlash) {
      this.muzzleFlash.life = 0;
      this.muzzleFlash.mesh.visible = false;
      this.muzzleFlash.light.intensity = 0;
    }
  }

  get activeTracerCount() {
    return this._tracers.filter((t) => t.life > 0).length;
  }

  dispose() {
    this.group.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
    this.group.parent?.remove(this.group);
    this._tracers.length = 0;
    this._impacts.length = 0;
  }
}
