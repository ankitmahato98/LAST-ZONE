import * as THREE from 'three';

/**
 * Headless stand-in for RendererSystem.
 *
 * It provides exactly the surface the other systems depend on - a scene graph,
 * a camera, the `world`/`actors` groups and render stats - without touching
 * WebGL. Everything else in the game (`createGame()` wiring included) is the
 * real thing, which is what makes the integration tests meaningful.
 */
export class HeadlessRenderer {
  constructor({ canvas }) {
    this.name = 'renderer';
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.15, 700);

    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'world';
    this.actorsGroup = new THREE.Group();
    this.actorsGroup.name = 'actors';
    this.scene.add(this.worldGroup, this.actorsGroup);

    this.stats = { calls: 0, triangles: 0 };
    this.frames = 0;
  }

  init(game) {
    this.game = game;
  }

  render() {
    // Stands in for the draw call: proves the system graph renders each frame
    // without a GPU.
    this.frames += 1;
    this.scene.updateMatrixWorld();
  }

  resize(width, height, pixelRatio) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.pixelRatio = pixelRatio;
  }

  dispose() {}
}

export const headlessRendererFactory = (options) => new HeadlessRenderer(options);
