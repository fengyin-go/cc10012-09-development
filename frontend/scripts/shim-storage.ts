// 在 Node 里垫上 localStorage，让数据层的持久化路径（重新进入后的读取）也能被验收。
const mem = new Map<string, string>()

const storage = {
  getItem: (key: string): string | null => (mem.has(key) ? (mem.get(key) as string) : null),
  setItem: (key: string, value: string): void => {
    mem.set(key, String(value))
  },
  removeItem: (key: string): void => {
    mem.delete(key)
  },
}

;(globalThis as Record<string, unknown>).window = { localStorage: storage }

export function storageDump(): Map<string, string> {
  return new Map(mem)
}
