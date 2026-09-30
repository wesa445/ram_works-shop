import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  DepthTexture,
  HalfFloatType,
  ShaderMaterial,
  UniformsUtils,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js'
import { QUALITY } from './quality.js'

// Атмосфера комнаты по референсам (Control, «камера содержания»): пыльная дымка, светящаяся
// от ламп, пылинки в лучах, ореол вокруг ярких мест, виньетка, зерно, холодный тон.
//
// Дымка и пыль живут только внутри объёма комнаты — габариты стен из поролона. Снаружи
// кадр остаётся тёмным и чистым, как на референсах.
const ROOM = ['Plane001', 'Plane006', 'Plane007']
const MAX_LIGHTS = 4
// Шагов меньше на сенсорных устройствах (quality.js). ponytail: следующий рычаг — считать дымку
// в половине разрешения, если телефоны всё ещё не тянут
const HAZE_STEPS = QUALITY.hazeSteps
const DUST_COUNT = 1500
// При подлёте к товару атмосфера отступает: дымка заливала куртку молоком, а светлые места
// принта ловили ореол. Скорость — как у наезда камеры (FOCUS_SPEED в Scene.jsx).
const FOCUS_HAZE_CUT = 0.75
const FOCUS_SPEED = 0.05

// Свет ламп, общий для дымки и пыли. Прожекторы из GLB, без теней: луч проходит сквозь
// куртку. ponytail: теневые карты прожекторов в дымку не заведены — добавить, если заметят
const LIGHTS_GLSL = /* glsl */ `
  uniform vec3 lPos[${MAX_LIGHTS}];
  uniform vec3 lDir[${MAX_LIGHTS}];
  uniform vec3 lColor[${MAX_LIGHTS}];
  uniform vec2 lCone[${MAX_LIGHTS}];
  uniform int lCount;

  vec3 lightAt(vec3 p) {
    vec3 sum = vec3(0.0);
    for (int k = 0; k < ${MAX_LIGHTS}; k++) {
      if (k >= lCount) break;
      vec3 v = p - lPos[k];
      float dist2 = max(dot(v, v), 0.25);
      // Край конуса размыт шире, чем у самой лампы: пыльный луч мягкий, а резкий край
      // между шагами марша рассыпается в точки
      float cone = smoothstep(lCone[k].x - 0.04, lCone[k].y, dot(v * inversesqrt(dist2), lDir[k]));
      sum += lColor[k] * cone / dist2;
    }
    return sum;
  }
`

const lightUniforms = () => ({
  lPos: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) },
  lDir: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) },
  lColor: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) },
  lCone: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector2()) },
  lCount: { value: 0 },
})

// Лампы неподвижны — положение и направление считаем один раз, яркость каждый кадр:
// её двигает панель через SceneLights
function collectLights(scene) {
  const lights = []
  scene.traverse((o) => {
    if (o.isSpotLight && lights.length < MAX_LIGHTS) lights.push(o)
  })
  return lights.map((light) => {
    light.updateWorldMatrix(true, true)
    const pos = light.getWorldPosition(new Vector3())
    const dir = light.target.getWorldPosition(new Vector3()).sub(pos).normalize()
    const cone = new Vector2(Math.cos(light.angle), Math.cos(light.angle * (1 - light.penumbra)))
    return { light, pos, dir, cone }
  })
}

function syncLights(uniforms, lights, scale) {
  uniforms.lCount.value = lights.length
  lights.forEach(({ light, pos, dir, cone }, i) => {
    uniforms.lPos.value[i].copy(pos)
    uniforms.lDir.value[i].copy(dir)
    uniforms.lCone.value[i].copy(cone)
    const c = light.color
    uniforms.lColor.value[i].set(c.r, c.g, c.b).multiplyScalar(light.intensity * scale)
  })
}

