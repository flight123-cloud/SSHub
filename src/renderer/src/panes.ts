/**
 * 分屏布局：二叉树，叶子是终端面板。
 * 渲染时把树换算成每个面板的绝对位置（百分比），所有面板平铺渲染，
 * 这样拆分 / 关闭面板时，已有终端不会被 React 重新创建（连接不会断）。
 */
export type PaneNode =
  | { type: 'leaf'; id: string }
  | { type: 'split'; id: string; dir: 'row' | 'col'; ratio: number; a: PaneNode; b: PaneNode }

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface DividerInfo {
  splitId: string
  dir: 'row' | 'col'
  /** 分隔条位置 */
  rect: Rect
  /** 所属拆分区域，拖动时据此换算比例 */
  area: Rect
}

let seq = 0
export const newPaneId = (): string => `p${Date.now().toString(36)}${(seq++).toString(36)}`

export function leaf(id = newPaneId()): PaneNode {
  return { type: 'leaf', id }
}

export function leaves(n: PaneNode): string[] {
  return n.type === 'leaf' ? [n.id] : [...leaves(n.a), ...leaves(n.b)]
}

export function layout(n: PaneNode, r: Rect = { x: 0, y: 0, w: 100, h: 100 }): { panes: Map<string, Rect>; dividers: DividerInfo[] } {
  const panes = new Map<string, Rect>()
  const dividers: DividerInfo[] = []
  const walk = (node: PaneNode, rect: Rect): void => {
    if (node.type === 'leaf') {
      panes.set(node.id, rect)
      return
    }
    if (node.dir === 'row') {
      const wa = rect.w * node.ratio
      walk(node.a, { x: rect.x, y: rect.y, w: wa, h: rect.h })
      walk(node.b, { x: rect.x + wa, y: rect.y, w: rect.w - wa, h: rect.h })
      dividers.push({ splitId: node.id, dir: 'row', rect: { x: rect.x + wa, y: rect.y, w: 0, h: rect.h }, area: rect })
    } else {
      const ha = rect.h * node.ratio
      walk(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ha })
      walk(node.b, { x: rect.x, y: rect.y + ha, w: rect.w, h: rect.h - ha })
      dividers.push({ splitId: node.id, dir: 'col', rect: { x: rect.x, y: rect.y + ha, w: rect.w, h: 0 }, area: rect })
    }
  }
  walk(n, r)
  return { panes, dividers }
}

/** 把 target 叶子拆成两个：原面板在前，新面板在后 */
export function splitPane(n: PaneNode, target: string, dir: 'row' | 'col', newId: string): PaneNode {
  if (n.type === 'leaf') {
    return n.id === target ? { type: 'split', id: newPaneId(), dir, ratio: 0.5, a: n, b: leaf(newId) } : n
  }
  return { ...n, a: splitPane(n.a, target, dir, newId), b: splitPane(n.b, target, dir, newId) }
}

/** 删除叶子，兄弟节点顶上来；只剩它自己时返回 null */
export function removePane(n: PaneNode, target: string): PaneNode | null {
  if (n.type === 'leaf') return n.id === target ? null : n
  const a = removePane(n.a, target)
  const b = removePane(n.b, target)
  if (!a) return b
  if (!b) return a
  return { ...n, a, b }
}

export function setRatio(n: PaneNode, splitId: string, ratio: number): PaneNode {
  if (n.type === 'leaf') return n
  if (n.id === splitId) return { ...n, ratio: Math.min(0.9, Math.max(0.1, ratio)) }
  return { ...n, a: setRatio(n.a, splitId, ratio), b: setRatio(n.b, splitId, ratio) }
}

export function equalize(n: PaneNode): PaneNode {
  if (n.type === 'leaf') return n
  // 按两侧面板数量分配，使同方向的面板一样大
  const count = (x: PaneNode, dir: 'row' | 'col'): number =>
    x.type === 'split' && x.dir === dir ? count(x.a, dir) + count(x.b, dir) : 1
  const ca = count(n.a, n.dir)
  const cb = count(n.b, n.dir)
  return { ...n, ratio: ca / (ca + cb), a: equalize(n.a), b: equalize(n.b) }
}

/** 按方向找相邻面板：取该方向上、与当前面板有重叠且距离最近的那个 */
export function neighbor(n: PaneNode, from: string, dir: 'left' | 'right' | 'up' | 'down'): string | null {
  const { panes } = layout(n)
  const cur = panes.get(from)
  if (!cur) return null
  const cx = cur.x + cur.w / 2
  const cy = cur.y + cur.h / 2
  let best: string | null = null
  let bestDist = Infinity
  const eps = 0.01
  for (const [id, r] of panes) {
    if (id === from) continue
    let ok = false
    let dist = 0
    if (dir === 'left') {
      ok = r.x + r.w <= cur.x + eps && r.y < cur.y + cur.h && r.y + r.h > cur.y
      dist = cur.x - (r.x + r.w) + Math.abs(r.y + r.h / 2 - cy) / 1000
    } else if (dir === 'right') {
      ok = r.x >= cur.x + cur.w - eps && r.y < cur.y + cur.h && r.y + r.h > cur.y
      dist = r.x - (cur.x + cur.w) + Math.abs(r.y + r.h / 2 - cy) / 1000
    } else if (dir === 'up') {
      ok = r.y + r.h <= cur.y + eps && r.x < cur.x + cur.w && r.x + r.w > cur.x
      dist = cur.y - (r.y + r.h) + Math.abs(r.x + r.w / 2 - cx) / 1000
    } else {
      ok = r.y >= cur.y + cur.h - eps && r.x < cur.x + cur.w && r.x + r.w > cur.x
      dist = r.y - (cur.y + cur.h) + Math.abs(r.x + r.w / 2 - cx) / 1000
    }
    if (ok && dist < bestDist) {
      bestDist = dist
      best = id
    }
  }
  return best
}
