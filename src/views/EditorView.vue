<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  MousePointer2, Pencil, Square, Circle, Minus, MoveRight, Type,
  StickyNote, Undo2, Redo2, Trash2, Plus, Maximize2, ArrowLeft,
  Hand, Monitor, Smartphone, Tablet as TabletIcon, LayoutGrid, X,
  Copy, Scissors, CopyPlus
} from 'lucide-vue-next'
import { useProjectStore } from '../stores/projectStore'
import type { CanvasElement, DeviceType, ElementType, Screen } from '../types'
import logo from '../assets/icon.png'

type Tool = ElementType | 'select' | 'pan'
type Point = { x: number; y: number }
interface HistoryEntry {
  screenId: string
  elements: CanvasElement[]
}

const route = useRoute()
const router = useRouter()
const store = useProjectStore()

// State
const tool = ref<Tool>('select')
const allElements = ref<Record<string, CanvasElement[]>>({})
const activeScreenId = ref<string>('')
const selectedId = ref<string>()
const zoom = ref(0.75)
const pan = ref<Point>({ x: 100, y: 100 })
const saving = ref('Saved')
const isSpacePressed = ref(false)
const isWorkspacePanning = ref(false)
const panOrigin = ref<Point>({ x: 0, y: 0 })

// Tool defaults
const pencilColor = ref('#111111')
const strokeWidth = ref(3)
const opacity = ref(1)

// Pointer tracking
const activePointer = ref(false)
const startPoint = ref<Point>({ x: 0, y: 0 })
const dragMode = ref<'create' | 'move' | 'resize' | null>(null)
const currentDrawScreenId = ref<string>('')

// History & timers
const history = ref<HistoryEntry[]>([])
const redoHistory = ref<HistoryEntry[]>([])
const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {}

// Inline Screen Creation Modal
const showAddScreenModal = ref(false)
const newScreenName = ref('')
const newScreenDevice = ref<DeviceType>('iphone')
const newScreenCustomWidth = ref(640)
const newScreenCustomHeight = ref(840)

// Inline Screen Renaming
const editingScreenId = ref<string | null>(null)
const editingScreenName = ref('')

// Computed
const project = computed(() => store.projects.find((item) => item.id === route.params.projectId))
const projectScreens = computed(() => store.screens.filter((item) => item.projectId === route.params.projectId))

const activeScreen = computed(() => projectScreens.value.find((s) => s.id === activeScreenId.value) || projectScreens.value[0])
const activeElements = computed({
  get: () => (activeScreenId.value ? allElements.value[activeScreenId.value] || [] : []),
  set: (val: CanvasElement[]) => {
    if (activeScreenId.value) allElements.value[activeScreenId.value] = val
  }
})

const selected = computed(() => activeElements.value.find((item) => item.id === selectedId.value))

// Screen Canvas Layout
const SCREEN_GAP = 140
const screenLayout = computed(() => {
  let x = 80
  const list: { screen: Screen; x: number; y: number }[] = []
  for (const s of projectScreens.value) {
    list.push({ screen: s, x, y: 80 })
    x += s.width + SCREEN_GAP
  }
  return { items: list, addCardX: x, maxScreenHeight: Math.max(800, ...projectScreens.value.map(s => s.height)) }
})

const toolList: { key: Tool; label: string; icon: unknown }[] = [
  { key: 'select', label: 'Selection (V)', icon: MousePointer2 },
  { key: 'pan', label: 'Hand / Pan (H or Space)', icon: Hand },
  { key: 'path', label: 'Pencil (P)', icon: Pencil },
  { key: 'line', label: 'Line (L)', icon: Minus },
  { key: 'arrow', label: 'Arrow (A)', icon: MoveRight },
  { key: 'rectangle', label: 'Rectangle (R)', icon: Square },
  { key: 'circle', label: 'Circle (O)', icon: Circle },
  { key: 'text', label: 'Text (T)', icon: Type },
  { key: 'stickyNote', label: 'Sticky note (S)', icon: StickyNote }
]

const makeId = () => crypto.randomUUID()
const number = (value: unknown) => Number(value ?? 0)

function data(element: CanvasElement) {
  return element.data as Record<string, unknown>
}

function cloneElements(source: CanvasElement[]) {
  return JSON.parse(JSON.stringify(source)) as CanvasElement[]
}

function addHistory(screenId: string) {
  const current = allElements.value[screenId] ? cloneElements(allElements.value[screenId]) : []
  history.value.push({ screenId, elements: current })
  if (history.value.length > 50) history.value.shift()
  redoHistory.value = []
}

function scheduleSave(screenId: string) {
  saving.value = 'Saving…'
  if (saveTimers[screenId]) clearTimeout(saveTimers[screenId])
  saveTimers[screenId] = setTimeout(async () => {
    await store.saveElements(screenId, allElements.value[screenId] || [])
    saving.value = 'Saved'
  }, 500)
}

function getScreenSvg(screenId: string): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>(`[data-screen-svg="${screenId}"]`)
}

function getScreenCoords(screen: Screen, event: PointerEvent): Point {
  const svg = getScreenSvg(screen.id)
  if (!svg) return { x: 0, y: 0 }
  const rect = svg.getBoundingClientRect()
  const scaleX = rect.width / screen.width
  const scaleY = rect.height / screen.height
  return {
    x: Math.max(0, Math.min(screen.width, (event.clientX - rect.left) / scaleX)),
    y: Math.max(0, Math.min(screen.height, (event.clientY - rect.top) / scaleY))
  }
}

function newElement(type: ElementType, screenId: string, position: Point): CanvasElement {
  const now = Date.now()
  return {
    id: makeId(),
    screenId,
    type,
    createdAt: now,
    updatedAt: now,
    data: {
      x: position.x,
      y: position.y,
      width: type === 'stickyNote' ? 180 : type === 'text' ? 180 : 0,
      height: type === 'stickyNote' ? 110 : type === 'text' ? 32 : 0,
      x2: position.x,
      y2: position.y,
      points: `${position.x},${position.y}`,
      color: pencilColor.value,
      fill: type === 'rectangle' || type === 'circle' ? '#4F46E5' : 'transparent',
      fillOpacity: 1,
      stroke: pencilColor.value,
      strokeWidth: strokeWidth.value,
      opacity: opacity.value,
      borderRadius: 8,
      rotation: 0,
      text: type === 'stickyNote' ? 'New note' : 'Type here',
      title: type === 'stickyNote' ? 'Note' : '',
      fontSize: 16,
      fontWeight: 400,
      editing: type === 'text' || type === 'stickyNote'
    }
  }
}

