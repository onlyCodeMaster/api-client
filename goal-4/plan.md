# Goal 4 Plan

## 需求分析

用户反馈“现在完全就不可用”，并质疑此前是否认真思考。这不是普通样式反馈，而是可用性事故，需要停止以“看起来更像 Postman”为主要目标，转为真实产品可用性排查和修复。

本轮目标：证明并修复当前 API Client 的实际不可用点，让用户能在真实页面上完成最小核心流程：

- 打开应用后首屏可理解、可操作。
- 能找到并编辑请求 method、URL、Params / Headers / Body / Auth。
- 能看到 Send / Save，且不会被布局挤掉或藏到下方。
- 能看到响应查看器，不会被工具抽屉、Explorer 或 Settings 挤掉。
- Collections / History / Environments / Settings / Import / Files 至少可达且不会破坏主流程。
- 浏览器运行态无本地应用控制台错误。

## 当前上下文

`goal-3` 已做过布局重构，尝试把主请求/响应区域改成 workbench，并把辅助工具移到 drawer。但用户明确表示“完全不可用”，说明此前的验收标准可能过低，或者真实交互上仍存在严重问题。

本轮不能只依赖已有任务记录，也不能只看构建通过。必须重新打开页面，从用户视角逐项操作和检查。

## 风险

- 可能存在视觉指标“通过”但实际交互不可用：例如首屏被 header 占满、输入框太低、响应区仍需滚动、工具 drawer 位置混乱。
- 可能存在 CSS grid 高度/滚动容器导致实际点击或编辑困难。
- 可能存在过度模拟 Postman 导致移动宽度反而更难用。
- 如果只继续微调会浪费时间；必须先找“不可用”的根因。

## 执行方案

1. 创建 `goal-4/input.md`、`goal-4/plan.md`、`goal-4/tasks.md`，保存原始反馈并建立事故排查计划。
2. 做真实可用性审计：启动页面，按核心用户流程操作，收集 DOM、截图、控制台、布局指标和失败点。
3. 只修复一个最阻断的不可用问题，优先保证首屏和核心请求流程可用。
4. 每三个 task 做一次大型全面检查 - debug 循环。
5. 最终审计必须重新执行最小用户路径：打开页面、编辑 URL、切换 tabs、打开/关闭工具、切 Settings/History、确认主流程仍可用。

## 验证方式

- `npm run build`
- `git diff --check`
- `npm run dev`
- in-app browser 真实运行态检查
- 关键 DOM 指标：可见区域、滚动高度、横向溢出、request editor、URL bar、Send、response panel、tool drawer、inspector
- 交互验证：点击、输入 URL、切 tab、打开工具、切 Settings/History、返回主流程
- 控制台错误检查

## 回滚方案

- 所有手工编辑使用 `apply_patch`。
- 不使用 `git reset --hard`、`git checkout --` 等破坏性命令。
- 若发现 goal-3 的布局重构是根因，优先用定点补丁修正，而不是盲目继续叠样式。
- 若某个改动让主流程更差，立刻反向补丁回退该 task 的改动。
