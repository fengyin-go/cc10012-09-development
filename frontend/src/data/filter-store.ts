import type { OrderRow } from './orders'

// 筛选规则版本与筛选结果记录集的本地持久化。
// 版本是条件口径的依据：两个负责人先后保存的条件都留在版本列表里，结果集按版本各自发布。

export type LogicOp = 'AND' | 'OR'

export type FilterCondition = {
  field: string
  operator: string
  value: string
}

export type ConditionSet = {
  logic: LogicOp
  conditions: FilterCondition[]
}

export type RuleVersion = {
  ruleCode: string
  version: number
  owner: string
  unit: string
  status: '草稿' | '已启用' | '已停用'
  conditionSet: ConditionSet
  sortField: string
  outputLimit: number
  savedAt: string
}

export type FilterResultSet = {
  id: string
  ruleCode: string
  ruleVersion: number
  owner: string
  unit: string
  executor: string
  conditionSet: ConditionSet
  totalHits: number
  returnedCount: number
  outputLimit: number
  truncated: boolean
  hitOrderIds: number[]
  rows: OrderRow[]
  idempotencyKey: string
  createdAt: string
}

const VERSIONS_KEY = 'data-explore-studio:filter-rule-versions'
const RESULTS_KEY = 'data-explore-studio:filter-result-sets'

// 初始版本：与 seed.ts 里 filter 模块三条规则的展示口径一致。
const SEED_VERSIONS: RuleVersion[] = [
  {
    ruleCode: 'FILT-0001',
    version: 1,
    owner: '高翔',
    unit: '华北事业部',
    status: '已启用',
    conditionSet: { logic: 'AND', conditions: [{ field: '区域', operator: '=', value: '华北' }] },
    sortField: '金额 降序',
    outputLimit: 50,
    savedAt: '2026-10-08 09:30:00',
  },
  {
    ruleCode: 'FILT-0002',
    version: 1,
    owner: '林岚',
    unit: '华东事业部',
    status: '草稿',
    conditionSet: {
      logic: 'OR',
      conditions: [
        { field: '金额', operator: '>=', value: '200' },
        { field: '客户等级', operator: '=', value: 'VIP' },
      ],
    },
    sortField: '金额 降序',
    outputLimit: 50,
    savedAt: '2026-10-09 14:00:00',
  },
  {
    ruleCode: 'FILT-0003',
    version: 1,
    owner: '林岚',
    unit: '华东事业部',
    status: '已启用',
    conditionSet: {
      logic: 'AND',
      conditions: [
        { field: '金额', operator: '>', value: '100' },
        { field: '区域', operator: '=', value: '华东' },
      ],
    },
    sortField: '金额 降序',
    outputLimit: 20,
    savedAt: '2026-10-10 10:00:00',
  },
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function read<T>(key: string, fallback: T[]): T[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T[]
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function write<T>(key: string, rows: T[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(key, JSON.stringify(rows))
}

let versionsCache: RuleVersion[] | null = null
let resultsCache: FilterResultSet[] | null = null

export function listRuleVersions(ruleCode?: string): RuleVersion[] {
  if (versionsCache === null) {
    versionsCache = read(VERSIONS_KEY, SEED_VERSIONS)
  }
  const all = versionsCache
  return ruleCode ? all.filter((item) => item.ruleCode === ruleCode) : all
}

export function getRuleVersion(ruleCode: string, version: number): RuleVersion | undefined {
  return listRuleVersions(ruleCode).find((item) => item.version === version)
}

export function appendRuleVersion(version: RuleVersion): void {
  const next = [...listRuleVersions(), version]
  versionsCache = next
  write(VERSIONS_KEY, next)
}

export function replaceRuleVersions(ruleCode: string, versions: RuleVersion[]): void {
  const rest = listRuleVersions().filter((item) => item.ruleCode !== ruleCode)
  const next = [...rest, ...versions]
  versionsCache = next
  write(VERSIONS_KEY, next)
}

export function listResultSets(): FilterResultSet[] {
  if (resultsCache === null) {
    resultsCache = read(RESULTS_KEY, [])
  }
  return resultsCache
}

export function getResultSetById(id: string): FilterResultSet | undefined {
  return listResultSets().find((set) => set.id === id)
}

export function findResultSetByKey(key: string): FilterResultSet | undefined {
  return listResultSets().find((set) => set.idempotencyKey === key)
}

export function appendResultSet(set: FilterResultSet): void {
  const next = [...listResultSets(), set]
  resultsCache = next
  write(RESULTS_KEY, next)
}

export function nextResultId(): string {
  return `FRES-${String(listResultSets().length + 1).padStart(4, '0')}`
}

export function filterStorageKeys(): { versions: string; results: string } {
  return { versions: VERSIONS_KEY, results: RESULTS_KEY }
}
