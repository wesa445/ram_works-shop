import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { formatPrice } from './product.js'
import './index.css'
import './page.css'

// Админка: список заказов. Пароль проверяет сервер (ADMIN_PASSWORD в env) — здесь он только
// хранится до закрытия вкладки, чтобы не вводить его на каждое обновление.
const KEY = 'rw-admin'

const pad = (n) => String(n).padStart(4, '0')
const when = (iso) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

function readPassword() {
  try {
    return sessionStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

function Admin() {
  const [password, setPassword] = useState(readPassword)
  const [draft, setDraft] = useState('')
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (pw) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/orders', { headers: { authorization: `Bearer ${pw}` } })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setPassword('')
        try { sessionStorage.removeItem(KEY) } catch { /* без хранилища — просто спросим пароль снова */ }
      }
      if (!res.ok) throw new Error(data.error || `Ошибка сервера: ${res.status}`)
      setOrders(data.orders)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (password) load(password)
  }, [password, load])

  const login = (e) => {
    e.preventDefault()
    try { sessionStorage.setItem(KEY, draft) } catch { /* пароль проживёт до перезагрузки */ }
    setPassword(draft)
    setDraft('')
  }

  const logout = () => {
    try { sessionStorage.removeItem(KEY) } catch { /* нечего удалять */ }
    setPassword('')
    setOrders(null)
  }

  if (!password) {
    return (
      <main className="page">
        <h1>ram-works · заказы</h1>
        <form className="admin-login" onSubmit={login}>
          <label>
            <span className="dim">Пароль</span>
            <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus required />
          </label>
          <button type="submit">[ войти ]</button>
          {error && <p role="alert">{error}</p>}
        </form>
      </main>
    )
  }

  return (
    <main className="page">
      <header className="admin-head">
        <h1>ram-works · заказы{orders && <span className="dim"> · {orders.length}</span>}</h1>
        <div className="admin-actions">
          <button onClick={() => load(password)} disabled={loading}>{loading ? '[ загрузка… ]' : '[ обновить ]'}</button>
          <button onClick={logout}>[ выйти ]</button>
        </div>
      </header>

      {error && <p role="alert">{error}</p>}
      {orders?.length === 0 && <p className="dim">Заказов пока нет.</p>}

      <ul className="admin-orders">
        {orders?.map((o) => (
          <li key={o.id}>
            <p className="admin-meta">
              <span>№{pad(o.id)}</span>
              <span className="dim">{when(o.created_at)}</span>
              {o.site && <span className="dim">{o.site}</span>}
            </p>
            <p>{o.name} · <a href={/^\+?[\d\s()-]{7,}$/.test(o.contact) ? `tel:${o.contact.replace(/[^\d+]/g, '')}` : undefined}>{o.contact}</a></p>
            <p>{o.address}</p>
            {o.items.map((i) => (
              <p key={`${i.id}|${i.size}`} className="admin-item">
                <span>{i.title}{i.size && ` · ${i.size}`} × {String(i.qty).padStart(2, '0')}</span>
                <span>{formatPrice(i.price * i.qty)}</span>
              </p>
            ))}
            <p className="admin-item"><span className="dim">Итого</span><span>{formatPrice(o.total)}</span></p>
            {o.comment && <p className="admin-comment">{o.comment}</p>}
          </li>
        ))}
      </ul>
    </main>
  )
}

createRoot(document.getElementById('admin')).render(
  <StrictMode>
    <Admin />
  </StrictMode>,
)
