# Экспорт сцены товара из Блендера: public/scene-<товар>.glb и текстуры товара.
#   npm run scene  (все товары по очереди)
#   blender -b Jacket.blend --python scripts/export-scene.py -- public/scene-hoodie.glb hoodie
# Правки делаются только в памяти — .blend не сохраняется и не меняется.
#
# Все вещи стоят в одной сцене Jacket.blend на одном месте (куртка, худи). Сцена товара — это
# комната с одной вещью: остальные вещи удаляем, шест и крючок перевешиваем на оставшуюся.
import bpy, math, os, sys
import numpy as np

out, product = sys.argv[sys.argv.index('--') + 1:][:2]

# object — объект в .blend, name — имя в GLB (по нему его ищет Scene.jsx, products.js),
# front/back — картинки лицевой стороны и изнанки из материала с Mix Shader по Backfacing
GARMENTS = {
    'jacket': {'object': 'Jacket', 'name': 'Jacket', 'front': 'Jacket Texture.png.001', 'back': 'Jacket Texture Back.png'},
    'hoodie': {'object': 'Plane.002', 'name': 'Hoodie', 'front': 'hoodie texture.png', 'back': 'hoodie texture(back).png'},
}
garment = GARMENTS[product]
hanger = bpy.data.objects[GARMENTS['jacket']['object']]  # шест и крючок — дети куртки
keep = bpy.data.objects[garment['object']]
for child in list(hanger.children):
    if keep is not hanger:
        world = child.matrix_world.copy()
        child.parent = keep
        child.matrix_world = world  # перевешиваем, не сдвигая: шест крутится вместе с вещью
for other in GARMENTS.values():
    obj = bpy.data.objects[other['object']]
    if obj is not keep:
        bpy.data.objects.remove(obj, do_unlink=True)
keep.name = garment['name']

# glTF не знает area-ламп — экспортёр их молча выкидывает. Меняем на прожектор с конусом
# в полусферу: светит так же вниз и в стороны. Мощность ×4: экспортёр делит ватты
# прожектора на 4π (как у точечного), а у площадной лампы сила света по нормали — P/π.
for o in bpy.data.objects:
    if o.type == 'LIGHT' and o.data.type == 'AREA':
        o.data.type = 'SPOT'
        o.data.energy *= 4
        o.data.spot_size = math.pi
        o.data.spot_blend = 1.0

# Вещь в Блендере — один материал, где Mix Shader по Backfacing выбирает лицевую или
# изнаночную текстуру. В glTF такого нет. Делим на два объекта: <Имя> с лицевой текстурой
# и <Имя>Back с изнанкой; сцена рисует первый только лицом, второй — только изнанкой.
def textured(name, image):
    m = bpy.data.materials.new(name)
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 1.0
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images[image]
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return m

# У текстур вещей есть альфа, но в материале она не подключена: Блендер показывает цвет
# под прозрачными пикселями. Сжатие WebP этот цвет выбрасывает — куртка выходила белой.
for name in (garment['front'], garment['back']):
    bpy.data.images[name].alpha_mode = 'NONE'

# Текстуры вещи — сам товар. Общее WebP-сжатие GLB срезало резкость принта на 14%, поэтому
# пишем их ещё и отдельными файлами: лицо без потерь (quality 100 у Блендера = lossless), изнанку q95.
# Сцена подменяет ими сжатые копии из GLB (products.js, textures); те остаются запасными.
# Альфу выбрасываем: в материале она не подключена, а браузер под нулевой альфой теряет цвет.
textures_dir = os.path.join(os.path.dirname(os.path.abspath(out)), 'textures')
os.makedirs(textures_dir, exist_ok=True)
for name, file, quality in (
    (garment['front'], f'{product}-front.webp', 100),
    (garment['back'], f'{product}-back.webp', 95),
):
    src = bpy.data.images[name]
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    px[3::4] = 1.0
    dst = bpy.data.images.new(file, w, h, alpha=False)
    dst.colorspace_settings.name = src.colorspace_settings.name
    dst.pixels.foreach_set(px)
    dst.file_format = 'WEBP'
    dst.filepath_raw = os.path.join(textures_dir, file)
    dst.save(quality=quality)

name = garment['name']
back = keep.copy()
back.data = keep.data.copy()
back.name = name + 'Back'
back.data.materials[0] = textured(name + 'Back', garment['back'])
keep.data.materials[0] = textured(name + 'Front', garment['front'])
for c in keep.users_collection:
    c.objects.link(back)

