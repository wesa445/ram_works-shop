-- Таблица заказов магазина. Выполнить один раз в Supabase: SQL Editor → вставить → Run.
-- Доступ только с сервера (ключ service_role в env Vercel): RLS включена, политик нет —
-- из браузера по публичному ключу таблицу не прочитать и не изменить.
create table if not exists public.shop_orders (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  items jsonb not null,          -- [{ id, title, price, qty }] — снимок на момент заказа
  total integer not null,        -- рубли
  name text not null,
  contact text not null,         -- телефон или Telegram
  address text not null,
  comment text,
  site text                      -- с какого адреса пришёл заказ: прод или дев
);

alter table public.shop_orders enable row level security;
