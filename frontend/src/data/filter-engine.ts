import { ORDER_FIELDS, listOrders, type OrderRow } from './orders'
import { listRows, saveRows } from './local-store'
import {
  appendResultSet,
  appendRuleVersion,
  findResultSetByKey,
  getResultSetById,
  getRuleVersion,
  listResultSets,
  listRuleVersions,
  nextResultId,
  replaceRuleVersions,
  type ConditionSet,
  type FilterResultSet,
  type RuleVersion,
} from './filter-store'
import type { EntryRow } from './types'

// 筛选规则执行引擎：读取订单记录与筛选规则，按筛选字段、比较运算符、逻辑组合过滤行，
// 生成筛选结果记录集。权限、并发与幂等规则都集中在这里，页面组件不做业务判断。

export type Operator = {
  name: string
  unit: string
  role: 'admin' | 'member'
}

// 演示用值班身份：头部可切换，用来核对负责人权限与越权拒绝。
export const KNOWN_OPERATORS: Operator[] = [
  { name: '值班管理员', unit: '数据平台部', role: 'admin' },
  { name: '林岚', unit: '华东事业部', role: 'member' },
  { name: '陈默', unit: '华东事业部', role: 'member' },
  { name: '高翔', unit: '华北事业部', role: 'member' },
  { name: '外单位访客', unit: '外部单位', role: 'member' },
]

export function operatorByName(name: string, unit = ''): Operator {
  const hit = KNOWN_OPERATORS.find((item) => item.name === name)
  if (hit) {
    return hit
  }
  return { name, unit: unit || '外部单位', role: 'member' }
}

export type ServiceResult<T> = {
  ok: boolean
  message: string
  data?: T
}

function ok<T>(message: string, data?: T): ServiceResult<T> {
  return { ok: true, message, data }
}

function fail<T>(message: string): ServiceResult<T> {
  return { ok: false, message }
}

// ---------- 条件解析与行过滤 ----------

const SPLIT_RE = /[,，、;；]/
const NUMERIC_OPERATORS = ['>', '>=', '<', '<=']
const SUPPORTED_OPERATORS = ['=', '!=', '>', '>=', '<', '<=', '包含']

export function normalizeLogic(raw: string): 'AND' | 'OR' {
  const text = raw.trim().toUpperCase()
  if (text.includes('OR') || text.includes('任一') || text.includes('或')) {
    return 'OR'
  }
  return 'AND'
}

export function parseConditionSet(input: {
  筛选字段: string
  比较运算符: string
  比较值: string
  逻辑组合: string
}): ServiceResult<ConditionSet> {
  const fields = input.筛选字段.split(SPLIT_RE).map((item) => item.trim()).filter(Boolean)
  const operators = input.比较运算符.split(SPLIT_RE).map((item) => item.trim()).filter(Boolean)
  const values = input.比较值.split(SPLIT_RE).map((item) => item.trim()).filter((item) => item !== '')
  if (!fields.length) {
    return fail('筛选字段不能为空')
  }
  if (fields.length !== operators.length || fields.length !== values.length) {
    return fail(`筛选字段、比较运算符、比较值的数量不一致（${fields.length}/${operators.length}/${values.length}）`)
  }
  for (const field of fields) {
    if (!(ORDER_FIELDS as readonly string[]).includes(field)) {
      return fail(`筛选字段「${field}」不在订单记录字段内（${ORDER_FIELDS.join('、')}）`)
    }
  }
  for (const operator of operators) {
    if (!SUPPORTED_OPERATORS.includes(operator)) {
      return fail(`比较运算符「${operator}」不受支持（支持：${SUPPORTED_OPERATORS.join('、')}）`)
    }
  }
  for (let index = 0; index < fields.length; index += 1) {
    if (NUMERIC_OPERATORS.includes(operators[index]) && Number.isNaN(Number(values[index]))) {
      return fail(`比较值「${values[index]}」不是数字，无法用于「${operators[index]}」比较`)
    }
  }
  const conditions = fields.map((field, index) => ({ field, operator: operators[index], value: values[index] }))
  return ok('条件解析成功', { logic: normalizeLogic(input.逻辑组合), conditions })
}

export function conditionSetText(set: ConditionSet): string {
  const joiner = set.logic === 'OR' ? ' 或 ' : ' 且 '
  return set.conditions.map((item) => `${item.field} ${item.operator} ${item.value}`).join(joiner)
}