# Меш без материала Блендер рисует серым 0.8, а glTF по умолчанию белым — дверь выходила
# заметно ярче рендера. Даём таким мешам тот же серый явно.
default_gray = bpy.data.materials.new('Default')
default_gray.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1)
for o in bpy.context.scene.objects:
    if o.type == 'MESH' and not any(s.material for s in o.material_slots):
        o.data.materials.append(default_gray)

# Процедурные материалы (камень, гранит, резина, сталь) — группы нод, glTF их не понимает
# и отдаёт серый дефолт. У каждой группы есть выходы «Color Bake», «Roughness Bake» и
# «Metallic Bake» — запекаем их в текстуры по свежей развёртке и собираем обычный Principled.
#
# Развёртка своя: у стен и пола исходные UV накладываются друг на друга (фаски, массивы),
# запекание в них смешало бы грани.
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1  # запекаем излучение без света — шума нет, лишние сэмплы только сглаживают
scene.render.bake.margin = 8

def bake_group(mat):
    for n in mat.node_tree.nodes:
        if n.type == 'GROUP' and 'Color Bake' in n.outputs:
            return n
    return None

# По средней стороне, а не по длинной: трос длинный, но тонкий — ему хватает 512
def texture_size(obj):
    size = sorted(obj.dimensions)[1]
    return 2048 if size > 10 else 1024 if size > 2 else 512

def bake_pass(obj, mat, group, socket, size, color):
    img = bpy.data.images.new(f'{obj.name} {socket}', size, size)
    img.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = img
    nodes.active = tex  # запекание пишет в активную картинку материала
    emit = nodes.new('ShaderNodeEmission')
    links.new(group.outputs[socket], emit.inputs['Color'])
    output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
    links.new(emit.outputs['Emission'], output.inputs['Surface'])
    bpy.ops.object.bake(type='EMIT', uv_layer='Bake')
    nodes.remove(emit)
    nodes.remove(tex)
    return img

meshes = [o for o in scene.objects if o.type == 'MESH']
hidden = {o: o.hide_render for o in meshes}
for obj in meshes:
    # Каждое запекание заново собирает сцену целиком — на 18 проходах это минуты.
    # Излучению соседи не нужны, прячем их на время запекания этого объекта.
    for other in meshes:
        other.hide_render = other is not obj

    slots = [s for s in obj.material_slots if s.material and bake_group(s.material)]
    if not slots:
        continue

    # Модификаторы применяем до развёртки: экспорт всё равно запекает их в меш
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    obj.modifiers.clear()
    obj.data = mesh

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mesh.uv_layers.active = mesh.uv_layers.new(name='Bake')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=0.002)
    bpy.ops.object.mode_set(mode='OBJECT')

    size = texture_size(obj)
    for slot in slots:
        # Материал общий у нескольких объектов (стены) — у каждого своя копия со своей текстурой
        src = slot.material
        mat = src.copy()
        slot.material = mat
        group = bake_group(mat)

        color = bake_pass(obj, mat, group, 'Color Bake', size, True)
        rough = bake_pass(obj, mat, group, 'Roughness Bake', size // 2, False)  # шероховатость плавная, хватит и половины
        metallic = 1.0 if 'Metallic Bake' in group.outputs and group.inputs.get('Metallic', None) and group.inputs['Metallic'].default_value > 0.5 else 0.0

        final = bpy.data.materials.new(src.name)
        nodes, links = final.node_tree.nodes, final.node_tree.links
        bsdf = nodes['Principled BSDF']
        bsdf.inputs['Metallic'].default_value = metallic
        for img, socket in ((color, 'Base Color'), (rough, 'Roughness')):
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = img
            uv = nodes.new('ShaderNodeUVMap')
            uv.uv_map = 'Bake'
            links.new(uv.outputs['UV'], tex.inputs['Vector'])
            links.new(tex.outputs['Color'], bsdf.inputs[socket])
        slot.material = final

    # Исходная развёртка больше не нужна — в GLB уйдёт только запечённая
    for layer in [l for l in mesh.uv_layers if l.name != 'Bake']:
        mesh.uv_layers.remove(layer)
    print('baked', obj.name, size)

for obj in meshes:
    obj.hide_render = hidden[obj]

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_apply=True,  # сабдив, фаски и Geometry Nodes запекаются в меш
    export_cameras=True,
    export_lights=True,
    export_yup=True,
    export_image_format='WEBP',
    export_draco_mesh_compression_enable=True,
)
