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

## 代码约定

- 使用两个空格缩进、单引号和尾随逗号，具体格式由 Prettier 与 EditorConfig 维护。
- 导入依次分为副作用导入、`node:` 前缀的 Node 内置模块、第三方包、其他绝对路径或别名、相对路径；组内排序由 ESLint 自动检查，`pnpm lint` 可修复。副作用导入保持原有的相对顺序。
- NestJS 代码按模块组织；控制器处理 HTTP 输入并委托服务，业务逻辑放在服务中。
- 明确处理异步错误与 Promise；对外输入在边界验证，不在日志中输出密钥、令牌等敏感信息。
- 命名应反映业务含义，类使用 PascalCase，变量与方法使用 camelCase，文件遵循已有的 NestJS 命名方式。

## 提交信息

使用 `type(scope): 描述` 格式，例如 `feat(auth): 添加登录接口` 或 `fix: 修复参数校验`。scope 可省略，使用小写；type 支持 `feat`、`fix`、`docs`、`style`、`test`、`refactor`、`chore`、`revert`。

使用 `printf 'feat(auth): 添加登录接口\n' | pnpm commitlint` 检查提交信息。此项目没有自动安装 Git hook，需要在提交时自行检查或在 CI 中运行检查。