function compareValue(actual: string | number, operator: string, raw: string): boolean {
  const text = String(actual)
  const target = raw.trim()
  const actualNumber = Number(actual)
  const targetNumber = Number(target)
  const numeric = target !== '' && !Number.isNaN(actualNumber) && !Number.isNaN(targetNumber)
  switch (operator) {
    case '=':
      return numeric ? actualNumber === targetNumber : text === target
    case '!=':
      return numeric ? actualNumber !== targetNumber : text !== target
    case '>':
      return numeric && actualNumber > targetNumber
    case '>=':
      return numeric && actualNumber >= targetNumber
    case '<':
      return numeric && actualNumber < targetNumber
    case '<=':
      return numeric && actualNumber <= targetNumber
    case '包含':
      return text.includes(target)
    default:
      return false
  }
}

export function matchOrder(row: OrderRow, set: ConditionSet): boolean {
  const results = set.conditions.map((item) =>
    compareValue(row[item.field as keyof OrderRow], item.operator, item.value),
  )
  return set.logic === 'OR' ? results.some(Boolean) : results.every(Boolean)
}

export function sortOrders(rows: OrderRow[], sortField: string): OrderRow[] {
  const text = sortField.trim()
  if (!text) {
    return rows
  }
  const desc = text.includes('降序')
  const field = text.replace(/(升序|降序)/g, '').trim()
  if (!field || !(ORDER_FIELDS as readonly string[]).includes(field)) {
    return rows
  }
  const key = field as keyof OrderRow
  return [...rows].sort((a, b) => {
    const aValue = a[key]
    const bValue = b[key]
    const aNumber = Number(aValue)
    const bNumber = Number(bValue)
    const cmp =
      !Number.isNaN(aNumber) && !Number.isNaN(bNumber)
        ? aNumber - bNumber
        : String(aValue).localeCompare(String(bValue), 'zh-Hans-CN')
    return desc ? -cmp : cmp
  })
}

// ---------- 行级可见性 ----------

export function visibleOrdersFor(operator: Operator): OrderRow[] {
  const all = listOrders()
  if (operator.role === 'admin') {
    return all
  }
  return all.filter((row) => row.归属单位 === operator.unit)
}

// ---------- 规则行与版本解析 ----------

function findRuleRow(ruleCode: string): EntryRow | undefined {
  return listRows('filter').find((row) => String(row['规则编号']) === ruleCode)
}

function ruleOwnerOf(rule: EntryRow): string {
  return String(rule['负责人'] ?? '')
}

function ruleUnitOf(rule: EntryRow): string {
  return String(rule['归属单位'] ?? '')
}

function isPrivileged(operator: Operator, rule: EntryRow): boolean {
  return operator.role === 'admin' || operator.name === ruleOwnerOf(rule) || operator.unit === ruleUnitOf(rule)
}

function updateRuleRow(ruleCode: string, updater: (row: EntryRow) => EntryRow): void {
  const next = listRows('filter').map((row) =>
    String(row['规则编号']) === ruleCode ? updater(row) : row,
  )
  saveRows('filter', next)
}

function versionFingerprint(version: RuleVersion): string {
  return JSON.stringify([
    version.conditionSet,
    version.status,
    version.owner,
    version.unit,
    version.outputLimit,
    version.sortField,
  ])
}

function resolveVersion(rule: EntryRow, operator: Operator, explicit?: number): ServiceResult<RuleVersion> {
  const ruleCode = String(rule['规则编号'])
  const versions = listRuleVersions(ruleCode)
  if (!versions.length) {
    return fail(`筛选规则 ${ruleCode} 还没有任何条件版本`)
  }
  if (explicit !== undefined) {
    const hit = getRuleVersion(ruleCode, explicit)
    if (!hit) {
      return fail(`筛选规则 ${ruleCode} 没有 v${explicit} 版本`)
    }
    if (!isPrivileged(operator, rule) && hit.status !== '已启用') {
      return fail('跨单位执行只能读取已启用版本，指定版本未启用')
    }
    return ok('已定位指定版本', hit)
  }
  if (isPrivileged(operator, rule)) {
    return ok('已定位最新版本', versions[versions.length - 1])
  }
  const enabled = versions.filter((item) => item.status === '已启用')
  if (!enabled.length) {
    return fail('跨单位执行只能读取已启用版本，该规则暂无已启用版本')
  }
  return ok('跨单位执行，已定位最新已启用版本', enabled[enabled.length - 1])
}

// ---------- 结果集读取权限 ----------

