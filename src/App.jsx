import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Scene from './Scene.jsx'
import Overlay from './Overlay.jsx'
import Cart from './Cart.jsx'
import { useCart } from './cart.js'
import { PRODUCT } from './product.js'
import { PARAMS } from './params.js'

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
  // Ссылка вида /#jacket открывает сразу подлёт к товару
  const [focusedId, setFocusedId] = useState(() => location.hash.slice(1) || null)
  // Камера доехала: карточка проявляется только тогда, иначе накрывает сам наезд
  const [arrived, setArrived] = useState(false)
  const goHome = useCallback(() => setFocusedId(null), [])
  const openProduct = useCallback(() => setFocusedId(PRODUCT.id), [])
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
        <Scene paramsRef={paramsRef} focusedId={focusedId} onFocus={setFocusedId} onArrive={setArrived} />
      </Suspense>

      <Overlay
        view={view}
        onOpen={openProduct}
        onHome={goHome}
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
