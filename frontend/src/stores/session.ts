import { defineStore } from 'pinia'

import { KNOWN_OPERATORS, type Operator } from '@/data/filter-engine'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    unit: '数据平台部',
    role: 'admin' as 'admin' | 'member',
    shiftLabel: '白班 08:00-20:00',
    scope: '多维数据探查分析工具',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    identities: () => KNOWN_OPERATORS,
    currentOperator(state): Operator {
      return { name: state.operator, unit: state.unit, role: state.role }
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchIdentity(name: string) {
      const hit = KNOWN_OPERATORS.find((item) => item.name === name)
      if (hit) {
        this.operator = hit.name
        this.unit = hit.unit
        this.role = hit.role
      }
    },
  },
})
