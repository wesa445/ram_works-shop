import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor, useGLTF } from '@react-three/drei'
import {
  AgXToneMapping,
  BackSide,
  Box3,
  Euler,
  FrontSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  PCFShadowMap,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { createRenderer } from './renderer.js'
import Effects from './Effects.jsx'
import { QUALITY } from './quality.js'

// Встроенные браузеры (Cursor, VS Code) часто идут без аппаратного ускорения — тогда
// сцена рисуется процессором и еле ползёт. Двойной пиксель и сглаживание там непозволительны.
const SOFTWARE_RENDERER = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return true
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''
    return /swiftshader|llvmpipe|software|basic render|microsoft/i.test(String(name))
  } catch {
    return false
  }
})()

// Сцена собирается из Jacket.blend скриптом scripts/export-scene.py (npm run scene)
const MODEL = '/scene.glb'
const DRACO = '/draco/' // меши сжаты Draco, декодер лежит локально — без внешнего CDN
const SHADOW_MAP = SOFTWARE_RENDERER ? 512 : QUALITY.shadowMap

// Тени бросают только узкие прожекторы. Потолочные лампы в GLB — бывшие area-лампы с
// конусом в полусферу: у теневой камеры прожектора угол обзора вдвое больше конуса,
// на 180° она вырождается.
const SHADOW_MAX_ANGLE = 1.2

// Кадр снят в Блендере под 16:9. Угол перспективной камеры задан по ВЕРТИКАЛИ, поэтому
// на телефоне в портрете горизонтальный обзор схлопывается. Расширяем вертикальный угол,
// сохраняя горизонтальный обзор автора, но не больше потолка — дальше перспектива
// разъезжается. Прирост делим между верхом и низом наклоном камеры.
const BASE_ASPECT = 16 / 9
const MAX_FOV = 45
const TILT_SHARE = 0
const fitFov = (baseFov, aspect) => {
  if (!baseFov || aspect >= BASE_ASPECT) return baseFov
  const half = (baseFov * Math.PI) / 360
  const widened = (2 * Math.atan(Math.tan(half) * (BASE_ASPECT / aspect)) * 180) / Math.PI
  return Math.min(widened, MAX_FOV)
}

// Кликабельные цели. Каждая — набор мешей, который ведёт себя как один объект:
// подсвечивается целиком и кадрируется по общим габаритам.
//
// Меши берутся строго по именам, без детей: у куртки дочерний трос уходит под потолок,
// и с ним рамка кадра растягивалась бы на всю высоту комнаты.
//
// zoom — множитель дистанции поверх ползунка «Запас кадра»; pitch — подъём точки
// подлёта над исходным направлением взгляда, в градусах.
const TARGETS = [
  { id: 'jacket', meshes: ['Jacket', 'JacketBack'], zoom: 1, pitch: 0 },
]
const FOCUS_SPEED = 0.05 // доля пути за кадр при 60 Гц; меньше — дольше наезд
const ARRIVE_AT = 0.1 // доля дистанции, на которой наезд считается законченным
// На узком экране карточка товара — блок текста и белая плашка снизу (index.css, граница 900 px).
// Камера при наезде опускается, чтобы товар встал над текстом, и подъезжает ближе.
const NARROW = 900
// Зоны карточки на узком экране сверху вниз: шапка, товар, ряд значка «можно покрутить», текст,
// белая плашка. Зеркало index.css (--foot, --card-h и отступы значка) — менять вместе. Камера вписывает
// товар в его зону, поэтому текст на него не заезжает при любой высоте телефона.
const CARD_ZONES = { top: 72, hint: 56, bar: 150, text: 0.26 } // px, px, px, доля высоты экрана
const ZONE_FILL = 0.92 // какую долю зоны занимает товар — остальное поля
// Общий план на узком экране: комната мелкая, вокруг пустота — подъезжаем ближе на долю пути до
// товара. 0.44 — оставшийся путь 0.56 = прежние 0.7 × 0.8, «ближе на 20%». Десктоп — кадр из Блендера.
const NARROW_DOLLY = 0.44

