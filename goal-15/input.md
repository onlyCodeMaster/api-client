/goal P0

ID	任务	涉及层	主要内容	完成标准	预估
P0-1	Collection / Request CRUD	前端 UI / Bridge / Rust / 数据层	新建、重命名、删除、复制 request；新建、重命名、删除 collection；排序与移动	用户可完整管理 collection 和 request，变更可持久化到本地文件	
P0-2	Environment CRUD	前端 UI / Bridge / Rust / 数据层	新建、重命名、删除 environment；新增、删除、编辑变量	environment 管理不再只限于切换和保存现有项	M
P0-3	Explorer 搜索过滤	前端 UI	Collections、History、Environments 的搜索/过滤真正生效	搜索输入可实时过滤列表，空结果有反馈	S
P0-4	请求编辑器基础闭环	前端 UI / Bridge	Params/Headers 行删除、空行聚焦、dirty 状态、save 成功/失败反馈	编辑器具备基本可用性，不再只是“能改值”	M
P0-5	History 基础回放	前端 UI / Bridge / 数据层	点击历史记录恢复请求、快速 resend、展示真实状态与时间	History 不只是展示列表，而是可回放	M
P0-6	首次启动与空状态	前端 UI / 数据层	无 collection / 无 environment / 无 history 时的空状态与引导	项目不依赖 seed 数据也能顺利进入可操作状态	M
P1

ID	任务	涉及层	主要内容	完成标准	预估
P1-1	Body 多模式支持	前端 UI / Bridge / Rust	JSON、Raw、x-www-form-urlencoded、multipart/form-data	用户可切换 body 类型并真实发出对应请求	L
P1-2	Auth 多方案支持	前端 UI / Bridge / Rust	Basic Auth、API Key、Bearer 完善，预留 OAuth2 入口	常见鉴权方式覆盖完整	M
P1-3	Params / Headers 高级编辑	前端 UI	描述列、批量编辑、粘贴导入、hidden/disabled 统计、排序	体验接近 Postman 基础编辑能力	M
P1-4	Response Viewer 增强	前端 UI	Pretty/Raw、搜索、复制、JSON tree、更真实 timeline	Response 不再只是文本框和简单列表	M
P1-5	Settings 真配置化	前端 UI / Bridge / 数据层	theme、auto-save、recent workspace、默认网络策略等配置	Settings 成为真正配置中心	M
P1-6	文件能力整合进请求流	前端 UI / Bridge / Rust	上传文件直接进入 multipart body；响应一键下载	Files 不再只是独立工具面板	M
P2

ID	任务	涉及层	主要内容	完成标准	预估
P2-1	Collection 组织能力升级	前端 UI / 数据层	分组、拖拽排序、折叠状态持久化	复杂 collection 仍然可管理	M
P2-2	History 深化	前端 UI / 数据层	搜索、筛选、按 request 聚合、diff 两次响应	History 升级为调试资产	M
P2-3	Import / Export 扩展	前端 UI / Bridge / Rust	OpenAPI 导入、环境导入导出、collection 导出	互操作能力更完整	L
P2-4	日志与诊断中心	前端 UI / Bridge / Rust / 数据层	bridge event 检索、请求失败诊断、运行日志查看	调试链路更可见	M
P2-5	Draft 恢复与自动保存	前端 UI / 数据层	unsaved draft、异常恢复、tab 状态恢复	编辑过程更可靠	M
P2-6	测试体系补强	前端 UI / Rust	前端交互测试、Tauri 命令测试、端到端 smoke test	核心能力有回归保障	L
