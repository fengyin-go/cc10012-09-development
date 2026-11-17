// tsc 编译产物是 CommonJS，但仓库 package.json 是 "type": "module"，
// 这里给输出目录补一个 {"type":"commonjs"} 再入口验收脚本。
const fs = require('node:fs')
const path = require('node:path')

const outDir = path.join(__dirname, '..', '.verify-out')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }))

require(path.join(outDir, 'scripts', 'verify-filter.js'))