// Куртку при наезде можно крутить перетаскиванием: радиан на пиксель
const SPIN_PER_PX = 0.01
// Подсказка «можно покрутить»: на крупном плане куртка сама медленно вращается, пока её не трогают.
const AUTO_SPIN = 0.25 // рад/с — оборот за 25 секунд
const AUTO_SPIN_START = 1500 // мс после открытия карточки: сначала камера доезжает
const AUTO_SPIN_RESUME = 2500 // мс после того, как человек отпустил куртку
const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const SPUN = ['Jacket', 'JacketBack']

// Текстуры куртки без потерь (пишет export-scene.py). В GLB — сжатые копии: показываются, пока
// эти грузятся, и остаются, если не загрузились.
const JACKET_TEXTURES = [
  ['Jacket', '/textures/jacket-front.webp'],
  ['JacketBack', '/textures/jacket-back.webp'],
]

// Контур: копия геометрии, раздутая по нормалям и отрисованная задними гранями.
// Толщина в пикселях экрана, но не больше доли от экранного радиуса самого меша.
const OUTLINE_COLOR = '#2bff66'
const OUTLINE_PX = 5
const OUTLINE_MAX_RATIO = 0.045

// Свет берём из GLB — лампы, расставленные в Блендере. Панель только масштабирует
// яркость. Геометрия и свет неподвижны, поэтому карту теней считаем один раз и
// замораживаем; пересчитываем, пока крутится куртка.
function SceneLights({ paramsRef, scene, radius }) {
  const gl = useThree((s) => s.gl)
  const signature = useRef('')

  const lights = useMemo(() => {
    const all = []
    const casters = []
    scene.traverse((o) => {
      if (!o.isLight) return
      // Потолочные (бывшие area-лампы, конус в полусферу) — свой множитель: на них держится
      // контраст «светлая комната в тёмном зале», как на референсах
      const ceiling = o.isSpotLight && o.angle > SHADOW_MAX_ANGLE
      all.push({ light: o, base: o.intensity, ceiling })
      if (ceiling) return
      o.castShadow = true
      o.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
      o.shadow.camera.near = 0.2
      o.shadow.camera.far = radius * 3
      o.shadow.normalBias = 0.02
      casters.push(o)
    })
    return all.length ? { all, casters } : null
  }, [scene, radius])

  useLayoutEffect(() => {
    gl.shadowMap.autoUpdate = false // тени пересчитываем только когда сами попросим
    gl.shadowMap.needsUpdate = true
  }, [gl])

  useFrame(() => {
    if (!lights) return
    const p = paramsRef.current

    const sig = `${p.lightScale}|${p.ceiling}|${p.shadowSoftness}`
    if (sig === signature.current) return
    signature.current = sig

    for (const { light, base, ceiling } of lights.all) light.intensity = base * p.lightScale * (ceiling ? p.ceiling : 1)
    for (const light of lights.casters) light.shadow.radius = p.shadowSoftness
    gl.shadowMap.needsUpdate = true
  })

  return null
}

// Мир в Блендере — ровный серый фон. В три.js это рассеянный свет той же силы.
function AmbientLight({ paramsRef }) {
  const light = useRef(null)
  useFrame(() => {
    if (light.current) light.current.intensity = paramsRef.current.ambient
  })
  return <ambientLight ref={light} />
}

// Заполняющий у камеры, чтобы передний план не проваливался в тень. Теней не бросает.
// Для общего плана и крупного — свои значения («Заполняющий» и «Свет на товаре» в панели):
// товар в карточке подсвечиваем, не трогая свет комнаты. Переход той же скоростью, что камера.
function FillLight({ paramsRef, focused }) {
  const light = useRef(null)
  const current = useRef(null)

  useFrame((state, delta) => {
    const l = light.current
    if (!l) return

    const goal = focused ? paramsRef.current.focusFill : paramsRef.current.fill
    if (current.current === null) current.current = goal

    const k = 1 - Math.pow(1 - FOCUS_SPEED, delta * 60)
    current.current += (goal - current.current) * k

    l.intensity = current.current
    l.position.copy(state.camera.position)
    l.position.y += 1
  })

  return <pointLight ref={light} decay={2} intensity={0} />
}

