# Goal 4 Tasks

- [x] Task 1: 创建 `goal-4/input.md`、`goal-4/plan.md`、`goal-4/tasks.md`
  - 目标：按 active goal workflow 创建新的递增 goal 目录，完整保存用户原始反馈，并建立可用性事故排查计划。
  - 独立验证：三份文件存在，`input.md` 逐字保留用户输入，`plan.md` 包含需求、上下文、风险、执行方案、验证方式、回滚方案。
  - 完成内容：已创建 `goal-4/` 三件套；`input.md` 逐字保存用户原始反馈；`plan.md` 写入可用性事故需求分析、当前上下文、风险、执行方案、验证方式和回滚方案；`tasks.md` 建立真实可用性审计、修复、全面检查和最终判定任务链。
  - 自信度检查：已用 `test -f` 验证三份文件存在，并用 `cat goal-4/input.md` 确认原始反馈未改写；当前 task 不修改业务代码，具备 100% 结束信心。

- [x] Task 2: 真实可用性事故审计
  - 目标：不先改代码，重新打开当前页面并按用户核心路径操作，找出“完全不可用”的真实阻断点。
  - 独立验证：形成可用性检查表，包含启动、首屏、编辑、发送入口、响应区、辅助面板、控制台和布局指标证据。
  - 完成内容：完成真实可用性事故审计；没有先改代码，而是重新构建、启动、打开页面，并按核心用户路径执行编辑 URL、切换 Body、打开 Files、切换 Settings 等操作。
  - 审计检查表：
    - 构建：`npm run build` 通过，产物包含 `dist/index.html`、`dist/assets/index-BKl13Ah2.css`、`dist/assets/index-CRLW-T0i.js`。
    - Whitespace：`git diff --check` 通过。
    - 启动失败证据：首次 `npm run dev` 失败，报 `Port 1420 is already in use` 和 `Port 1421 is already in use`。
    - 端口占用证据：`lsof -nP -iTCP:1420 -sTCP:LISTEN` 与 `lsof -nP -iTCP:1421 -sTCP:LISTEN` 显示残留 `node` 进程 PID `95041` 占用两个端口。
    - 临时恢复：普通 `kill 95041` 因权限失败，提权 `kill 95041` 成功；随后端口释放，`npm run dev` 成功启动。
    - 首屏可操作性：运行态 viewport `599x1329` 下 `.request-editor`、`.request-editor__bar`、URL input、Send、Save、`.response-panel` 均可见，无横向溢出。
    - 编辑路径：用真实浏览器 locator 编辑 URL 为 `https://example.com/api/usability-check` 成功。
    - Tab 路径：直接用 `getByRole("button", { name: "Body", exact: true })` 点击失败，原因是严格模式匹配到两个同名按钮：request tab 的 `Body` 与 response tab 的 `Body`。
    - Scoped workaround：改用 `.request-tabs .request-tab` scoped selector 后能切到 request Body，body textarea 可见。
    - Files 路径：打开 Files 后 `.tool-drawer` 可见，`Upload Active Request` 和 `Download to Path` 可见，且 request editor / response panel 仍可见。
    - Settings 路径：切 Settings 后 `scrollY=0`，`.workspace-inspector` 可见，`Local Runtime Overview` 可见，request editor / response panel 仍可见。
    - 控制台：本地应用 `tab.dev.logs({ levels: ["error"] })` 为空。
    - 端口清理：审计结束后 `pkill -f "npm run dev"`，`curl -s http://localhost:1420` 返回连接失败。
  - 真实问题排序：
    - P0：开发服务器可被残留 Vite/node 进程卡死，导致 `npm run dev` 直接不可用。短期需要在验证流程中明确清理；长期可考虑脚本化端口检查或文档化恢复命令。
    - P1：请求 Body tab 与响应 Body tab 同名，导致 role/name 定位歧义；这会影响自动化、键盘/读屏可用性和真实可测性。Task 3 先修这个可控问题。
    - P2：当前窄屏仍是长页面，虽然核心流程可走，但首屏密度仍偏高；后续 task 继续考虑。
  - 自信度检查：对 Task 2 审计结论有 100% 信心：启动失败、端口占用、交互歧义、scoped workaround、Files/Settings 路径和控制台状态都有真实命令或浏览器证据支撑；当前不能标记 goal 完成，必须继续修复。

- [ ] Task 3: 修复最高优先级不可用问题
  - 目标：只修复 Task 2 发现的最阻断问题，优先保证首屏和核心请求流程可用。
  - 独立验证：构建通过，真实浏览器中可完成对应用户路径。
  - 完成内容：
  - 自信度检查：

- [ ] Task 4: 大型全面检查 - debug 循环
  - 目标：对 Task 1-3 的可用性修复做全面回归，继续找隐藏 bug。
  - 独立验证：构建、运行态、核心交互、控制台均通过。
  - 完成内容：
  - 自信度检查：

- [ ] Task 5: 修复剩余高优先级可用性问题
  - 目标：处理审计中剩余影响“可用”的问题，而不是只做视觉美化。
  - 独立验证：真实用户路径通过，核心入口不丢失。
  - 完成内容：
  - 自信度检查：

- [ ] Task 6: 最终可用性审计与 goal 完成判定
  - 目标：重新按用户“完全不可用”的反馈做最终审计，只有核心流程真实可用才标记完成。
  - 独立验证：完整 checklist 全部满足，构建和运行态检查通过。
  - 完成内容：
  - 自信度检查：
