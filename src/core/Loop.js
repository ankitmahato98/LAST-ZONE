import { GameEvents } from './events.js';

/**
 * Fixed-timestep simulation + decoupled render loop.
 *
 * Why not a plain `requestAnimationFrame` with variable dt?
 *  - Movement, jumping and collisions stay identical at 30fps and 144fps.
 *  - The accumulator is clamped, so tab switches or GC pauses produce a short
 *    hitch instead of teleporting the player across the map.
 *  - `alpha` allows interpolating visuals between simulation steps later on
 *    (network interpolation, animation smoothing, ...).
 */
export const FIXED_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

export class Loop {
  constructor({ bus, fixedStep = FIXED_STEP, maxSubSteps = MAX_STEPS_PER_FRAME } = {}) {
    this.bus = bus;
    this.fixedStep = fixedStep;
    this.maxSubSteps = maxSubSteps;

    this.running = false;
    this.rafId = 0;
    this.accumulator = 0;
    this.elapsed = 0;
    this.tick = 0;

    this._lastTime = 0;
    this._frame = this._frame.bind(this);

    this.metrics = { fps: 0, frameMs: 0, updatesPerSecond: 0, stepsThisFrame: 0 };
    this._fpsWindow = { frames: 0, time: 0, updates: 0 };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Advance the simulation by an explicit amount - used by automated tests. */
  advance(dt) {
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(this.fixedStep, remaining);
      this.elapsed += step;
      this.tick += 1;
      this.bus.emit(GameEvents.FIXED_UPDATE, { dt: step, tick: this.tick });
      remaining -= step;
    }
    this.bus.emit(GameEvents.UPDATE, { dt, elapsed: this.elapsed, alpha: 1 });
  }

  _frame(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._frame);

    const frameStart = now;
    let frameDt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (frameDt > 0.25) frameDt = 0.25; // recovered from a stall - do not fast-forward
    if (!Number.isFinite(frameDt) || frameDt < 0) frameDt = 0;

    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= this.fixedStep && steps < this.maxSubSteps) {
      this.accumulator -= this.fixedStep;
      steps += 1;
      this.elapsed += this.fixedStep;
      this.tick += 1;
      this.bus.emit(GameEvents.FIXED_UPDATE, { dt: this.fixedStep, tick: this.tick });
    }
    if (steps === this.maxSubSteps) this.accumulator = 0; // drop the backlog

    this.metrics.stepsThisFrame = steps;
    this.bus.emit(GameEvents.UPDATE, {
      dt: frameDt,
      elapsed: this.elapsed,
      alpha: this.accumulator / this.fixedStep,
    });

    this._trackMetrics(now - frameStart, steps);
  }

  _trackMetrics(frameMs, steps) {
    const w = this._fpsWindow;
    w.frames += 1;
    w.updates += steps;
    w.time += frameMs / 1000;
    this.metrics.frameMs = frameMs;

    if (w.time >= 0.5) {
      this.metrics.fps = w.frames / w.time;
      this.metrics.updatesPerSecond = w.updates / w.time;
      w.frames = 0;
      w.updates = 0;
      w.time = 0;
    }
  }
}
