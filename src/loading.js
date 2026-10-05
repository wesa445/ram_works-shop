// Сколько байт сцены уже скачано. Загрузчик three считает файлы, а не байты: пока
// тянется единственный glb на два мегабайта, счётчик файлов стоит на нуле, и полоса
// выглядит зависшей. Здесь лежит честный прогресс самого тяжёлого файла.
let state = { loaded: 0, total: 0 }
const listeners = new Set()

export const setSceneBytes = (loaded, total) => {
  state = { loaded, total }
  listeners.forEach((listener) => listener(state))
}

export const subscribeSceneBytes = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getSceneBytes = () => state