const _q = new Quaternion()
const _qWorld = new Quaternion()
const _qInv = new Quaternion()
const _goalQuat = new Quaternion()
const _spin = new Quaternion()
const _e = new Euler(0, 0, 0, 'YXZ')
const _v = new Vector3()
const _goalPos = new Vector3()
const _goalCenter = new Vector3()
const _lookMatrix = new Matrix4()
const _up = new Vector3(0, 1, 0)
const _ndc = new Vector2()

// Камера. Базовая поза плавно переезжает между исходной и приближённой, поверх —
// параллакс за курсором. Параллакс вращает камеру вокруг точки, а не сцену: геометрия
// и свет неподвижны, значит замороженная карта теней верна.
function CameraRig({ paramsRef, home, focus, focused, onArrive }) {
  const pose = useRef(null)
  const sway = useRef({ x: 0, y: 0 })
  const arrived = useRef(false)

  useFrame((state, delta) => {
    const p = paramsRef.current
    const camera = state.camera

    if (!pose.current) {
      pose.current = {
        position: home.position.clone(),
        quaternion: home.quaternion.clone(),
        pivot: home.pivot.clone(),
      }
    }

    const cur = pose.current
    let goal = home

    if (focused && focus) {
      // На узком экране дистанция уже посчитана точно под зону — ползунок «Запас кадра» не участвует
      const distance = focus.exact ? focus.distance : focus.distance * p.focusZoom
      // Сдвиг зависит от дистанции (высота кадра на ней), а её двигает ползунок — считаем здесь
      _goalCenter.copy(focus.center)
      _goalCenter.y -= focus.lift * distance
      _goalPos.copy(_goalCenter).addScaledVector(focus.dir, distance)
      // Через Matrix4, а не Object3D.lookAt: у простого объекта three строит матрицу
      // как lookAt(target, position) — камера смотрела бы в обратную сторону.
      _lookMatrix.lookAt(_goalPos, _goalCenter, _up)
      _goalQuat.setFromRotationMatrix(_lookMatrix)
      goal = { position: _goalPos, quaternion: _goalQuat, pivot: _goalCenter }
    }

    // Сглаживание, не зависящее от частоты кадров
    const move = 1 - Math.pow(1 - FOCUS_SPEED, delta * 60)
    cur.position.lerp(goal.position, move)
    cur.quaternion.slerp(goal.quaternion, move)
    cur.pivot.lerp(goal.pivot, move)

    // Наезд экспоненциальный и в цель не приходит никогда — порог в долях дистанции
    const near = !!(focused && focus) && cur.position.distanceTo(goal.position) < focus.distance * ARRIVE_AT
    if (near !== arrived.current) {
      arrived.current = near
      onArrive?.(near)
    }

    const k = 1 - Math.pow(1 - p.swaySpeed, delta * 60)
    sway.current.x += (state.pointer.y * p.swayAmount - sway.current.x) * k
    sway.current.y += (state.pointer.x * p.swayAmount - sway.current.y) * k

    // Наклон в собственных осях камеры: в мировых поворот по X подмешивал бы крен
    _q.setFromEuler(_e.set(-sway.current.x, -sway.current.y, 0))
    _qInv.copy(cur.quaternion).invert()
    _qWorld.copy(cur.quaternion).multiply(_q).multiply(_qInv)

    camera.position.copy(cur.position).sub(cur.pivot).applyQuaternion(_qWorld).add(cur.pivot)
    camera.quaternion.copy(cur.quaternion).multiply(_q)
  })

  return null
}

// Габариты меша без детей: Box3.expandByObject обходит потомков, а у куртки это трос
function meshBox(mesh, box = new Box3()) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  mesh.updateWorldMatrix(true, false)
  return box.union(new Box3().copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld))
}

