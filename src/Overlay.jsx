import { useState } from 'react'
import { CART_ENABLED, formatPrice, ORDER_URL } from './product.js'

// Интерфейс поверх сцены по макетам из Paper: общий план и карточка товара (крупный план).
// Оба слоя смонтированы всегда и переключаются прозрачностью — без перерисовки и скачков.
// Сам слой не ловит мышь (pointer-events: none), кроме кнопок: сцену под ним можно крутить.

function Arrow({ side }) {
  return (
    <svg className={`arrow arrow-${side}`} viewBox="61 38 28 53" width="28" height="53" aria-hidden="true">
      <path d="M85.5 42.5L64 64L86 86" fill="none" stroke="currentColor" strokeWidth="4" />
    </svg>
  )
}

// onPrev/onNext — перелистывание товаров; null, пока идёт переход или товар один
export default function Overlay({ product, view, onOpen, onHome, onPrev, onNext, cartCount, onCart, onAdd }) {
  const [size, setSize] = useState(null)

  return (
    <div className={`ui ui-${view}`}>
      {/* Общее для обоих экранов */}
      <button className="brand" onClick={onHome} disabled={view === 'home'} aria-label="ram-works — на общий план">
        <img src="/logo.png" width="57" height="106" alt="" />
        <span>ram-works</span>
      </button>
      {/* Число товаров — двумя цифрами: [ корзина 01 ]. Пока корзина выключена — неактивна */}
      <button className="cart" onClick={onCart} disabled={!CART_ENABLED}>
        {CART_ENABLED && cartCount ? `[ корзина ${String(cartCount).padStart(2, '0')} ]` : '[ корзина ]'}
      </button>
      <div className="bureau">
        <span className="dim">Бюро Наблюдений</span>
        <span className="bureau-name">специзделия</span>
      </div>
      <h1 className="title">{product.title}</h1>

      {/* Крестик — назад на общий план. Вне слоя карточки: на телефоне тот прокручивается */}
      <button className="close" onClick={onHome} disabled={view !== 'card'} aria-label="Вернуться на общий план">
        <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
          <path d="M4 4L24 24M24 4L4 24" fill="none" stroke="currentColor" strokeWidth="3" />
        </svg>
      </button>

      {/* Подсказка на крупном плане: куртку можно крутить. Контурный куб, вокруг — орбита со стрелкой */}
      <svg className="spin-hint" viewBox="0 0 48 24" width="64" height="32" role="img" aria-label="Модель можно покрутить">
        <path
          d="M5.2 9.6A20 7 0 1 0 42.8 9.6M42.8 9.6L43.8 14.5M42.8 9.6L47.7 10.4M24 4L29.2 7V13L24 16L18.8 13V7ZM18.8 7L24 10L29.2 7M24 10V16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>

      {/* Телефон, карточка: белая плашка снизу по макету — название, цена, оформить выдачу.
          На десктопе её нет (index.css): там цена и кнопка в левой колонке карточки. */}
      <div className="bar" inert={view !== 'card'}>
        <p>{product.title}</p>
        <div className="bar-row">
          <span>{formatPrice(product.price)}</span>
          {/* ponytail: при включённой корзине сюда понадобится и выбор размера */}
          {CART_ENABLED ? (
            <button className="bar-order" onClick={() => onAdd(product.id, size)} disabled={!size}>[ добавить в корзину ]</button>
          ) : (
            <a className="bar-order" href={ORDER_URL} target="_blank" rel="noopener">[ оформить выдачу ]</a>
          )}
        </div>
      </div>

      {/* Общий план. Стрелки — перелистывание товаров (переход — в App.jsx) */}
      <div className="layer home" inert={view !== 'home'}>
        <button className="nav nav-prev" onClick={onPrev} disabled={!onPrev} aria-label="Предыдущий товар"><Arrow side="prev" /></button>
        <button className="nav nav-next" onClick={onNext} disabled={!onNext} aria-label="Следующий товар"><Arrow side="next" /></button>
        <button className="open" onClick={onOpen}>[ ознакомиться ]</button>
      </div>

      {/* Карточка товара — крупный план */}
      <div className="layer card" inert={view !== 'card'}>
        <section className="card-main">
          <div className="card-facts">
            {product.specs.map(([label, value]) => (
              <div className="spec" key={label}>
                <span className="dim">{label}:</span> <span>{value}</span>
              </div>
            ))}
            <p>{product.note}</p>
            <p className="card-text">{product.description}</p>
          </div>
          <div className="buy">
            {/* Размер нужен только корзине: в Telegram по ссылке его не передать — покупатель называет
                его в переписке. Без выбранного размера добавить нельзя — иначе в заказ уйдёт не тот */}
            {CART_ENABLED && (
              <div className="sizes" role="radiogroup" aria-label="Размер">
                {product.sizes.map((s) => (
                  <button key={s} role="radio" aria-checked={size === s} className={size === s ? 'on' : ''} onClick={() => setSize(s)}>
                    [ {s} ]
                  </button>
                ))}
              </div>
            )}
            <span className="price">{formatPrice(product.price)}</span>
            {CART_ENABLED ? (
              <button className="add" onClick={() => onAdd(product.id, size)} disabled={!size} title={size ? undefined : 'Выберите размер'}>
                [ добавить в корзину ]
              </button>
            ) : (
              // Пока корзина выключена — заказ сообщением в Telegram. Размер туда не передать:
              // ссылка без текста, покупатель называет его в переписке
              <a className="add" href={ORDER_URL} target="_blank" rel="noopener">[ оформить выдачу ]</a>
            )}
          </div>
        </section>
        <section className="card-lore card-text">
          {product.lore.map((p) => <p key={p}>{p}</p>)}
          <a className="report" href={product.reportUrl} target="_blank" rel="noopener">[ читать рапорт происшествия ]</a>
        </section>
      </div>
    </div>
  )
}
