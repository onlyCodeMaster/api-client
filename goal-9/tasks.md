# Goal 9 Tasks

- [x] Task 1: 创建 `goal-9/input.md`、`goal-9/plan.md`、`goal-9/tasks.md`
  - 目标：为 `P1-2 Auth 多方案支持` 建立独立 goal 目录和任务链。
  - 独立验证：三份文件存在，`input.md` 逐字保留任务名，`plan.md` 包含完整规划结构。
  - 完成内容：已创建 `goal-9/` 三件套，并写入本轮 Auth 多方案支持的目标、上下文、风险、执行方案、验证方式和回滚方案。
  - 自信度检查：当前 task 只涉及文档创建，具备 100% 结束信心。

- [x] Task 2: 梳理 Auth 数据模型、发送链路与最小缺口
  - 目标：明确当前 `none / bearer` 路径、header 冲突规则以及 curl/postman 现状，收敛 `P1-2` 的实现边界。
  - 独立验证：形成面向 `P1-2` 的最小缺口清单。
  - 完成内容：
    - 已审计前端 store、`App.tsx`、Tauri TS 类型、Rust models、HTTP 发送、storage、cURL 导入导出、Postman 导入路径。
    - 当前 auth 真正支持的只有 `none / bearer`。前端 `AuthType`、request/history 数据、bridge 输入输出、Rust `SendRequestInput / SaveRequestInput / StoredRequest / HistoryEntry` 都只有 `authType + authToken` 这一对字段，没有 `basic` 所需的 `username/password`，也没有 `apiKey` 所需的 `name/value/in`。
    - 当前发送链路只在 `http.rs` 中识别 `auth_type == "bearer"`，并通过 `Authorization: Bearer <token>` 注入请求；`none` 之外没有其他语义 auth。
    - header 冲突规则已经存在真实隐患：seed request 里同时存在显式 `Authorization` header 和 `authType = bearer`；发送时 `http.rs` 先收集 header rows，再对 bearer 执行 `headers.insert(AUTHORIZATION, ...)`，因此最终会由 bearer auth 覆盖用户显式写入的 `Authorization`。`P1-2` 需要把这条规则显式固定，而不是继续靠偶然覆盖。
    - `App.tsx` 当前多处把 auth 值强制收窄成 `\"none\" | \"bearer\"`；就算后端先扩展 richer auth，前端保存/载入路径现在也会把未知方案洗回 `none`，所以 `Task 3` 不能只改 Rust。
    - storage 和 history 当前也只持久化 `auth_type / auth_token`。如果不扩 schema，Basic/API Key 无法被保存、历史回放也无法还原 auth 状态。
    - cURL 现状：导入只会把 `Authorization: Bearer ...` 提升成 auth 语义；Basic 仍会被保留成普通 header。导出也只会自动补 Bearer，且仅在用户未显式写 `Authorization` header 时追加。
    - Postman 现状：header 解析和 `auth` object 解析都只识别 bearer；Basic/API Key 不会被提升成 auth 语义。
    - 结论：`P1-2` 的最小安全范围必须覆盖前端 store、bridge 类型、Rust models、save/load、history、send path 的同步扩展；只补发送命令会造成保存、回放、导入导出和 UI 状态全部失真。
    - `Task 3` 的最小实现边界已经收敛为：
      - 真正支持 `none / bearer / basic / apiKey`
      - `basic` 至少新增 `username / password`
      - `apiKey` 至少新增 `key / value / in(header|query)`
      - Bearer/Basic 的 `Authorization` 语义必须统一冲突规则
      - OAuth2 本 goal 只预留入口，不进入真实发送闭环，避免伪支持
  - 自信度检查：本 task 只做现状审计与边界收敛，关键链路已覆盖到前端、bridge、Rust、持久化和导入导出，已具备 100% 结束信心。

- [ ] Task 3: 实现最小数据层 / bridge Auth 多方案发送闭环
  - 目标：先补齐真正能按鉴权方案发出请求的 auth 数据结构和发送路径。
  - 独立验证：至少 Basic、API Key、Bearer 三类 auth 能被测试覆盖并真实注入请求。
  - 完成内容：
  - 自信度检查：

- [ ] Task 4: 大型全面检查 - 审计 Auth 多方案编辑与发送闭环
  - 目标：确认 auth 多方案不是只有命令，而是用户路径真能走通。
  - 独立验证：构建、测试、真实操作路径都通过。
  - 完成内容：
  - 自信度检查：

- [ ] Task 5: 补齐前端 Auth 编辑器与保存加载兼容
  - 目标：把 auth 编辑补到真正可切换、可保存、可再次加载，而不是只在发送前临时拼装。
  - 独立验证：切换鉴权方案、保存 request、重新载入 request 后，auth 状态与发送结果一致。
  - 完成内容：
  - 自信度检查：
