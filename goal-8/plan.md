# Goal 8 Plan

## 需求分析

当前 active goal 的下一个最高优先级未完成项是 `P1-1 Body 多模式支持`。目标不只是把 UI 做成多几个 tab，而是要把 request body 从单一/基础 raw 编辑扩展为真正可用的多模式请求编辑与发送，至少补齐：

- JSON
- Raw Text
- `application/x-www-form-urlencoded`
- `multipart/form-data`

完成标准是：用户可切换 body 类型并真实发出对应请求。

## 当前上下文

已完成：

- `P0-1 Collection / Request CRUD`
- `P0-2 Environment CRUD`
- `P0-3 Explorer 搜索过滤`
- `P0-4 请求编辑器基础闭环`
- `P0-5 History 基础回放`
- `P0-6 首次启动与空状态`

与 `P1-1` 直接相关的现状需要进一步代码审计确认，但已知：

- 前端已有 Request Body 编辑区。
- Rust 核心已有 HTTP 请求发送能力。
- 项目中已有独立文件上传/下载能力。
- 当前 body 编辑与发送更接近基础 raw/json 路径，尚未形成统一的多模式闭环。

## 风险

- 如果只改 UI，不同步请求构造，最终会出现“能切 body 类型但发出的仍是同一种请求”的假闭环。
- `multipart/form-data` 可能与现有独立文件工具、header 自动设置、boundary 处理相互影响。
- `x-www-form-urlencoded` 与 `multipart/form-data` 都需要行式 key/value 数据模型，若直接复用现有 raw body 状态容易产生错配。
- 多模式切换时若不设计迁移/保留策略，可能导致用户切换模式时内容丢失。
- 自动设置 `Content-Type` 若处理不当，可能和用户自定义 header 冲突。

## 执行方案

1. 创建 `goal-8/input.md`、`goal-8/plan.md`、`goal-8/tasks.md`。
2. 审计当前 request body 数据模型、前端 UI、bridge 入参、Rust 请求构造路径。
3. 先补请求模型与发送链路：
   - 明确 body mode 枚举
   - 为 raw/json、urlencoded、multipart 建立可持久化数据结构
   - 发送时按模式构造真实请求体
4. 再补前端 body 编辑入口：
   - body 模式切换
   - raw/json 文本编辑
   - urlencoded key/value 行编辑
   - multipart key/value/file 行编辑
5. 处理多模式切换、自动 header、保存与加载兼容。
6. 做构建、测试和真实交互审计。

## 验证方式

- 前端交互测试覆盖：
  - 切换 body 模式
  - 编辑 raw/json body
  - 编辑 urlencoded body
  - 编辑 multipart body
- Rust 或桥接测试覆盖：
  - 按模式构造真实 HTTP 请求
  - `Content-Type` 行为符合预期
- `npm test` 通过。
- `npm run build` 通过。
- 与 body 相关的 Rust 测试通过。
- `git diff --check` 通过。

## 回滚方案

- 所有代码编辑使用 `apply_patch`。
- 不使用破坏性 git 命令。
- 若 `multipart/form-data` 范围膨胀，优先守住 `raw/json + urlencoded + multipart` 的最小发送闭环，不提前扩展高级文件队列、批量文件选择或 preview 能力。