// Дымка: марш луча от камеры до поверхности, только внутри коробки комнаты. Плотность
// клочьями (шум, медленно дрейфует), каждая точка подсвечена лампами. Работает в линейном
// HDR до тонемаппинга — поэтому светящуюся дымку дальше подхватывает ореол.
const HazeShader = {
  uniforms: {
    tDepth: { value: null },
    projInv: { value: null },
    camWorld: { value: null },
    camPos: { value: new Vector3() },
    boxMin: { value: new Vector3() },
    boxMax: { value: new Vector3() },
    density: { value: 0 },
    time: { value: 0 },
    ...lightUniforms(),
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDepth;
    uniform mat4 projInv;
    uniform mat4 camWorld;
    uniform vec3 camPos;
    uniform vec3 boxMin;
    uniform vec3 boxMax;
    uniform float density;
    uniform float time;
    varying vec2 vUv;
    ${LIGHTS_GLSL}

    float hash(vec3 p) {
      p = fract(p * 0.3183099 + 0.1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float noise(vec3 x) {
      vec3 i = floor(x), f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
        mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
        f.z);
    }

    // Результат — не кадр, а сама дымка: rgb — свет, рассеянный к камере, a — сколько света
    // сцены прошло сквозь неё. Смешивает с кадром HazeMixShader: так дымку можно считать
    // в уменьшенном разрешении (quality.js, hazeScale), а кадр оставить чётким.
    void main() {
      if (density <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

      // Точка поверхности в мире — из буфера глубины
      vec4 view = projInv * vec4(vUv * 2.0 - 1.0, texture2D(tDepth, vUv).x * 2.0 - 1.0, 1.0);
      vec3 world = (camWorld * vec4(view.xyz / view.w, 1.0)).xyz;
      vec3 rd = world - camPos;
      float tMax = length(rd);
      rd /= tMax;

      // Отрезок луча внутри коробки комнаты
      vec3 inv = 1.0 / rd;
      vec3 a = (boxMin - camPos) * inv, b = (boxMax - camPos) * inv;
      vec3 lo = min(a, b), hi = max(a, b);
      float tn = max(max(max(lo.x, lo.y), lo.z), 0.0);
      float tf = min(min(min(hi.x, hi.y), hi.z), tMax);
      if (tf <= tn) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

      // Сдвиг старта по пикселю прячет ступеньки марша в равномерный шум
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float ds = (tf - tn) / float(${HAZE_STEPS});
      vec3 scatter = vec3(0.0);
      float T = 1.0;
      for (int i = 0; i < ${HAZE_STEPS}; i++) {
        vec3 p = camPos + rd * (tn + (float(i) + jitter) * ds);
        float n = noise(p * 0.35 + vec3(0.0, -time * 0.04, time * 0.025));
        // Гуще под светом, у пола почти прозрачно — как на референсах. Физически свечение
        // собирает близкая лампа, у нас она высоко над открытой комнатой, и спад слабый.
        float height = (p.y - boxMin.y) / (boxMax.y - boxMin.y);
        float rho = density * (0.3 + 1.4 * n * n) * smoothstep(-0.1, 1.0, height);
        scatter += T * rho * lightAt(p) * ds;
        T *= exp(-rho * ds);
      }
      gl_FragColor = vec4(scatter * 0.0795775, T); // 1/4π — рассеяние во все стороны
    }
  `,
}

const HazeMixShader = {
  uniforms: { tDiffuse: { value: null }, tHaze: { value: null } },
  vertexShader: HazeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tHaze;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 haze = texture2D(tHaze, vUv); // в уменьшенном разрешении — растягивается сглаженно
      gl_FragColor = vec4(base.rgb * haze.a + haze.rgb, base.a);
    }
  `,
}

// Дымка в два шага: марш луча — в свою текстуру размером scale от кадра, затем смешивание
// с кадром в полном разрешении. ponytail: на резких краях (силуэт куртки на фоне стены) растяжка
// даёт тонкий ореол в пиксель — под зерном не виден; понадобится — смешивать с учётом глубины.
class HazePass extends Pass {
  constructor(scale) {
    super()
    this.scale = scale
    this.march = new FullScreenQuad(new ShaderMaterial({ ...HazeShader, uniforms: UniformsUtils.clone(HazeShader.uniforms) }))
    this.mix = new FullScreenQuad(new ShaderMaterial({ ...HazeMixShader, uniforms: UniformsUtils.clone(HazeMixShader.uniforms) }))
    this.uniforms = this.march.material.uniforms
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType })
  }

  setSize(width, height) {
    this.target.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)))
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDepth.value = readBuffer.depthTexture
    renderer.setRenderTarget(this.target)
    this.march.render(renderer)

    const mix = this.mix.material.uniforms
    mix.tDiffuse.value = readBuffer.texture
    mix.tHaze.value = this.target.texture
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer)
    this.mix.render(renderer)
  }

  dispose() {
    this.target.dispose()
    this.march.dispose()
    this.mix.dispose()
  }
}

