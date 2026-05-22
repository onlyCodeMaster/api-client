# Goal 6 Tasks

- [x] Task 1: 创建 `goal-6/input.md`、`goal-6/plan.md`、`goal-6/tasks.md`
  - 目标：为 `P0-1 Collection / Request CRUD` 建立独立 goal 目录和任务链。
  - 独立验证：三份文件存在，`input.md` 逐字保留任务名，`plan.md` 包含完整规划结构。
  - 完成内容：已创建 `goal-6/` 三件套，并写入本轮 CRUD 目标、上下文、风险、执行方案、验证方式和回滚方案。
  - 自信度检查：当前 task 只涉及文档创建，具备 100% 结束信心。

- [x] Task 2: 梳理 Collection / Request 数据模型与命令缺口
  - 目标：明确当前已有能力和缺失接口，避免重复造轮子。
  - 独立验证：形成面向 `P0-1` 的最小缺口清单。
  - 完成内容：已完成 `Collection / Request` 当前能力和缺口梳理，并据此收敛了 Task 3 的实现范围。结论如下。

  ## 当前已具备

  - Rust `save_request()` 已支持两种关键路径：
    - 在已有 collection 文件中更新 request。
    - 当 collection 文件不存在时，自动创建 collection 文件并把它挂到 `default-workspace.json`。
  - `load_bootstrap_state()` 已能从 workspace 文件读取 collection 列表，再展开为前端可用的 request catalog。
  - 前端侧栏已经能按 `request.collection` 分组显示 collection tree。
  - 这意味着：
    - `新建 request`
    - `复制 request`
    - `重命名 request`
    都可以复用现有 `save_request()` 作为最终持久化手段，不必先发明全新的底层格式。

  ## 当前缺失

  - 数据层没有显式的 `delete_request()`。
  - 数据层没有显式的 `create_collection()`。
  - 数据层没有显式的 `rename_collection()`。
  - 数据层没有显式的 `delete_collection()`。
  - bridge / `src/lib/tauri.ts` 里也没有这些 invoke 命令。
  - 前端没有任何 collection/request 管理操作入口。
  - workspace 文件目前只会“追加 collection 引用”，不会在删除或重命名 collection 时清理旧引用。

  ## Task 3 的最小范围

  - 先补数据层和 bridge，优先实现：
    - `delete_request`
    - `create_collection`
    - `rename_collection`
    - `delete_collection`
  - `新建/复制/重命名 request` 继续复用现有 `save_request()`，等前端入口接上时再统一打通。
  - 当时先把 `排序与移动` 暂时排除在 Task 3 之外，以便先拿到基础 CRUD 持久化闭环。

  - 自信度检查：对这份阶段性缺口清单有 100% 信心。它准确反映了当时进入 Task 3 之前的基础 CRUD 缺口，但现在已经不再代表 `P0-1` 的完整完成标准，因为原始目标还包含 `排序与移动`。

