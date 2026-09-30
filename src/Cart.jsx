import { useEffect, useRef, useState } from 'react'
import { formatPrice, PRODUCTS } from './product.js'

// Попап корзины: позиции, сумма, форма заказа. Оплаты на сайте нет — заказ уходит заявкой,
// продавец связывается по контакту. Текст здесь обычным языком, без ролевой игры: покупатель
// принимает решение (канон проекта, Secret Materials/CLAUDE.md).

const pad = (n, len = 2) => String(n).padStart(len, '0')

const FIELDS = [
  { name: 'name', label: 'Имя', autoComplete: 'name', max: 100 },
  { name: 'contact', label: 'Телефон или Telegram', autoComplete: 'tel', max: 100 },
  { name: 'address', label: 'Город и адрес доставки', autoComplete: 'street-address', max: 300 },
]

export default function Cart({ open, onClose, cart }) {
  const closeRef = useRef(null)
  const [form, setForm] = useState({ name: '', contact: '', address: '', comment: '', consent: false, website: '' })
  const [status, setStatus] = useState('idle') // idle | sending | done
  const [error, setError] = useState('')
  const [orderId, setOrderId] = useState(null)

  useEffect(() => {
    if (open) closeRef.current?.focus()
    else if (status === 'done') setStatus('idle') // после закрытия — снова пустая форма для следующего заказа
  }, [open, status])

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setStatus('sending')
    setError('')
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, items: cart.items }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Не удалось отправить заказ. Попробуйте ещё раз.')
      setOrderId(data.id)
      setStatus('done')
      cart.clear()
      setForm((f) => ({ ...f, comment: '' })) // имя, контакт и адрес оставляем — пригодятся в следующий раз
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.' : err.message)
      setStatus('idle')
    }
  }

  if (!open) return null

  return (
    <div className="cart-popup" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="cart-panel" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <div className="cart-head">
          <h2 id="cart-title">Корзина</h2>
          <button ref={closeRef} className="cart-close" onClick={onClose} aria-label="Закрыть корзину">
            <svg viewBox="0 0 28 28" width="20" height="20" aria-hidden="true">
              <path d="M4 4L24 24M24 4L4 24" fill="none" stroke="currentColor" strokeWidth="3" />
            </svg>
          </button>
        </div>

        {status === 'done' ? (
          <div className="cart-done">
            <p>Заказ №{pad(orderId, 4)} принят.</p>
            <p className="note">Мы свяжемся с вами по указанному контакту, чтобы подтвердить заказ и договориться об оплате и доставке.</p>
            <button onClick={onClose}>[ закрыть ]</button>
          </div>
        ) : cart.items.length === 0 ? (
          <p className="note">Корзина пуста.</p>
        ) : (
          <>
            <ul className="cart-items">
              {cart.items.map(({ id, size, qty }) => {
                const p = PRODUCTS[id]
                return (
                  <li key={`${id}|${size}`}>
                    <p>{p.title}</p>
                    {size && <p><span className="dim">Размер:</span> {size}</p>}
                    <div className="cart-row">
                      <span className="cart-qty">
                        <button onClick={() => cart.setQty(id, size, qty - 1)} aria-label="Меньше">[ − ]</button>
                        <span aria-label="Количество">{pad(qty)}</span>
                        <button onClick={() => cart.setQty(id, size, qty + 1)} aria-label="Больше">[ + ]</button>
                      </span>
                      <span>{formatPrice(p.price * qty)}</span>
                    </div>
                    <button className="dim" onClick={() => cart.setQty(id, size, 0)}>[ удалить ]</button>
                  </li>
                )
              })}
            </ul>

            <p className="cart-total"><span className="dim">Итого:</span> {formatPrice(cart.total)}</p>

            <form className="cart-form" onSubmit={submit}>
              {FIELDS.map(({ name, label, autoComplete, max }) => (
                <label key={name}>
                  <span className="dim">{label}</span>
                  <input name={name} value={form[name]} onChange={set(name)} autoComplete={autoComplete} maxLength={max} required />
                </label>
              ))}
              <label>
                <span className="dim">Комментарий</span>
                <textarea name="comment" value={form.comment} onChange={set('comment')} maxLength={1000} rows={2} />
              </label>
              {/* Поле-ловушка для ботов: человек его не видит и не заполняет */}
              <input className="cart-trap" name="website" value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" />
              <label className="cart-consent">
                <input type="checkbox" checked={form.consent} onChange={set('consent')} required />
                <span>
                  Согласен на обработку персональных данных для оформления и доставки заказа
                  по <a href="/privacy.html" target="_blank" rel="noopener">политике обработки данных</a>
                </span>
              </label>
              <p className="note">Оплата на сайте не принимается: после заказа мы свяжемся с вами для подтверждения.</p>
              {error && <p className="cart-error" role="alert">{error}</p>}
              <button type="submit" disabled={status === 'sending'}>
                {status === 'sending' ? '[ отправляем… ]' : '[ оформить заказ ]'}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
