# Goal 5 Tasks

- [x] Task 1: 创建 `goal-5/input.md`、`goal-5/plan.md`、`goal-5/tasks.md`
  - 目标：按 `AGENTS.md` 要求为本轮“开发任务表”请求建立新的 goal 目录和三件套。
  - 独立验证：三份文件存在，`input.md` 逐字保留用户原始输入，`plan.md` 包含完整规划结构。
  - 完成内容：已创建 `goal-5/` 三件套；`input.md` 逐字保存“开发任务表”；`plan.md` 写入需求分析、上下文、风险、执行方案、验证方式和回滚方案；`tasks.md` 建立本轮任务链。
  - 自信度检查：当前 task 只涉及文档创建，已满足要求，具备 100% 结束信心。

- [x] Task 2: 梳理当前实现状态与缺口基线
  - 目标：确认当前哪些能力已完成、哪些能力半实现、哪些能力仍缺失，为任务表提供真实依据。
  - 独立验证：形成和当前项目状态一致的能力基线，不重复列出已完成工作。
  - 完成内容：已完成当前能力基线梳理，并和代码状态对齐。确认 `P0-3 Explorer 搜索过滤`、`P0-4 请求编辑器基础闭环`、`P0-5 History 基础回放` 已完成；`P0-6 首次启动与空状态` 正在推进。已核对空状态实现证据，包括 `scratch-request`、`No collections yet`、`No environments yet`、空工作区 import 路径以及 `storage.rs` 中的空默认 workspace 和首个 request 保存逻辑。已核对请求保存状态、history restore/resend、dirty/saved 反馈等现有能力，确保后续任务表不会把这些已完成事项重复列为待开发。
  - 自信度检查：对当前基线有 100% 信心，原因是结论都能直接对应到代码证据：`src/App.tsx`、`src/store/requestStore.ts`、`src-tauri/src/storage.rs` 中的关键实现和测试命名均已核对。

