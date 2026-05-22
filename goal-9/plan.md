# Goal 9 Plan

## 需求分析

当前 active goal 的下一个最高优先级未完成项是 `P1-2 Auth 多方案支持`。目标不只是把 auth 面板里多放几个下拉项，而是要把请求鉴权从目前的基础 `none / bearer` 扩展为真正可用的多方案闭环，至少补齐：

- Basic Auth
- API Key
- Bearer 完善
- 为 OAuth2 预留合理入口

完成标准是：常见鉴权方式覆盖完整。

## 当前上下文

已完成：

- `P0-1 Collection / Request CRUD`
- `P0-2 Environment CRUD`
- `P0-3 Explorer 搜索过滤`
- `P0-4 请求编辑器基础闭环`
- `P0-5 History 基础回放`
- `P0-6 首次启动与空状态`
- `P1-1 Body 多模式支持`

与 `P1-2` 直接相关的现状已做初步审计：

- 前端 `src/App.tsx` 的 auth 面板目前只支持：
  - `No Auth`
  - `Bearer Token`
- store 的 `AuthType` 目前只有：
  - `none`
  - `bearer`
- Rust `src-tauri/src/http.rs` 当前只会在 `auth_type == "bearer"` 时插入 `Authorization: Bearer ...`
- `curl` / `postman` 导入导出当前也主要围绕 bearer 路径

## 风险

- 如果只改前端枚举，不改 Rust 发送逻辑，会出现“能选 Basic/API Key 但发出去仍然没有鉴权”的假闭环。
- API Key 需要支持不同注入位置（header/query）与自定义 key 名，如果状态模型设计太窄，后续会返工。
- Basic Auth 若只把 base64 结果当普通字符串存，可能影响后续保存/编辑体验和变量模板解析。
- Bearer 完善时若不处理与显式 `Authorization` header 的关系，可能出现重复 header 或覆盖冲突。
- OAuth2 不在本轮最小完成标准里，但入口设计如果过重，会拖慢 `P1-2` 的闭环。

## 执行方案

1. 创建 `goal-9/input.md`、`goal-9/plan.md`、`goal-9/tasks.md`。
2. 梳理当前 auth 数据模型、发送链路、存储、history、curl/postman 的最小缺口。
3. 先补最小数据层 / bridge / Rust 发送闭环：
   - 扩展 `AuthType`
   - Basic Auth
   - API Key（header/query）
   - Bearer 与显式 header 的规则整理
4. 再补前端 auth editor：
   - Type 切换
   - Basic 用户名/密码
   - API Key 名称 / 值 / 注入位置
   - Bearer token
5. 处理保存、加载、history replay、import/export 的兼容。
6. 做构建、测试和真实交互审计。

## 验证方式

- 前端交互测试覆盖：
  - 切换 auth 类型
  - 编辑 Basic/Auth/API Key/Bearer
  - 保存 request 并 reload
  - 发送时 payload 正确
- Rust 或 bridge 测试覆盖：
  - Basic Auth header 构造
  - API Key header/query 注入
  - Bearer 与显式 header 的行为
- `npm test` 通过。
- `npm run build` 通过。
- 与 auth 相关的 Rust 测试通过。
- `git diff --check` 通过。

## 回滚方案

- 所有代码编辑使用 `apply_patch`。
- 不使用破坏性 git 命令。
- 若 API Key 范围膨胀，优先守住 `header/query` 两种最常见注入位置，不提前扩展 cookie/session 类鉴权。
