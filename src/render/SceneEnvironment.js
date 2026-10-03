import * as THREE from 'three';

/**
 * Sky, fog and lights.
 *
 * The sky is a procedurally painted equirectangular canvas texture (no shader
 * code to maintain, no external assets) and the sun direction is derived from
 * the same vector that positions the directional light, so the bright spot in
 * the sky always matches the shadows on the ground.
 *
 * The sun's shadow camera is a compact moving box that follows the player,
 * keeping character-scale shadow detail sharp across the island.
 */

const SKY_TEXTURE_WIDTH = 1024;
const SKY_TEXTURE_HEIGHT = 512;

const PALETTE = {
  zenith: '#2b5a86',
  horizon: '#c3d6e2',
  ground: '#8a8f83',
  sunCore: '#fff6dd',
  sunGlow: '#ffd9a0',
};

export class SceneEnvironment {
  constructor({ scene, quality, world, renderConfig }) {
    this.name = 'environment';
    this.scene = scene;
    this.quality = quality;
    this.world = world;
    this.config = renderConfig;

    /** Direction the light travels *from* (points at the sun). */
    this.sunDirection = new THREE.Vector3(0.42, 0.62, 0.36).normalize();
    this._focus = new THREE.Vector3();
    this._sunOffset = this.sunDirection.clone().multiplyScalar(180);
  }

  init(game) {
    this.game = game;
    const { scene } = this;

    scene.background = this._createSkyTexture();
    scene.fog = new THREE.Fog(
      new THREE.Color(PALETTE.horizon).getHex(),
      this.config.fogNear,
      this.config.fogFar,
    );

    // --- Sun -------------------------------------------------------------
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.35);
    this.sun.position.copy(this._sunOffset);
    this.sun.castShadow = this.config.shadows && this.quality.shadowMapSize > 0;
    this.sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    // Texel size of the shadow map is ~0.06m (130m across 2048px): keep the
    // normal bias near that so shadows neither acne nor detach from their caster.
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.06;
    this.sun.target.position.set(0, 0, 0);

    const radius = this.config.shadowRadius;
    const cam = this.sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.updateProjectionMatrix();

    // --- Sky bounce + ground bounce --------------------------------------
    this.hemisphere = new THREE.HemisphereLight(0xc5dcf0, 0x5a624c, 0.95);
    this.ambient = new THREE.AmbientLight(0xe8f0f4, 0.16);

    scene.add(this.sun, this.sun.target, this.hemisphere, this.ambient);

    this.worldGroup = new THREE.Group();
    scene.add(this.worldGroup);

    // Start with the focus on the player spawn so frame one is already lit.
    this._focus.set(0, 0, 0);
  }

  update() {
    const player = this.game?.services.get('player');
    if (!player) return;
    this._focus.copy(player.position);
    // Quantise the follow position so the shadow map does not shimmer.
    this._focus.x = Math.round(this._focus.x * 2) / 2;
    this._focus.z = Math.round(this._focus.z * 2) / 2;

    this.sun.target.position.copy(this._focus);
    this.sun.target.updateMatrixWorld();
    this.sun.position.copy(this._focus).add(this._sunOffset);
  }

  // ------------------------------------------------------------------ sky --

  _createSkyTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = SKY_TEXTURE_WIDTH;
    canvas.height = SKY_TEXTURE_HEIGHT;
    const ctx = canvas.getContext('2d');

    // Headless/test environments have no 2D context: a flat horizon colour is
    // a perfectly good stand-in for the painted gradient.
    if (!ctx) return new THREE.Color(PALETTE.horizon);

    // Vertical gradient: ground haze -> horizon -> zenith.
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0.0, PALETTE.zenith);
    gradient.addColorStop(0.42, mixHex(PALETTE.zenith, PALETTE.horizon, 0.55));
    gradient.addColorStop(0.5, PALETTE.horizon);
    gradient.addColorStop(0.56, PALETTE.horizon);
    gradient.addColorStop(1.0, PALETTE.ground);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Sun glow, placed with the same equirect mapping three.js samples with.
    const { u, v } = equirectUv(this.sunDirection);
    const sx = u * canvas.width;
    const sy = (1 - v) * canvas.height;

    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, canvas.width * 0.26);
    glow.addColorStop(0, hexToRgba(PALETTE.sunCore, 0.95));
    glow.addColorStop(0.12, hexToRgba(PALETTE.sunGlow, 0.5));
    glow.addColorStop(0.45, hexToRgba(PALETTE.sunGlow, 0.14));
    glow.addColorStop(1, hexToRgba(PALETTE.sunGlow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.arc(sx, sy, canvas.width * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.sunCore;
    ctx.fill();

    // A few soft cloud bands for depth.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 18; i += 1) {
      const cx = ((i * 137.5) % SKY_TEXTURE_WIDTH) + Math.sin(i) * 30;
      const cy = SKY_TEXTURE_HEIGHT * (0.18 + ((i * 0.137) % 0.22));
      const rx = 60 + ((i * 37) % 90);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, rx * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  get fogColorHex() {
    return new THREE.Color(PALETTE.horizon).getHex();
  }

  dispose() {
    this.scene.background?.dispose?.();
    this.scene.background = null;
    this.scene.fog = null;
    this.sun?.dispose?.();
    this.hemisphere?.dispose?.();
    this.ambient?.dispose?.();
  }
}

/** Matches three.js' equirectangular background sampling. */
export function equirectUv(direction) {
  const u = Math.atan2(direction.z, direction.x) / (Math.PI * 2) + 0.5;
  const v = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) / Math.PI + 0.5;
  return { u, v };
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixHex(a, b, t) {
  const pa = parseInt(a.replace('#', ''), 16);
  const pb = parseInt(b.replace('#', ''), 16);
  const ar = (pa >> 16) & 255;
  const ag = (pa >> 8) & 255;
  const ab = pa & 255;
  const br = (pb >> 16) & 255;
  const bg = (pb >> 8) & 255;
  const bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}
