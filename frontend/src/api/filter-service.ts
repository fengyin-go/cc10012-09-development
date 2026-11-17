// 筛选规则执行的 API 层：页面统一从这里读写，业务判断都在 data/filter-engine.ts。
export * from '@/data/filter-engine'
export { listResultSets, listRuleVersions } from '@/data/filter-store'
export type { ConditionSet, FilterResultSet, RuleVersion } from '@/data/filter-store'
export { listOrders, ORDER_FIELDS, ordersStorageKey, resetOrders } from '@/data/orders'
export type { OrderRow } from '@/data/orders'
