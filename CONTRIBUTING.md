# 项目开发规范

项目的代码检查参考阿里巴巴开源的 `eslint-config-ali`，提交信息参考其 `commitlint-config-ali`。规则按当前 NestJS、TypeScript 和 Prettier 工具链配置；具体行为以项目配置为准。

## 日常检查

- `pnpm lint:check`：只检查代码，不修改文件；警告也会导致检查失败。
- `pnpm lint`：检查并自动修复可修复的问题。
- `pnpm format:check`：检查 `src` 和 `test` 下 TypeScript 文件的格式。
- `pnpm format`：格式化这些文件。
- `pnpm build`：编译项目。
- `pnpm test`、`pnpm test:e2e`：运行单元测试和端到端测试。

提交前根据改动运行相关检查；涉及代码改动时至少检查格式、lint 和构建，并运行适用测试。现有 Jest 与 NestJS 12 的 ES 模块兼容问题需要单独调整。

## 目录结构与分层

架构采用「业务域垂直切分 + 域内分层」：外层按限界上下文分域（`src/modules/<domain>`），每个域内部按接入层 → 应用层 → 领域层 → 仓储层单向依赖。新增业务一律放进对应业务域，不在 `src` 根下散落文件。

```text
src/
├── main.ts                      # 启动装配：Fastify、全局 pipe/filter/interceptor
├── app.module.ts                # 根模块：只做汇总，不写业务
├── app.controller.ts            # 健康检查 / 版本号
│
├── modules/                     # 业务域（限界上下文），一域一目录
│   └── <domain>/                # 如 auth、user、org、rbac、audit、ai
│       ├── <domain>.module.ts   # 依赖装配
│       ├── controller/          # 接入层
│       │   ├── <domain>.controller.ts
│       │   └── dto/             # 请求参数（zod schema）
│       ├── service/             # 应用层：用例编排、事务边界
│       ├── manager/             # 领域层：业务规则、第三方防腐（简单 CRUD 可省）
│       ├── repository/          # 仓储层
│       │   ├── <x>.repo.ts      #   接口（port）
│       │   └── impl/
│       │       └── pg-<x>.repo.ts   # 实现（adapter，对接 infra/db）
│       └── model/               # 领域模型：DO / BO / VO / Query
│
├── infra/                       # 基础设施（COLA 的 infrastructure 层）
│   ├── db/                      # pg 数据源、迁移、通用分页
│   ├── langchain/               # LLM / RAG / 向量库 / langgraph 封装
│   ├── cache/
│   ├── mq/
│   └── third-party/             # 外部服务防腐层（ACL）
│
├── common/                      # HTTP 横切
│   ├── response/                # 响应包装 · 异常过滤
│   ├── guard/                   # 鉴权 · 权限
│   ├── interceptor/
│   ├── filter/
│   ├── pipe/                    # zod 校验管道
│   ├── decorator/
│   └── middleware/
│
├── shared/                      # 纯工具：不依赖 Nest、不含业务语义
│   ├── utils/
│   ├── types/
│   └── constants/               # 常量 · 枚举
│
└── config/                      # 配置加载（zod 校验 env）
    ├── env.ts
    └── configuration.ts
```

`test/` 保持平铺，e2e 用例按 `*.e2e-spec.ts` 命名。

### 分层职责

- **接入层**（`controller/`、`dto/`）：HTTP 路由、鉴权取参、入参校验，不写业务逻辑。
- **应用层**（`service/`）：用例编排与事务边界，调用 manager / repository 完成一个完整用例。
- **领域层**（`manager/`）：业务规则、第三方服务防腐、跨仓储的领域逻辑；纯 CRUD 的域可省略此层，由 service 直连 repository。
- **仓储层**（`repository/`）：接口（port）定义数据访问契约，`impl/` 中的实现对接 `infra/db`。
- **基础设施层**（`infra/`）：技术细节封装（pg、langchain、cache、mq、第三方 ACL），对业务层无感。

### 依赖规则

1. 模块内严格分层调用：controller → service → manager → repository，只准向下，禁止反向 import。
2. 业务域之间不直接 import 对方内部文件；确需协作时只依赖对方 module 通过 Nest `exports` 导出的 service，或发领域事件。
3. 业务层只依赖 `infra/` 的封装，SQL、prompt、向量库细节不出现在 service 以上。
4. `common/` 不依赖 `modules/`；`shared/` 不依赖任何层（包括 Nest）。
5. 跨域编排放应用层 service 完成，不在 controller 里拼装。

### 模型命名

沿用分层模型命名，TypeScript 中用文件后缀区分，不再嵌套子目录：

- DO（如 `user.do.ts`）：与数据库表对应的持久化对象。
- BO（如 `user.bo.ts`）：领域业务对象。
- DTO（如 `login.dto.ts`）：接口入参传输对象，配合 zod schema。
- VO（如 `user.vo.ts`）：返回给前端的视图对象。
- Query（如 `user.query.ts`）：查询条件对象。

## 代码约定

- 使用两个空格缩进、单引号和尾随逗号，具体格式由 Prettier 与 EditorConfig 维护。
- 导入依次分为副作用导入、`node:` 前缀的 Node 内置模块、第三方包、其他绝对路径或别名、相对路径；组内排序由 ESLint 自动检查，`pnpm lint` 可修复。副作用导入保持原有的相对顺序。
- NestJS 代码按 `src/modules/<domain>` 业务域组织，分层职责与依赖规则见「目录结构与分层」；控制器只处理 HTTP 输入并委托服务，业务逻辑放在服务与领域层。
- 明确处理异步错误与 Promise；对外输入在边界验证，不在日志中输出密钥、令牌等敏感信息。
- 命名应反映业务含义，类使用 PascalCase，变量与方法使用 camelCase，文件遵循已有的 NestJS 命名方式。

## 提交信息

使用 `type(scope): 描述` 格式，例如 `feat(auth): 添加登录接口` 或 `fix: 修复参数校验`。scope 可省略，使用小写；type 支持 `feat`、`fix`、`docs`、`style`、`test`、`refactor`、`chore`、`revert`。

使用 `printf 'feat(auth): 添加登录接口\n' | pnpm commitlint` 检查提交信息。此项目没有自动安装 Git hook，需要在提交时自行检查或在 CI 中运行检查。
