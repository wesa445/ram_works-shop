import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { getSceneBytes, subscribeSceneBytes } from './loading.js'

// Перенесён из портфолио (C:\portfolio-3d, src/Preloader.jsx) — тот же экран, что на
// ram-works.shop/my_pocket_dimention. Правки делать в обоих местах.
//
// Полоса загрузки, а следом фирменный глаз — и только потом сцена. Первые секунды
// без этого смотреть не на что: страница весит несколько мегабайт.
//
// Проценты честные: большую часть полосы двигают байты самой сцены (она и есть
// основной вес), остаток добирает пофайловый счётчик three — текстуры и карта
// окружения. Сцены других товаров грузятся позже, по стрелке, и полосу не трогают:
// она закрывается один раз и не возвращается (переход между товарами — затемнение в App.jsx).
const WIDTH = 46 // ячеек в полосе
const SCENE_SHARE = 90 // сколько процентов полосы отдано скачиванию сцены
const EYE_MS = 3000 // сколько показываем глаз; ролик длиннее, это его начало
const FADE = 400 // уход всего загрузчика
// Страховка: если файл не долетел или загрузчик завис, экран не должен остаться
// чёрным навсегда. По этому сроку показываем сцену с тем, что успело загрузиться.
const MAX_WAIT = 25000
const SWAP = 500 // перетекание полосы в глаз

const s = {
  wrap: {
    position: 'fixed', inset: 0, zIndex: 40,
    display: 'grid', placeItems: 'center',
    background: '#0a0a0b', color: '#e8e8e8',
    font: '600 clamp(11px, 1.35vw, 18px)/1.4 ui-monospace, "Cascadia Mono", Consolas, monospace',
    letterSpacing: '0.06em', whiteSpace: 'pre', userSelect: 'none',
    // Два свойства в одной записи: сокращённая форма ниже затирала бы список,
    // и фон переключался бы рывком вместо перехода
    transition: `opacity ${FADE}ms ease, background-color ${SWAP}ms ease`,
  },
  // Полоса и глаз лежат в одной ячейке сетки и меняются перетеканием
  layer: { gridArea: '1 / 1', transition: `opacity ${SWAP}ms ease` },
  // Ролик нарисован чёрным по белому, а загрузчик тёмный. Выворачиваем и сразу
  // подгоняем диапазон под его палитру: белое поле ролика становится ровно фоном
  // #0a0a0b, а линии — цветом текста #e8e8e8. Иначе по краям виден светлый квадрат.
  // brightness и contrast вместе дают отображение 0..255 → 10..232.
  eye: {
    width: 'clamp(160px, 22vw, 320px)', height: 'auto', display: 'block',
    filter: 'invert(1) brightness(0.945) contrast(0.922)',
  },
}

function bar(percent) {
  const label = `${Math.round(percent)}%`
  const cells = Array.from({ length: WIDTH }, (_, i) => (((i + 1) / WIDTH) * 100 <= percent ? '/' : '.'))
  // Проценты вписываем внутрь полосы, а не рядом: так строка не дёргается по ширине
  const at = Math.round((WIDTH - label.length) / 2)
  cells.splice(at, label.length, ...label)
  return `[${cells.join('')}]`
}

export default function Preloader() {
  const { progress, active, errors } = useProgress()
  const [bytes, setBytes] = useState(getSceneBytes)
  const [state, setState] = useState('load') // load → eye → fade → gone

  useEffect(() => subscribeSceneBytes(setBytes), [])

  // Пока качается сцена — её собственные байты; дальше досчитывает счётчик файлов.
  // Если сервер не сообщил размер, остаётся только счётчик файлов.
  const scene = bytes.total ? (bytes.loaded / bytes.total) * 100 : null
  const raw =
    scene === null
      ? progress
      : scene < 100
        ? (scene * SCENE_SHARE) / 100
        : SCENE_SHARE + (progress * (100 - SCENE_SHARE)) / 100

  // Браузер отдаёт прогресс скачивания большими кусками: первое же событие может
  // прийти сразу с половиной файла. Цифру не завышаем — просто подтягиваем показ
  // к уже достигнутому, чтобы полоса доезжала, а не прыгала.
  const peak = useRef(0)
  peak.current = Math.max(peak.current, raw)

  const [display, setDisplay] = useState(0)
  useEffect(() => {
    let frame = 0
    const step = () => {
      // У экспоненциального подтягивания хвост бесконечный: у самой цели дожимаем
      setDisplay((was) => (peak.current - was < 0.5 ? peak.current : was + (peak.current - was) * 0.12))
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [])

  const shown = state === 'load' ? display : 100

  useEffect(() => {
    // Ошибка загрузки тоже повод идти дальше: какой-то файл мог не долететь,
    // но сцена без него обычно живая, а ждать до бесконечности нельзя.
    const done = !active && (progress >= 100 || errors.length > 0)
    if (state !== 'load' || !done) return undefined
    // Даём кадру отрисоваться, иначе полоса уходит раньше, чем появится картинка
    const timer = setTimeout(() => setState('eye'), 250)
    return () => clearTimeout(timer)
  }, [state, active, progress, errors])

  useEffect(() => {
    const limit = setTimeout(() => setState((was) => (was === 'load' ? 'eye' : was)), MAX_WAIT)
    return () => clearTimeout(limit)
  }, [])

  useEffect(() => {
    if (state !== 'eye') return undefined
    const timer = setTimeout(() => setState('fade'), EYE_MS)
    return () => clearTimeout(timer)
  }, [state])

  useEffect(() => {
    if (state !== 'fade') return undefined
    const timer = setTimeout(() => setState('gone'), FADE)
    return () => clearTimeout(timer)
  }, [state])

  if (state === 'gone') return null

  return (
    <div
      style={{
        ...s.wrap,
        opacity: state === 'fade' ? 0 : 1,
      }}
      role="status"
      aria-live="polite"
    >
      <div style={{ ...s.layer, opacity: state === 'load' ? 1 : 0 }}>{bar(shown)}</div>

      {/* Ролик цепляем к концу полосы: раньше он отнимал бы канал у сцены, позже —
          глаз показался бы с паузой на буферизацию. */}
      {(state !== 'load' || shown > 70) && (
        <div style={{ ...s.layer, opacity: state === 'load' ? 0 : 1 }}>
          <video src="/eye.mp4" style={s.eye} autoPlay muted playsInline preload="auto" />
        </div>
      )}
    </div>
  )
}