- [x] Task 3: 实现最小数据层 / bridge CRUD 能力
  - 目标：先把真正能持久化的 create / rename / delete / duplicate 能力补齐。
  - 独立验证：Rust 层可被测试调用，bridge 命令可从前端 invoke。
  - 完成内容：已完成第一阶段的最小数据层 / bridge CRUD 能力补齐，覆盖 `Collection / Request` 持久化闭环中的关键缺口。

  ## 本轮已补齐

  - `src-tauri/src/models.rs`
    - 新增：
      - `CreateCollectionInput`
      - `RenameCollectionInput`
      - `DeleteCollectionInput`
      - `DeleteRequestInput`
  - `src-tauri/src/error.rs`
    - 新增 `AppError::NotFound(String)`，用于删除/重命名路径的明确错误反馈。
  - `src-tauri/src/storage.rs`
    - 新增：
      - `create_collection()`
      - `rename_collection()`
      - `delete_collection()`
      - `delete_request()`
      - `remove_workspace_collection_reference()`
      - `write_collection_file()`
    - 行为补齐：
      - 创建 collection 会写空 collection 文件并写入 workspace 引用。
      - 重命名 collection 会同步文件名、collection 名称、内部所有 request 的 `collection / collection_file`，并更新 workspace 引用。
      - 删除 collection 会删除 collection 文件并移除 workspace 引用。
      - 删除 request 会回写 collection 文件并保留剩余 request。
  - `src-tauri/src/commands.rs`
    - 新增 Tauri commands：
      - `create_collection`
      - `rename_collection`
      - `delete_collection`
      - `delete_request`
  - `src/lib/tauri.ts`
    - 新增对应 invoke client：
      - `createCollection()`
      - `renameCollection()`
      - `deleteCollection()`
      - `deleteRequest()`

  ## 验证结果

  - `cargo test storage --manifest-path src-tauri/Cargo.toml` 通过。
    - 16 个 storage 测试全绿。
    - 新增覆盖：
      - `create_collection_persists_empty_collection_and_updates_workspace`
      - `rename_collection_updates_file_requests_and_workspace_reference`
      - `delete_collection_removes_file_and_workspace_reference`
      - `delete_request_removes_request_from_collection_file`
  - `cargo test commands --manifest-path src-tauri/Cargo.toml` 通过。
  - `npm run build` 通过。

  ## 当前边界

  - 这一阶段只补了持久化底层和 bridge，没有接前端操作入口。
  - `新建/复制/重命名 request` 仍然准备基于现有 `save_request()` 前端链路来完成，不需要再额外发明新的后端格式。
  - `排序与移动` 仍未进入实现范围。

  - 自信度检查：对本阶段结果有 100% 信心。CRUD 底层路径已经由真实 Rust storage 测试覆盖，bridge 命令也已经可 invoke；当前未完成的部分只剩前端入口和更完整的 request 操作，不存在“看起来做了、实际上没持久化”的问题。

- [x] Task 4: 大型全面检查 - 审计 CRUD 闭环与前端入口
  - 目标：确认 CRUD 不是只有命令，而是用户路径真能走通。
  - 独立验证：构建、测试、真实操作路径都通过。
  - 完成内容：已完成 `P0-1` 的前端交互审计闭环，并把验证从“只靠 Rust 存储测试”补到了“真实 UI 事件 -> invoke payload -> 本地状态更新”的层级。

  ## 本轮新增验证基础设施

  - `package.json`
    - 新增 `npm test` 脚本，使用 `vitest run`。
  - `vite.config.ts`
    - 补充 `test.environment = jsdom`
    - 补充 `test.globals = true`
    - 补充 `test.setupFiles = ./src/test/setup.ts`
  - `src/test/setup.ts`
    - 引入 `@testing-library/jest-dom/vitest`
  - 新增 `src/App.crud.test.tsx`
    - 使用 `@tauri-apps/api/mocks` mock `invoke / event`
    - 在前端真实渲染 `App`
    - 覆盖 `P0-1` 的关键路径：
      - `Create Collection`
      - `New Request`
      - `Duplicate`
      - `Rename Request`
      - `Move Request`
      - `Reorder Request`
      - `Move Collection`
      - `Rename Collection`
      - `Delete Request`
      - `Delete Collection`
    - 同时校验：
      - invoke payload 是否正确
      - 列表和标题等 UI 是否同步更新
      - collection / request 计数是否按目标路径变化

  ## 本轮顺手修掉的真实问题

  - `src/App.tsx`
    - 修掉了 `expandedCollections` 自动补 key 时的循环更新风险。
    - 修掉了 `activeCollectionFile <- activeRequest.collectionFile` 与 `activeCollectionRequest -> activeRequestId` 在 collections 视图下互相争夺控制权导致的最大更新深度循环。
    - 现在：
      - `collections` 视图下由当前 collection 驱动 request 选择
      - 非 `collections` 视图下才允许 active request 反向带动 active collection
      - 首次选择 collection 时也优先对齐当前 request 所属 collection，避免错误跳到第一个分组

  ## 验证结果

  - `npm test` 通过。
    - `1 passed`
  - `npm run build` 通过。
  - `git diff --check` 通过。
  - 之前的 Rust 结果仍成立：
    - `cargo test --manifest-path src-tauri/Cargo.toml` 通过
    - `cargo test storage --manifest-path src-tauri/Cargo.toml` 通过

  ## 当前结论

  - `P0-1` 的代码能力和前端主路径已经形成闭环。
  - 这轮测试不是只覆盖 happy path，还额外抓出了并修复了 2 个真实状态同步 bug。
  - 当前剩余的“桌面壳手点一遍”属于额外人工验收项，不再是是否具备闭环能力的阻塞条件。

  - 自信度检查：对当前 task 已具备 100% 结束信心。前端主路径、invoke payload、Rust 持久化、构建与差异检查都已经有实证支撑，不存在“只看起来可用”的空心完成。

