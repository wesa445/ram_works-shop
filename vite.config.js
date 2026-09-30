import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Границы допустимых значений. Запись идёт в исходник по HTTP, поэтому принимаем
// только известные ключи и зажимаем числа — что бы ни прислали в теле запроса.
const RANGES = {
  ambient: [0, 2],
  lightScale: [0, 0.02],
  fill: [0, 2000],
  focusFill: [0, 2000],
  shadowSoftness: [0, 30],
  swayAmount: [-0.5, 0.5],
  swaySpeed: [0.005, 0.5],
  focusZoom: [1, 6],
  ceiling: [0, 5],
  haze: [0, 0.2],
  hazeGlow: [0, 5],
  dust: [0, 1],
  bloom: [0, 3],
  bloomThreshold: [0, 5],
  cool: [0, 1],
  vignette: [0, 1.5],
  grain: [0, 0.2],
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function validateParams(input) {
  const out = {}
  for (const [key, [lo, hi]] of Object.entries(RANGES)) {
    const v = Number(input[key])
    if (!Number.isFinite(v)) throw new Error(`поле ${key}: не число`)
    out[key] = clamp(v, lo, hi)
  }
  return out
}

const renderParams = (p) => `// Значения правятся панелью в браузере и переписывают этот файл.
// Подобраны на глаз в панели под референсы (Control): тёмный зал, светящаяся пыльная комната.
// Точка отсчёта — калибровка по рендеру Cycles замером зон кадра: ambient 0.28, lightScale 0.0008,
// ceiling 1, без дымки и ореола. Физичные ambient 0.16 и lightScale 1/683 рендеру не соответствуют.
export const PARAMS = {
${Object.keys(RANGES).map((k) => `  ${k}: ${p[k]},`).join('\n')}
}
`

// apply: 'serve' — плагин существует только у dev-сервера, в прод-сборку не попадает
function paramsWriter() {
  return {
    name: 'params-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__params', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('только POST')
        }
        const chunks = []
        let size = 0
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > 65536) return req.destroy()
          chunks.push(chunk)
        })
        req.on('end', () => {
          try {
            const data = validateParams(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            // Через временный файл: HMR может прочитать модуль на середине записи
            const dest = resolve('src/params.js')
            writeFileSync(dest + '.tmp', renderParams(data), 'utf8')
            renameSync(dest + '.tmp', dest)
            res.end('ok')
          } catch (e) {
            res.statusCode = 400
            res.end(e.message)
          }
        })
      })
    },
  }
}

// Функции из api/ на dev-сервере — в том же виде, в каком их вызывает Vercel: req.body уже разобран,
// у res есть status() и json(). Модуль грузится через Vite, правки подхватываются без перезапуска.
function apiDev() {
  return {
    name: 'api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        const name = req.url.split('?')[0].replace(/^\/+/, '')
        if (!/^[a-z-]+$/.test(name) || !existsSync(resolve(`api/${name}.js`))) return next()
        const mod = await server.ssrLoadModule(`/api/${name}.js`)

        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const raw = Buffer.concat(chunks).toString('utf8')
        try {
          req.body = raw ? JSON.parse(raw) : undefined
        } catch {
          req.body = undefined
        }
        res.status = (code) => ((res.statusCode = code), res)
        res.json = (data) => {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(data))
        }
        await mod.default(req, res)
      })
    },
  }
}

// Серверные переменные для dev берём из .env.local — на Vercel они заданы в настройках проекта
const SERVER_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of SERVER_ENV) if (env[key]) process.env[key] = env[key]

  return {
    plugins: [react(), paramsWriter(), apiDev()],
    build: {
      // Сборка с панелями кладётся отдельно, чтобы не затирать основную
      outDir: mode === 'tools' ? 'dist-tools' : 'dist',
      // Админка и политика — отдельные страницы со своими маленькими бандлами, без three.js
      rolldownOptions: { input: { main: resolve('index.html'), admin: resolve('admin.html'), privacy: resolve('privacy.html') } },
    },
  }
})
