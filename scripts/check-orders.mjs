// Проверка приёма заказа: node scripts/check-orders.mjs (npm run check) — молчит, если всё в порядке.
import assert from 'node:assert/strict'
import { validateOrder } from '../api/orders.js'
import { PRODUCT } from '../src/product.js'

const [M, L] = PRODUCT.sizes
const ok = { items: [{ id: PRODUCT.id, size: M, qty: 2 }], name: 'Имя', contact: '@tg', address: 'Город', consent: true }

// Сумма считается по серверной цене, цена из запроса игнорируется
const { order } = validateOrder({ ...ok, items: [{ id: PRODUCT.id, size: M, qty: 2, price: 1 }] })
assert.equal(order.total, PRODUCT.price * 2)
assert.deepEqual(order.items, [{ id: PRODUCT.id, title: PRODUCT.title, price: PRODUCT.price, qty: 2, size: M }])

// Повторы одного товара в одном размере складываются, количество ограничено
assert.equal(validateOrder({ ...ok, items: [{ id: PRODUCT.id, size: M, qty: 7 }, { id: PRODUCT.id, size: M, qty: 7 }] }).order.items[0].qty, 10)

// Разные размеры — разные позиции, сумма по обеим
const two = validateOrder({ ...ok, items: [{ id: PRODUCT.id, size: M, qty: 1 }, { id: PRODUCT.id, size: L, qty: 1 }] }).order
assert.equal(two.items.length, 2)
assert.equal(two.total, PRODUCT.price * 2)

// Отказы
assert.ok(validateOrder({ ...ok, items: [] }).error)
assert.ok(validateOrder({ ...ok, items: [{ id: 'нет-такого', size: M, qty: 1 }] }).error)
assert.ok(validateOrder({ ...ok, items: [{ id: PRODUCT.id, qty: 1 }] }).error) // без размера
assert.ok(validateOrder({ ...ok, items: [{ id: PRODUCT.id, size: 'XXXL', qty: 1 }] }).error)
assert.ok(validateOrder({ ...ok, items: [{ id: PRODUCT.id, size: M, qty: 0 }] }).error)
assert.ok(validateOrder({ ...ok, items: [{ id: PRODUCT.id, size: M, qty: 1.5 }] }).error)
assert.ok(validateOrder({ ...ok, name: '   ' }).error)
assert.ok(validateOrder({ ...ok, consent: 'true' }).error)
assert.ok(validateOrder({ ...ok, website: 'bot' }).error)
assert.ok(validateOrder(null).error)