- [x] Task 3: 产出按 `P0 / P1 / P2` 划分的开发任务表
  - 目标：把当前缺口整理成可以直接排期的任务表。
  - 独立验证：每项任务都包含涉及层、主要内容、完成标准和预估体量。
  - 完成内容：已产出按 `P0 / P1 / P2` 划分的开发任务表，并增加状态字段，明确区分 `已完成 / 进行中 / 待开发`。任务表如下。

  ## 开发任务表

  ### 已完成 / 进行中

  | ID | 任务 | 状态 | 说明 |
  | --- | --- | --- | --- |
  | P0-3 | Explorer 搜索过滤 | 已完成 | Collections / History / Environments 搜索过滤已生效。 |
  | P0-4 | 请求编辑器基础闭环 | 已完成 | Params / Headers 增删改、dirty/save 反馈、空白行处理已补齐。 |
  | P0-5 | History 基础回放 | 已完成 | History restore / resend、真实 method / status / duration 展示已接通。 |
  | P0-6 | 首次启动与空状态 | 进行中 | 空工作区与空面板分支已落地，仍需最终审计闭环。 |

  ### P0

  | ID | 任务 | 状态 | 涉及层 | 主要内容 | 完成标准 | 预估 |
  | --- | --- | --- | --- | --- | --- | --- |
  | P0-1 | Collection / Request CRUD | 待开发 | 前端 UI / Bridge / Rust / 数据层 | 新建、重命名、删除、复制 request；新建、重命名、删除 collection；排序与移动。 | 用户可完整管理 collection 和 request，变更可持久化到本地文件。 | L |
  | P0-2 | Environment CRUD | 待开发 | 前端 UI / Bridge / Rust / 数据层 | 新建、重命名、删除 environment；新增、删除、编辑变量。 | Environment 管理不再只限于切换和保存现有项。 | M |
  | P0-6 | 首次启动与空状态 | 进行中 | 前端 UI / 数据层 | 去除对 sample/seed 数据依赖，补齐无 collection / 无 environment / 无 history 的空状态与导入路径。 | 项目不依赖 seed 数据也能顺利进入可操作状态。 | M |

  ### P1

  | ID | 任务 | 状态 | 涉及层 | 主要内容 | 完成标准 | 预估 |
  | --- | --- | --- | --- | --- | --- | --- |
  | P1-1 | Body 多模式支持 | 待开发 | 前端 UI / Bridge / Rust | JSON、Raw、`application/x-www-form-urlencoded`、`multipart/form-data`。 | 用户可切换 body 类型并真实发出对应请求。 | L |
  | P1-2 | Auth 多方案支持 | 待开发 | 前端 UI / Bridge / Rust | Basic Auth、API Key、Bearer 完善，预留 OAuth2 入口。 | 常见鉴权方式覆盖完整。 | M |
  | P1-3 | Params / Headers 高级编辑 | 待开发 | 前端 UI | 描述列、批量编辑、粘贴导入、hidden/disabled 统计、排序。 | 体验接近 Postman 基础编辑能力。 | M |
  | P1-4 | Response Viewer 增强 | 待开发 | 前端 UI | Pretty/Raw、搜索、复制、JSON tree、更真实 timeline。 | Response 不再只是文本框和简单列表。 | M |
  | P1-5 | Settings 真配置化 | 待开发 | 前端 UI / Bridge / 数据层 | theme、auto-save、recent workspace、默认网络策略等配置。 | Settings 成为真正配置中心。 | M |
  | P1-6 | 文件能力整合进请求流 | 待开发 | 前端 UI / Bridge / Rust | 上传文件直接进入 multipart body；响应一键下载。 | Files 不再只是独立工具面板。 | M |

  ### P2

  | ID | 任务 | 状态 | 涉及层 | 主要内容 | 完成标准 | 预估 |
  | --- | --- | --- | --- | --- | --- | --- |
  | P2-1 | Collection 组织能力升级 | 待开发 | 前端 UI / 数据层 | 分组、拖拽排序、折叠状态持久化。 | 复杂 collection 仍然可管理。 | M |
  | P2-2 | History 深化 | 待开发 | 前端 UI / 数据层 | 搜索、筛选、按 request 聚合、diff 两次响应。 | History 升级为调试资产。 | M |
  | P2-3 | Import / Export 扩展 | 待开发 | 前端 UI / Bridge / Rust | OpenAPI 导入、环境导入导出、collection 导出。 | 互操作能力更完整。 | L |
  | P2-4 | 日志与诊断中心 | 待开发 | 前端 UI / Bridge / Rust / 数据层 | bridge event 检索、请求失败诊断、运行日志查看。 | 调试链路更可见。 | M |
  | P2-5 | Draft 恢复与自动保存 | 待开发 | 前端 UI / 数据层 | unsaved draft、异常恢复、tab 状态恢复。 | 编辑过程更可靠。 | M |
  | P2-6 | 测试体系补强 | 待开发 | 前端 UI / Rust | 前端交互测试、Tauri 命令测试、端到端 smoke test。 | 核心能力有回归保障。 | L |

  ### 建议首个迭代

  | 顺序 | 任务 | 原因 |
  | --- | --- | --- |
  | 1 | P0-6 首次启动与空状态 | 已经在推进，优先收口能减少后续所有任务的假数据干扰。 |
  | 2 | P0-1 Collection / Request CRUD | 这是“能不能真正管理接口资产”的第一核心能力。 |
  | 3 | P0-2 Environment CRUD | 没有完整 CRUD，环境系统仍然是半成品。 |
  | 4 | P1-1 Body 多模式支持 | 这是请求编辑器迈向真实 API Client 的关键闭环。 |
  | 5 | P1-2 Auth 多方案支持 | 常见接口场景离不开 Basic / API Key 等补齐。 |

  - 自信度检查：对任务表有 100% 信心。它已经把当前已完成、进行中和待开发三类事项分开，而且每项都有明确完成标准，不会再出现“只做出 UI 但闭环缺失”的歧义。

- [x] Task 4: 大型全面检查 - 校对任务表与当前状态一致性
  - 目标：对前 3 个 task 做一次全面检查，确认任务表没有和当前实现状态冲突。
  - 独立验证：已完成项、进行中项、待开发项之间边界清晰，并给出建议首个迭代顺序。
  - 完成内容：已完成一致性检查。确认任务表没有把 `P0-3 / P0-4 / P0-5` 误列为待开发，而是归到“已完成”；`P0-6` 被保留为“进行中”；真正的待开发项从 `P0-1 / P0-2` 开始。还额外核对了底层已有但上层未闭环的能力，例如 HTTP send、Bearer Auth、Cookie / Proxy / TLS、cURL / Postman、文件上传下载基础能力，这些被反映为后续产品化任务，而不是误写成完全未实现。
  - 自信度检查：对一致性检查有 100% 信心。任务表和当前代码、当前 goal 进度、以及已知实现证据之间没有冲突。
