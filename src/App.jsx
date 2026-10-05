import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Scene from './Scene.jsx'
import Overlay from './Overlay.jsx'
import Cart from './Cart.jsx'
import { useCart } from './cart.js'
import { CATALOG, productFromHash } from './product.js'
import { PARAMS } from './params.js'

// Длительность затемнения при переходе между товарами — та же в index.css (.fade)
const FADE_MS = 600

// Условие прямо здесь, а не импортом: Vite подставляет import.meta.env на месте, и сборщик
// видит константу false и выкидывает панель из прод-бандла целиком.
const TOOLS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_TOOLS === '1'
const Panel = TOOLS_ENABLED ? lazy(() => import('./Panel.jsx')) : null

// Панель свёрстана под широкий монитор: на телефоне она накрывает сцену целиком
function useWideScreen() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 900px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const on = (e) => setWide(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

export default function App() {
  // Параметры в ref, а не в состоянии: ползунок не должен перерисовывать сцену
  // window.__P — подмена параметров для замеров со скриншотов, только на dev-сервере
  const paramsRef = useRef({ ...PARAMS, ...(import.meta.env.DEV && window.__P) })
  // Ссылка вида /#hoodie открывает сразу этот товар крупным планом
  const [index, setIndex] = useState(productFromHash)
  const product = CATALOG[index]
  const [focusedId, setFocusedId] = useState(() => (location.hash ? product.id : null))
  // Камера доехала: карточка проявляется только тогда, иначе накрывает сам наезд
  const [arrived, setArrived] = useState(false)
  const goHome = useCallback(() => setFocusedId(null), [])
  const openProduct = useCallback(() => setFocusedId(product.id), [product.id])

  // Переход между товарами: камера уезжает вбок и сцена гаснет в чёрное (FADE_MS); в темноте
  // меняется товар — старая сцена выгружается, новая грузится; когда она на экране (onReady),
  // камера доезжает с другой стороны и затемнение уходит. dir: +1 — вперёд, камера едет вправо.
  const [move, setMove] = useState({ slide: 0, enterFrom: 0, dark: false, busy: false })
  const go = useCallback((dir) => {
    setMove({ slide: dir, enterFrom: 0, dark: true, busy: true })
    setTimeout(() => {
      setIndex((i) => (i + dir + CATALOG.length) % CATALOG.length)
      setMove({ slide: 0, enterFrom: -dir, dark: true, busy: true })
    }, FADE_MS)
  }, [])
  const onReady = useCallback(() => {
    setMove((m) => (m.busy ? { ...m, dark: false } : m))
    setTimeout(() => setMove((m) => ({ ...m, busy: false })), FADE_MS)
  }, [])
  const canSwitch = CATALOG.length > 1 && !move.busy && !focusedId
  const view = !focusedId ? 'home' : arrived ? 'card' : 'flight'
  const wide = useWideScreen()

  const cart = useCart()
  const [cartOpen, setCartOpen] = useState(false)
  const closeCart = useCallback(() => setCartOpen(false), [])

  // Esc закрывает верхний слой: сначала корзину, потом карточку товара
  useEffect(() => {
    if (!cartOpen && !focusedId) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (cartOpen) closeCart()
      else goHome()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cartOpen, focusedId, closeCart, goHome])

  return (
    <>
      <Suspense fallback={null}>
        <Scene
          product={product}
          paramsRef={paramsRef}
          focusedId={focusedId}
          onFocus={setFocusedId}
          onArrive={setArrived}
          onReady={onReady}
          slide={move.slide}
          enterFrom={move.enterFrom}
        />
      </Suspense>

      {/* Затемнение перехода. Пока чёрное — ловит клики, чтобы не нажать что-то вслепую.
          Если новая сцена грузится дольше секунды — проступает подпись (index.css) */}
      <div className={move.dark ? 'fade on' : 'fade'} aria-hidden="true">
        <span>[ загрузка ]</span>
      </div>

      <Overlay
        product={product}
        view={view}
        onOpen={openProduct}
        onHome={goHome}
        onPrev={canSwitch ? () => go(-1) : null}
        onNext={canSwitch ? () => go(1) : null}
        cartCount={cart.count}
        onCart={() => setCartOpen(true)}
        onAdd={cart.add}
      />
      <Cart open={cartOpen} onClose={closeCart} cart={cart} />

      {Panel && wide && (
        <Suspense fallback={null}>
          <Panel paramsRef={paramsRef} />
        </Suspense>
      )}
    </>
  )
}