// Text in-place editing state
let lastClickTime = 0
let lastClickElementId = ''

function startTextEdit(element: CanvasElement) {
  // Exit edit mode on any other element
  for (const sId in allElements.value) {
    allElements.value[sId].forEach((el) => {
      if (el.id !== element.id && data(el).editing) {
        data(el).editing = false
      }
    })
  }

  data(element).editing = true
  selectedId.value = element.id
  activeScreenId.value = element.screenId

  nextTick(() => {
    const el = document.querySelector<HTMLTextAreaElement>(`[data-edit-id="${element.id}"]`)
    if (el) {
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    }
  })
}

function finishTextEdit(element: CanvasElement) {
  data(element).editing = false
  if (!String(data(element).text || '').trim()) {
    data(element).text = 'Type here'
  }
  scheduleSave(element.screenId)
}

function onTextInput(element: CanvasElement, event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  if (!textarea) return
  data(element).text = textarea.value

  // Auto expand height & width if needed (Figma-like auto resize)
  textarea.style.height = 'auto'
  const scrollHeight = textarea.scrollHeight
  if (scrollHeight > number(data(element).height) - 8) {
    data(element).height = Math.max(32, scrollHeight + 10)
  }

  const lines = textarea.value.split('\n')
  const maxLen = Math.max(...lines.map((l) => l.length))
  const fontSize = number(data(element).fontSize) || 16
  const estimatedWidth = Math.max(140, Math.min(800, maxLen * fontSize * 0.65 + 30))
  if (estimatedWidth > number(data(element).width)) {
    data(element).width = estimatedWidth
  }
  updateProperty()
}

function onTextKeydown(element: CanvasElement, event: KeyboardEvent) {
  if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === 'Enter')) {
    event.preventDefault()
    finishTextEdit(element)
  }
}

// Drawing & Element Interaction
function screenDown(screen: Screen, event: PointerEvent) {
  activeScreenId.value = screen.id
  currentDrawScreenId.value = screen.id

  if (tool.value === 'pan' || isSpacePressed.value || event.button === 1) {
    startWorkspacePan(event)
    return
  }

  if (tool.value === 'select') {
    // If clicking outside while editing, close editing
    if (selected.value && data(selected.value).editing) {
      finishTextEdit(selected.value)
    }
    selectedId.value = undefined
    return
  }

  // Draw tools
  const p = getScreenCoords(screen, event)
  addHistory(screen.id)
  if (!allElements.value[screen.id]) allElements.value[screen.id] = []

  if (tool.value === 'text' || tool.value === 'stickyNote') {
    const el = newElement(tool.value, screen.id, p)
    allElements.value[screen.id].push(el)
    tool.value = 'select' // Return to select tool like Figma
    scheduleSave(screen.id)
    startTextEdit(el)
    return
  }

  const el = newElement(tool.value as ElementType, screen.id, p)
  allElements.value[screen.id].push(el)
  selectedId.value = el.id
  startPoint.value = p
  activePointer.value = true
  dragMode.value = 'create'
  getScreenSvg(screen.id)?.setPointerCapture(event.pointerId)
}

function elementDown(screen: Screen, element: CanvasElement, event: PointerEvent) {
  if (tool.value !== 'select' || isSpacePressed.value || event.button === 1) return
  if (data(element).editing) return // Don't drag while actively editing text!
  event.stopPropagation()
  activeScreenId.value = screen.id
  currentDrawScreenId.value = screen.id

  const now = Date.now()
  if (element.type === 'text' || element.type === 'stickyNote') {
    if (lastClickElementId === element.id && now - lastClickTime < 350) {
      startTextEdit(element)
      return
    }
    lastClickTime = now
    lastClickElementId = element.id
  }

  if (selectedId.value !== element.id) {
    addHistory(screen.id)
  }
  selectedId.value = element.id
  startPoint.value = getScreenCoords(screen, event)
  activePointer.value = true
  dragMode.value = 'move'
  ;(event.currentTarget as SVGElement).setPointerCapture(event.pointerId)
}