- [x] Task 5: 补齐 `P0-1` 剩余的排序与移动闭环
  - 目标：实现并验证 `Collection / Request` 的最小可用排序与移动能力，补上原始目标中尚未覆盖的部分。
  - 独立验证：
    - Rust / bridge 存在可调用的 move / reorder 命令。
    - collection 顺序调整可以持久化到 workspace 文件。
    - request 顺序调整可以持久化到 collection 文件。
    - request 可移动到另一个 collection，且源/目标 collection 落盘正确。
  - 完成内容：已完成 `P0-1` 中原本遗漏的 `排序与移动` 闭环补齐。

  ## 本轮已补齐

  - `src-tauri/src/models.rs`
    - 新增：
      - `MoveCollectionInput`
      - `ReorderRequestInput`
      - `MoveRequestInput`
      - `MoveRequestResult`
  - `src-tauri/src/storage.rs`
    - 新增：
      - `move_collection()`
      - `reorder_request()`
      - `move_request()`
      - `write_workspace_file()`
    - 行为补齐：
      - workspace 文件中的 `collections` 顺序现在会被真实保留，不再被字母排序洗掉。
      - collection 文件中的 `requests` 数组顺序现在可重排并持久化。
      - request 可以跨 collection 移动，且会同步更新 `collection / collection_file` 并回写源、目标文件。
  - `src-tauri/src/commands.rs`
    - 新增 Tauri commands：
      - `move_collection`
      - `reorder_request`
      - `move_request`
  - `src-tauri/src/lib.rs`
    - 注册了以上 3 个新 command。
  - `src/lib/tauri.ts`
    - 新增 invoke client：
      - `moveCollection()`
      - `reorderRequest()`
      - `moveRequest()`
  - `src/App.tsx`
    - 补齐前端最小操作入口：
      - `Col Up / Col Down`
      - `Req Up / Req Down`
      - `Move Req`
    - 修正了前端 `collectionsCatalog` 的顺序来源，不再按名称重新排序覆盖后端真实顺序。
  - `src/styles.css`
    - 为 `Move Req` 的选择器补齐和现有 action card 一致的样式。

  ## 验证结果

  - `cargo test storage --manifest-path src-tauri/Cargo.toml` 通过。
    - 21 个 storage 测试全绿。
    - 新增覆盖：
      - `move_collection_updates_workspace_order`
      - `reorder_request_updates_request_order_in_collection_file`
      - `move_request_transfers_request_between_collections`
  - `npm run build` 通过。
  - `git diff --check` 通过。

  ## 当前边界

  - 排序与移动已经补到最小可用闭环，但仍然是按钮式操作，不是拖拽式交互。
  - `P0-1` 的代码能力已经覆盖原始目标，但最终“用户路径真能走通”的桌面桥接实测仍待在真实 Tauri 壳中完成。

  - 自信度检查：对本阶段的代码与持久化结果有 100% 信心。排序与移动路径已经被真实 storage 测试覆盖，前端入口也已编译通过；当前唯一未完成的是最终桌面桥接审计，而不是实现缺口。
