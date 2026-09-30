// Писать в исходники умеет только dev-сервер: эндпоинты живут в плагине vite.
// В выложенной версии сохранять некуда — значения уезжают в буфер обмена.
export const CAN_WRITE_SOURCE = import.meta.env.DEV

// Один путь для обеих панелей: на dev-сервере пишем в файл, иначе копируем JSON.
export async function saveOrCopy(endpoint, file, data) {
  const json = JSON.stringify(data, null, 2)

  if (!CAN_WRITE_SOURCE) {
    try {
      await navigator.clipboard.writeText(json)
      return `скопировано в буфер — вставь в ${file}`
    } catch {
      // clipboard недоступен без https или без разрешения — показываем текст
      return 'буфер недоступен, значения в консоли: ' + (console.log(json), 'смотри лог')
    }
  }

  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: json,
  })
  return r.ok ? `записано в ${file}` : 'ошибка: ' + (await r.text())
}