function resizeDown(screen: Screen, event: PointerEvent) {
  if (!selected.value) return
  event.stopPropagation()
  addHistory(screen.id)
  activePointer.value = true
  dragMode.value = 'resize'
  ;(event.currentTarget as SVGRectElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  // 1. Workspace panning
  if (isWorkspacePanning.value) {
    pan.value = {
      x: event.clientX - panOrigin.value.x,
      y: event.clientY - panOrigin.value.y
    }
    return
  }

  // 2. Element drawing/transforming
  if (!activePointer.value || !currentDrawScreenId.value) return
  const currentScreen = projectScreens.value.find(s => s.id === currentDrawScreenId.value)
  if (!currentScreen) return

  const p = getScreenCoords(currentScreen, event)
  const el = selected.value
  if (!el) return
  const item = data(el)

  if (dragMode.value === 'create') {
    if (el.type === 'path') {
      item.points = `${String(item.points)} ${p.x},${p.y}`
    } else {
      item.x2 = p.x
      item.y2 = p.y
      item.width = Math.max(10, Math.abs(p.x - startPoint.value.x))
      item.height = Math.max(10, Math.abs(p.y - startPoint.value.y))
      item.x = Math.min(p.x, startPoint.value.x)
      item.y = Math.min(p.y, startPoint.value.y)
    }
  } else if (dragMode.value === 'move') {
    const dx = p.x - startPoint.value.x
    const dy = p.y - startPoint.value.y
    translate(el, dx, dy, currentScreen)
    startPoint.value = p
  } else if (dragMode.value === 'resize') {
    item.width = Math.max(16, p.x - number(item.x))
    item.height = Math.max(16, p.y - number(item.y))
    item.x2 = number(item.x) + number(item.width)
    item.y2 = number(item.y) + number(item.height)
  }
}

function onPointerUp(event?: PointerEvent) {
  if (isWorkspacePanning.value) {
    isWorkspacePanning.value = false
  }

  if (activePointer.value) {
    if (currentDrawScreenId.value) {
      const surface = getScreenSvg(currentDrawScreenId.value)
      if (event && surface?.hasPointerCapture(event.pointerId)) {
        surface.releasePointerCapture(event.pointerId)
      }
      scheduleSave(currentDrawScreenId.value)
    }
    activePointer.value = false
    dragMode.value = null
  }
}

function translate(element: CanvasElement, dx: number, dy: number, screen: Screen) {
  const item = data(element)
  item.x = Math.max(0, Math.min(screen.width - 10, number(item.x) + dx))
  item.y = Math.max(0, Math.min(screen.height - 10, number(item.y) + dy))
  item.x2 = number(item.x2) + dx
  item.y2 = number(item.y2) + dy
  if (element.type === 'path') {
    item.points = String(item.points)
      .split(' ')
      .map((pair) => {
        const [px, py] = pair.split(',').map(Number)
        return `${px + dx},${py + dy}`
      })
      .join(' ')
  }
}

// Workspace Panning & Zooming
function startWorkspacePan(event: PointerEvent) {
  isWorkspacePanning.value = true
  panOrigin.value = {
    x: event.clientX - pan.value.x,
    y: event.clientY - pan.value.y
  }
}

function workspacePointerDown(event: PointerEvent) {
  // If clicked directly on the workspace background or with middle click or pan tool
  if (
    event.button === 1 ||
    tool.value === 'pan' ||
    isSpacePressed.value ||
    (event.target as HTMLElement).classList.contains('workspace') ||
    (event.target as HTMLElement).classList.contains('canvas-world')
  ) {
    startWorkspacePan(event)
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
}

function onWheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    const zoomFactor = event.deltaY < 0 ? 1.12 : 0.89
    const newZoom = Math.max(0.15, Math.min(3, zoom.value * zoomFactor))
    const mouseX = event.clientX
    const mouseY = event.clientY

    pan.value = {
      x: mouseX - (mouseX - pan.value.x) * (newZoom / zoom.value),
      y: mouseY - (mouseY - pan.value.y) * (newZoom / zoom.value)
    }
    zoom.value = newZoom
  } else {
    // Normal wheel pans
    if (event.shiftKey) {
      pan.value.x -= event.deltaY || event.deltaX
    } else {
      pan.value.x -= event.deltaX
      pan.value.y -= event.deltaY
    }
  }
}

// Fit functions
function fitAll() {
  if (!projectScreens.value.length) return
  const availableWidth = window.innerWidth - 300
  const availableHeight = window.innerHeight - 120
  const totalWidth = screenLayout.value.addCardX + 160
  const maxHeight = screenLayout.value.maxScreenHeight + 200

  const scaleX = availableWidth / totalWidth
  const scaleY = availableHeight / maxHeight
  const targetZoom = Math.max(0.2, Math.min(1.0, Math.min(scaleX, scaleY)))

  zoom.value = targetZoom
  pan.value = {
    x: Math.max(40, (availableWidth - totalWidth * targetZoom) / 2 + 50),
    y: Math.max(40, (availableHeight - maxHeight * targetZoom) / 2 + 60)
  }
}

function focusScreen(screenId: string) {
  activeScreenId.value = screenId
  const item = screenLayout.value.items.find((it) => it.screen.id === screenId)
  if (!item) return
  const targetX = window.innerWidth / 2 - (item.x + item.screen.width / 2) * zoom.value
  const targetY = window.innerHeight / 2 - (item.y + item.screen.height / 2) * zoom.value
  pan.value = { x: targetX, y: targetY }
}

// Undo & Redo
function undo() {
  const last = history.value.pop()
  if (!last) return
  const current = allElements.value[last.screenId] ? cloneElements(allElements.value[last.screenId]) : []
  redoHistory.value.push({ screenId: last.screenId, elements: current })
  allElements.value[last.screenId] = last.elements
  activeScreenId.value = last.screenId
  selectedId.value = undefined
  scheduleSave(last.screenId)
}

function redo() {
  const next = redoHistory.value.pop()
  if (!next) return
  const current = allElements.value[next.screenId] ? cloneElements(allElements.value[next.screenId]) : []
  history.value.push({ screenId: next.screenId, elements: current })
  allElements.value[next.screenId] = next.elements
  activeScreenId.value = next.screenId
  selectedId.value = undefined
  scheduleSave(next.screenId)
}

function deleteSelected() {
  if (!selectedId.value || !activeScreenId.value) return
  addHistory(activeScreenId.value)
  allElements.value[activeScreenId.value] = activeElements.value.filter((el) => el.id !== selectedId.value)
  selectedId.value = undefined
  scheduleSave(activeScreenId.value)
}

// Copy, Cut, Paste, Duplicate
const copiedElement = ref<CanvasElement | null>(null)

function copySelected() {
  if (!selected.value) return
  copiedElement.value = JSON.parse(JSON.stringify(selected.value)) as CanvasElement
  try {
    const payload = JSON.stringify({
      wirebook: true,
      element: copiedElement.value
    })
    navigator.clipboard?.writeText?.(payload)
  } catch {}
}

function cutSelected() {
  if (!selected.value || !activeScreenId.value) return
  copySelected()
  deleteSelected()
}

function duplicateSelected() {
  if (!selected.value || !activeScreenId.value) return
  addHistory(activeScreenId.value)
  const clone = JSON.parse(JSON.stringify(selected.value)) as CanvasElement
  clone.id = makeId()
  clone.screenId = activeScreenId.value
  clone.createdAt = Date.now()
  clone.updatedAt = Date.now()
  const d = clone.data
  d.x = number(d.x) + 20
  d.y = number(d.y) + 20
  d.x2 = number(d.x2) + 20
  d.y2 = number(d.y2) + 20
  if (clone.type === 'path' && d.points) {
    d.points = String(d.points)
      .split(' ')
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number)
        return `${x + 20},${y + 20}`
      })
      .join(' ')
  }
  allElements.value[activeScreenId.value].push(clone)
  selectedId.value = clone.id
  scheduleSave(activeScreenId.value)
}

