// Хранилище заказов. Файл с подчёркиванием — Vercel не делает из него отдельный адрес.
//
// Боевое — таблица shop_orders в Supabase (схема в supabase-orders.sql), через REST API
// обычным fetch, без пакетов. Ключ service_role живёт только в env Vercel и на сервере.
//
// Без переменных Supabase на своей машине заказы пишутся в .orders.local.json — чтобы проверять
// оформление целиком без базы. На Vercel такой откат запрещён: файловая система там временная,
// заказ пропал бы молча. Лучше честная ошибка.
import { readFile, writeFile } from 'node:fs/promises'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LOCAL_FILE = '.orders.local.json'

export const storeReady = () => Boolean(URL && KEY) || !process.env.VERCEL

async function supabase(path, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
  return res.json()
}

async function readLocal() {
  try {
    return JSON.parse(await readFile(LOCAL_FILE, 'utf8'))
  } catch {
    return []
  }
}

// Возвращает сохранённый заказ с номером (id) и временем создания
export async function saveOrder(order) {
  if (URL && KEY) {
    const [row] = await supabase('shop_orders', { method: 'POST', body: JSON.stringify(order) })
    return row
  }
  const all = await readLocal()
  const row = { id: (all[0]?.id ?? 0) + 1, created_at: new Date().toISOString(), ...order }
  await writeFile(LOCAL_FILE, JSON.stringify([row, ...all], null, 2))
  return row
}

// Новые сверху. ponytail: без постраничности — добавить, когда заказов станут сотни
export async function listOrders() {
  if (URL && KEY) return supabase('shop_orders?select=*&order=created_at.desc&limit=500')
  return readLocal()
}
