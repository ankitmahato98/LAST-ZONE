import * as THREE from 'three';

/**
 * Lightweight water: fresnel-tinted ShaderMaterial with vertex waves.
 * Not a screen-space reflection engine — sky colour + sun highlight only.
 */
export function createWaterMaterial({ quality = {}, color = '#1e6a78' } = {}) {
  const waves = quality.waterWaves !== false;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorDeep: { value: new THREE.Color('#0d3d4a') },
      uColorShallow: { value: new THREE.Color(color) },
      uSun: { value: new THREE.Vector3(0.42, 0.62, 0.36) },
      uWaves: { value: waves ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWaves;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vec3 p = position;
        if (uWaves > 0.5) {
          p.z += sin(position.x * 0.018 + uTime * 0.6) * 0.18
               + cos(position.y * 0.014 - uTime * 0.45) * 0.12;
        }
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorDeep;
      uniform vec3 uColorShallow;
      uniform vec3 uSun;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(viewDir, vNormalW), 0.0), 3.0);
        vec3 color = mix(uColorDeep, uColorShallow, fresnel);
        float spec = pow(max(dot(reflect(-uSun, vNormalW), viewDir), 0.0), 48.0);
        color += vec3(0.85, 0.92, 1.0) * spec * 0.45;
        gl_FragColor = vec4(color, 0.92);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  material.name = 'water-surface';
  material.userData.update = (dt) => {
    material.uniforms.uTime.value += dt;
  };
  return material;
}

export function tickWater(root, dt) {
  root?.traverse((child) => {
    child.material?.userData?.update?.(dt);
  });
}