export function canReadResultSet(set: FilterResultSet, operator: Operator): boolean {
  return operator.role === 'admin' || operator.name === set.owner || operator.unit === set.unit
}

export function getResultSet(id: string, operator: Operator): ServiceResult<FilterResultSet> {
  const set = getResultSetById(id)
  if (!set) {
    return fail(`没有找到编号为 ${id} 的筛选结果记录集`)
  }
  if (!canReadResultSet(set, operator)) {
    return fail(`越权请求已被拒绝：筛选结果记录集 ${id} 仅负责人（${set.owner}）、归属单位（${set.unit}）与管理员可读`)
  }
  return ok('读取成功', set)
}

export function listVisibleResultSets(operator: Operator, ruleCode?: string): FilterResultSet[] {
  return listResultSets().filter(
    (set) => (!ruleCode || set.ruleCode === ruleCode) && canReadResultSet(set, operator),
  )
}

// ---------- 规则执行 ----------

function nowText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

export function executeFilterRule(options: {
  ruleCode: string
  operator: Operator
  version?: number
  beforePublish?: () => void
}): ServiceResult<FilterResultSet> {
  const rule = findRuleRow(options.ruleCode)
  if (!rule) {
    return fail(`没有找到规则编号为 ${options.ruleCode} 的筛选规则`)
  }
  const resolved = resolveVersion(rule, options.operator, options.version)
  if (!resolved.ok || !resolved.data) {
    return fail(resolved.message)
  }
  const version = resolved.data
  const snapshot = versionFingerprint(version)

  // 命中行按「规则负责人可见」的范围计算，与执行人身份无关。
  const ownerIdentity = operatorByName(version.owner, version.unit)
  const hits = sortOrders(
    visibleOrdersFor(ownerIdentity).filter((row) => matchOrder(row, version.conditionSet)),
    version.sortField,
  )
  const limit = version.outputLimit > 0 ? version.outputLimit : 50
  const capped = hits.slice(0, limit)
  const key = `${options.ruleCode}#v${version.version}`

  // 测试与验收钩子：在发布前注入一次并发更新。
  options.beforePublish?.()

  // 发布前重新解析版本：规则在执行期间被并发更新时放弃发布，
  // 只允许发布一份完整命中结果，避免把未授权条件混进结果集。
  const fresh = resolveVersion(rule, options.operator, options.version)
  if (!fresh.ok || !fresh.data || fresh.data.version !== version.version || versionFingerprint(fresh.data) !== snapshot) {
    return fail(`筛选规则 ${options.ruleCode} 在执行期间被并发更新，已放弃发布：只允许发布一份完整命中结果，避免混入未授权条件`)
  }

  const existing = findResultSetByKey(key)
  if (existing) {
    const readable = canReadResultSet(existing, options.operator)
    const message = `已存在同规则同版本的筛选结果记录集 ${existing.id}，竞态重试只保留这一份`
    return ok(readable ? message : `${message}；当前身份无读取权限`, readable ? existing : undefined)
  }

  const set: FilterResultSet = {
    id: nextResultId(),
    ruleCode: options.ruleCode,
    ruleVersion: version.version,
    owner: version.owner,
    unit: version.unit,
    executor: options.operator.name,
    conditionSet: version.conditionSet,
    totalHits: hits.length,
    returnedCount: capped.length,
    outputLimit: limit,
    truncated: hits.length > capped.length,
    hitOrderIds: hits.map((row) => row.id),
    rows: capped,
    idempotencyKey: key,
    createdAt: nowText(),
  }
  appendResultSet(set)
  const readable = canReadResultSet(set, options.operator)
  const message = `已发布筛选结果记录集 ${set.id}（${options.ruleCode} v${version.version}）：命中 ${set.totalHits} 行，返回 ${set.returnedCount} 行${set.truncated ? '，已截断' : ''}`
  return ok(readable ? message : `${message}；当前身份无读取权限，仅负责人与归属单位可查看明细`, readable ? set : undefined)
}

// ---------- 条件改写 / 启用 / 移交（仅规则负责人） ----------