// Уже после тонемаппинга, в экранных цветах: холодный тон, виньетка, зерно
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    cool: { value: 0 },
    vignette: { value: 0 },
    grain: { value: 0 },
    time: { value: 0 },
  },
  vertexShader: HazeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float cool;
    uniform float vignette;
    uniform float grain;
    uniform float time;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Холодный грейд как на референсах: тени уходят в сине-бирюзовый, света почти не трогаем
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 cold = c.rgb * vec3(0.88, 1.0, 1.1) + vec3(-0.01, 0.005, 0.03) * (1.0 - l);
      c.rgb = mix(c.rgb, cold, cool);
      vec2 q = vUv - 0.5;
      c.rgb *= 1.0 - vignette * dot(q, q) * 2.2;
      float g = fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (g - 0.5) * grain;
      gl_FragColor = c;
    }
  `,
}

// Пылинки: медленно оседают и покачиваются, светятся только там, где их достаёт свет —
// в луче прожектора видны, в тени пропадают. Рисуются в HDR, дальше их подхватывает ореол.
function Dust({ box, lights, paramsRef }) {
  const [geometry, material] = useMemo(() => {
    const seeds = new Float32Array(DUST_COUNT * 3)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    const geometry = new BufferGeometry()
    // Позиции считает шейдер, атрибут position нужен только чтобы three знал число точек
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(DUST_COUNT * 3), 3))
    geometry.setAttribute('seed', new BufferAttribute(seeds, 3))

    const material = new ShaderMaterial({
      uniforms: {
        boxMin: { value: box.min.clone() },
        boxMax: { value: box.max.clone() },
        time: { value: 0 },
        amount: { value: 0 },
        pxScale: { value: 1 },
        ...lightUniforms(),
      },
      vertexShader: /* glsl */ `
        uniform vec3 boxMin;
        uniform vec3 boxMax;
        uniform float time;
        uniform float pxScale;
        attribute vec3 seed;
        varying vec3 vColor;
        ${LIGHTS_GLSL}
        void main() {
          vec3 span = boxMax - boxMin;
          vec3 p = seed * span;
          p.y -= time * 0.03 * (0.4 + seed.x);          // оседает
          p += 0.25 * sin(time * 0.2 + seed * 40.0);     // покачивается в потоке воздуха
          p = boxMin + mod(p, span);                     // ушла за край — появляется с другой стороны
          vColor = lightAt(p);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(0.025 * (0.5 + seed.z) * pxScale / -mv.z, 1.0, 5.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float amount;
        varying vec3 vColor;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(vColor * a * amount, 1.0);
        }
      `,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
    return [geometry, material]
  }, [box])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  useFrame((state) => {
    const u = material.uniforms
    u.time.value = state.clock.elapsedTime
    u.amount.value = paramsRef.current.dust
    // Размер точки в пикселях на единицу удаления: высота кадра в пикселях на тангенс полуугла
    u.pxScale.value = (state.size.height * state.viewport.dpr * state.camera.projectionMatrix.elements[5]) / 2
    syncLights(u, lights, 1)
  })

  return <points geometry={geometry} material={material} frustumCulled={false} />
}

// model — сцена из GLB. Не корневая сцена R3F: на этапе рендера модель в неё ещё не
// прикреплена, и поиск стен и ламп там ничего не находил.
export default function Effects({ paramsRef, model, focused }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  const box = useMemo(() => {
    const b = new Box3()
    for (const name of ROOM) {
      const o = model.getObjectByName(name)
      if (o) b.expandByObject(o)
    }
    return b.isEmpty() ? null : b
  }, [model])

  const lights = useMemo(() => collectLights(model), [model])

  const passes = useMemo(() => {
    // Глубина нужна дымке, HDR — ореолу: порог яркости работает до тонемаппинга.
    // Без MSAA: мультисэмпл вместе с текстурой глубины в D3D11 (ANGLE) ронял кадр с 37 до 4 fps.
    // Сглаживает FXAA в конце — в тёмной сцене с зерном и дымкой разницы не видно.
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthTexture: new DepthTexture(1, 1) })
    const composer = new EffectComposer(gl, target)
    const render = new RenderPass(scene, null)
    const haze = new HazePass(QUALITY.hazeScale)
    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0, 0.6, 1)
    const fxaa = new ShaderPass(FXAAShader)
    const finish = new ShaderPass(FinishShader)
    composer.addPass(render)
    composer.addPass(haze)
    composer.addPass(bloom)
    composer.addPass(new OutputPass()) // тонемаппинг AgX и перевод в sRGB — как у обычного рендера
    composer.addPass(fxaa) // по экранным цветам, до зерна — иначе он сгладил бы и зерно
    composer.addPass(finish)
    if (box) {
      haze.uniforms.boxMin.value.copy(box.min)
      haze.uniforms.boxMax.value.copy(box.max)
    }
    return { composer, render, haze, bloom, fxaa, finish }
  }, [gl, scene, box])

  useEffect(() => {
    passes.composer.setPixelRatio(dpr)
    passes.composer.setSize(size.width, size.height)
    passes.fxaa.uniforms.resolution.value.set(1 / (size.width * dpr), 1 / (size.height * dpr))
  }, [passes, size, dpr])

  useEffect(() => () => passes.composer.dispose(), [passes])

  const focusMix = useRef(0)
  const sinceDraw = useRef(Infinity)

  // Приоритет 1 — рисуем сами, R3F свой рендер в этом случае пропускает
  useFrame((state, delta) => {
    // Потолок частоты (quality.js): на экранах 90–120 Гц кадр пропускаем, пока не прошла 1/60 с.
    // Пропущенный кадр не рисуется вовсе — на холсте остаётся предыдущий.
    sinceDraw.current += delta
    if (QUALITY.fpsCap && sinceDraw.current < 1 / QUALITY.fpsCap - 0.002) return
    sinceDraw.current = 0

    const p = paramsRef.current
    const { composer, render, haze, bloom, finish } = passes
    const camera = state.camera
    const t = state.clock.elapsedTime
    focusMix.current += ((focused ? 1 : 0) - focusMix.current) * (1 - Math.pow(1 - FOCUS_SPEED, delta * 60))
    const clear = focusMix.current

    render.camera = camera
    const h = haze.uniforms
    h.projInv.value = camera.projectionMatrixInverse
    h.camWorld.value = camera.matrixWorld
    h.camPos.value.setFromMatrixPosition(camera.matrixWorld)
    h.density.value = box ? p.haze * (1 - FOCUS_HAZE_CUT * clear) : 0
    h.time.value = t
    syncLights(h, lights, p.hazeGlow)

    bloom.strength = p.bloom * (1 - clear)
    bloom.threshold = p.bloomThreshold
    // При нулевой силе проход всё равно считал бы все уровни размытия — на крупном плане зря
    bloom.enabled = QUALITY.bloom && bloom.strength > 0.001
    finish.uniforms.cool.value = p.cool
    finish.uniforms.vignette.value = p.vignette
    finish.uniforms.grain.value = p.grain
    finish.uniforms.time.value = t % 100

    composer.render(delta)
  }, 1)

  return box ? <Dust box={box} lights={lights} paramsRef={paramsRef} /> : null
}
