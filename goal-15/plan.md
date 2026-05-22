# Goal 15 Plan

## 需求分析

当前用户通过 `/goal P0` 启动了一次完整的 P0 交付流程。范围覆盖以下六项：

- `P0-1 Collection / Request CRUD`
- `P0-2 Environment CRUD`
- `P0-3 Explorer 搜索过滤`
- `P0-4 请求编辑器基础闭环`
- `P0-5 History 基础回放`
- `P0-6 首次启动与空状态`

整体目标不是单点修补，而是把项目拉到一个“无需 seed 数据即可正常进入并完成基础请求管理”的可用基线。每一项都需要结合前端 UI、Tauri bridge、Rust command 和本地数据持久化来验证，而不是只看单层表现。

## 当前上下文

从仓库结构和现有目标记录可确认：

- 当前项目是 `React 19 + Vite + Tauri 2 + Rust` 的本地 API client。
- 现有测试文件已覆盖多个功能面：
  - `src/App.crud.test.tsx`
  - `src/App.params-headers.test.tsx`
  - `src/App.response-viewer.test.tsx`
  - `src/App.settings.test.tsx`
  - `src/App.auth.transport.test.tsx`
  - `src/App.body.test.tsx`
- 仓库中已有 `goal-1` 到 `goal-14`，其中 `goal-14/plan.md` 明确把 `P0-1` 到 `P0-6` 视为“已完成”的历史上下文。

这意味着本次 `/goal P0` 不能盲目重复开发，也不能直接相信历史状态。需要以当前代码和测试为准重新审计：确认哪些能力已经真实闭环，哪些仍有缺口、回归或只在 UI 层表面存在。

## 风险

- P0 可能已经部分实现，若不先审计，重复改动容易引入回归。
- 多个需求横跨 UI、bridge、Rust、数据层，若只修前端，很容易出现“看起来能用、重载后丢失”的伪完成。
- CRUD、History replay、dirty/save 反馈这类需求，常见风险在异常路径、空状态和跨层同步，而不是 happy path。
- 首次启动与空状态需要兼顾“全空 workspace”和“已有数据 workspace”，否则容易破坏既有用户数据流。
- 之前目标目录中存在“已完成”的上下文，若当前实现与历史记录不一致，需要优先相信代码现状和验证结果，而不是沿用历史结论。

## 执行方案

1. 创建 `goal-15/input.md`、`goal-15/plan.md`、`goal-15/tasks.md`，建立本轮 goal 的执行骨架。
2. 审计当前代码、bridge、Rust storage 和测试，逐条映射 `P0-1` 到 `P0-6` 的现状与缺口。
3. 实现或修复 `P0-1 Collection / Request CRUD`，确保新建、重命名、删除、复制 request 与 collection，以及排序/移动都真实持久化。
4. 做第一次大型全面检查，重点围绕 CRUD 数据一致性、文件持久化、重载恢复和异常路径。
5. 实现或修复 `P0-2 Environment CRUD`。
6. 实现或修复 `P0-3 Explorer 搜索过滤`。
7. 实现或修复 `P0-4 请求编辑器基础闭环`。
8. 做第二次大型全面检查，重点围绕 explorer 过滤、environment 编辑、dirty/save 反馈和交互稳定性。
9. 实现或修复 `P0-5 History 基础回放`。
10. 实现或修复 `P0-6 首次启动与空状态`。
11. 做最终最大的 review，从 C 端体验、代码结构、持久化一致性、安全性和回归风险角度补齐剩余问题，直到 P0 达到可交付状态。

## 验证方式

- 针对当前 task 运行最小必要测试，避免只靠肉眼判断。
- 在关键阶段运行前端测试：
  - `npm test`
- 在关键阶段运行构建验证：
  - `npm run build`
- 在涉及 Rust command / storage 时运行：
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- 进行差异健全性检查：
  - `git diff --check`
- 对需要持久化的能力重点验证：
  - 操作后重载是否保留
  - 删除/重命名后关联数据是否同步
  - 空状态进入后是否能顺利创建首个实体
  - 失败路径是否给出明确反馈且不会污染当前编辑状态

## 回滚方案

- 所有手工代码编辑仅使用 `apply_patch`。
- 不使用破坏性 git 命令。
- 每次只做一个 task，并在 task 结束时先进行“100% 自信”检查，再决定是否收口。
- 若某个需求跨层范围过大，优先先打通数据模型与 bridge，再让 UI 消费，避免形成新的临时状态。
- 若发现历史目标状态与当前代码严重冲突，本轮以“当前代码 + 当前测试结果”为准，在 `tasks.md` 中记录差异和修复内容。
