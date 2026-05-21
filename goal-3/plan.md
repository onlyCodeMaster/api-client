# Goal 3 Plan

## 需求分析

用户指出当前整体页面布局仍存在明显问题，和 Postman 差异太大。由于当前处于 active goal，本轮必须按 goal workflow 执行，先创建 `goal-3/input.md`、`goal-3/plan.md`、`goal-3/tasks.md`，在三份文件完成前不修改代码。

本轮目标不是新增 API Client 后端能力，而是对现有前端整体布局进行真实审查和修缮，使页面更接近 Postman 类 API Client 的基础信息架构和使用体验。

可落地的验收标准：

- 左侧应有清晰的 workspace / collection / history / environment / settings 导航结构，不应像普通 dashboard。
- 中间主区域应突出请求编辑器，包含请求标签、method + URL bar、Params / Auth / Headers / Body 等编辑区。
- 右侧或下方响应区域应有明确响应查看器，包含 Body / Headers / Timeline 等分区。
- 导入、文件、环境、设置等辅助能力不能挤占主要请求发送流程。
- 页面密度、分栏比例、面板边界、滚动行为、移动端可达性应更像专业 API 工具，而不是营销页或卡片堆叠。
- 必须通过真实浏览器运行态检查，而不能只凭代码想象。

## 当前上下文

前一轮 `goal-2` 已完成大量功能：请求编辑、Tauri bridge、HTTP、Cookie、Proxy/TLS、cURL/Postman、文件传输、SQLite、JSON/YAML、Keychain、cache/log 等。当前问题聚焦在前端视觉和布局体验。

需要重新检查当前实际 `src/App.tsx`、`src/styles.css` 和运行态页面，不依赖此前“功能已完成”的结论来判断 UI 是否达标。

## 风险

- “像 Postman”不能简单复制品牌视觉或逐像素复刻，应提炼 API Client 的通用布局规律。
- 过度大改可能破坏已经实现的功能入口和 Tauri invoke 流程。
- 当前 CSS 可能已有大量响应式规则，改动时要避免移动端入口再次不可达。
- 运行态检查可能受 Tauri 环境限制；至少需要用 Vite + browser 验证页面结构、滚动、可见性和控制台错误。

## 执行方案

1. 建立 `goal-3` 三件套，完整保存本次输入、计划和任务拆解。
2. 审计当前布局：读取前端文件、运行页面、截图或 DOM 检查，形成与 Postman 类布局的差距清单。
3. 选择一个最关键、可验证的布局重构 task，优先修复整体信息架构和主工作台骨架。
4. 每次只做一个 task；每个 task 完成前执行自信度检查，必要时继续修复。
5. 每三个 task 执行一次大型全面检查 - debug 循环，重点覆盖视觉布局、响应式、构建和无控制台错误。
6. 全部布局任务完成后，做最终审计：把用户“整体页面布局”和“和 Postman 差异太大”转成可检查清单，逐项验证。

## 验证方式

- 代码审计：读取 `src/App.tsx`、`src/styles.css`、相关 store / component 结构。
- 构建验证：`npm run build`。
- 运行态验证：`npm run dev`，使用 in-app browser 打开 `http://localhost:1420/` 检查页面。
- 视觉验证：必要时截图，检查布局层级、比例、主操作路径、响应区、侧边栏和窄屏行为。
- 回归验证：确认核心入口仍存在：Send、Save、Params、Headers、Body、Auth、response tabs、History、Environments、Settings、Import cURL/Postman、Files。

## 回滚方案

- 所有手工编辑通过 `apply_patch` 完成。
- 不使用 `git reset --hard`、`git checkout --` 等破坏性命令。
- 若布局重构引入明显功能缺失，优先用反向补丁回滚本 task 改动。
- 每个 task 只触碰必要前端文件，避免混入 Rust core 无关改动。
