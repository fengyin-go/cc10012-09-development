<template>
  <section class="page" data-module="filter">
    <header class="page-head">
      <div>
        <h2>数据筛选管理</h2>
        <p class="page-desc">维护数据筛选规则的输入、执行约束与结果记录，为数据过滤提供可验证的数据工程流程。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记筛选规则</button>
        <button class="btn" type="button" @click="exportRows">导出数据筛选清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="selectRule(row)">执行/版本</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无数据筛选数据，可先登记筛选规则</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条数据筛选记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section v-if="activeRule" class="panel">
      <h3>规则执行 · {{ activeRule['规则编号'] }}</h3>
      <p class="hint">
        负责人 {{ activeRule['负责人'] }} · 归属单位 {{ activeRule['归属单位'] }} · 当前版本 {{ activeRule['当前版本'] }}；
        当前身份 {{ store.operator }}（{{ store.unit }}）。只有规则负责人可以改写条件，跨单位执行只能读取已启用版本。
      </p>

      <h4>规则版本（条件口径以版本为依据，下游不能混合不同版本的命中行）</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>版本</th><th>状态</th><th>负责人</th><th>归属单位</th><th>筛选条件</th><th>排序</th><th>上限</th><th>保存时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in versions" :key="item.version">
            <td>v{{ item.version }}</td>
            <td>{{ item.status }}</td>
            <td>{{ item.owner }}</td>
            <td>{{ item.unit }}</td>
            <td>{{ conditionText(item.conditionSet) }}</td>
            <td>{{ item.sortField || '—' }}</td>
            <td>{{ item.outputLimit }}</td>
            <td>{{ item.savedAt }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="execute(item.version)">执行</button>
              <button class="link" type="button" @click="enable(item.version)">启用</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        <button class="btn primary" type="button" @click="execute()">按当前身份执行规则</button>
      </p>

      <h4>改写条件（仅规则负责人可保存，保存即生成新版本）</h4>
      <form class="filter-bar" @submit.prevent="saveConditions">
        <label class="filter-item">
          <span>筛选字段</span>
          <input v-model="editForm.筛选字段" placeholder="如：金额,区域" />
        </label>
        <label class="filter-item">
          <span>比较运算符</span>
          <input v-model="editForm.比较运算符" placeholder="如：>,=" />
        </label>
        <label class="filter-item">
          <span>比较值</span>
          <input v-model="editForm.比较值" placeholder="如：100,华东" />
        </label>
        <label class="filter-item">
          <span>逻辑组合</span>
          <select v-model="editForm.逻辑组合">
            <option>AND（全部满足）</option>
            <option>OR（任一满足）</option>
          </select>
        </label>
        <label class="filter-item">
          <span>排序字段</span>
          <input v-model="editForm.排序字段" placeholder="如：金额 降序" />
        </label>
        <label class="filter-item">
          <span>输出行数上限</span>
          <input v-model="editForm.输出行数上限" placeholder="如：20" />
        </label>
        <button class="btn primary" type="submit">保存为新版本</button>
      </form>

      <h4>移交负责人（负责人或管理员）</h4>
      <form class="filter-bar" @submit.prevent="transfer">
        <label class="filter-item">
          <span>新负责人</span>
          <input v-model="transferForm.owner" placeholder="如：陈默" />
        </label>
        <label class="filter-item">
          <span>新归属单位</span>
          <input v-model="transferForm.unit" placeholder="如：华东事业部" />
        </label>
        <button class="btn" type="submit">移交</button>
      </form>

      <h4>版本冲突核对（两个负责人先后保存的条件都保留版本依据）</h4>
      <div class="filter-bar">
        <label class="filter-item">
          <span>版本 A</span>
          <select v-model.number="compareForm.a">
            <option v-for="item in versions" :key="item.version" :value="item.version">
              v{{ item.version }} · {{ item.owner }}
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>版本 B</span>
          <select v-model.number="compareForm.b">
            <option v-for="item in versions" :key="item.version" :value="item.version">
              v{{ item.version }} · {{ item.owner }}
            </option>
          </select>
        </label>
        <button class="btn" type="button" @click="runCompare">比较两种做法</button>
      </div>
      <div v-if="compareResult" class="compare-grid">
        <div class="compare-card">
          <strong>v{{ compareResult.a.version.version }} · {{ compareResult.a.version.owner }}</strong>
          <p>{{ conditionText(compareResult.a.version.conditionSet) }}</p>
          <p>命中 {{ compareResult.a.hits }} 行</p>
        </div>
        <div class="compare-card">
          <strong>v{{ compareResult.b.version.version }} · {{ compareResult.b.version.owner }}</strong>
          <p>{{ conditionText(compareResult.b.version.conditionSet) }}</p>
          <p>命中 {{ compareResult.b.hits }} 行</p>
        </div>
        <p class="hint">
          共同命中 {{ compareResult.bothIds.length }} 行；
          仅 v{{ compareResult.a.version.version }} 命中 {{ compareResult.onlyAIds.length }} 行（订单 id：{{ compareResult.onlyAIds.join('、') || '无' }}）；
          仅 v{{ compareResult.b.version.version }} 命中 {{ compareResult.onlyBIds.length }} 行（订单 id：{{ compareResult.onlyBIds.join('、') || '无' }}）。
          下游只能绑定单一版本的筛选结果记录集，不能混合两个版本的命中行。
        </p>
      </div>

      <p v-if="panelMessage" :class="panelOk ? 'msg-ok' : 'msg-err'">{{ panelMessage }}</p>
    </section>

    <section class="panel">
      <h3>筛选结果记录集</h3>
      <p class="hint">
        按「规则编号#版本」幂等发布，竞态重试只生成一份；命中行可通过过滤条件核对；
        仅负责人、归属单位与管理员可读，越权请求会被拒绝；重新进入后仍可检查。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>结果编号</th><th>规则</th><th>版本</th><th>负责人</th><th>归属单位</th><th>执行人</th>
            <th>命中行数</th><th>返回行数</th><th>截断</th><th>生成时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="set in resultSets" :key="set.id">
            <td>{{ set.id }}</td>
            <td>{{ set.ruleCode }}</td>
            <td>v{{ set.ruleVersion }}</td>
            <td>{{ set.owner }}</td>
            <td>{{ set.unit }}</td>
            <td>{{ set.executor }}</td>
            <td>{{ set.totalHits }}</td>
            <td>{{ set.returnedCount }}</td>
            <td>
              <span v-if="set.truncated" class="badge warn">已截断</span>
              <span v-else class="badge">完整</span>
            </td>
            <td>{{ set.createdAt }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="toggleSet(set.id)">命中行</button>
              <button class="link" type="button" @click="audit(set.id)">核对</button>
            </td>
          </tr>
          <tr v-if="!resultSets.length">
            <td colspan="11" class="empty-state">当前身份下暂无可读的筛选结果记录集</td>
          </tr>
        </tbody>
      </table>

      <div v-if="expandedDetail" class="panel-sub">
        <h4>{{ expandedDetail.id }} 命中行（{{ conditionText(expandedDetail.conditionSet) }}）</h4>
        <p class="hint">
          共命中 {{ expandedDetail.totalHits }} 行，返回 {{ expandedDetail.returnedCount }} 行
          <span v-if="expandedDetail.truncated" class="badge warn">
            已截断：只返回规则负责人可见的 {{ expandedDetail.returnedCount }} 行
          </span>
        </p>
        <table class="data-table">
          <thead>
            <tr>
              <th>订单编号</th><th>金额</th><th>区域</th><th>品类</th><th>客户等级</th><th>下单日期</th><th>归属单位</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in expandedDetail.rows" :key="row.id">
              <td>{{ row.订单编号 }}</td>
              <td>{{ row.金额 }}</td>
              <td>{{ row.区域 }}</td>
              <td>{{ row.品类 }}</td>
              <td>{{ row.客户等级 }}</td>
              <td>{{ row.下单日期 }}</td>
              <td>{{ row.归属单位 }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul v-if="auditLines.length" class="audit-list">
        <li v-for="line in auditLines" :key="line" :class="line.startsWith('通过') ? 'msg-ok' : 'msg-err'">
          {{ line }}
        </li>
      </ul>
      <p v-if="setsMessage" :class="setsOk ? 'msg-ok' : 'msg-err'">{{ setsMessage }}</p>
    </section>

    <section class="panel">
      <h3>订单记录（源数据表，只读可追溯）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>订单编号</th><th>金额</th><th>区域</th><th>品类</th><th>客户等级</th><th>下单日期</th><th>归属单位</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in orders" :key="row.id">
            <td>{{ row.订单编号 }}</td>
            <td>{{ row.金额 }}</td>
            <td>{{ row.区域 }}</td>
            <td>{{ row.品类 }}</td>
            <td>{{ row.客户等级 }}</td>
            <td>{{ row.下单日期 }}</td>
            <td>{{ row.归属单位 }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  auditResultSet,
  compareRuleVersions,
  conditionSetText,
  enableRuleVersion,
  executeFilterRule,
  getResultSet,
  listOrders,
  listRuleVersions,
  listVisibleResultSets,
  saveRuleConditions,
  transferRuleOwnership,
  type ConditionSet,
  type FilterResultSet,
  type RuleVersion,
  type VersionCompare,
} from '@/api/filter-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('filter')
const columns = ["规则编号", "目标数据集", "筛选字段", "比较运算符", "比较值", "逻辑组合", "排序字段", "输出行数上限"]
const actions = ["提交校验", "启用规则", "停用规则"]
const statuses = ["草稿", "待校验", "已启用", "已停用"]
const stats = [{"label": "筛选规则总数", "value": 0}, {"label": "已启用规则", "value": 0}, {"label": "待校验规则", "value": 0}]

const store = useSessionStore()
const operator = computed(() => store.currentOperator)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const orders = listOrders()
const activeRuleCode = ref('')
const activeRule = computed(() =>
  rows.value.find((row) => String(row['规则编号']) === activeRuleCode.value),
)
const versions = ref<RuleVersion[]>([])
const resultSets = ref<FilterResultSet[]>([])
const editForm = reactive({
  筛选字段: '',
  比较运算符: '',
  比较值: '',
  逻辑组合: 'AND（全部满足）',
  排序字段: '金额 降序',
  输出行数上限: '20',
})
const transferForm = reactive({ owner: '', unit: '' })
const compareForm = reactive({ a: 0, b: 0 })
const compareResult = ref<VersionCompare>()
const panelMessage = ref('')
const panelOk = ref(true)
const setsMessage = ref('')
const setsOk = ref(true)
const expandedId = ref('')
const expandedDetail = ref<FilterResultSet>()
const auditLines = ref<string[]>([])

function conditionText(set: ConditionSet): string {
  return conditionSetText(set)
}

function selectRule(row: EntryRow) {
  activeRuleCode.value = String(row['规则编号'])
  editForm.筛选字段 = String(row['筛选字段'] ?? '')
  editForm.比较运算符 = String(row['比较运算符'] ?? '')
  editForm.比较值 = String(row['比较值'] ?? '')
  editForm.逻辑组合 = String(row['逻辑组合'] ?? 'AND（全部满足）')
  editForm.排序字段 = String(row['排序字段'] ?? '')
  editForm.输出行数上限 = String(row['输出行数上限'] ?? '20')
  compareResult.value = undefined
  panelMessage.value = ''
  refreshPanels()
}

function refreshResultSets() {
  resultSets.value = listVisibleResultSets(operator.value)
}

function refreshPanels() {
  if (activeRuleCode.value) {
    versions.value = listRuleVersions(activeRuleCode.value)
    if (versions.value.length) {
      compareForm.a = versions.value[0].version
      compareForm.b = versions.value[versions.value.length - 1].version
    }
  }
  refreshResultSets()
}

function execute(version?: number) {
  const result = executeFilterRule({ ruleCode: activeRuleCode.value, operator: operator.value, version })
  panelOk.value = result.ok
  panelMessage.value = result.message
  refreshResultSets()
}

function saveConditions() {
  const result = saveRuleConditions({
    ruleCode: activeRuleCode.value,
    operator: operator.value,
    fields: { ...editForm },
  })
  panelOk.value = result.ok
  panelMessage.value = result.message
  reload()
  refreshPanels()
}

function enable(version: number) {
  const result = enableRuleVersion(activeRuleCode.value, version, operator.value)
  panelOk.value = result.ok
  panelMessage.value = result.message
  reload()
  refreshPanels()
}

function transfer() {
  const result = transferRuleOwnership({
    ruleCode: activeRuleCode.value,
    operator: operator.value,
    newOwner: transferForm.owner,
    newUnit: transferForm.unit,
  })
  panelOk.value = result.ok
  panelMessage.value = result.message
  reload()
  refreshPanels()
}

function runCompare() {
  if (!compareForm.a || !compareForm.b) {
    panelOk.value = false
    panelMessage.value = '请先选择两个版本'
    return
  }
  const result = compareRuleVersions(activeRuleCode.value, compareForm.a, compareForm.b, operator.value)
  panelOk.value = result.ok
  panelMessage.value = result.message
  compareResult.value = result.data
}

function toggleSet(id: string) {
  if (expandedId.value === id) {
    expandedId.value = ''
    expandedDetail.value = undefined
    return
  }
  const result = getResultSet(id, operator.value)
  setsOk.value = result.ok
  setsMessage.value = result.message
  if (result.ok && result.data) {
    expandedId.value = id
    expandedDetail.value = result.data
  }
}

function audit(id: string) {
  const result = auditResultSet(id, operator.value)
  setsOk.value = result.ok
  setsMessage.value = result.message
  auditLines.value = result.data ?? []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '筛选规则登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据筛选列表读取失败'
  }
}

watch(
  () => store.operator,
  () => {
    expandedId.value = ''
    expandedDetail.value = undefined
    auditLines.value = []
    refreshPanels()
  },
)

onMounted(() => {
  reload()
  refreshResultSets()
})
</script>
