<template>
  <section class="page" data-module="drill">
    <header class="page-head">
      <div>
        <h2>多维下钻管理</h2>
        <p class="page-desc">维护多维下钻路径的输入、执行约束与结果记录，为数据探查提供可验证的数据工程流程。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记下钻路径</button>
        <button class="btn" type="button" @click="exportRows">导出多维下钻清单</button>
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
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无多维下钻数据，可先登记下钻路径</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条多维下钻记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="panel">
      <h3>筛选结果记录集下钻（跨模块）</h3>
      <p class="hint">
        钻取明细直接来自数据筛选模块发布的筛选结果记录集命中快照，命中行与钻取明细一致；
        结果集只读，越权访问会被拒绝。
      </p>
      <div class="filter-bar">
        <label class="filter-item">
          <span>筛选结果记录集</span>
          <select v-model="drillSetId">
            <option v-for="set in drillSets" :key="set.id" :value="set.id">
              {{ set.id }} · {{ set.ruleCode }} v{{ set.ruleVersion }} · {{ set.owner }}
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>下钻维度</span>
          <select v-model="drillDim">
            <option v-for="dim in drillDimensions" :key="dim">{{ dim }}</option>
          </select>
        </label>
        <button class="btn" type="button" @click="runDrill">下钻</button>
      </div>
      <p v-if="drillMessage" class="msg-err">{{ drillMessage }}</p>
      <p v-if="!drillSets.length" class="hint">当前身份下没有可读的筛选结果记录集，请先在数据筛选模块执行规则。</p>

      <template v-if="drillGroups.length">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ drillDim }}</th>
              <th>命中行数</th>
              <th>金额合计</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in drillGroups" :key="group.value">
              <td>{{ group.value }}</td>
              <td>{{ group.count }}</td>
              <td>{{ group.amountSum }}</td>
              <td>
                <button class="link" type="button" @click="showGroup(group)">查看明细</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="hint">
          各分组行数合计 {{ groupTotal }} 行 = 结果集 {{ drillSetInfo?.id }} 返回行数
          {{ drillSetInfo?.returnedCount }}，命中行与钻取明细一致。
        </p>
      </template>

      <div v-if="drillDetail.length" class="panel-sub">
        <h4>{{ drillDim }} = {{ drillActiveGroup }} 的钻取明细（{{ drillDetail.length }} 行）</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>订单编号</th><th>金额</th><th>区域</th><th>品类</th><th>客户等级</th><th>下单日期</th><th>归属单位</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in drillDetail" :key="row.id">
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
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  DRILL_DIMENSIONS,
  drillResultSet,
  listVisibleResultSets,
  type DrillGroup,
  type FilterResultSet,
  type OrderRow,
} from '@/api/filter-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('drill')
const columns = ["路径编号", "起点维度", "下钻层数", "层级维度列表", "聚合指标", "默认展开层", "排序方向", "最多展示行数"]
const actions = ["提交校验", "启用路径", "停用路径"]
const statuses = ["草稿", "待校验", "已启用", "已停用"]
const stats = [{"label": "下钻路径总数", "value": 0}, {"label": "已启用路径", "value": 0}, {"label": "待校验路径", "value": 0}]

const store = useSessionStore()

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

const drillDimensions = DRILL_DIMENSIONS
const drillSets = ref<FilterResultSet[]>([])
const drillSetId = ref('')
const drillDim = ref<string>('区域')
const drillGroups = ref<DrillGroup[]>([])
const drillDetail = ref<OrderRow[]>([])
const drillActiveGroup = ref('')
const drillMessage = ref('')
const drillSetInfo = ref<FilterResultSet>()
const groupTotal = computed(() => drillGroups.value.reduce((sum, group) => sum + group.count, 0))

function refreshDrillSets() {
  drillSets.value = listVisibleResultSets(store.currentOperator)
  if (!drillSets.value.some((set) => set.id === drillSetId.value)) {
    drillSetId.value = drillSets.value.length ? drillSets.value[0].id : ''
  }
}

function runDrill() {
  drillMessage.value = ''
  drillDetail.value = []
  drillActiveGroup.value = ''
  if (!drillSetId.value) {
    drillGroups.value = []
    drillMessage.value = '请先选择筛选结果记录集'
    return
  }
  const result = drillResultSet(drillSetId.value, drillDim.value, store.currentOperator)
  if (!result.ok || !result.data) {
    drillGroups.value = []
    drillSetInfo.value = undefined
    drillMessage.value = result.message
    return
  }
  drillGroups.value = result.data.groups
  drillSetInfo.value = result.data.set
}

function showGroup(group: DrillGroup) {
  drillActiveGroup.value = group.value
  drillDetail.value = group.rows
}

watch(
  () => store.operator,
  () => {
    drillGroups.value = []
    drillDetail.value = []
    drillSetInfo.value = undefined
    drillMessage.value = ''
    refreshDrillSets()
  },
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '下钻路径登记入口尚未接入审批流'
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
    errorMessage.value = error instanceof Error ? error.message : '多维下钻列表读取失败'
  }
}

onMounted(() => {
  reload()
  refreshDrillSets()
})
</script>