// Блик. Физматериал три.js на тёмных шероховатых поверхностях бликует заметно сильнее
// Cycles. Подобрано замером зон кадра против рендера из Блендера (яркость 0–255):
//                  рендер  как есть  specular 0.3  без блика
//   поролон          14       39         16            9
//   верх постамента  42       90         49           34
//   куртка           59       84         77           62
// Неметаллам — ослабленный блик, ткани куртки — никакого. Металлы (ручка двери) не трогаем.
const SPECULAR = 0.3
const MATTE = ['Jacket', 'JacketBack']

// Лицо и изнанка куртки — две копии одной геометрии (см. export-scene.py): первая рисуется
// только лицом, вторая только изнанкой. Идемпотентно — StrictMode зовёт дважды.
function prepareMaterials(scene) {
  const swapped = new Map() // материал общий у нескольких мешей — замена тоже одна
  scene.traverse((o) => {
    const old = o.material
    if (!o.isMesh || !old.isMeshStandardMaterial || old.isMeshPhysicalMaterial || old.metalness > 0) return
    if (!swapped.has(old)) {
      const base = { name: old.name, map: old.map, color: old.color, side: old.side }
      // На телефоне (quality.js) без блика все неметаллы: физический материал там — треть кадра
      swapped.set(old, QUALITY.lambert || MATTE.includes(o.name)
        ? new MeshLambertMaterial(base)
        : new MeshPhysicalMaterial({ ...base, roughness: old.roughness, roughnessMap: old.roughnessMap, specularIntensity: SPECULAR }))
      old.dispose()
    }
    o.material = swapped.get(old)
  })

  const front = scene.getObjectByName('Jacket')
  const back = scene.getObjectByName('JacketBack')
  if (front?.isMesh && back?.isMesh) {
    front.material.side = FrontSide
    back.material.side = BackSide
  }
}

