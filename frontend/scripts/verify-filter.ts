// 筛选规则执行的验收脚本：不依赖浏览器，直接核对 FILT-0003 等关键场景。
// 运行：npm run verify
import './shim-storage'
import { storageDump } from './shim-storage'

import assert from 'node:assert/strict'

import { listOrders } from '../src/data/orders'
import {
  KNOWN_OPERATORS,
  auditResultSet,
  compareRuleVersions,
  drillResultSet,
  enableRuleVersion,
  executeFilterRule,
  getResultSet,
  listVisibleResultSets,
  saveRuleConditions,
  transferRuleOwnership,
} from '../src/data/filter-engine'
import { listResultSets, listRuleVersions } from '../src/data/filter-store'

const [admin, lin, chen, gao, outsider] = KNOWN_OPERATORS

const FILT3_V2 = {
  筛选字段: '金额,区域',
  比较运算符: '>,=',
  比较值: '150,华东',
  逻辑组合: 'AND（全部满足）',
  排序字段: '金额 降序',
  输出行数上限: '20',
}

let passed = 0
const failures: string[] = []

function check(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

check('01 订单记录播种完成，华东且金额大于 100 的订单共 25 行', () => {
  const orders = listOrders()
  assert.equal(orders.length, 66)
  const hits = orders.filter((row) => row.区域 === '华东' && Number(row.金额) > 100)
  assert.equal(hits.length, 25)
})

check('02 FILT-0003 执行：金额>100 且区域=华东，只返回规则负责人可见的 20 行并标明截断', () => {
  const result = executeFilterRule({ ruleCode: 'FILT-0003', operator: lin })
  assert.ok(result.ok, result.message)
  const set = result.data!
  assert.equal(set.id, 'FRES-0001')
  assert.equal(set.ruleVersion, 1)
  assert.equal(set.owner, '林岚')
  assert.equal(set.unit, '华东事业部')
  assert.equal(set.totalHits, 25)
  assert.equal(set.returnedCount, 20)
  assert.equal(set.truncated, true)
  assert.equal(set.rows.length, 20)
  assert.ok(set.rows.every((row) => Number(row.金额) > 100 && row.区域 === '华东'))
  assert.equal(set.rows[0].金额, 396)
  assert.equal(set.rows[19].金额, 171)
  assert.equal(set.hitOrderIds.length, 25)
})

check('03 竞态重试只生成一份筛选结果记录集', () => {
  const again = executeFilterRule({ ruleCode: 'FILT-0003', operator: lin })
  assert.ok(again.ok, again.message)
  assert.match(again.message, /竞态重试/)
  assert.equal(again.data!.id, 'FRES-0001')
  assert.equal(listResultSets().filter((set) => set.ruleCode === 'FILT-0003').length, 1)
})

check('04 非负责人改写条件被拒绝', () => {
  const result = saveRuleConditions({ ruleCode: 'FILT-0003', operator: chen, fields: FILT3_V2 })
  assert.equal(result.ok, false)
  assert.match(result.message, /只有规则负责人/)
  assert.equal(listRuleVersions('FILT-0003').length, 1)
})

check('05 越权读取结果集被拒绝，负责人与管理员可读', () => {
  const denied = getResultSet('FRES-0001', gao)
  assert.equal(denied.ok, false)
  assert.match(denied.message, /越权请求已被拒绝/)
  assert.equal(getResultSet('FRES-0001', outsider).ok, false)
  assert.ok(getResultSet('FRES-0001', lin).ok)
  assert.ok(getResultSet('FRES-0001', admin).ok)
})

check('06 跨单位执行只能读取已启用版本，负责人可执行草稿版本', () => {
  const crossUnit = executeFilterRule({ ruleCode: 'FILT-0002', operator: gao })
  assert.equal(crossUnit.ok, false)
  assert.match(crossUnit.message, /已启用版本/)
  const own = executeFilterRule({ ruleCode: 'FILT-0002', operator: lin })
  assert.ok(own.ok, own.message)
  assert.equal(own.data!.totalHits, 21)
  assert.equal(own.data!.returnedCount, 21)
  assert.equal(own.data!.truncated, false)
})

check('07 规则并发更新时放弃发布，平静后重试只发布一份完整命中结果', () => {
  const before = listResultSets().filter((set) => set.ruleCode === 'FILT-0001').length
  const result = executeFilterRule({
    ruleCode: 'FILT-0001',
    operator: gao,
    beforePublish: () => {
      saveRuleConditions({
        ruleCode: 'FILT-0001',
        operator: gao,
        fields: {
          筛选字段: '区域',
          比较运算符: '=',
          比较值: '华北',
          逻辑组合: 'AND（全部满足）',
          排序字段: '金额 降序',
          输出行数上限: '50',
        },
      })
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /并发更新/)
  assert.equal(listResultSets().filter((set) => set.ruleCode === 'FILT-0001').length, before)
  const retry = executeFilterRule({ ruleCode: 'FILT-0001', operator: gao })
  assert.ok(retry.ok, retry.message)
  assert.equal(retry.data!.ruleVersion, 2)
  const again = executeFilterRule({ ruleCode: 'FILT-0001', operator: gao })
  assert.equal(again.data!.id, retry.data!.id)
  assert.equal(listResultSets().filter((set) => set.ruleCode === 'FILT-0001').length, before + 1)
})

check('08 负责人移交后新负责人才可改写，两版条件都保留版本依据', () => {
  const denied = transferRuleOwnership({ ruleCode: 'FILT-0003', operator: gao, newOwner: '陈默', newUnit: '华东事业部' })
  assert.equal(denied.ok, false)
  const moved = transferRuleOwnership({ ruleCode: 'FILT-0003', operator: lin, newOwner: '陈默', newUnit: '华东事业部' })
  assert.ok(moved.ok, moved.message)
  const byOldOwner = saveRuleConditions({ ruleCode: 'FILT-0003', operator: lin, fields: FILT3_V2 })
  assert.equal(byOldOwner.ok, false)
  const saved = saveRuleConditions({ ruleCode: 'FILT-0003', operator: chen, fields: FILT3_V2 })
  assert.ok(saved.ok, saved.message)
  assert.equal(saved.data!.version, 2)
  assert.equal(saved.data!.owner, '陈默')
  const enabled = enableRuleVersion('FILT-0003', 2, chen)
  assert.ok(enabled.ok, enabled.message)
  const versions = listRuleVersions('FILT-0003')
  assert.equal(versions.length, 2)
  assert.equal(versions[0].owner, '林岚')
  assert.equal(versions[1].owner, '陈默')
  assert.equal(versions[0].status, '已停用')
  assert.equal(versions[1].status, '已启用')
})

check('09 版本冲突核对：比较两种做法，下游不混合命中行', () => {
  const result = compareRuleVersions('FILT-0003', 1, 2, chen)
  assert.ok(result.ok, result.message)
  const cmp = result.data!
  assert.equal(cmp.a.hits, 25)
  assert.equal(cmp.b.hits, 21)
  assert.equal(cmp.bothIds.length, 21)
  assert.equal(cmp.onlyAIds.length, 4)
  assert.equal(cmp.onlyBIds.length, 0)
  assert.equal(compareRuleVersions('FILT-0003', 1, 2, outsider).ok, false)
})

check('10 新版本执行生成独立结果集，版本依据保留，命中行不混合', () => {
  const v2 = executeFilterRule({ ruleCode: 'FILT-0003', operator: chen })
  assert.ok(v2.ok, v2.message)
  const set2 = v2.data!
  assert.equal(set2.ruleVersion, 2)
  assert.equal(set2.owner, '陈默')
  assert.equal(set2.totalHits, 21)
  assert.equal(set2.returnedCount, 20)
  assert.equal(set2.truncated, true)
  const set1 = getResultSet('FRES-0001', chen).data!
  assert.equal(set1.ruleVersion, 1)
  assert.equal(set1.totalHits, 25)
  assert.notEqual(set2.id, set1.id)
  const audit1 = auditResultSet(set1.id, chen)
  const audit2 = auditResultSet(set2.id, chen)
  assert.ok(audit1.ok, audit1.message)
  assert.ok(audit2.ok, audit2.message)
})

check('11 结果集持久化，重新进入后可检查，归属决定只读权限', () => {
  const dump = storageDump()
  const resultsRaw = dump.get('data-explore-studio:filter-result-sets') ?? ''
  assert.ok(resultsRaw.includes('FRES-0001'))
  assert.ok(resultsRaw.includes('FILT-0003#v1'))
  assert.ok(resultsRaw.includes('FILT-0003#v2'))
  const versionsRaw = dump.get('data-explore-studio:filter-rule-versions') ?? ''
  assert.ok(versionsRaw.includes('"ruleCode":"FILT-0003"'))
  const linVisible = listVisibleResultSets(lin).map((set) => set.id)
  const gaoVisible = listVisibleResultSets(gao).map((set) => set.id)
  assert.ok(linVisible.includes('FRES-0001'))
  const filt1Set = listResultSets().find((set) => set.ruleCode === 'FILT-0001')!
  assert.ok(gaoVisible.includes(filt1Set.id))
  assert.ok(!linVisible.includes(filt1Set.id))
  assert.ok(!gaoVisible.includes('FRES-0001'))
})

check('12 跨模块多维下钻：命中行与钻取明细一致，越权下钻被拒绝', () => {
  const result = drillResultSet('FRES-0001', '区域', lin)
  assert.ok(result.ok, result.message)
  const { set, groups } = result.data!
  assert.equal(groups.length, 1)
  assert.equal(groups[0].value, '华东')
  assert.equal(groups[0].count, 20)
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), set.returnedCount)
  const hitIds = new Set(set.hitOrderIds)
  assert.ok(groups[0].rows.every((row) => hitIds.has(row.id)))
  const denied = drillResultSet('FRES-0001', '区域', gao)
  assert.equal(denied.ok, false)
  assert.match(denied.message, /越权请求已被拒绝/)
})

check('13 外单位可执行已启用版本，但无权读取结果明细', () => {
  const result = executeFilterRule({ ruleCode: 'FILT-0003', operator: outsider })
  assert.ok(result.ok, result.message)
  assert.equal(result.data, undefined)
  assert.match(result.message, /无读取权限/)
  assert.equal(getResultSet('FRES-0004', outsider).ok, false)
})

check('14 条件校验：未知字段、非法运算符、非数字比较值都会被拒绝', () => {
  const base = {
    ruleCode: 'FILT-0001',
    operator: gao,
  }
  const badField = saveRuleConditions({
    ...base,
    fields: { 筛选字段: '不存在字段', 比较运算符: '=', 比较值: '1', 逻辑组合: 'AND（全部满足）', 排序字段: '', 输出行数上限: '50' },
  })
  assert.equal(badField.ok, false)
  const badOperator = saveRuleConditions({
    ...base,
    fields: { 筛选字段: '金额', 比较运算符: '~', 比较值: '100', 逻辑组合: 'AND（全部满足）', 排序字段: '', 输出行数上限: '50' },
  })
  assert.equal(badOperator.ok, false)
  const badValue = saveRuleConditions({
    ...base,
    fields: { 筛选字段: '金额', 比较运算符: '>', 比较值: 'abc', 逻辑组合: 'AND（全部满足）', 排序字段: '', 输出行数上限: '50' },
  })
  assert.equal(badValue.ok, false)
  assert.equal(listRuleVersions('FILT-0001').length, 2)
})

console.log(`\n${passed} 项通过，${failures.length} 项失败`)
if (failures.length) {
  console.error(`未通过：${failures.join('；')}`)
  process.exit(1)
}