function pasteElement(source: CanvasElement) {
  if (!activeScreen.value) return
  const currentScreen = activeScreen.value
  const clone = JSON.parse(JSON.stringify(source)) as CanvasElement
  clone.id = makeId()
  clone.screenId = currentScreen.id
  clone.createdAt = Date.now()
  clone.updatedAt = Date.now()
  const d = clone.data
  d.x = Math.min(currentScreen.width - 20, number(d.x) + 20)
  d.y = Math.min(currentScreen.height - 20, number(d.y) + 20)
  d.x2 = number(d.x2) + 20
  d.y2 = number(d.y2) + 20
  if (clone.type === 'path' && d.points) {
    d.points = String(d.points)
      .split(' ')
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number)
        return `${x + 20},${y + 20}`
      })
      .join(' ')
  }
  addHistory(currentScreen.id)
  if (!allElements.value[currentScreen.id]) allElements.value[currentScreen.id] = []
  allElements.value[currentScreen.id].push(clone)
  selectedId.value = clone.id
  scheduleSave(currentScreen.id)
}

function pasteInternalElement() {
  if (copiedElement.value) {
    pasteElement(copiedElement.value)
  }
}

async function handlePaste(event: ClipboardEvent) {
  if (isFormField(event.target)) return
  if (!activeScreen.value) return
  const currentScreen = activeScreen.value

  // 1. Check for clipboard image files
  if (event.clipboardData?.items) {
    for (const item of Array.from(event.clipboardData.items)) {
      if (item.type.startsWith('image/')) {
        event.preventDefault()
        const file = item.getAsFile()
        if (file) {
          const reader = new FileReader()
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string
            if (!dataUrl) return
            const img = new Image()
            img.onload = () => {
              const maxW = Math.min(360, currentScreen.width * 0.8)
              const scale = img.width > maxW ? maxW / img.width : 1
              const w = Math.round(img.width * scale)
              const h = Math.round(img.height * scale)
              const newEl: CanvasElement = {
                id: makeId(),
                screenId: currentScreen.id,
                type: 'image',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                data: {
                  x: Math.round((currentScreen.width - w) / 2),
                  y: Math.round((currentScreen.height - h) / 2),
                  width: w,
                  height: h,
                  src: dataUrl,
                  opacity: 1,
                  rotation: 0
                }
              }
              addHistory(currentScreen.id)
              if (!allElements.value[currentScreen.id]) allElements.value[currentScreen.id] = []
              allElements.value[currentScreen.id].push(newEl)
              selectedId.value = newEl.id
              scheduleSave(currentScreen.id)
            }
            img.src = dataUrl
          }
          reader.readAsDataURL(file)
          return
        }
      }
    }
  }

  // 2. Check for text data
  const text = event.clipboardData?.getData('text/plain') || ''
  if (!text) {
    if (copiedElement.value) {
      event.preventDefault()
      pasteInternalElement()
    }
    return
  }

  // A) JSON Wirebook Element
  try {
    const parsed = JSON.parse(text)
    if (parsed && (parsed.wirebook || parsed.type === 'wirebook-element') && parsed.element) {
      event.preventDefault()
      pasteElement(parsed.element)
      return
    }
  } catch {}

  // B) SVG Markup (Icons, vectors from Figma/Lucide/Web)
  const trimmed = text.trim()
  if (trimmed.startsWith('<svg') || (trimmed.includes('<svg') && trimmed.includes('</svg>'))) {
    event.preventDefault()
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(trimmed, 'image/svg+xml')
      const svgEl = doc.querySelector('svg')
      if (svgEl) {
        const viewBox = svgEl.getAttribute('viewBox') || '0 0 24 24'
        const rawW = parseFloat(svgEl.getAttribute('width') || '48') || 48
        const rawH = parseFloat(svgEl.getAttribute('height') || '48') || 48
        const width = Math.min(300, Math.max(32, rawW))
        const height = Math.min(300, Math.max(32, rawH))
        const innerContent = svgEl.innerHTML

        const newEl: CanvasElement = {
          id: makeId(),
          screenId: currentScreen.id,
          type: 'svg',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          data: {
            x: Math.round((currentScreen.width - width) / 2),
            y: Math.round((currentScreen.height - height) / 2),
            width,
            height,
            viewBox,
            svgContent: innerContent,
            stroke: pencilColor.value,
            fill: 'none',
            strokeWidth: 2,
            opacity: 1,
            rotation: 0
          }
        }
        addHistory(currentScreen.id)
        if (!allElements.value[currentScreen.id]) allElements.value[currentScreen.id] = []
        allElements.value[currentScreen.id].push(newEl)
        selectedId.value = newEl.id
        scheduleSave(currentScreen.id)
        return
      }
    } catch (err) {
      console.error('Failed to parse pasted SVG', err)
    }
  }

  // C) Normal text pasted onto canvas
  if (trimmed.length > 0 && !copiedElement.value) {
    event.preventDefault()
    const newEl: CanvasElement = {
      id: makeId(),
      screenId: currentScreen.id,
      type: 'text',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: {
        x: Math.round((currentScreen.width - 200) / 2),
        y: Math.round((currentScreen.height - 40) / 2),
        width: Math.min(400, Math.max(160, trimmed.length * 10 + 20)),
        height: 36,
        text: trimmed,
        color: pencilColor.value,
        fontSize: 16,
        opacity: 1,
        rotation: 0,
        editing: false
      }
    }
    addHistory(currentScreen.id)
    if (!allElements.value[currentScreen.id]) allElements.value[currentScreen.id] = []
    allElements.value[currentScreen.id].push(newEl)
    selectedId.value = newEl.id
    scheduleSave(currentScreen.id)
    return
  }

  // D) Default fallback to internal element
  if (copiedElement.value) {
    event.preventDefault()
    pasteInternalElement()
  }
}

function updateProperty() {
  if (selected.value) {
    selected.value.updatedAt = Date.now()
    scheduleSave(activeScreenId.value)
  }
}

function bounds(element: CanvasElement) {
  const item = data(element)
  if (element.type === 'path') {
    const points = String(item.points)
      .split(' ')
      .map((pair) => pair.split(',').map(Number))
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    }
  }
  return {
    x: number(item.x),
    y: number(item.y),
    width: number(item.width),
    height: number(item.height)
  }
}

// Inline Screen Creation
function openAddScreenModal() {
  newScreenName.value = `Screen ${projectScreens.value.length + 1}`
  newScreenDevice.value = 'iphone'
  showAddScreenModal.value = true
}

