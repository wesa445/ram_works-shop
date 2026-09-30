import { useState } from 'react'
import { saveOrCopy } from './tools.js'

// Панель только для dev: в проде её нет в бандле (см. App.jsx).
// Значения пишутся прямо в paramsRef — сцена читает их в кадровом цикле, поэтому
// перетаскивание ползунка не вызывает ни одной перерисовки внутри Canvas.
// Кнопка «Сохранить» переписывает src/params.js через middleware в vite.config.js.

const SLIDERS = [
  { key: 'ambient', label: 'Рассеянный (мир)', min: 0, max: 2, step: 0.01 },
  { key: 'lightScale', label: 'Яркость ламп', min: 0, max: 0.02, step: 0.00001 },
  { key: 'fill', label: 'Заполняющий', min: 0, max: 2000, step: 5 },
  { key: 'focusFill', label: 'Свет на товаре', min: 0, max: 2000, step: 5 },
  { key: 'shadowSoftness', label: 'Мягкость теней', min: 0, max: 30, step: 0.5 },
  { key: 'swayAmount', label: 'Параллакс, рад', min: -0.3, max: 0.3, step: 0.005 },
  { key: 'swaySpeed', label: 'Плавность', min: 0.005, max: 0.5, step: 0.005 },
  { key: 'focusZoom', label: 'Запас кадра', min: 1, max: 6, step: 0.1 },
  { key: 'ceiling', label: 'Потолочный свет', min: 0, max: 5, step: 0.05 },
  { key: 'haze', label: 'Дымка, плотность', min: 0, max: 0.2, step: 0.001 },
  { key: 'hazeGlow', label: 'Дымка, свечение', min: 0, max: 5, step: 0.05 },
  { key: 'dust', label: 'Пылинки', min: 0, max: 1, step: 0.005 },
  { key: 'bloom', label: 'Ореол', min: 0, max: 3, step: 0.05 },
  { key: 'bloomThreshold', label: 'Ореол, порог', min: 0, max: 5, step: 0.05 },
  { key: 'cool', label: 'Холодный тон', min: 0, max: 1, step: 0.05 },
  { key: 'vignette', label: 'Виньетка', min: 0, max: 1.5, step: 0.05 },
  { key: 'grain', label: 'Зерно', min: 0, max: 0.2, step: 0.005 },
]

const s = {
  wrap: {
    position: 'fixed', right: 16, top: 48, width: 260, zIndex: 10, // под «[ корзина ]», не поверх кнопок макета
    background: 'rgba(18,18,20,.92)', color: '#e8e8e8', borderRadius: 8,
    padding: '12px 14px', font: '12px/1.4 system-ui, sans-serif',
    border: '1px solid #333', backdropFilter: 'blur(6px)',
    maxHeight: 'calc(100vh - 64px)', overflowY: 'auto', // ползунков больше, чем влезает на ноутбуке
  },
  summary: { cursor: 'pointer', userSelect: 'none' },
  row: { display: 'flex', justifyContent: 'space-between', marginBottom: 2 },
  range: { width: '100%', marginBottom: 8 },
  num: { color: '#9a9a9a', fontVariantNumeric: 'tabular-nums' },
  btn: {
    width: '100%', padding: '7px', marginTop: 2, cursor: 'pointer',
    background: '#2b2b30', color: '#e8e8e8', border: '1px solid #444', borderRadius: 5,
    font: 'inherit',
  },
  status: { marginTop: 6, minHeight: 14, color: '#8a8a8a' },
}

export default function Panel({ paramsRef }) {
  // Локальная копия нужна только чтобы рисовать подписи и положение ручек.
  // Источник правды для сцены — paramsRef, он обновляется тут же, синхронно.
  const [view, setView] = useState(() => ({ ...paramsRef.current }))
  const [status, setStatus] = useState('')

  const setKey = (key, value) => {
    paramsRef.current[key] = value
    setView((v) => ({ ...v, [key]: value }))
  }

  const save = async () => {
    setStatus('сохраняю…')
    try {
      setStatus(await saveOrCopy('/__params', 'src/params.js', paramsRef.current))
    } catch (e) {
      setStatus('ошибка: ' + e.message)
    }
  }

  return (
    // Свёрнута по умолчанию: развёрнутая закрывает интерфейс из макета
    <details style={s.wrap}>
      <summary style={s.summary}>Свет и атмосфера</summary>
      {SLIDERS.map(({ key, label, min, max, step }) => (
        <div key={key}>
          <div style={s.row}>
            <span>{label}</span>
            <span style={s.num}>{view[key]}</span>
          </div>
          <input
            style={s.range}
            type="range"
            min={min}
            max={max}
            step={step}
            value={view[key]}
            onChange={(e) => setKey(key, Number(e.target.value))}
          />
        </div>
      ))}

      <button style={s.btn} onClick={save}>Сохранить в код</button>
      <div style={s.status}>{status}</div>
    </details>
  )
}
