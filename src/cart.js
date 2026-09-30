import { useCallback, useEffect, useState } from 'react'
import { MAX_QTY, PRODUCTS } from './product.js'

// Корзина живёт в localStorage: переживает перезагрузку, на сервер уходит только при оформлении.
// Хранятся только id, размер и количество — цены и названия всегда берутся из каталога.
// Позиция — товар в конкретном размере: одна куртка в M и одна в L — две строки.
const KEY = 'rw-cart'

const valid = (i) => {
  const p = PRODUCTS[i?.id]
  return p && i.qty > 0 && (!p.sizes || p.sizes.includes(i.size))
}

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY))
    // Товар или размер могли убрать из каталога — такие позиции выбрасываем
    return Array.isArray(list) ? list.filter(valid) : []
  } catch {
    return []
  }
}

const same = (i, id, size) => i.id === id && (i.size ?? null) === (size ?? null)

export function useCart() {
  const [items, setItems] = useState(read) // [{ id, size, qty }]

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items))
    } catch {
      // приватный режим или запрет хранилища: корзина проживёт до перезагрузки
    }
  }, [items])

  // qty < 1 убирает позицию
  const setQty = useCallback((id, size, qty) => {
    setItems((list) =>
      qty < 1
        ? list.filter((i) => !same(i, id, size))
        : list.map((i) => (same(i, id, size) ? { ...i, qty: Math.min(MAX_QTY, qty) } : i)),
    )
  }, [])

  const add = useCallback((id, size) => {
    setItems((list) =>
      list.some((i) => same(i, id, size))
        ? list.map((i) => (same(i, id, size) ? { ...i, qty: Math.min(MAX_QTY, i.qty + 1) } : i))
        : [...list, { id, size, qty: 1 }],
    )
  }, [])

  const clear = useCallback(() => setItems([]), [])
  const count = items.reduce((n, i) => n + i.qty, 0)
  const total = items.reduce((sum, i) => sum + PRODUCTS[i.id].price * i.qty, 0)

  return { items, count, total, add, setQty, clear }
}