async function handleCreateScreen() {
  if (!project.value) return
  const customSize: [number, number] | undefined =
    newScreenDevice.value === 'custom'
      ? [newScreenCustomWidth.value, newScreenCustomHeight.value]
      : undefined

  const screen = await store.createScreen(
    project.value.id,
    newScreenName.value || `Screen ${projectScreens.value.length + 1}`,
    newScreenDevice.value,
    customSize
  )

  allElements.value[screen.id] = []
  showAddScreenModal.value = false
  await nextTick()
  focusScreen(screen.id)
}

// Inline Screen Renaming & Deletion
function startRenameScreen(screen: Screen) {
  editingScreenId.value = screen.id
  editingScreenName.value = screen.name
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-rename-input="${screen.id}"]`)
    input?.focus()
    input?.select()
  })
}

async function saveScreenRename(screen: Screen) {
  if (!editingScreenId.value) return
  if (editingScreenName.value.trim()) {
    screen.name = editingScreenName.value.trim()
    await store.updateScreen(screen)
  }
  editingScreenId.value = null
}

async function handleDeleteScreen(screen: Screen) {
  if (projectScreens.value.length <= 1) {
    alert('A project must have at least one screen.')
    return
  }
  if (confirm(`Delete screen "${screen.name}"?`)) {
    await store.deleteScreen(screen.id)
    delete allElements.value[screen.id]
    if (activeScreenId.value === screen.id) {
      activeScreenId.value = projectScreens.value[0]?.id || ''
    }
  }
}

function share() {
  alert('Sharing is coming soon.')
}

// Keyboard shortcuts
function isFormField(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function onKeydown(event: KeyboardEvent) {
  if (isFormField(event.target)) return

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    event.shiftKey ? redo() : undo()
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redo()
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    if (selected.value && !data(selected.value).editing) {
      copySelected()
    }
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
    if (selected.value && !data(selected.value).editing) {
      event.preventDefault()
      cutSelected()
    }
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    if (selected.value && !data(selected.value).editing) {
      event.preventDefault()
      duplicateSelected()
    }
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selectedId.value) {
      event.preventDefault()
      deleteSelected()
    }
  } else if (event.key === 'Enter') {
    if (
      selected.value &&
      (selected.value.type === 'text' || selected.value.type === 'stickyNote') &&
      !data(selected.value).editing
    ) {
      event.preventDefault()
      startTextEdit(selected.value)
    }
  } else if (event.code === 'Space' && !isSpacePressed.value) {
    isSpacePressed.value = true
  } else if (event.key.toLowerCase() === 'v') {
    tool.value = 'select'
  } else if (event.key.toLowerCase() === 'h') {
    tool.value = 'pan'
  } else if (event.key.toLowerCase() === 'p') {
    tool.value = 'path'
  } else if (event.key.toLowerCase() === 'r') {
    tool.value = 'rectangle'
  } else if (event.key.toLowerCase() === 'o') {
    tool.value = 'circle'
  } else if (event.key.toLowerCase() === 'l') {
    tool.value = 'line'
  } else if (event.key.toLowerCase() === 'a') {
    tool.value = 'arrow'
  } else if (event.key.toLowerCase() === 't') {
    tool.value = 'text'
  } else if (event.key.toLowerCase() === 's') {
    tool.value = 'stickyNote'
  } else if (event.key === '1' && event.shiftKey) {
    event.preventDefault()
    fitAll()
  }
}

function onKeyup(event: KeyboardEvent) {
  if (event.code === 'Space') {
    isSpacePressed.value = false
  }
}

onMounted(async () => {
  if (!store.ready) await store.hydrate()

  // Load elements for all screens in this project
  for (const s of projectScreens.value) {
    allElements.value[s.id] = await store.loadElements(s.id)
  }

  // Set initial active screen
  const initialId = String(route.params.screenId)
  if (projectScreens.value.some((s) => s.id === initialId)) {
    activeScreenId.value = initialId
  } else if (projectScreens.value.length > 0) {
    activeScreenId.value = projectScreens.value[0].id
  }

  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('paste', handlePaste)

  nextTick(() => {
    // Add logo to header brand if needed
    const brand = document.querySelector<HTMLAnchorElement>('.editor-header .brand')
    if (brand && !brand.querySelector('img')) {
      const image = new Image()
      image.src = logo
      image.alt = 'Wirebook'
      image.className = 'brand-logo'
      brand.prepend(image)
    }

    if (activeScreenId.value) {
      focusScreen(activeScreenId.value)
    } else {
      fitAll()
    }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  window.removeEventListener('paste', handlePaste)
  for (const id in saveTimers) {
    clearTimeout(saveTimers[id])
  }
})
</script>

<template>
  <div class="editor" @wheel="onWheel">
    <!-- Top Header -->
    <header class="editor-header">
      <button class="icon-button" aria-label="Back to project" @click="router.push(`/project/${route.params.projectId}`)">
        <ArrowLeft :size="19" />
      </button>
      <RouterLink class="brand" to="/">Wirebook<span>.</span></RouterLink>

      <span class="crumb">
        {{ project?.name }} / <b>{{ activeScreen?.name || 'Overview' }}</b>
      </span>

      <!-- Screen Selector Pills -->
      <div class="header-screens-pills" style="display: flex; gap: 6px; margin-left: 10px; overflow-x: auto; max-width: 320px;">
        <button
          v-for="s in projectScreens"
          :key="s.id"
          class="button ghost"
          :style="{
            padding: '4px 10px',
            fontSize: '12px',
            borderRadius: '6px',
            background: activeScreenId === s.id ? 'var(--primary-light, #EEF2FF)' : 'transparent',
            color: activeScreenId === s.id ? 'var(--primary, #4F46E5)' : '#666',
            fontWeight: activeScreenId === s.id ? '700' : '500'
          }"
          @click="focusScreen(s.id)"
        >
          {{ s.name }}
        </button>
      </div>

      <button
        class="button primary"
        style="padding: 6px 12px; font-size: 13px; margin-left: 8px;"
        @click="openAddScreenModal"
      >
        <Plus :size="16" /> Add Screen
      </button>

      <span class="save-status">{{ saving }}</span>
      <button class="button ghost" @click="share">Share</button>
    </header>

    <!-- Toolbar Tools -->
    <aside class="editor-tools">
      <button
        v-for="item in toolList"
        :key="item.key"
        :class="{ active: tool === item.key }"
        :title="item.label"
        @click="tool = item.key"
      >
        <component :is="item.icon" :size="19" />
      </button>
      <i />
      <button title="Undo (Ctrl+Z)" :disabled="!history.length" @click="undo">
        <Undo2 :size="19" />
      </button>
      <button title="Redo (Ctrl+Shift+Z)" :disabled="!redoHistory.length" @click="redo">
        <Redo2 :size="19" />
      </button>
      <i />
      <button title="Copy (Ctrl+C)" :disabled="!selected" @click="copySelected">
        <Copy :size="18" />
      </button>
      <button title="Cut (Ctrl+X)" :disabled="!selected" @click="cutSelected">
        <Scissors :size="18" />
      </button>
      <button title="Duplicate (Ctrl+D)" :disabled="!selected" @click="duplicateSelected">
        <CopyPlus :size="18" />
      </button>
    </aside>

    <!-- Infinite Canvas Workspace -->
    <main
      class="workspace"
      :class="{
        'is-panning': isWorkspacePanning,
        'is-pan-tool': tool === 'pan' || isSpacePressed
      }"
      @pointerdown="workspacePointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div
        class="canvas-world"
        :style="{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0'
        }"
      >
        <!-- Render Every Screen Node -->
        <div
          v-for="item in screenLayout.items"
          :key="item.screen.id"
          class="canvas-screen-node"
          :class="{ 'is-active': activeScreenId === item.screen.id }"
          :style="{
            left: `${item.x}px`,
            top: `${item.y}px`
          }"
          @click="activeScreenId = item.screen.id"
        >
          <!-- Frame Header Bar (Figma-Style) -->
          <div class="screen-header-bar" @dblclick.stop="startRenameScreen(item.screen)">
            <input
              v-if="editingScreenId === item.screen.id"
              :data-rename-input="item.screen.id"
              v-model="editingScreenName"
              class="screen-rename-input"
              @blur="saveScreenRename(item.screen)"
              @keydown.enter="saveScreenRename(item.screen)"
              @click.stop
            />
            <span v-else class="screen-header-title">{{ item.screen.name }}</span>

            <span class="screen-header-size">{{ item.screen.width }} × {{ item.screen.height }}</span>

            <button
              v-if="projectScreens.length > 1"
              class="screen-del-btn"
              title="Delete screen"
              @click.stop="handleDeleteScreen(item.screen)"
            >
              <X :size="14" />
            </button>
          </div>

          <!-- Realistic Device Shell -->
          <div class="device-shell" :class="item.screen.deviceType">
            <!-- iPhone Details -->
            <template v-if="item.screen.deviceType === 'iphone'">
              <div class="iphone-dynamic-island">
                <div class="iphone-camera-lens" />
              </div>
              <div class="iphone-home-indicator" />
            </template>

            <!-- Android Details -->
            <template v-if="item.screen.deviceType === 'android'">
              <div class="android-punch-hole" />
              <div class="android-nav-bar" />
            </template>

            <!-- Desktop Details -->
            <template v-if="item.screen.deviceType === 'desktop'">
              <div class="desktop-webcam" />
            </template>

            <!-- Tablet Details -->
            <template v-if="item.screen.deviceType === 'tablet'">
              <div class="tablet-camera" />
            </template>

            <!-- Device Screen Area & SVG -->
            <div
              class="device-screen"
              :style="{
                width: `${item.screen.width}px`,
                height: `${item.screen.height}px`
              }"
            >
              <svg
                :data-screen-svg="item.screen.id"
                :viewBox="`0 0 ${item.screen.width} ${item.screen.height}`"
                :width="item.screen.width"
                :height="item.screen.height"
                @pointerdown="screenDown(item.screen, $event)"
              >
                <defs>
                  <marker
                    :id="`arrow-head-${item.screen.id}`"
                    markerWidth="10"
                    markerHeight="8"
                    refX="8"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L9,4 L0,8 z" fill="currentColor" />
                  </marker>
                </defs>

                <rect width="100%" height="100%" fill="white" />

                <!-- Elements -->
                <g
                  v-for="element in (allElements[item.screen.id] || [])"
                  :key="element.id"
                  :opacity="number(data(element).opacity) || 1"
                  :transform="number(data(element).rotation) ? `rotate(${number(data(element).rotation)} ${number(data(element).x) + number(data(element).width)/2} ${number(data(element).y) + number(data(element).height)/2})` : ''"
                  @pointerdown="elementDown(item.screen, element, $event)"
                  @dblclick.stop="element.type === 'text' || element.type === 'stickyNote' ? startTextEdit(element) : null"
                >
                  <polyline
                    v-if="element.type === 'path'"
                    :points="String(data(element).points)"
                    fill="none"
                    :stroke="String(data(element).stroke || data(element).color || '#111')"
                    :stroke-width="number(data(element).strokeWidth) || 3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <rect
                    v-else-if="element.type === 'rectangle'"
                    :x="number(data(element).x)"
                    :y="number(data(element).y)"
                    :width="number(data(element).width)"
                    :height="number(data(element).height)"
                    :rx="number(data(element).borderRadius ?? 8)"
                    :fill="String(data(element).fill || '#4F46E5')"
                    :fill-opacity="number(data(element).fillOpacity ?? 1)"
                    :stroke="String(data(element).stroke || '#111')"
                    :stroke-width="number(data(element).strokeWidth) || 2"
                  />
                  <ellipse
                    v-else-if="element.type === 'circle'"
                    :cx="number(data(element).x) + number(data(element).width) / 2"
                    :cy="number(data(element).y) + number(data(element).height) / 2"
                    :rx="number(data(element).width) / 2"
                    :ry="number(data(element).height) / 2"
                    :fill="String(data(element).fill || '#4F46E5')"
                    :fill-opacity="number(data(element).fillOpacity ?? 1)"
                    :stroke="String(data(element).stroke || '#111')"
                    :stroke-width="number(data(element).strokeWidth) || 2"
                  />
                  <line
                    v-else-if="element.type === 'line' || element.type === 'arrow'"
                    :x1="number(data(element).x)"
                    :y1="number(data(element).y)"
                    :x2="number(data(element).x2)"
                    :y2="number(data(element).y2)"
                    :stroke="String(data(element).stroke || '#111')"
                    :stroke-width="number(data(element).strokeWidth) || 3"
                    :marker-end="element.type === 'arrow' ? `url(#arrow-head-${item.screen.id})` : undefined"
                  />
                  <!-- External/Pasted SVG Vector or Icon -->
                  <svg
                    v-else-if="element.type === 'svg'"
                    :x="number(data(element).x)"
                    :y="number(data(element).y)"
                    :width="number(data(element).width) || 48"
                    :height="number(data(element).height) || 48"
                    :viewBox="String(data(element).viewBox || '0 0 24 24')"
                    :fill="String(data(element).fill || 'none')"
                    :stroke="String(data(element).stroke || data(element).color || '#111')"
                    :stroke-width="number(data(element).strokeWidth) || 2"
                    style="overflow: visible;"
                    v-html="data(element).svgContent"
                  />
                  <!-- Pasted Image -->
                  <image
                    v-else-if="element.type === 'image'"
                    :x="number(data(element).x)"
                    :y="number(data(element).y)"
                    :width="number(data(element).width)"
                    :height="number(data(element).height)"
                    :href="String(data(element).src)"
                    preserveAspectRatio="xMidYMid meet"
                  />
                  <foreignObject
                    v-else
                    :x="number(data(element).x)"
                    :y="number(data(element).y)"
                    :width="Math.max(number(data(element).width), 60)"
                    :height="Math.max(number(data(element).height), 32)"
                  >
                    <div
                      xmlns="http://www.w3.org/1999/xhtml"
                      :class="[
                        'svg-editable',
                        element.type,
                        {
                          'is-editing': data(element).editing,
                          'is-text-view': !data(element).editing,
                          note: element.type === 'stickyNote'
                        }
                      ]"
                      :style="{
                        fontSize: `${number(data(element).fontSize) || 16}px`,
                        color: String(data(element).color || data(element).stroke || '#111')
                      }"
                    >
                      <b v-if="element.type === 'stickyNote'">{{ data(element).title }}</b>
                      <textarea
                        v-if="data(element).editing"
                        :data-edit-id="element.id"
                        v-model="data(element).text as string"
                        placeholder="Type here..."
                        @input="onTextInput(element, $event)"
                        @blur="finishTextEdit(element)"
                        @keydown.stop="onTextKeydown(element, $event)"
                        @pointerdown.stop
                        @click.stop
                      />
                      <span
                        v-else
                        style="display: block; width: 100%; height: 100%; white-space: pre-wrap; word-break: break-word;"
                        @dblclick.stop="startTextEdit(element)"
                      >{{ data(element).text || 'Type here' }}</span>
                    </div>
                  </foreignObject>
                </g>

                <!-- Selection Box on Active Screen (Hidden while directly editing text, like Figma) -->
                <g v-if="activeScreenId === item.screen.id && selected && !data(selected).editing" class="selection">
                  <rect
                    :x="bounds(selected).x - 5"
                    :y="bounds(selected).y - 5"
                    :width="bounds(selected).width + 10"
                    :height="bounds(selected).height + 10"
                    fill="none"
                    stroke="#4F46E5"
                    stroke-width="1.5"
                    stroke-dasharray="4 3"
                    pointer-events="none"
                  />
                  <rect
                    :x="bounds(selected).x + bounds(selected).width + 1"
                    :y="bounds(selected).y + bounds(selected).height + 1"
                    width="10"
                    height="10"
                    fill="white"
                    stroke="#4F46E5"
                    stroke-width="2"
                    @pointerdown="resizeDown(item.screen, $event)"
                  />
                </g>
              </svg>
            </div>

            <!-- Desktop Monitor Stand -->
            <div v-if="item.screen.deviceType === 'desktop'" class="monitor-stand-assembly">
              <div class="monitor-neck" />
              <div class="monitor-foot" />
            </div>
          </div>
        </div>

        <!-- Add Screen Card on Canvas -->
        <button
          class="canvas-add-screen-card"
          :style="{
            left: `${screenLayout.addCardX}px`,
            top: '80px'
          }"
          @click="openAddScreenModal"
        >
          <div class="icon-wrap">
            <Plus :size="28" />
          </div>
          <span>Add Screen</span>
        </button>
      </div>
    </main>

    <!-- Properties Panel (Right Sidebar) -->
    <aside class="properties">
      <p class="eyebrow">{{ selected ? selected.type.toUpperCase() : tool.toUpperCase() }}</p>
      <h3>{{ selected ? 'Element properties' : 'Tool properties' }}</h3>

      <!-- Tool Defaults when nothing is selected -->
      <template v-if="tool === 'path' && !selected">
        <label>
          Color
          <input v-model="pencilColor" type="color" />
        </label>
        <label>
          Stroke width <b>{{ strokeWidth }}px</b>
          <input v-model.number="strokeWidth" type="range" min="1" max="16" />
        </label>
        <label>
          Opacity <b>{{ Math.round(opacity * 100) }}%</b>
          <input v-model.number="opacity" type="range" min="0.1" max="1" step="0.1" />
        </label>
      </template>

      <!-- Properties when an Element is selected -->
      <template v-else-if="selected">
        <div class="prop-row">
          <label>
            X
            <input v-model.number="data(selected).x as number" type="number" @input="updateProperty" />
          </label>
          <label>
            Y
            <input v-model.number="data(selected).y as number" type="number" @input="updateProperty" />
          </label>
        </div>

        <div class="prop-row">
          <label>
            Width
            <input v-model.number="data(selected).width as number" type="number" min="16" @input="updateProperty" />
          </label>
          <label>
            Height
            <input v-model.number="data(selected).height as number" type="number" min="16" @input="updateProperty" />
          </label>
        </div>

        <!-- Border Radius for Rectangle (Slider + Number input) -->
        <div v-if="selected.type === 'rectangle'" style="margin-top: 10px;">
          <label>
            Border Radius
            <div style="display: flex; gap: 8px; align-items: center;">
              <input
                v-model.number="data(selected).borderRadius as number"
                type="range"
                min="0"
                max="120"
                style="flex: 1;"
                @input="updateProperty"
              />
              <input
                v-model.number="data(selected).borderRadius as number"
                type="number"
                min="0"
                max="500"
                style="width: 60px;"
                placeholder="0"
                @input="updateProperty"
              />
            </div>
          </label>
        </div>

        <!-- Rotation (Slider + Number) -->
        <div style="margin-top: 10px;">
          <label>
            Rotation ({{ data(selected).rotation ?? 0 }}°)
            <div style="display: flex; gap: 8px; align-items: center;">
              <input
                v-model.number="data(selected).rotation as number"
                type="range"
                min="0"
                max="360"
                style="flex: 1;"
                @input="updateProperty"
              />
              <input
                v-model.number="data(selected).rotation as number"
                type="number"
                min="0"
                max="360"
                style="width: 60px;"
                @input="updateProperty"
              />
            </div>
          </label>
        </div>

        <!-- Fill Color (For Rectangle, Circle & SVG) -->
        <div v-if="selected.type === 'rectangle' || selected.type === 'circle' || selected.type === 'svg'" class="color-section">
          <label>Fill Color</label>
          <div class="color-picker-row">
            <input v-model="data(selected).fill as string" type="color" @input="updateProperty" />
            <input
              v-model="data(selected).fill as string"
              type="text"
              placeholder="#4F46E5"
              @input="updateProperty"
            />
          </div>
        </div>

        <!-- Stroke / Border Color -->
        <div v-if="selected.type !== 'text' && selected.type !== 'stickyNote' && selected.type !== 'image'" class="color-section">
          <label>Stroke Color</label>
          <div class="color-picker-row">
            <input v-model="data(selected).stroke as string" type="color" @input="updateProperty" />
            <input
              v-model="data(selected).stroke as string"
              type="text"
              placeholder="#111111"
              @input="updateProperty"
            />
          </div>

          <label>
            Stroke Width <b>{{ data(selected).strokeWidth ?? 2 }}px</b>
            <input
              v-model.number="data(selected).strokeWidth as number"
              type="range"
              min="1"
              max="20"
              @input="updateProperty"
            />
          </label>
        </div>

        <!-- Font Size & Text Options -->
        <template v-if="selected.type === 'text' || selected.type === 'stickyNote'">
          <label>
            Font size (px)
            <input
              v-model.number="data(selected).fontSize as number"
              type="number"
              min="10"
              max="72"
              @input="updateProperty"
            />
          </label>
          <label v-if="selected.type === 'stickyNote'">
            Note Title
            <input
              v-model="data(selected).title as string"
              type="text"
              @input="updateProperty"
            />
          </label>
          <label>
            Content
            <textarea
              v-model="data(selected).text as string"
              style="width: 100%; height: 60px; padding: 6px; font: inherit; border: 1px solid #ddd; border-radius: 6px;"
              @input="updateProperty"
            />
          </label>
        </template>

        <!-- Opacity Slider -->
        <label>
          Opacity <b>{{ Math.round((number(data(selected).opacity) || 1) * 100) }}%</b>
          <input
            v-model.number="data(selected).opacity as number"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            @input="updateProperty"
          />
        </label>

        <!-- Action Buttons (Copy, Cut, Duplicate) -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 18px;">
          <button type="button" class="button ghost" style="font-size: 11px; padding: 6px 4px; border: 1px solid var(--border, #ddd);" title="Copy (Ctrl+C)" @click="copySelected">
            <Copy :size="13" /> Copy
          </button>
          <button type="button" class="button ghost" style="font-size: 11px; padding: 6px 4px; border: 1px solid var(--border, #ddd);" title="Cut (Ctrl+X)" @click="cutSelected">
            <Scissors :size="13" /> Cut
          </button>
          <button type="button" class="button ghost" style="font-size: 11px; padding: 6px 4px; border: 1px solid var(--border, #ddd);" title="Duplicate (Ctrl+D)" @click="duplicateSelected">
            <CopyPlus :size="13" /> Clone
          </button>
        </div>

        <!-- Delete Element Button -->
        <button class="button danger" style="margin-top: 10px; width: 100%;" @click="deleteSelected">
          <Trash2 :size="16" /> Delete element
        </button>
      </template>

      <p v-else class="muted">
        Select an element or click on any screen to start designing.
      </p>
    </aside>

    <!-- Zoom & Navigation Controls -->
    <div class="zoom-controls">
      <button title="Zoom Out" @click="zoom = Math.max(0.2, zoom - 0.1)">
        <Minus :size="17" />
      </button>
      <span title="Current Zoom">{{ Math.round(zoom * 100) }}%</span>
      <button title="Zoom In" @click="zoom = Math.min(3, zoom + 0.1)">
        <Plus :size="17" />
      </button>
      <button title="Fit All Screens (Shift+1)" @click="fitAll">
        <Maximize2 :size="17" />
      </button>
      <button
        v-if="activeScreen"
        title="Focus Active Screen"
        style="border: 0; background: transparent; padding: 6px; display: grid;"
        @click="focusScreen(activeScreen.id)"
      >
        <LayoutGrid :size="17" />
      </button>
    </div>

    <!-- Inline Add Screen Modal -->
    <Teleport to="body">
      <div v-if="showAddScreenModal" class="modal-backdrop" @mousedown.self="showAddScreenModal = false">
        <form class="modal small" @submit.prevent="handleCreateScreen">
          <p class="eyebrow">NEW SCREEN</p>
          <h2>Add screen to canvas</h2>

          <label>
            Screen name
            <input v-model="newScreenName" placeholder="e.g. Checkout page" autofocus />
          </label>

          <label>Device frame</label>
          <div class="device-options">
            <button
              v-for="item in ([
                ['iphone', 'iPhone', Smartphone],
                ['android', 'Android', Smartphone],
                ['desktop', 'Desktop', Monitor],
                ['tablet', 'Tablet', TabletIcon]
              ] as [DeviceType, string, unknown][])"
              :key="item[0]"
              type="button"
              :class="{ chosen: newScreenDevice === item[0] }"
              @click="newScreenDevice = item[0]"
            >
              <component :is="item[2]" :size="20" style="margin-bottom: 2px;" />
              {{ item[1] }}
            </button>
          </div>

          <div v-if="newScreenDevice === 'custom'" class="prop-row" style="margin-top: 10px;">
            <label>
              Width (px)
              <input v-model.number="newScreenCustomWidth" type="number" min="200" max="3840" />
            </label>
            <label>
              Height (px)
              <input v-model.number="newScreenCustomHeight" type="number" min="200" max="3840" />
            </label>
          </div>

          <div class="modal-actions">
            <button type="button" class="button ghost" @click="showAddScreenModal = false">
              Cancel
            </button>
            <button class="button primary">
              Create screen
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </div>
</template>
