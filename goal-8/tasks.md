# Goal 8 Tasks

- [x] Task 1: 创建 `goal-8/input.md`、`goal-8/plan.md`、`goal-8/tasks.md`
  - 目标：为 `P1-1 Body 多模式支持` 建立独立 goal 目录和任务链。
  - 独立验证：三份文件存在，`input.md` 逐字保留任务名，`plan.md` 包含完整规划结构。
  - 完成内容：已创建 `goal-8/` 三件套，并写入本轮 Body 多模式支持的目标、上下文、风险、执行方案、验证方式和回滚方案。
  - 自信度检查：当前 task 只涉及文档创建，具备 100% 结束信心。

- [x] Task 2: 梳理 Body 数据模型、发送链路与最小缺口
  - 目标：明确当前 raw/json 路径、header 行为和文件能力现状，收敛 `P1-1` 的实现边界。
  - 独立验证：形成面向 `P1-1` 的最小缺口清单。
  - 完成内容：已完成当前 body 链路梳理，并据此收敛了 `P1-1` 的最小实现边界。结论如下。

  ## 当前已具备

  - 前端已有 `Request Body` 编辑区，但只有单一 textarea：
    - `src/App.tsx` 里 body 面板标题写死为 `application/json`
    - 编辑入口只有 `updateRequestBody()`
  - 请求发送链路已经真实可用：
    - `src/store/requestStore.ts` 的 `sendActiveRequest()` 会把 request 发给 `send_request`
    - `src-tauri/src/http.rs` 会把 `input.body` 作为字符串 `.body(...)` 发出
  - 独立文件传输能力已存在：
    - `src-tauri/src/file_transfer.rs` 已能单独构造 `multipart/form-data`
    - 但它是独立工具面板，不在 request body 主流程中

  ## 当前结构限制

  - `RequestRecord` / `StoredRequest` / `SendRequestInput` / `HistoryEntry` / `CurlExportInput` 当前都只有 `body: string`
  - collection 文件格式也只有：
    - `body`
    - 没有 `bodyMode`
    - 没有结构化 body rows
  - history 记录也只保存 body string，意味着如果不扩展模型，history replay 会丢失 body 模式信息
  - `src-tauri/src/http.rs` 当前不会：
    - 构造 `x-www-form-urlencoded`
    - 构造 request 级 `multipart/form-data`
    - 处理 body 模式对应的 `Content-Type`
  - `src-tauri/src/transport.rs` 只会原样构造用户 headers，不会自动处理 body 相关 header

  ## 与周边能力的关系

  - `curl import/export` 目前只把 body 当字符串处理，未区分模式
  - `Postman import` 目前只取 `body.raw`
  - 这些不是 `P1-1` 的最小验收门槛，但若 body 模型升级，至少要保证现有路径不崩

  ## Task 3 的最小范围

  - 扩展 request / history / bridge / storage 模型，为 body 增加显式模式和结构化 payload
  - 发送链路至少真实支持：
    - `json`
    - `raw`
    - `application/x-www-form-urlencoded`
    - `multipart/form-data`
  - 为 `multipart/form-data` 增加 request 级字段模型，至少支持：
    - text field
    - file field（以绝对路径传入）
  - 自动 `Content-Type` 逻辑要与用户自定义 header 共存：
    - `multipart` 不能手工写死 boundary
    - `json` / `raw` / `urlencoded` 要避免无谓覆盖用户 header
  - `curl/postman import-export` 与独立 `upload_file` 面板先以“不回归、不阻塞主流程”为边界，不在 Task 3 提前全面升级

  - 自信度检查：对这份缺口清单有 100% 信心。它准确描述了当前 `P1-1` 的前后端限制，也把实现范围收敛在“真实发送闭环”而不是外围功能扩展。

