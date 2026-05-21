# Goal 2 Plan

## 需求分析

用户再次以 `/goal` 提交同一整体目标，必须重新进入 goal workflow，并在当前项目下创建递增编号的 `goal-2/` 目录，包含 `input.md`、`plan.md`、`tasks.md`。在这三个文件完成前不得修改代码。

目标是完成一个 Tauri + TypeScript 前端 + Rust 核心 + 本地数据层的 API Client。明确能力包括：

- 前端 UI 层：请求编辑器、Header / Query / Body 表单、响应查看器、历史记录、环境变量、Collection 管理、设置页面。
- Tauri Bridge 层：command 暴露、参数校验、类型转换、错误封装、前后端事件通信。
- Rust Core 核心层：HTTP 请求引擎、环境变量解析、Cookie 管理、Auth 处理、Proxy / TLS 配置、cURL 导入导出、Postman Collection 导入、文件上传下载。
- 本地数据层：SQLite、JSON/YAML 文件、系统 Keychain、本地缓存、日志。

## 当前上下文

当前项目已经存在 `goal-1/`，且 `goal-1/tasks.md` 显示此前已完成一轮完整实现与审计，包括 React/Tauri 基础工程、Postman 风格工作台、SQLite 历史、文件系统 Collection/Environment、Keychain Secret、真实 HTTP 请求链路、构建与 Rust 检查。

由于本次是新的 `/goal` 输入，本计划不会默认相信历史记录已经完全代表当前文件状态。后续任务必须重新读取实际代码、命令输出和测试结果，用真实证据确认每项要求是否已覆盖；若发现缺口，则只选择一个最小可验证 task 修复。

## 风险

- 目标范围很大，完整生产级 Postman 替代品不可在单个 task 内完成，必须按最小可验证闭环推进。
- `goal-1` 的完成记录可能与当前实际代码不一致，必须重新审计，不能只依赖文字记录。
- 当前 git 工作区几乎全为未跟踪文件，提交时必须避免误提交用户或历史未确认改动。
- 部分能力如 Proxy/TLS、文件上传下载、Postman/cURL 导入导出可能只是框架或未实现，审计时需要明确区分“已实现”“部分实现”“未实现”。
- 本地端口、Keychain、Tauri dev 运行可能受沙箱或系统权限影响，验证结果需要标注执行环境。

## 执行方案

1. 创建 `goal-2/input.md`、`goal-2/plan.md`、`goal-2/tasks.md`，保存原始输入并建立新任务链。
2. 对当前实际项目做完整基线审计，逐项映射用户目标到代码、配置、测试与运行证据。
3. 若审计发现最关键缺口，选择一个最小闭环实现；若所有基础交付已满足，则进入最终完成度审计。
4. 每三个 task 后进行一次大型全面检查 - debug 循环，覆盖前端、Tauri bridge、Rust core、本地数据、构建、测试和运行态。
5. 所有 task 完成后执行最终最大的 review，从 C 端体验、代码质量、安全性、数据持久化、错误处理、测试覆盖角度复查，确认无剩余必需工作后再标记 goal 完成。

## 验证方式

- 文件级验证：`rg --files`、逐文件读取相关实现。
- 前端验证：`npm run build`。
- Rust 验证：`cargo check --manifest-path src-tauri/Cargo.toml`。
- 单测验证：按模块运行 `cargo test --manifest-path src-tauri/Cargo.toml ...`。
- 运行验证：必要时运行 `npm run tauri -- dev`，确认 Tauri 应用能启动。
- 审计验证：建立 prompt-to-artifact checklist，将每个明确要求映射到具体文件、命令输出或测试证据。

## 回滚方案

- 所有手工编辑通过 `apply_patch` 完成，便于审查和定点回滚。
- 不使用 `git reset --hard`、`git checkout --` 等破坏性命令。
- 若某个 task 引入问题，优先用反向补丁撤销本 task 改动，不触碰无关文件。
- 若测试或构建失败，先定位最小失败面并修复；无法安全修复时，停止并向用户报告风险与建议。
