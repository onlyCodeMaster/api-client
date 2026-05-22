# Goal 7 Tasks

- [x] Task 1: 创建 `goal-7/input.md`、`goal-7/plan.md`、`goal-7/tasks.md`
  - 目标：为 `P0-2 Environment CRUD` 建立独立 goal 目录和任务链。
  - 独立验证：三份文件存在，`input.md` 逐字保留任务名，`plan.md` 包含完整规划结构。
  - 完成内容：已创建 `goal-7/` 三件套，并写入本轮 Environment CRUD 的目标、上下文、风险、执行方案、验证方式和回滚方案。
  - 自信度检查：当前 task 只涉及文档创建，具备 100% 结束信心。

- [x] Task 2: 梳理 Environment 数据模型与命令缺口
  - 目标：明确当前已有能力和最小缺口，避免重复实现。
  - 独立验证：形成面向 `P0-2` 的最小缺口清单。
  - 完成内容：已完成 `Environment CRUD` 当前能力和缺口梳理，并据此收敛了 Task 3 / Task 5 的实现范围。结论如下。

  ## 当前已具备

  - Rust / bridge 已有 `save_environment()`：
    - `src-tauri/src/models.rs` 定义了 `SaveEnvironmentInput`
    - `src-tauri/src/storage.rs` 的 `save_environment()` 会按 `filePath` 写入 `json / yaml / yml` 环境文件
    - `src-tauri/src/commands.rs` 已暴露 `save_environment`
    - `src/lib/tauri.ts` 已有 `saveEnvironment()`
  - `load_bootstrap_state()` 会通过 `list_environments()` 直接扫描 `environments/` 目录装载环境，不依赖 workspace 文件中的 environment 引用。
  - 前端已有两条环境相关路径：
    - `handleSaveEnvironment()`：保存当前环境
    - `handleCreateFirstEnvironment()`：在空环境场景创建首个本地环境
  - store 当前支持：
    - `setActiveEnvironment()`
    - `updateEnvironmentVar()`
    - `upsertEnvironment()`
    - `replaceEnvironment()`

  ## 当前缺失

  - 数据层没有显式的 `rename_environment()`。
  - 数据层没有显式的 `delete_environment()`。
  - bridge / `src/lib/tauri.ts` 没有 rename / delete environment invoke 命令。
  - 前端没有多环境场景下的：
    - 新建 environment 入口
    - 重命名 environment 入口
    - 删除 environment 入口
  - 变量编辑目前只能“改现有值”，没有：
    - 新增变量
    - 删除变量
  - 环境面板没有独立 dirty / save 状态体系，只有一次性 `environmentSaveFeedback`

  ## 关键结构判断

  - environment 不挂在 workspace 文件里，bootstrap 是直接扫 `environments/` 目录装载的。
  - 这意味着：
    - “新建 environment” 可以继续复用现有 `save_environment()` 持久化路径，不必额外发明 `create_environment`
    - 真正缺的底层命令是：
      - `rename_environment`
      - `delete_environment`
  - 因为前端已经有 `handleCreateFirstEnvironment()`，后续需要把“空状态创建”和“常规新建”收敛成一套共享逻辑，避免双轨维护。

  ## Task 3 的最小范围

  - 数据层和 bridge 优先补：
    - `rename_environment`
    - `delete_environment`
  - `create environment` 继续复用现有 `save_environment()`，由前端统一出创建入口。
  - `变量新增 / 删除` 留到 Task 5，与前端编辑闭环一起补，不在 Task 3 提前展开。

  - 自信度检查：对这份缺口清单有 100% 信心。它准确描述了当前 `P0-2` 的最小后端缺口和前端缺口，也为后续任务收敛了范围。

- [x] Task 3: 实现最小数据层 / bridge Environment CRUD
  - 目标：先补齐真正能持久化的 create / rename / delete environment 能力。
  - 独立验证：Rust 层可被测试调用，bridge 命令可从前端 invoke。
  - 完成内容：已完成 `P0-2` 的最小数据层 / bridge Environment CRUD 补齐，重点补上了 `rename / delete environment` 两条真正缺失的持久化路径。

  ## 本轮已补齐

  - `src-tauri/src/models.rs`
    - 新增：
      - `RenameEnvironmentInput`
      - `DeleteEnvironmentInput`
  - `src-tauri/src/storage.rs`
    - 新增：
      - `rename_environment()`
      - `delete_environment()`
    - 行为补齐：
      - environment 重命名支持同时变更 `name` 和 `filePath`
      - 支持 `json -> yaml/yml` 等扩展名切换
      - 当目标文件已存在时会拒绝覆盖
      - 删除 environment 会真实移除本地环境文件
  - `src-tauri/src/commands.rs`
    - 新增 Tauri commands：
      - `rename_environment`
      - `delete_environment`
  - `src-tauri/src/lib.rs`
    - 注册了以上 2 个新 command
  - `src/lib/tauri.ts`
    - 新增 invoke client：
      - `renameEnvironment()`
      - `deleteEnvironment()`

  ## 验证结果

  - `cargo test environment --manifest-path src-tauri/Cargo.toml` 通过。
    - 8 个环境相关测试全绿。
    - 新增覆盖：
      - `rename_environment_updates_name_and_file_path`
      - `rename_environment_rejects_existing_target_file`
      - `delete_environment_removes_file`
  - `cargo test storage --manifest-path src-tauri/Cargo.toml` 通过。
    - 24 个 storage 测试全绿。
  - `npm run build` 通过。
  - `git diff --check` 通过。

  ## 当前边界

  - 这一步只补了后端和 bridge，不包含前端环境入口和变量增删 UI。
  - `create environment` 仍然继续复用现有 `save_environment()` 路径，符合 Task 2 的收敛结论。

  - 自信度检查：对本阶段结果有 100% 信心。底层持久化、bridge 命令和前端类型链路都有实证支撑，当前未完成的只剩前端闭环。