export function saveRuleConditions(input: {
  ruleCode: string
  operator: Operator
  fields: {
    筛选字段: string
    比较运算符: string
    比较值: string
    逻辑组合: string
    排序字段: string
    输出行数上限: string
  }
}): ServiceResult<RuleVersion> {
  const rule = findRuleRow(input.ruleCode)
  if (!rule) {
    return fail(`没有找到规则编号为 ${input.ruleCode} 的筛选规则`)
  }
  if (ruleOwnerOf(rule) !== input.operator.name) {
    return fail(`只有规则负责人（${ruleOwnerOf(rule)}）可以改写条件，当前身份 ${input.operator.name} 已被拒绝`)
  }
  const parsed = parseConditionSet(input.fields)
  if (!parsed.ok || !parsed.data) {
    return fail(parsed.message)
  }
  const limit = Number(input.fields.输出行数上限)
  if (!Number.isInteger(limit) || limit <= 0) {
    return fail('输出行数上限必须是正整数')
  }
  const versions = listRuleVersions(input.ruleCode)
  const version: RuleVersion = {
    ruleCode: input.ruleCode,
    version: versions.length ? versions[versions.length - 1].version + 1 : 1,
    owner: input.operator.name,
    unit: input.operator.unit,
    status: '草稿',
    conditionSet: parsed.data,
    sortField: input.fields.排序字段.trim(),
    outputLimit: limit,
    savedAt: nowText(),
  }
  appendRuleVersion(version)
  updateRuleRow(input.ruleCode, (row) => ({
    ...row,
    筛选字段: input.fields.筛选字段,
    比较运算符: input.fields.比较运算符,
    比较值: input.fields.比较值,
    逻辑组合: input.fields.逻辑组合,
    排序字段: input.fields.排序字段,
    输出行数上限: input.fields.输出行数上限,
    当前版本: `v${version.version}`,
  }))
  return ok(`已保存 ${input.ruleCode} v${version.version}（草稿），启用后跨单位才可执行`, version)
}

export function enableRuleVersion(ruleCode: string, versionNo: number, operator: Operator): ServiceResult<RuleVersion> {
  const rule = findRuleRow(ruleCode)
  if (!rule) {
    return fail(`没有找到规则编号为 ${ruleCode} 的筛选规则`)
  }
  if (ruleOwnerOf(rule) !== operator.name) {
    return fail(`只有规则负责人（${ruleOwnerOf(rule)}）可以启用版本，当前身份 ${operator.name} 已被拒绝`)
  }
  const versions = listRuleVersions(ruleCode)
  const target = versions.find((item) => item.version === versionNo)
  if (!target) {
    return fail(`筛选规则 ${ruleCode} 没有 v${versionNo} 版本`)
  }
  if (target.status === '已启用') {
    return fail(`v${versionNo} 已经是已启用版本`)
  }
  const next = versions.map((item) => ({
    ...item,
    status: item.version === versionNo ? ('已启用' as const) : item.status === '已启用' ? ('已停用' as const) : item.status,
  }))
  replaceRuleVersions(ruleCode, next)
  updateRuleRow(ruleCode, (row) => ({ ...row, status: '已启用', pending: false, 当前版本: `v${versionNo}` }))
  return ok(`已启用 ${ruleCode} v${versionNo}，跨单位执行将读取该版本`, { ...target, status: '已启用' })
}

export function transferRuleOwnership(input: {
  ruleCode: string
  operator: Operator
  newOwner: string
  newUnit: string
}): ServiceResult<EntryRow> {
  const rule = findRuleRow(input.ruleCode)
  if (!rule) {
    return fail(`没有找到规则编号为 ${input.ruleCode} 的筛选规则`)
  }
  const current = ruleOwnerOf(rule)
  if (input.operator.name !== current && input.operator.role !== 'admin') {
    return fail(`只有规则负责人（${current}）或管理员可以移交负责人，当前身份 ${input.operator.name} 已被拒绝`)
  }
  if (!input.newOwner.trim()) {
    return fail('新负责人不能为空')
  }
  updateRuleRow(input.ruleCode, (row) => ({
    ...row,
    负责人: input.newOwner.trim(),
    归属单位: input.newUnit.trim() || ruleUnitOf(row),
  }))
  return ok(`筛选规则 ${input.ruleCode} 负责人已由 ${current} 移交为 ${input.newOwner.trim()}，历史版本的负责人保持不变`)
}

// ---------- 命中行核对 / 版本冲突比较 / 多维下钻 ----------

