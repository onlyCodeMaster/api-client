# Goal 7 Plan

## 需求分析

当前 active goal 的下一个最高优先级未完成项是 `P0-2 Environment CRUD`。目标不只是“能切环境、能保存当前文件”，而是要把 environment 变成真正可管理的实体，至少补齐：

- 新建 environment
- 重命名 environment
- 删除 environment
- 新增变量
- 删除变量
- 编辑变量

完成标准是：environment 管理不再只限于切换和保存现有项。

## 当前上下文

已完成：

- `P0-1 Collection / Request CRUD`
- `P0-3 Explorer 搜索过滤`
- `P0-4 请求编辑器基础闭环`
- `P0-5 History 基础回放`
- `P0-6 首次启动与空状态`

和 `P0-2` 直接相关的现状：

- Rust / bridge 已有 `save_environment()`，可以持久化现有 environment 文件。
- 前端已经有 `handleCreateFirstEnvironment()`，能在“无环境”场景创建首个本地 environment。
- 前端 `Environments` 面板可以展示当前环境变量，并允许直接编辑值。
- 但还没有完整的 create / rename / delete 命令，也没有完整的变量增删操作入口。

## 风险

- 如果只补 UI，不补 storage / command，会再次出现“看起来能改，实际上不落盘”的假闭环。
- 如果 rename / delete environment 不同步当前活动 environment 状态，可能出现 active id 指向不存在对象。
- 如果变量增删只改前端不校验 persistence，build 过了也不代表完成标准达成。
- `handleCreateFirstEnvironment()` 已经存在，后续新增完整 CRUD 时要避免逻辑分叉和重复路径。

## 执行方案

1. 创建 `goal-7/input.md`、`goal-7/plan.md`、`goal-7/tasks.md`。
2. 梳理当前 Environment 模型、storage 路径、bridge 命令、前端状态与 UI 缺口。
3. 先补最小数据层 / bridge CRUD：
   - create environment
   - rename environment
   - delete environment
4. 再接前端操作入口：
   - 新建 environment
   - 重命名 environment
   - 删除 environment
   - 新增变量
   - 删除变量
5. 为 environment 变量编辑路径补更明确的保存 / dirty / 空状态反馈。
6. 做构建、测试和真实交互审计。

## 验证方式

- Rust storage / command 测试覆盖 create / rename / delete environment。
- 前端交互测试覆盖：
  - 新建 environment
  - 重命名 environment
  - 删除 environment
  - 新增变量
  - 删除变量
  - 编辑变量并保存
- `npm run build` 通过。
- `git diff --check` 通过。
- 若需要，补充真实页面审计确认空环境与多环境切换路径无回退。

## 回滚方案

- 所有代码编辑使用 `apply_patch`。
- 不使用破坏性 git 命令。
- 若发现环境 CRUD 范围膨胀，优先守住 `P0-2` 的最小完成标准，不提前扩展到 secret 管理或高级变量引用。