function Model({ paramsRef, focusedId, onFocus, onArrive }) {
  const { scene, cameras } = useGLTF(MODEL, DRACO)
  const set = useThree((s) => s.set)
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const camera = cameras[0] // камера из Блендера — кадр, заданный автором

  // Камера лежит внутри GLTF-сцены, в Блендере — на пустышке. Оставить её там нельзя:
  // параллакс двигает камеру, и она тянула бы за собой геометрию. Переносим мировую позу
  // в саму камеру и отцепляем — до расчётов ниже, они читают её position. Идемпотентно.
  useMemo(() => {
    if (!camera?.parent) return
    camera.updateWorldMatrix(true, false)
    camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale)
    camera.removeFromParent()
  }, [camera])

  // Исходный угол запоминаем один раз: дальше мы его меняем под экран
  const baseFovRef = useRef(null)
  if (camera && baseFovRef.current == null) baseFovRef.current = camera.fov
  // Считаем в рендере: этим значением пользуются расчёты наездов в useMemo ниже
  const fov = fitFov(baseFovRef.current, size.width / size.height)

  // До расчётов ниже: контур смотрит на сторону материала, чтобы не дублировать изнанку
  useMemo(() => prepareMaterials(scene), [scene])

  const [hoveredId, setHoveredId] = useState(null)
  const hoveredRef = useRef(null)

  useLayoutEffect(() => {
    scene.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      o.receiveShadow = true
    })

  }, [scene])

  useEffect(() => {
    const loader = new TextureLoader()
    const anisotropy = gl.capabilities.getMaxAnisotropy() // принт не мылится, когда куртка повёрнута
    const loaded = []
    for (const [name, url] of JACKET_TEXTURES) {
      const mesh = scene.getObjectByName(name)
      if (!mesh?.isMesh) continue
      loader.load(url, (texture) => {
        texture.flipY = false // развёртка в координатах glTF
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = anisotropy
        mesh.material.map = texture
        mesh.material.needsUpdate = true
        loaded.push(texture)
      })
    }
    return () => loaded.forEach((texture) => texture.dispose())
  }, [scene, gl])

  useLayoutEffect(() => {
    if (!camera) return
    camera.aspect = size.width / size.height
    camera.fov = fov
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    set({ camera })
  }, [camera, scene, size, fov, set])

  // Имена в объекты — один раз. Отсутствующие пропускаем: переименование в Блендере
  // не должно ронять сцену.
  const targets = useMemo(() => {
    return TARGETS.map(({ id, meshes, zoom, pitch }) => ({
      id,
      zoom: zoom ?? 1,
      pitch: pitch ?? 0,
      objects: meshes.map((name) => scene.getObjectByName(name)).filter((o) => o?.isMesh),
    })).filter((t) => t.objects.length > 0)
  }, [scene])

  // Габариты целей для клика и наведения, с запасом в 15% размера: на телефоне куртка шириной
  // в палец, и тап между рукавом и полой уходил мимо. Наведение по тем же коробкам — курсор-палец
  // совпадает с зоной клика. Считаются в покое: на общем плане куртка не крутится.
  const hitBoxes = useMemo(
    () => targets.map(({ id, objects }) => {
      const box = new Box3()
      for (const o of objects) meshBox(o, box)
      return { id, box: box.expandByVector(box.getSize(new Vector3()).multiplyScalar(0.15)) }
    }),
    [targets],
  )

  // Исходная поза — камера из Блендера. Ось параллакса — на глубине первой цели:
  // товар почти стоит на месте, стены за ним и рама перед ним расходятся в стороны.
  const home = useMemo(() => {
    if (!camera) return null
    camera.updateMatrixWorld(true)
    const forward = camera.getWorldDirection(new Vector3())
    const box = new Box3().setFromObject(scene)

    let depth = 0
    const targetCenter = new Vector3()
    if (targets[0]) {
      const target = new Box3()
      for (const o of targets[0].objects) meshBox(o, target)
      target.getCenter(targetCenter)
      depth = Math.max(_v.copy(targetCenter).sub(camera.position).dot(forward), 0)
    }

    // Расширенный под узкий экран угол прирастает вверх и вниз; снизу — пустота перед
    // рамой, поэтому наклоняем камеру вверх на долю прироста. Вокруг горизонтальной оси,
    // перпендикулярной взгляду, а не локальной X камеры — та даёт крен.
    const quaternion = camera.quaternion.clone()
    const tilt = ((fov - baseFovRef.current) * Math.PI * TILT_SHARE) / 360
    if (tilt > 0) {
      const axis = new Vector3().crossVectors(forward, _up).normalize()
      if (axis.lengthSq() > 0) quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, tilt))
    }

    const narrow = size.width < NARROW
    const position = camera.position.clone().addScaledVector(forward, narrow ? depth * NARROW_DOLLY : 0)
    let pivot = camera.position.clone().addScaledVector(forward, depth)

    // На узком экране кадр автора срезан по бокам, и товар оказывался на трети ширины, у края.
    // Поворачиваем камеру по горизонтали прямо на него — вокруг мировой вертикали, без крена;
    // ось параллакса ставим на сам товар, чтобы он стоял на месте, а стены расходились вокруг.
    if (narrow && targets[0]) {
      const look = forward.clone().setY(0)
      const to = targetCenter.clone().sub(position).setY(0)
      const yaw = Math.atan2(look.z * to.x - look.x * to.z, look.dot(to)) // знаковый угол от look к to вокруг +Y
      quaternion.premultiply(new Quaternion().setFromAxisAngle(_up, yaw))
      pivot = targetCenter.clone()
    }

    return {
      position,
      quaternion,
      pivot,
      radius: box.getSize(new Vector3()).length() / 2,
    }
  }, [scene, camera, fov, targets, size.width])

  // Геометрия контура — один раз для всех целей. В сцену не добавляем здесь:
  // побочные действия в useMemo ломаются на StrictMode.
  const outlineParts = useMemo(() => {
    const parts = []
    if (!home || !camera) return parts

    const halfFov = (fov * Math.PI) / 360
    const unitsPerPixel = (distance) => (2 * distance * Math.tan(halfFov)) / size.height

    for (const { id, objects } of targets) {
      for (const mesh of objects) {
        // Изнанка повторяет геометрию лица — вторая оболочка легла бы ровно поверх первой
        if (mesh.material.side === BackSide) continue

        // Сшиваем вершины и пересчитываем нормали, иначе раздутая копия расходится по
        // рёбрам. Перед сшивкой оставляем только позиции — разница в UV мешает слиянию.
        const source = mesh.geometry.clone()
        for (const name of Object.keys(source.attributes)) {
          if (name !== 'position') source.deleteAttribute(name)
        }
        const geometry = mergeVertices(source)
        geometry.computeVertexNormals()
        geometry.computeBoundingSphere()
        source.dispose()

        mesh.updateWorldMatrix(true, false)
        const worldScale = _v.setFromMatrixScale(mesh.matrixWorld)
        const scale = (worldScale.x + worldScale.y + worldScale.z) / 3 || 1

        const center = geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld)
        const perPixel = unitsPerPixel(center.distanceTo(home.position))
        const screenRadius = (geometry.boundingSphere.radius * scale) / perPixel
        const pixels = Math.min(OUTLINE_PX, screenRadius * OUTLINE_MAX_RATIO)
        const thickness = (pixels * perPixel) / scale

        const position = geometry.attributes.position
        const normal = geometry.attributes.normal
        for (let i = 0; i < position.count; i++) {
          position.setXYZ(
            i,
            position.getX(i) + normal.getX(i) * thickness,
            position.getY(i) + normal.getY(i) * thickness,
            position.getZ(i) + normal.getZ(i) * thickness,
          )
        }
        position.needsUpdate = true
        geometry.computeBoundingSphere()

        parts.push({ id, parent: mesh, geometry })
      }
    }
    return parts
  }, [targets, home, camera, size, fov])

  useEffect(() => () => {
    for (const part of outlineParts) part.geometry.dispose()
  }, [outlineParts])

  useEffect(() => {
    if (!hoveredId || focusedId) return undefined
    const parts = outlineParts.filter((part) => part.id === hoveredId)
    if (!parts.length) return undefined

    const material = new MeshBasicMaterial({
      color: OUTLINE_COLOR,
      side: BackSide, // видно только то, что выступает за силуэт
      toneMapped: false, // тонемаппинг притушил бы кислотный зелёный
    })

    const added = []
    for (const { parent, geometry } of parts) {
      const outline = new Mesh(geometry, material)
      outline.castShadow = false
      outline.receiveShadow = false
      outline.raycast = () => {} // иначе луч наведения попадает в саму обводку и она мигает
      parent.add(outline)
      added.push(outline)
    }

    return () => {
      for (const outline of added) outline.removeFromParent()
      material.dispose()
    }
  }, [hoveredId, focusedId, outlineParts])

  // Приближённая поза на каждую цель: отходим вдоль исходного направления взгляда
  // ровно настолько, чтобы группа влезла в кадр. Зависит от аспекта — пересчёт на ресайз.
  const focusById = useMemo(() => {
    const map = new Map()
    if (!home || !camera) return map

    const aspect = size.width / size.height
    const halfFov = (fov * Math.PI) / 360

    for (const { id, objects, zoom, pitch } of targets) {
      const box = new Box3()
      for (const o of objects) meshBox(o, box)
      if (box.isEmpty()) continue

      const center = box.getCenter(new Vector3())
      const extent = box.getSize(new Vector3())

      // По вертикали и горизонтали нужны разные дистанции — берём большую. Глубину
      // не учитываем: куртка крутится, и её ширина на экране — это max(x, z).
      const across = Math.max(extent.x, extent.z)
      const byHeight = extent.y / 2 / Math.tan(halfFov)
      const byWidth = across / 2 / (Math.tan(halfFov) * aspect)
      const distance = Math.max(byHeight, byWidth) + across / 2

      const dir = home.position.clone().sub(center).normalize()
      if (pitch) {
        const axis = new Vector3().crossVectors(dir, _up).normalize()
        if (axis.lengthSq() > 0) dir.applyAxisAngle(axis, (pitch * Math.PI) / 180).normalize()
      }

      if (size.width >= NARROW) {
        map.set(id, { center, dir, distance: distance * zoom, lift: 0, exact: false })
        continue
      }

      // Узкий экран: вписываем товар в его зону. Высота кадра на расстоянии d — 2·d·tg(½ угла),
      // товару по высоте достаётся доля зоны, по ширине — весь экран. lift — на сколько опустить
      // точку взгляда на единицу дистанции, чтобы товар встал в центр зоны, а не экрана.
      const t = Math.tan(halfFov)
      const H = size.height
      const zoneH = Math.max(H - CARD_ZONES.top - CARD_ZONES.hint - CARD_ZONES.text * H - CARD_ZONES.bar, H * 0.2)
      const fit = Math.max(extent.y / 2 / (t * (zoneH / H)), across / 2 / (t * aspect)) / ZONE_FILL
      const lift = (0.5 - (CARD_ZONES.top + zoneH / 2) / H) * 2 * t
      map.set(id, { center, dir, distance: fit, lift, exact: true })
    }
    return map
  }, [targets, home, camera, size, fov])

  const focus = focusedId ? (focusById.get(focusedId) ?? null) : null

  // Вращение куртки. Исходные повороты запоминаем, угол накладываем поверх вокруг
  // мировой вертикали. На общем плане куртка плавно возвращается в исходное положение.
  const spun = useMemo(
    () => SPUN.map((name) => scene.getObjectByName(name)).filter(Boolean)
      .map((object) => ({ object, base: object.quaternion.clone() })),
    [scene],
  )
  const spin = useRef({ angle: 0, goal: 0, dragX: null, autoAt: Infinity, stale: false, tick: 0 })

  useEffect(() => {
    const s = spin.current
    if (focusedId !== 'jacket') {
      // К ближайшему целому обороту, а не к нулю: после трёх оборотов куртка иначе
      // раскручивалась бы назад все три
      s.goal = Math.round(s.angle / (2 * Math.PI)) * 2 * Math.PI
      s.dragX = null
      s.autoAt = Infinity
      return undefined
    }
    s.autoAt = performance.now() + AUTO_SPIN_START
    const canvas = gl.domElement
    const down = (e) => { s.dragX = e.clientX }
    const move = (e) => {
      if (s.dragX == null) return
      s.goal += (e.clientX - s.dragX) * SPIN_PER_PX
      s.dragX = e.clientX
    }
    const up = () => {
      if (s.dragX != null) s.autoAt = performance.now() + AUTO_SPIN_RESUME
      s.dragX = null
    }
    canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [focusedId, gl])

  // Наведение — собственным лучом каждый кадр, а не событиями R3F: курсор может стоять,
  // пока камера едет от параллакса, и объект уплывает из-под него без событий.
  const raycaster = useMemo(() => new Raycaster(), [])
  const pointerInside = useRef(false)
  const getState = useThree((s) => s.get)

  useEffect(() => {
    const canvas = gl.domElement
    // Наведение — только мышью. Включаем и от движения, а не только от входа в холст: если страница
    // загрузилась под курсором, события «вошёл» не будет, и куртка не подсвечивалась до выхода и входа.
    const move = (e) => { pointerInside.current = e.pointerType === 'mouse' }
    const leave = () => { pointerInside.current = false }

    // Клик решаем своим лучом ровно в точке нажатия, по габаритам целей (hitBoxes). Раньше решение бралось
    // из наведения: у тапа без движения точка наведения старая, и клик уходил мимо. А обработчик R3F
    // на всей сцене гонял луч по ~200 тыс. треугольников на каждое движение пальца и мыши.
    const click = (e) => {
      if (focusedId) return
      const rect = canvas.getBoundingClientRect()
      _ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(_ndc, getState().camera)
      const hit = hitBoxes.find(({ box }) => raycaster.ray.intersectsBox(box))
      if (hit) onFocus(hit.id)
    }

    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('click', click)
    return () => {
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('click', click)
    }
  }, [gl, focusedId, hitBoxes, raycaster, getState, onFocus])

  useFrame((state, delta) => {
    const s = spin.current
    // Сама крутится, пока человек не взялся за неё; после отпускания — пауза и снова
    if (!REDUCED_MOTION && s.dragX == null && performance.now() > s.autoAt) s.goal += AUTO_SPIN * delta

    const moving = Math.abs(s.goal - s.angle) > 1e-4
    if (moving) {
      s.angle += (s.goal - s.angle) * (1 - Math.pow(1 - 0.15, delta * 60))
      _spin.setFromAxisAngle(_up, s.angle)
      for (const { object, base } of spun) object.quaternion.copy(base).premultiply(_spin)
      s.stale = true
    }
    // Тень куртки на стене поворачивается вместе с ней. Пока крутится — раз в несколько кадров
    // (quality.js): при непрерывном вращении пересчёт карт теней каждый кадр дорог на телефоне.
    // Остановилась — досчитываем сразу, чтобы тень не застыла в промежуточном положении.
    if (s.stale && (!moving || ++s.tick % QUALITY.shadowEvery === 0)) {
      gl.shadowMap.needsUpdate = true
      s.stale = false
    }

    let active = null
    if (!focusedId && pointerInside.current) {
      raycaster.setFromCamera(state.pointer, state.camera)
      active = hitBoxes.find(({ box }) => raycaster.ray.intersectsBox(box))?.id ?? null
    }

    if (active !== hoveredRef.current) {
      hoveredRef.current = active
      setHoveredId(active)
    }
  })

  // Курсор-палец над кликабельным объектом, «рука» над курткой в режиме вращения
  useEffect(() => {
    const cursor = hoveredId ? 'pointer' : focusedId === 'jacket' ? 'grab' : ''
    document.body.style.cursor = cursor
    return () => {
      document.body.style.cursor = ''
    }
  }, [hoveredId, focusedId])

  return (
    <>
      <primitive object={scene} />
      {/* Дымка и постобработка процессору не по силам — там обычный рендер */}
      {!SOFTWARE_RENDERER && <Effects paramsRef={paramsRef} model={scene} focused={!!focusedId} />}
      {home && (
        <>
          <SceneLights paramsRef={paramsRef} scene={scene} radius={home.radius} />
          <CameraRig
            paramsRef={paramsRef}
            home={home}
            focus={focus}
            focused={!!focusedId}
            onArrive={onArrive}
          />
        </>
      )}
    </>
  )
}

