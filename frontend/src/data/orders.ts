// 订单记录源数据表：筛选规则执行时读取的业务行，持久化在 localStorage，刷新后仍可追溯。
export type OrderRow = {
  id: number
  订单编号: string
  金额: number
  区域: string
  品类: string
  客户等级: string
  下单日期: string
  归属单位: string
}

// 可被筛选规则引用的字段（不含内部 id）。
export const ORDER_FIELDS = ['订单编号', '金额', '区域', '品类', '客户等级', '下单日期', '归属单位'] as const

const STORAGE_KEY = 'data-explore-studio:orders'

const REGION_UNIT: Record<string, string> = {
  华东: '华东事业部',
  华北: '华北事业部',
  华南: '华南事业部',
  西南: '西南事业部',
}

// 金额是手工排定的：华东 30 行里 25 行大于 100，FILT-0003（金额>100 且区域=华东）命中 25 行，
// 输出行数上限 20 时必然截断，验收能直接看到「已截断」标记。
const AMOUNTS: Record<string, number[]> = {
  华东: [97, 134, 171, 208, 245, 282, 319, 356, 393, 90, 127, 164, 201, 238, 275, 312, 349, 386, 63, 100, 137, 174, 211, 248, 285, 322, 359, 396, 93, 130],
  华北: [88, 156, 204, 252, 300, 48, 141, 189, 237, 285, 333, 81],
  华南: [75, 123, 171, 219, 267, 315, 363, 51, 99, 147, 195, 243],
  西南: [66, 114, 162, 210, 258, 306, 354, 42, 90, 138, 186, 234],
}

const CATEGORIES = ['办公用品', '电子设备', '耗材', '技术服务']
const LEVELS = ['普通', '银卡', '金卡', 'VIP']

function seedOrders(): OrderRow[] {
  const rows: OrderRow[] = []
  let seq = 0
  for (const [region, amounts] of Object.entries(AMOUNTS)) {
    for (const amount of amounts) {
      seq += 1
      rows.push({
        id: seq,
        订单编号: `ORD-${String(seq).padStart(4, '0')}`,
        金额: amount,
        区域: region,
        品类: CATEGORIES[seq % CATEGORIES.length],
        客户等级: LEVELS[seq % LEVELS.length],
        下单日期: `2026-09-${String((seq % 28) + 1).padStart(2, '0')}`,
        归属单位: REGION_UNIT[region],
      })
    }
  }
  return rows
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readOrders(): OrderRow[] {
  const fallback = seedOrders()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as OrderRow[]
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: OrderRow[] | null = null

export function listOrders(): OrderRow[] {
  if (cache === null) {
    cache = readOrders()
  }
  return cache
}

export function resetOrders(): OrderRow[] {
  const rows = seedOrders()
  cache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
  return rows
}

export function ordersStorageKey(): string {
  return STORAGE_KEY
}
