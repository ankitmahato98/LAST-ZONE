import { nextFrame } from '../utils/dom.js';

/**
 * Boot overlay.
 *
 * Also owns shader warm-up: compiling materials while the loading screen is
 * still up avoids the classic "first step in the game stutters" problem.
 */
export class LoadingScreen {
  constructor({ element = document.getElementById('boot') } = {}) {
    this.element = element;
    this.status = element?.querySelector('#boot-status') ?? null;
  }

  setStatus(text) {
    if (this.status) this.status.textContent = text;
  }

  /**
   * Compiles every material in the scene before the first gameplay frame.
   * Warm-up is best effort: if anything about it fails the game still starts,
   * because the cost of a late shader compile is a stutter, not a crash.
   */
  async warmup(game) {
    const renderer = game?.services.get('renderer');
    if (!renderer?.renderer) return;

    this.setStatus('Compiling shaders\u2026');
    const { renderer: gl, scene, camera } = renderer;

    try {
      if (typeof gl.compileAsync === 'function') await gl.compileAsync(scene, camera);
      else gl.compile?.(scene, camera);

      // One synchronous frame renders the background so nothing pops in.
      gl.render?.(scene, camera);
    } catch (error) {
      console.warn('[loading] shader warm-up skipped', error);
    }

    await nextFrame();
  }

  async hide(delay = 260) {
    if (!this.element) return;
    this.element.classList.add('boot--hidden');
    await new Promise((resolve) => setTimeout(resolve, delay));
    this.element.remove();
    this.element = null;
    this.status = null;
  }

  fail(error) {
    if (!this.element) return;
    this.element.classList.remove('boot--hidden');
    if (this.status) {
      this.status.classList.add('boot__status--error');
      this.status.textContent = String(error?.message ?? error);
    }
  }
}
