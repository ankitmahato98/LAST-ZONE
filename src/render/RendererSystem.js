import * as THREE from 'three';
import { RENDER, getQualitySettings } from '../config/settings.js';

/**
 * Owns the WebGL renderer, the scene graph root and the world camera.
 *
 * Everything else in the game talks to `renderer.scene` / `renderer.camera`
 * (or the `renderer` service) - no other module creates a WebGL context.
 */
export class RendererSystem {
  constructor({ canvas, config = RENDER }) {
    this.name = 'renderer';
    this.canvas = canvas;
    this.config = config;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = config.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0b1014, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(config.fov, 1, config.near, config.far);
    this.camera.position.set(0, 4, 10);

    // Groups keep the scene graph readable and let systems add/remove subtrees.
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'world';
    this.actorsGroup = new THREE.Group();
    this.actorsGroup.name = 'actors';
    this.scene.add(this.worldGroup, this.actorsGroup);

    this.stats = { calls: 0, triangles: 0, programs: 0 };
    this._contextLost = false;
  }

  init(game) {
    this.game = game;
    this.quality = game.services.get('quality') ?? getQualitySettings();

    this.canvas.addEventListener('webglcontextlost', this._onContextLost = (event) => {
      event.preventDefault();
      this._contextLost = true;
      console.error('[renderer] WebGL context lost');
      game.bus.emit('renderer:contextlost');
      game.pause();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this._contextLost = false;
      game.bus.emit('renderer:contextrestored');
      game.resume();
    });

    this.renderer.shadowMap.enabled = this.config.shadows && this.quality.shadowMapSize > 0;
  }

  /**
   * Draws the frame. Runs in the render pass, after every system has updated,
   * so lights, cameras and animation are all in their final state.
   */
  render() {
    if (this._contextLost) return;
    this.renderer.render(this.scene, this.camera);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
  }

  resize(width, height, pixelRatio) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.renderer.dispose();
  }
}