- [x] Task 3: 实现最小数据层 / bridge Body 多模式发送闭环
  - 目标：先补齐真正能按模式发出请求的 body 数据结构和发送路径。
  - 独立验证：至少 raw/json、urlencoded、multipart 三类 body 能被测试覆盖并真实构造请求。
  - 完成内容：已完成 `P1-1` 的最小数据层 / bridge Body 多模式发送闭环，重点补齐了 request body 的显式模式模型、历史/存储持久化结构以及 Rust 侧真实构造逻辑。

  ## 本轮已补齐

  - `src-tauri/src/models.rs`
    - 为 request / history / save / send / curl export 模型新增：
      - `bodyMode`
      - `bodyContentType`
      - `bodyRows`
    - 新增 `RequestBodyRow`
  - `src-tauri/src/storage.rs`
    - collection 文件读写支持持久化：
      - `bodyMode`
      - `bodyContentType`
      - `bodyRows`
    - 兼容旧 collection 文件：
      - 无 body mode 时会基于 header/body 推断 `json/raw/urlencoded/multipart`
    - history 表 schema 新增：
      - `body_mode`
      - `body_content_type`
      - `body_rows_json`
    - `record_history()` / `list_history()` 已同步支持新字段
  - `src-tauri/src/http.rs`
    - 新增 body mode 分支：
      - `json`
      - `raw`
      - `urlencoded`
      - `multipart`
    - 新增辅助逻辑：
      - `maybe_insert_content_type()`
      - `encode_urlencoded_body()`
      - `build_multipart_form()`
    - `multipart` 会移除手工 `Content-Type`，避免 boundary 冲突
  - `src-tauri/Cargo.toml`
    - 新增 `form_urlencoded` 依赖，用于稳定构造 `application/x-www-form-urlencoded`
  - `src/lib/tauri.ts`
    - 前端 bridge 类型同步支持 body mode / rows
  - `src/store/requestStore.ts`
    - request / history store 状态已支持：
      - `bodyMode`
      - `bodyContentType`
      - `bodyRows`
    - `sendActiveRequest()` 已把 body mode 结构化数据传给 bridge
  - `src/App.tsx`
    - request normalize / save / import / export / history bootstrap 已同步承接新 body 模型
  - `src/App.crud.test.tsx`
    - 现有 CRUD 测试 fixtures 已补齐 body mode 字段，避免旧 mock 结构导致状态回退

  ## 验证结果

  - `cargo test urlencoded_body_encodes_enabled_rows_and_templates --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test multipart_body_builds_text_and_file_parts --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test maybe_insert_content_type_defaults_for_json_urlencoded_and_raw --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test storage --manifest-path src-tauri/Cargo.toml` 通过。
    - 24 个 storage 测试全绿。
  - `npm test` 通过。
    - 2 个前端 CRUD 集成测试全绿。
  - `npm run build` 通过。
  - `git diff --check` 通过。

  ## 当前边界

  - 本阶段已经把 body 多模式的模型、bridge 和发送逻辑打通，但前端 body editor 还没有把 `urlencoded / multipart` 作为用户可操作编辑器完整暴露出来。
  - `curl/postman import-export` 当前已兼容新字段链路，但还没有针对多模式做完整语义升级，这部分留给后续 task。

  - 自信度检查：对本阶段结果有 100% 信心。底层模型、存储、bridge、发送构造和现有前端回归都已有实证支撑，未完成的部分明确收敛在前端 editor 与保存加载体验。

- [ ] Task 4: 大型全面检查 - 审计 Body 多模式编辑与发送闭环
  - 目标：确认 body 多模式不是只有命令，而是用户路径真能走通。
  - 独立验证：构建、测试、真实操作路径都通过。
  - 完成内容：
  - 自信度检查：

- [ ] Task 5: 补齐前端 Body 编辑器与保存加载兼容
  - 目标：把 body 编辑补到真正可切换、可保存、可再次加载，而不是只在发送前临时拼装。
  - 独立验证：切换模式、保存 request、重新载入 request 后，body 状态与发送结果一致。
  - 完成内容：
  - 自信度检查：
