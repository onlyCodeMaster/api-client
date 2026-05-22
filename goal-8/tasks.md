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

- [x] Task 4: 大型全面检查 - 审计 Body 多模式编辑与发送闭环
  - 目标：确认 body 多模式不是只有命令，而是用户路径真能走通。
  - 独立验证：构建、测试、真实操作路径都通过。
  - 完成内容：已完成 `P1-1` 的综合审计，并把“切换模式 + 保存/重载 + 发送 + Rust 真实构造”这四层证据补齐到位。

  ## Prompt-to-Artifact Checklist

  - 要求：支持 `JSON`
    - 证据：
      - `src/App.tsx` 的 body editor 已有 `JSON` 模式切换按钮与 textarea 编辑。
      - `src/App.body.test.tsx` 覆盖：
        - 初始加载 `JSON`
        - 点击 `Send`
        - 断言 `send_request` payload 带 `bodyMode: "json"` 与 JSON body
      - `cargo test http --manifest-path src-tauri/Cargo.toml` 通过，包含
        - `execute_request_sends_real_http_request_and_maps_response`
        - 真实本地 HTTP 请求发送和 JSON body/header 断言

  - 要求：支持 `Raw Text`
    - 证据：
      - `src/App.tsx` 的 body editor 已有 `Raw` 模式切换按钮、textarea 和 `Content-Type` 输入。
      - `src/App.body.test.tsx` 覆盖：
        - `Raw` 编辑
        - 保存 request
        - reload 后仍为 `Raw`
        - 点击 `Send`
        - 断言 `send_request` payload 带 `bodyMode: "raw"`、`bodyContentType: "text/plain"` 和 raw body
      - `cargo test http --manifest-path src-tauri/Cargo.toml` 通过，包含
        - `maybe_insert_content_type_defaults_for_json_urlencoded_and_raw`

  - 要求：支持 `application/x-www-form-urlencoded`
    - 证据：
      - `src/App.tsx` 的 body editor 已有 `Form URL` 模式切换和 key/value 行编辑。
      - `src/App.body.test.tsx` 覆盖：
        - 切换到 `Form URL`
        - 填写 key/value
        - 保存 request
        - reload 后仍为 `Form URL`
        - 点击 `Send`
        - 断言 `send_request` payload 带 `bodyMode: "urlencoded"` 和 `bodyRows`
      - `cargo test http --manifest-path src-tauri/Cargo.toml` 通过，包含
        - `urlencoded_body_encodes_enabled_rows_and_templates`
        - `execute_request_sends_urlencoded_body`
        - 真实本地 HTTP 请求体断言为 `q=workspace+search&limit=20`

  - 要求：支持 `multipart/form-data`
    - 证据：
      - `src/App.tsx` 的 body editor 已有 `Multipart` 模式切换、text/file 行类型切换、路径输入。
      - `src/App.body.test.tsx` 覆盖：
        - 切换到 `Multipart`
        - 把行类型改成 `File`
        - 保存 request
        - reload 后仍为 `Multipart`
        - 点击 `Send`
        - 断言 `send_request` payload 带 `bodyMode: "multipart"` 和 `fieldType: "file"`
      - `cargo test http --manifest-path src-tauri/Cargo.toml` 通过，包含
        - `multipart_body_builds_text_and_file_parts`
        - `execute_request_sends_multipart_body`
        - 真实本地 HTTP multipart body / boundary / file content 断言

  - 要求：用户可切换 body 类型并真实发出对应请求
    - 证据：
      - `src/App.tsx` 已暴露四种模式切换入口。
      - `src/store/requestStore.ts` 的 `sendActiveRequest()` 已把 `bodyMode / bodyContentType / bodyRows` 传给 bridge。
      - `src-tauri/src/http.rs` 已按模式真实构造请求体。
      - `src/App.body.test.tsx` 覆盖点击 `Send` 的前端路径。
      - `cargo test http --manifest-path src-tauri/Cargo.toml` 通过，6 个 `http` 相关测试全绿。

  - 要求：切换模式后可保存 request 并重新加载，body 状态保持一致
    - 证据：
      - `src/App.body.test.tsx` 在单个测试中串行覆盖：
        - `json -> raw -> urlencoded -> multipart`
        - 每一步 `Save`
        - `unmount -> reset store -> render` reload
        - reload 后检查模式、内容、行数据保持一致
      - `src-tauri/src/storage.rs` / `src-tauri/src/models.rs` 已持久化 `bodyMode / bodyContentType / bodyRows`
      - `cargo test storage --manifest-path src-tauri/Cargo.toml` 通过，24 个 storage 测试全绿

  ## 审计结论

  - `P1-1` 的显式完成标准“用户可切换 body 类型并真实发出对应请求”已满足。
  - 没有发现只改 UI、不改发送链路或只改发送链路、不支持保存/重载的假闭环。
  - 现阶段仍未把 `curl/postman import-export` 的多模式语义做满，但这不属于 `P1-1` 的显式验收项。

  ## 验证结果

  - `npm test` 通过。
    - 2 个测试文件，3 个测试全绿。
  - `npm run build` 通过。
  - `cargo test http --manifest-path src-tauri/Cargo.toml` 通过。
    - 6 个 `http` 测试全绿。
  - `cargo test storage --manifest-path src-tauri/Cargo.toml` 通过。
    - 24 个 storage 测试全绿。
  - `git diff --check` 通过。

  - 自信度检查：对本次审计结果有 100% 信心。四种 body 模式的前端交互、保存重载、bridge 入参和 Rust 真实请求构造都已有直接证据支撑。

- [x] Task 5: 补齐前端 Body 编辑器与保存加载兼容
  - 目标：把 body 编辑补到真正可切换、可保存、可再次加载，而不是只在发送前临时拼装。
  - 独立验证：切换模式、保存 request、重新载入 request 后，body 状态与发送结果一致。
  - 完成内容：已完成前端 body editor、多模式保存加载链路和 body 专项交互测试。

  ## 本轮实现

  - `src/App.tsx`
    - body panel 从单一 textarea 升级为四种模式切换：
      - `JSON`
      - `Raw`
      - `Form URL`
      - `Multipart`
    - `JSON / Raw`：
      - 继续使用 textarea 编辑 body string
      - 增加 `Content-Type` 输入
    - `Form URL`：
      - 增加 key/value 行编辑
    - `Multipart`：
      - 增加 text/file 行类型切换
      - 支持文件绝对路径输入
    - 增加 body 行新增、删除、启用/停用、焦点回落逻辑
    - request save / import / export / bootstrap normalize 已全部承接
      - `bodyMode`
      - `bodyContentType`
      - `bodyRows`
  - `src/styles.css`
    - 新增 body mode segmented 样式
    - 新增 body toolbar / inline content-type field 样式
    - 新增 `urlencoded / multipart` 表格布局与 file type select 样式
  - `src/App.body.test.tsx`
    - 新增 body 专项集成测试：
      - 初始 `JSON`
      - 切换 `Raw`
      - 切换 `Form URL`
      - 切换 `Multipart`
      - 每一步 `Save`
      - `unmount -> rerender` reload
      - 每一步点击 `Send`，断言 `send_request` payload

  ## 完成标准核对

  - 切换模式：已支持。
  - 编辑 body：已支持。
  - 保存 request：已支持。
  - 重新加载 request：已支持。
  - 发送时模式与保存状态一致：已支持。

  - 自信度检查：对当前实现有 100% 信心。body editor 的 UI、状态、保存、重载和发送链路已经形成完整闭环，当前没有剩余结构性缺口。