export default function Scene({ paramsRef, focusedId, onFocus, onArrive }) {
  // Потолок плотности пикселей — по уровню качества (quality.js); если кадр всё равно не успевает,
  // PerformanceMonitor опускает его до 1. Обратно не поднимаем: мигание резкости хуже мыла.
  const [maxDpr, setMaxDpr] = useState(QUALITY.maxDpr)

  return (
    <Canvas
      style={{ width: '100%', height: '100dvh' }}
      dpr={SOFTWARE_RENDERER ? 1 : [1, maxDpr]}
      // R3F 9 умеет асинхронную фабрику рендерера — там выбирается WebGPU или WebGL2
      gl={(props) =>
        // Сглаживает FXAA в постобработке (Effects.jsx) — у холста оно лишнее
        createRenderer({ ...props, antialias: false, powerPreference: 'high-performance' })
      }
      // Блендер рендерит в AgX — тот же тонемаппинг, иначе кадр расходится по контрасту
      onCreated={({ gl }) => { gl.toneMapping = AgXToneMapping }}
      // Явно: сокращение shadows выставляет PCFSoftShadowMap, которого в three уже нет
      shadows={{ type: PCFShadowMap }}
    >
      <Suspense fallback={null}>
        <Model paramsRef={paramsRef} focusedId={focusedId} onFocus={onFocus} onArrive={onArrive} />
      </Suspense>
      <AmbientLight paramsRef={paramsRef} />
      <FillLight paramsRef={paramsRef} focused={!!focusedId} />
      <PerformanceMonitor onDecline={() => setMaxDpr(1)} />
    </Canvas>
  )
}

useGLTF.preload(MODEL, DRACO)
