# Goal 6 Plan

## 需求分析

当前 active goal 的下一个最高优先级未完成项是 `P0-1 Collection / Request CRUD`。目标不仅包括新建、重命名、删除、复制这些基础 CRUD，还明确包含 `排序与移动`。这意味着本轮不能只做到“最小 CRUD 壳子”，还需要把 collection 顺序调整、request 顺序调整，以及 request 跨 collection 移动补成真正可持久化的闭环。

本轮目标：

- 为 `Collection / Request CRUD` 建立独立 goal 文档和任务链。
- 先梳理当前数据模型、bridge 命令和 UI 缺口。
- 先完成基础 CRUD，再补上最小可用的排序与移动能力；拖拽不是必须，但顺序调整和跨 collection 移动必须有真实路径。

## 当前上下文

已完成：

- `P0-3 Explorer 搜索过滤`
- `P0-4 请求编辑器基础闭环`
- `P0-5 History 基础回放`
- `P0-6 首次启动与空状态` 已完成实现与验证，空环境链路也已补到可创建首个本地 environment。

当前和 `P0-1` 直接相关的现状：

- Rust 数据层当前只有 `save_request()`，能更新或创建 collection 文件中的 request。
- `save_request()` 已会把新 collection 自动挂到 default workspace。
- 目前没有显式的 create / rename / delete / duplicate / move collection/request 命令。
- 前端侧栏能展示 collection tree，但没有真正的管理操作入口。

## 风险

- 如果把“排序与移动”继续当作后续能力跳过，就会和 `P0-1` 原始完成标准不一致，导致 task 看起来完成但实际未达标。
- 如果只做 UI 而不补 storage / command，仍然会回到“看起来能点，但没有持久化”。
- 如果删除 collection/request 不同步 workspace 文件，数据层会残留悬挂引用。
- 如果 collection 顺序仍在 `list_collections()` 中被字母排序，后端即使支持移动，前端也看不到真实结果。

## 执行方案

1. 创建 `goal-6/input.md`、`goal-6/plan.md`、`goal-6/tasks.md`。
2. 梳理 `Collection / Request` 的现有模型、命令、持久化路径和 UI 入口。
3. 先实现基础数据层与 bridge 能力：
   - create request
   - duplicate request
   - rename request
   - delete request
   - create collection
   - delete collection
4. 在基础 CRUD 之上补最小可用的排序与移动：
   - move collection（workspace 内顺序调整）
   - reorder request（collection 内顺序调整）
   - move request（跨 collection 移动并持久化）
5. 再接前端操作入口，优先让空工作区和已存在 collection 两条路径都能用。
6. 做构建、存储测试和真实路径审计。

## 验证方式

- 相关 Rust storage / command 测试覆盖 create / delete / duplicate / rename / reorder / move 的核心路径。
- `npm run build` 通过。
- `git diff --check` 通过。
- 真实页面中能至少完成：
  - 创建第一个 request
  - 保存到新 collection
  - duplicate request
  - 删除 request
  - 删除空 collection 或连带删除 collection 中最后一个 request 的合理处理
  - 调整 collection 顺序后刷新仍保持
  - request 在 collection 内排序后刷新仍保持
  - request 移动到另一个 collection 后两边状态和落盘结果都正确

## 回滚方案

- 所有代码编辑使用 `apply_patch`。
- 不使用破坏性 git 命令。
- 若发现某一步范围过大，优先缩回到更小的 CRUD 子集，而不是继续扩张。