- [x] Task 4: 大型全面检查 - 审计 Environment CRUD 闭环与变量编辑入口
  - 目标：确认 environment 管理不是只有命令，而是用户路径真能走通。
  - 独立验证：构建、测试、真实操作路径都通过。
  - 完成内容：已完成本轮 Environment CRUD 的综合审计，并把验证证据补齐到前后端两层。

  ## 审计范围

  - 用户路径：
    - 新建 environment
    - 重命名 environment
    - 新增变量
    - 编辑变量
    - 删除变量
    - 保存 environment
    - 删除 environment
  - 审计方式：
    - 前端集成测试跑完整 UI 路径
    - Rust storage 测试验证 rename / delete / save 的真实持久化
    - 构建与 diff-check 审计回归风险

  ## 审计结果

  - `src/App.crud.test.tsx`
    - 新增 environment CRUD 集成测试：
      - 打开 `Environments`
      - `New Env`
      - `Rename Env`
      - `Add Variable`
      - `Save Env`
      - 删除变量
      - 再次 `Save Env`
      - `Delete Env`
    - 测试里已 mock 并断言：
      - `save_environment`
      - `rename_environment`
      - `delete_environment`
  - `src/test/setup.ts`
    - 为 `window.scrollTo` 添加 stub，去掉 JSDOM 噪音，保证回归输出干净可读。
  - 验证命令：
    - `npm test` 通过，2 个前端 CRUD 集成测试全绿。
    - `npm run build` 通过。
    - `cargo test environment --manifest-path src-tauri/Cargo.toml` 通过，8 个环境相关测试全绿。
    - `cargo test storage --manifest-path src-tauri/Cargo.toml` 通过，24 个 storage 测试全绿。
    - `git diff --check` 通过。

  ## 结论

  - 在当前本地 preview 环境里无法直接完成 Tauri 桌面壳持久化点击审计，但本轮已经通过“前端完整交互测试 + Rust 真实持久化测试”的组合，把 `P0-2` 的关键闭环跑通并留有证据。
  - 当前不存在只改 UI、不落盘的假闭环残留。

  - 自信度检查：对本次审计结果有 100% 信心。核心用户路径已有前端测试覆盖，真实持久化已有 Rust 测试覆盖，且构建与 diff-check 都已通过。

- [x] Task 5: 补齐变量新增 / 删除 / 保存反馈闭环
  - 目标：把 environment 变量编辑补到真正可管理，而不是只能改现有值。
  - 独立验证：可以新增变量、删除变量、修改变量并保存到本地文件。
  - 完成内容：已完成前端 environment 变量编辑闭环、环境级操作面板和保存状态体系。

  ## 本轮实现

  - `src/store/requestStore.ts`
    - 为 environment variables 引入稳定 `id`，避免新增 / 删除行时依赖索引导致错位。
    - 新增：
      - `normalizeEnvironmentVars()`
      - `appendEnvironmentVar()`
      - `removeEnvironmentVarRow()`
      - `makeScratchEnvironment()`
    - store API 改为按 `rowId` 更新与删除变量：
      - `updateEnvironmentVar(environmentId, rowId, field, value)`
      - `addEnvironmentVar(environmentId)`
      - `removeEnvironmentVar(environmentId, rowId)`
  - `src/App.tsx`
    - 新增 environment 操作状态：
      - `environmentActionMode`
      - `environmentActionValue`
      - `environmentActionMessage`
      - `pendingEnvironmentFocus`
      - `savedEnvironmentSignatures`
    - 补齐环境操作入口：
      - `New Env`
      - `Rename Env`
      - `Delete Env`
    - 补齐变量编辑入口：
      - `Add Variable`
      - 行级 `Remove`
      - 键和值都可编辑
    - 统一空环境创建和常规新建逻辑，避免双轨维护。
    - 保存时会基于 signature 维护 `Unsaved / Saving / Saved / Error` 反馈。
    - 保存时会把带 `id` 的前端变量行映射回 `{ key, value }` 持久化格式。
  - `src/styles.css`
    - 补齐 environment 表格行和操作区样式，使新增 / 删除变量后的布局保持稳定。

  ## 完成标准核对

  - 新建 environment：已支持。
  - 重命名 environment：已支持。
  - 删除 environment：已支持。
  - 新增变量：已支持。
  - 删除变量：已支持。
  - 编辑变量：已支持。
  - 保存反馈：已支持 `Unsaved / Saving / Saved / Error`。

  - 自信度检查：对当前实现有 100% 信心。前端状态模型、UI 入口、保存路径和测试证据已经形成完整闭环，未发现剩余结构性缺口。