export function auditResultSet(id: string, operator: Operator): ServiceResult<string[]> {
  const got = getResultSet(id, operator)
  if (!got.ok || !got.data) {
    return fail(got.message)
  }
  const set = got.data
  const checks: string[] = []
  const mismatched = set.rows.filter((row) => !matchOrder(row, set.conditionSet))
  checks.push(
    mismatched.length === 0
      ? `通过：${set.rows.length} 行命中行全部满足过滤条件（${conditionSetText(set.conditionSet)}）`
      : `失败：${mismatched.length} 行命中行不满足过滤条件`,
  )
  checks.push(
    set.hitOrderIds.length === set.totalHits
      ? `通过：命中行数 ${set.totalHits} 与命中编号清单一致`
      : `失败：命中编号清单 ${set.hitOrderIds.length} 条与命中行数 ${set.totalHits} 不一致`,
  )
  const expectReturned = Math.min(set.totalHits, set.outputLimit)
  checks.push(
    set.returnedCount === expectReturned
      ? `通过：返回 ${set.returnedCount} 行 = min(命中 ${set.totalHits} 行, 上限 ${set.outputLimit} 行)`
      : `失败：返回行数 ${set.returnedCount} 应为 ${expectReturned}`,
  )
  checks.push(
    set.truncated === set.totalHits > set.outputLimit
      ? `通过：截断标记（${set.truncated ? '已截断' : '未截断'}）与命中规模一致`
      : '失败：截断标记与命中规模不一致',
  )
  const allPass = checks.every((line) => line.startsWith('通过'))
  return { ok: allPass, message: allPass ? `筛选结果记录集 ${id} 核对通过` : `筛选结果记录集 ${id} 核对未通过`, data: checks }
}

export type VersionCompare = {
  ruleCode: string
  a: { version: RuleVersion; hits: number; ids: number[] }
  b: { version: RuleVersion; hits: number; ids: number[] }
  bothIds: number[]
  onlyAIds: number[]
  onlyBIds: number[]
}

export function compareRuleVersions(
  ruleCode: string,
  versionA: number,
  versionB: number,
  operator: Operator,
): ServiceResult<VersionCompare> {
  const rule = findRuleRow(ruleCode)
  if (!rule) {
    return fail(`没有找到规则编号为 ${ruleCode} 的筛选规则`)
  }
  if (!isPrivileged(operator, rule)) {
    return fail('越权请求已被拒绝：版本冲突核对仅负责人、归属单位与管理员可见')
  }
  const a = getRuleVersion(ruleCode, versionA)
  const b = getRuleVersion(ruleCode, versionB)
  if (!a || !b) {
    return fail('参与比较的版本不存在')
  }
  const hitsOf = (version: RuleVersion) =>
    visibleOrdersFor(operatorByName(version.owner, version.unit))
      .filter((row) => matchOrder(row, version.conditionSet))
      .map((row) => row.id)
  const aIds = hitsOf(a)
  const bIds = hitsOf(b)
  const aSet = new Set(aIds)
  const bSet = new Set(bIds)
  return ok('已生成两版条件的命中对照，下游只能绑定单一版本的结果集，不能混合两个版本的命中行', {
    ruleCode,
    a: { version: a, hits: aIds.length, ids: aIds },
    b: { version: b, hits: bIds.length, ids: bIds },
    bothIds: aIds.filter((id) => bSet.has(id)),
    onlyAIds: aIds.filter((id) => !bSet.has(id)),
    onlyBIds: bIds.filter((id) => !aSet.has(id)),
  })
}

export const DRILL_DIMENSIONS = ['区域', '品类', '客户等级', '归属单位'] as const

export type DrillGroup = {
  value: string
  count: number
  amountSum: number
  rows: OrderRow[]
}

export function drillResultSet(
  id: string,
  dimension: string,
  operator: Operator,
): ServiceResult<{ set: FilterResultSet; dimension: string; groups: DrillGroup[] }> {
  const got = getResultSet(id, operator)
  if (!got.ok || !got.data) {
    return fail(got.message)
  }
  if (!(DRILL_DIMENSIONS as readonly string[]).includes(dimension)) {
    return fail(`不支持的下钻维度「${dimension}」（支持：${DRILL_DIMENSIONS.join('、')}）`)
  }
  const set = got.data
  const buckets = new Map<string, OrderRow[]>()
  for (const row of set.rows) {
    const value = String(row[dimension as keyof OrderRow])
    const list = buckets.get(value) ?? []
    list.push(row)
    buckets.set(value, list)
  }
  const groups = [...buckets.entries()].map(([value, rows]) => ({
    value,
    count: rows.length,
    amountSum: rows.reduce((sum, row) => sum + Number(row.金额), 0),
    rows,
  }))
  return ok(`下钻明细来自筛选结果记录集 ${id} 的命中快照，共 ${set.rows.length} 行，与命中行一致`, {
    set,
    dimension,
    groups,
  })
}
