# 多维数据探查分析工具

离线版多维数据探查分析工具，涵盖数据源接入、交互查询、聚合统计、图表看板、预警通知与数据导出，所有分析配置与结果持久化到浏览器本地存储。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 交互查询 | `query` | 查询语句 | 语句编号、查询表达式、目标数据集 |
| 可视化图表 | `chart` | 图表配置 | 图表编号、图表名称、图表类型 |
| 数据源接入 | `source` | 接入配置 | 配置编号、连接类型、接入地址 |
| 聚合计算 | `aggregate` | 聚合方案 | 方案编号、聚合函数、目标字段 |
| 数据筛选 | `filter` | 筛选规则 | 规则编号、目标数据集、筛选字段 |
| 报告生成 | `reportgen` | 报告模板 | 模板编号、模板名称、包含图表 |
| 异常检测 | `anomaly` | 检测规则 | 规则编号、监控指标、基线均值 |
| 多维下钻 | `drill` | 下钻路径 | 路径编号、起点维度、下钻层数 |
| 对比分析 | `compare` | 对比方案 | 方案编号、基准数据集、对照数据集 |
| 分析流水线 | `pipeline` | 流水线节点 | 节点编号、节点类型、输入源 |
| 数据集管理 | `datastore` | 数据集定义 | 数据集编号、数据集名称、来源表名 |
| 趋势预测 | `forecast` | 预测模型 | 模型编号、模型类型、训练数据集 |
| 预警通知 | `alert` | 预警规则 | 规则编号、关联指标、阈值上界 |
| 查询缓存 | `cache` | 缓存策略 | 策略编号、目标查询、缓存键规则 |
| 数据标签 | `tag` | 标签定义 | 标签编号、标签名称、计算表达式 |
| 数据导出 | `export` | 导出任务 | 任务编号、查询SQL、导出格式 |
| 数据分享 | `share` | 分享链接 | 链接编号、目标数据集、访问密码 |
| 定时任务 | `schedule` | 调度配置 | 配置编号、关联任务、调度表达式 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `data-explore-studio:entries` 这一项，或调用 `resetModule(模块)`。

## 筛选规则执行与筛选结果记录集

数据筛选模块在条件配置之外新增了规则执行：读取订单记录与筛选规则，按筛选字段、比较运算符和
逻辑组合过滤行，生成可核对的筛选结果记录集。

- `frontend/src/data/orders.ts`：订单记录源数据表（66 行示例订单，持久化键
  `data-explore-studio:orders`），筛选页底部只读展示，数据表内容可追溯。
- `frontend/src/data/filter-store.ts`：规则版本（`data-explore-studio:filter-rule-versions`）与
  筛选结果记录集（`data-explore-studio:filter-result-sets`）的本地持久化，重新进入后可检查。
- `frontend/src/data/filter-engine.ts`：执行引擎，页面经 `frontend/src/api/filter-service.ts` 调用：
  - 只有规则负责人可以改写条件（保存即生成新版本）；跨单位执行只能读取已启用版本。
  - 执行按「规则编号#版本」幂等发布：竞态重试只生成一份结果集；执行期间规则被并发更新则
    放弃发布，只允许发布一份完整命中结果，避免混入未授权条件。
  - 结果集记录规则版本、负责人与归属单位并据此决定只读权限，越权请求会被拒绝；
    命中行可通过过滤条件逐行核对（结果集列表的「核对」按钮）。
  - 两个负责人先后保存的条件都保留版本依据，可在筛选页做版本冲突核对（比较两种做法）；
    下游只能绑定单一版本的结果集，不能混合不同规则版本的命中行。
- 多维下钻页可直接选择筛选结果记录集做分维度下钻，钻取明细与命中行一致。
- 头部可切换值班身份（值班管理员 / 林岚 / 陈默 / 高翔 / 外单位访客），用于核对负责人权限、
  跨单位执行限制与越权拒绝。
- 验收口径：FILT-0003（金额 > 100 且区域 = 华东）命中 25 行，只返回规则负责人可见的 20 行
  并标明「已截断」。

验收自测（无需浏览器，Node 直接跑通上述全部场景）：

```bash
make verify          # 或 cd frontend && npm run verify
```

领域：数据工程
子方向：数据分析与数据应用
