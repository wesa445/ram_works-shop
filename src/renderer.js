import { WebGLRenderer } from 'three'

// Выбор графического API.
//
// По умолчанию WebGL2. WebGPU подключается только явным ?renderer=webgpu, и вот почему:
// прироста он не дал (60 fps на обоих), зато в three 0.186 на нём не компилируются
// обычные GLSL-шейдеры (работают лишь узловые материалы), а прозрачные материалы со
// сложением цвета не рисуются и валятся ошибкой «Destroyed texture PMREM.cubeUv used
// in a submit». На этом сломалось свечение контура при наведении.
//
// Код выбора оставлен: как только three починит, достаточно вернуть автовыбор.
//
// WebGL1 не поддерживается и не может быть: из three его вырезали в r163, текущий
// WebGLRenderer запрашивает только контекст 'webgl2'. Это ограничение библиотеки,
// а не наше — под WebGL1 пришлось бы сидеть на three годичной давности.
//
// Пакет three/webgpu весит заметно, поэтому грузится динамически и только там, где
// WebGPU реально есть. На WebGL-машинах он не скачивается вовсе.

export const BACKEND = { name: 'неизвестен', device: '' }

// Ручной выбор для проверок: ?renderer=webgl или ?renderer=webgpu
function forced() {
  try {
    const v = new URLSearchParams(location.search).get('renderer')
    return v === 'webgl' || v === 'webgpu' ? v : null
  } catch {
    return null
  }
}

// Спрашиваем на отдельном холсте, а не на рабочем: у холста бывает только один тип
// контекста, и запрос webgl2 у холста с WebGPU обнуляет уже созданный контекст —
// рендер падает на `null.configure`.
function describe() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
  } catch {
    return ''
  }
}

export async function createRenderer(props) {
  const choice = forced()

  if (choice === 'webgpu' && 'gpu' in navigator) {
    try {
      const { WebGPURenderer } = await import('three/webgpu')
      const renderer = new WebGPURenderer({
        canvas: props.canvas,
        antialias: props.antialias,
        alpha: props.alpha,
        powerPreference: props.powerPreference,
        forceWebGL: false,
      })
      await renderer.init() // без этого первый кадр уйдёт в пустоту

      // init() молча откатывается на свой WebGL-бэкенд, если адаптер не выдали
      BACKEND.name = renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (бэкенд WebGPU-рендерера)'
      BACKEND.device = describe()
      return renderer
    } catch (e) {
      console.warn('WebGPU не поднялся, беру WebGL2:', e?.message ?? e)
    }
  }

  const renderer = new WebGLRenderer(props)
  BACKEND.name = 'WebGL2'
  BACKEND.device = describe()
  return renderer
}
