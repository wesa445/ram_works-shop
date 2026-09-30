// /api/orders
//   POST — оформить заказ (корзина на сайте). Оплаты нет: заказ — заявка, продавец связывается сам.
//   GET  — список заказов для админки, по паролю ADMIN_PASSWORD из env.
//
// Цены и названия берём из каталога здесь, на сервере. Из запроса — только id и количество:
// иначе цену можно было бы поправить в браузере.
import { createHash, timingSafeEqual } from 'node:crypto'
import { MAX_QTY, PRODUCTS } from '../src/product.js'
import { listOrders, saveOrder, storeReady } from './_store.js'

const LIMITS = { name: 100, contact: 100, address: 300, comment: 1000 }

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// Возвращает { order } или { error } — текст ошибки показывается покупателю как есть
export function validateOrder(body) {
  if (!body || typeof body !== 'object') return { error: 'Пустой запрос.' }
  if (body.website) return { error: 'Заказ отклонён.' } // поле-ловушка, человек его не видит

  // Позиция — товар в конкретном размере: одна куртка в M и одна в L — две позиции
  const qty = new Map()
  for (const item of Array.isArray(body.items) ? body.items : []) {
    const product = PRODUCTS[item?.id]
    const n = Number(item?.qty)
    if (!product || !Number.isInteger(n) || n < 1) return { error: 'В корзине неизвестный товар — обновите страницу.' }
    const size = product.sizes ? item.size : null
    if (product.sizes && !product.sizes.includes(size)) return { error: 'Выберите размер для каждой позиции в корзине.' }
    const key = `${product.id}|${size ?? ''}`
    qty.set(key, Math.min(MAX_QTY, (qty.get(key) ?? 0) + n))
  }
  if (!qty.size) return { error: 'Корзина пуста.' }

  const name = text(body.name, LIMITS.name)
  const contact = text(body.contact, LIMITS.contact)
  const address = text(body.address, LIMITS.address)
  if (!name || !contact || !address) return { error: 'Заполните имя, контакт и адрес доставки.' }
  if (body.consent !== true) return { error: 'Нужно согласие на обработку персональных данных.' }

  const items = [...qty].map(([key, n]) => {
    const [id, size] = key.split('|')
    const p = PRODUCTS[id]
    return { id, title: p.title, price: p.price, qty: n, ...(size && { size }) }
  })
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0)
  return { order: { items, total, name, contact, address, comment: text(body.comment, LIMITS.comment) || null } }
}

// Сравнение пароля за постоянное время: хэши одной длины, по времени ответа не подобрать
function isAdmin(req) {
  const password = process.env.ADMIN_PASSWORD
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!password || !given) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(password).digest()
  return timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  if (!storeReady()) return res.status(503).json({ error: 'Приём заказов не настроен: нет базы в env Vercel.' })

  try {
    if (req.method === 'POST') {
      const { order, error } = validateOrder(req.body)
      if (error) return res.status(400).json({ error })
      const saved = await saveOrder({ ...order, site: String(req.headers.host || '').slice(0, 100) })
      return res.status(201).json({ id: saved.id, total: saved.total })
    }

    if (req.method === 'GET') {
      if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD не задан в env.' })
      if (!isAdmin(req)) return res.status(401).json({ error: 'Неверный пароль.' })
      return res.status(200).json({ orders: await listOrders() })
    }

    res.setHeader('allow', 'GET, POST')
    return res.status(405).json({ error: 'Метод не поддерживается.' })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: 'Не удалось сохранить заказ. Попробуйте ещё раз.' })
  }
}
