import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Mobile-safe post stack. Missing WebGL / failed composer construction
 * falls back to a raw renderer.render so tests and weak GPUs still draw.
 */
export class PostProcess {
  constructor({ renderer, scene, camera, quality = {} }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.enabled = Boolean(quality.postFx);
    this.composer = null;
    this._size = new THREE.Vector2(1, 1);
    if (this.enabled) this._build();
  }

  _build() {
    try {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));

      if (this.quality.ssao) {
        this.aoPass = new ShaderPass(CONTACT_AO);
        composer.addPass(this.aoPass);
      }

      if (this.quality.bloom) {
        const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.12, 0.4, 0.92);
        composer.addPass(bloom);
      }

      this.grade = new ShaderPass(GRADE);
      composer.addPass(this.grade);

      this.fxaa = new ShaderPass(FXAAShader);
      composer.addPass(this.fxaa);
      composer.addPass(new OutputPass());
      this.composer = composer;
    } catch (error) {
      console.warn('[postprocess] disabled', error?.message ?? error);
      this.composer = null;
      this.enabled = false;
    }
  }

  setSize(width, height, pixelRatio) {
    this._size.set(width, height);
    this.composer?.setSize(width, height);
    this.composer?.setPixelRatio?.(pixelRatio ?? 1);
    if (this.fxaa) {
      this.fxaa.material.uniforms.resolution.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    }
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose?.();
  }
}

const GRADE = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.28 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec3 graded = mix(color.rgb, color.rgb * vec3(1.02, 1.0, 0.96), 0.25);
      float d = distance(vUv, vec2(0.5));
      graded *= 1.0 - smoothstep(0.45, 0.95, d) * uVignette;
      gl_FragColor = vec4(graded, color.a);
    }
  `,
};

/** Cheap screen-space contact darkening — not full SSAO. */
const CONTACT_AO = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: GRADE.vertexShader,
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec3 blur = texture2D(tDiffuse, vUv + vec2(0.0016, 0.0)).rgb
                + texture2D(tDiffuse, vUv - vec2(0.0016, 0.0)).rgb
                + texture2D(tDiffuse, vUv + vec2(0.0, 0.0016)).rgb
                + texture2D(tDiffuse, vUv - vec2(0.0, 0.0016)).rgb;
      float occl = clamp(length(color.rgb) - length(blur * 0.25), 0.0, 0.12);
      gl_FragColor = vec4(color.rgb * (1.0 - occl * 1.4), color.a);
    }
  `,
};
