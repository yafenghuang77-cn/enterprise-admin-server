# 环境变量与配置读取设计

本文约定 enterprise-admin-server 的环境变量命名、**按 `NODE_ENV` 分环境读取**、启动校验、配置读取方式，以及仓库/部署侧的文件分工。覆盖 development / test / staging / production 四套配置。

## 1. 背景与现状

技术栈（以 `package.json` 为准）：NestJS 12 + Fastify，MySQL（TypeORM）、Redis、RabbitMQ/Kafka（见 [mq-selection.md](./mq-selection.md)）、MongoDB（LangGraph checkpoint）、DeepSeek/OpenAI（LangChain）。

当前配置相关现状：

| 项 | 状态 |
| --- | --- |
| `@nestjs/config`、`zod` | 已在 dependencies，尚未接入 |
| 环境变量读取 | 仅 `main.ts` 中 `process.env.PORT` |
| `.env` / `.env.example` | 不存在 |
| 启动期校验 | 无 |

问题：密钥、连接串会散落为 `process.env.XXX` 裸调用；写错要到运行期才暴露；类型全无。

## 2. 设计目标

1. **启动即校验**：缺变量、类型错、生产误开危险开关，在 `bootstrap` 阶段失败并给出可读错误，而不是第一个请求 500。
2. **单一读取入口**：业务代码只注入类型化门面 `AppConfigService`；基础设施装配（TypeORM/Redis/MQ）用 `ConfigService` + 命名空间键。
3. **键名自文档**：扁平大写变量（环境契约）→ 嵌套命名空间（代码内键），两边职责分离。
4. **环境差异外置**：按 `NODE_ENV` 选择 `.env.<env>`（可选 `.env.<env>.local` 个人覆盖）；进程环境变量（CI / K8s）始终优先于文件；仓库不存真实生产密钥。
5. **可测**：单测/e2e 可整体替换配置，不必改业务代码。

## 3. 环境变量清单（契约）

以下为各环境文件的共同变量契约（键 + 默认值）。按环境的取值见仓库根目录 `.env.development` / `.env.test` / `.env.staging` / `.env.production`。详细校验规则见 §5。

### 3.1 应用

| 变量 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | enum | `development` | `development` / `test` / `staging` / `production`；决定读取哪套配置文件，须与文件名一致 |
| `PORT` | int | `3000` | 监听端口 |
| `HOST` | string | `0.0.0.0` | 监听地址 |
| `LOG_LEVEL` | enum | `info` | `error` / `warn` / `info` / `debug` |

### 3.2 MySQL（TypeORM）

| 变量 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DB_HOST` | string | — | 必填 |
| `DB_PORT` | int | `3306` | |
| `DB_USERNAME` | string | — | 必填 |
| `DB_PASSWORD` | string | `''` | |
| `DB_DATABASE` | string | — | 必填 |
| `DB_POOL_SIZE` | int | `10` | 连接池大小 |
| `DB_SYNC` | bool | `false` | TypeORM synchronize；**production 禁止为 true** |
| `DB_LOGGING` | bool | `false` | |

### 3.3 Redis

| 变量 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `REDIS_HOST` | string | — | 必填 |
| `REDIS_PORT` | int | `6379` | |
| `REDIS_PASSWORD` | string | `''` | |
| `REDIS_DB` | int | `0` | |
| `REDIS_PREFIX` | string | `eas:` | cache key 前缀，避免多服务撞键 |

### 3.4 MongoDB（LangGraph checkpoint）

| 变量 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `MONGODB_URI` | string | — | 以 `mongodb` 开头；未启用 agent 时可省略 |

### 3.5 认证

| 变量 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `JWT_SECRET` | string | — | 必填；production 要求长度 ≥ 32 且不可为 `change-me` |
| `JWT_EXPIRES_IN` | string | `2h` | access token |
| `JWT_REFRESH_EXPIRES_IN` | string | `7d` | refresh token |

### 3.6 LLM

| 变量 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | string | — | 可选；开启 AI 时至少与 OpenAI 二选一 |
| `DEEPSEEK_MODEL` | string | `deepseek-chat` | |
| `OPENAI_API_KEY` | string | — | 可选 |
| `OPENAI_BASE_URL` | string | — | 可选，兼容中转 |
| `OPENAI_MODEL` | string | `gpt-4o-mini` | |

### 3.7 MQ

与 [mq-selection.md](./mq-selection.md) 对齐：驱动按场景选定，用 `MQ_DRIVER` 显式声明。

| 变量 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `MQ_DRIVER` | enum | `rabbitmq` | `none` / `rabbitmq` / `kafka` |
| `RABBITMQ_URL` | string | — | `MQ_DRIVER=rabbitmq` 时必填 |
| `KAFKA_BROKERS` | string | — | 逗号分隔；`MQ_DRIVER=kafka` 时必填 |
| `KAFKA_CLIENT_ID` | string | `enterprise-admin` | |
| `KAFKA_GROUP_ID` | string | `eas-admin` | |

### 3.8 功能开关

| 变量 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `FEATURE_AI_AGENT` | bool | `false` | 关闭时不注册 AI 相关 Module |
| `FEATURE_AUDIT_LOG` | bool | `true` | |

## 4. 代码结构

```text
src/
  config/
    env-file.ts           # 按 NODE_ENV 解析配置文件路径
    env.schema.ts         # zod schema、Env 类型、validateEnv()
    configuration.ts      # 扁平 env → 嵌套命名空间配置
    app-config.service.ts # 类型化门面（业务唯一读取入口）
    index.ts              # 对外 re-export
  main.ts
  app.module.ts           # ConfigModule / 各 forRootAsync 装配
```

仓库文件约定：

| 路径 | 是否提交 | 说明 |
| --- | --- | --- |
| `.env.development` | 是 | 本地开发 |
| `.env.test` | 是 | 测试 / e2e |
| `.env.staging` | 是 | 预发（密钥占位，部署时替换或注入） |
| `.env.production` | 是 | 生产（密钥占位；真实值建议由部署平台注入覆盖） |
| `.env.<env>.local` | 否（gitignore） | 个人/机器覆盖，优先于对应环境文件 |
| `.env` | 否（gitignore） | 不再使用，避免与分环境文件混淆 |

**读取规则：**

1. 用启动时的 `NODE_ENV` 选择文件：`development` → `.env.development`，依此类推。
2. 同环境优先加载 `.env.<env>.local`（存在则覆盖同名变量）。
3. 文件内 `NODE_ENV` 必须与文件名一致，否则启动失败（防止贴错配置）。
4. 部署平台注入的同名环境变量优先于文件内容。

启动脚本对齐 Nest 官方模板（`nest start` / `nest build` / `node dist/main`），用官方 `--env-file` 选择环境。

| 命令 | 等价 Nest 官方 | 配置文件 |
| --- | --- | --- |
| `pnpm build` | `nest build` | 仅编译，不读配置 |
| `pnpm start` | `nest start` | `.env.development` |
| `pnpm start:dev` | `nest start --watch` | `.env.development` |
| `pnpm start:debug` | `nest start --debug --watch` | `.env.development` |
| `pnpm start:test` / `:staging` | `nest start` | `.env.test` / `.env.staging` |
| `pnpm start:prod` | `node dist/main` | `.env.production` |

```bash
nest start --env-file .env.development
nest start --env-file .env.test
node --env-file=.env.production dist/main   # 需先 build
```

新增变量的固定流程：改 `env.schema.ts` → 四套 `.env.<env>` 同步补键 → 在 `configuration.ts` 映射 → 需要时在 `AppConfigService` 暴露。漏任一环则无法通过类型检查或启动校验。

## 5. Schema 与校验（`env.schema.ts`）

```ts
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().default(3306),
    DB_USERNAME: z.string().min(1),
    DB_PASSWORD: z.string().default(''),
    DB_DATABASE: z.string().min(1),
    DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
    DB_SYNC: bool.default(false),
    DB_LOGGING: bool.default(false),

    REDIS_HOST: z.string().min(1),
    REDIS_PORT: z.coerce.number().int().default(6379),
    REDIS_PASSWORD: z.string().default(''),
    REDIS_DB: z.coerce.number().int().min(0).default(0),
    REDIS_PREFIX: z.string().default('eas:'),

    MONGODB_URI: z.string().startsWith('mongodb').optional(),

    JWT_SECRET: z.string().min(1),
    JWT_EXPIRES_IN: z.string().default('2h'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),

    MQ_DRIVER: z.enum(['none', 'rabbitmq', 'kafka']).default('rabbitmq'),
    RABBITMQ_URL: z.string().optional(),
    KAFKA_BROKERS: z.string().optional(),
    KAFKA_CLIENT_ID: z.string().default('enterprise-admin'),
    KAFKA_GROUP_ID: z.string().default('eas-admin'),

    FEATURE_AI_AGENT: bool.default(false),
    FEATURE_AUDIT_LOG: bool.default(true),
  })
  .superRefine((v, ctx) => {
    if (v.MQ_DRIVER === 'rabbitmq' && !v.RABBITMQ_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['RABBITMQ_URL'],
        message: 'MQ_DRIVER=rabbitmq 时必填',
      });
    }
    if (v.MQ_DRIVER === 'kafka' && !v.KAFKA_BROKERS) {
      ctx.addIssue({
        code: 'custom',
        path: ['KAFKA_BROKERS'],
        message: 'MQ_DRIVER=kafka 时必填',
      });
    }
    if (v.FEATURE_AI_AGENT && !v.DEEPSEEK_API_KEY && !v.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEEPSEEK_API_KEY'],
        message: '开启 FEATURE_AI_AGENT 时至少配置一个 LLM Key',
      });
    }
    if (v.NODE_ENV === 'staging' || v.NODE_ENV === 'production') {
      if (v.DB_SYNC) {
        ctx.addIssue({
          code: 'custom',
          path: ['DB_SYNC'],
          message: `${v.NODE_ENV} 禁止 DB_SYNC=true`,
        });
      }
      if (v.JWT_SECRET.length < 32 || v.JWT_SECRET === 'change-me') {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_SECRET'],
          message: `${v.NODE_ENV} 的 JWT_SECRET 不合法`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(
  raw: Record<string, unknown>,
  selectedNodeEnv?: NodeEnv,
): Env {
  // 文件内 NODE_ENV 与按 NODE_ENV 选择的文件名不一致时直接失败
  if (
    selectedNodeEnv !== undefined &&
    raw.NODE_ENV !== undefined &&
    raw.NODE_ENV !== selectedNodeEnv
  ) {
    const fileNodeEnv =
      typeof raw.NODE_ENV === 'string'
        ? raw.NODE_ENV
        : JSON.stringify(raw.NODE_ENV);
    throw new Error(
      `环境变量校验失败:\n  · NODE_ENV: 按 "${selectedNodeEnv}" 加载配置文件，但文件内 NODE_ENV="${fileNodeEnv}"`,
    );
  }

  const input =
    selectedNodeEnv === undefined ? raw : { ...raw, NODE_ENV: selectedNodeEnv };
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`环境变量校验失败:\n${detail}`);
  }
  return parsed.data;
}
```

约定：

- 数字一律 `z.coerce.number()`，避免 `"3000"` 被当字符串传给 TypeORM。
- 布尔禁止 `!!process.env.X`，统一走 `bool` transform（`"false"` 必须是 false）。
- 跨字段约束放 `superRefine`；错误信息面向人读，不直接抛 zod 原始 JSON。
- `selectedNodeEnv` 由 `resolveNodeEnv(process.env.NODE_ENV)` 在装配 `ConfigModule` 时确定，并作为 NODE_ENV 真值。

## 6. 配置命名空间（`configuration.ts`）

`validateEnv` 只保证「扁平环境变量」正确；代码内统一使用嵌套键：

| 环境变量 | 配置键 |
| --- | --- |
| `DB_HOST` | `db.host` |
| `JWT_SECRET` | `jwt.secret` |
| `MQ_DRIVER` | `mq.driver` |
| `FEATURE_AI_AGENT` | `feature.aiAgent` |

```ts
import { registerAs } from '@nestjs/config';
import { Env } from './env.schema';

export interface AppConfigShape {
  app: {
    nodeEnv: Env['NODE_ENV'];
    port: number;
    host: string;
    logLevel: Env['LOG_LEVEL'];
  };
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    poolSize: number;
    sync: boolean;
    logging: boolean;
  };
  redis: {
    host: string;
    port: number;
    password: string;
    db: number;
    prefix: string;
  };
  mongo: { uri?: string };
  jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };
  llm: {
    deepseek: { apiKey?: string; model: string };
    openai: {
      apiKey?: string;
      baseURL?: string;
      model: string;
    };
  };
  mq: {
    driver: Env['MQ_DRIVER'];
    rabbitmqUrl?: string;
    kafkaBrokers?: string[];
    kafkaClientId: string;
    kafkaGroupId: string;
  };
  feature: {
    aiAgent: boolean;
    auditLog: boolean;
  };
}

export default registerAs('config', (): AppConfigShape => {
  // validate 已跑过一遍；此处 parse 保证拿到的是强类型（含 coerce）
  const env = envSchema.parse(process.env);
  return {
    app: {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      host: env.HOST,
      logLevel: env.LOG_LEVEL,
    },
    db: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      username: env.DB_USERNAME,
      password: env.DB_PASSWORD,
      database: env.DB_DATABASE,
      poolSize: env.DB_POOL_SIZE,
      sync: env.DB_SYNC,
      logging: env.DB_LOGGING,
    },
    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      prefix: env.REDIS_PREFIX,
    },
    mongo: { uri: env.MONGODB_URI },
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
    llm: {
      deepseek: {
        apiKey: env.DEEPSEEK_API_KEY,
        model: env.DEEPSEEK_MODEL,
      },
      openai: {
        apiKey: env.OPENAI_API_KEY,
        baseURL: env.OPENAI_BASE_URL,
        model: env.OPENAI_MODEL,
      },
    },
    mq: {
      driver: env.MQ_DRIVER,
      rabbitmqUrl: env.RABBITMQ_URL,
      kafkaBrokers: env.KAFKA_BROKERS?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      kafkaClientId: env.KAFKA_CLIENT_ID,
      kafkaGroupId: env.KAFKA_GROUP_ID,
    },
    feature: {
      aiAgent: env.FEATURE_AI_AGENT,
      auditLog: env.FEATURE_AUDIT_LOG,
    },
  };
});
```

说明：

- 用 `registerAs('config', …)` 后，读取键为 `config.db.host` 一层前缀即可；若倾向更短键名，可改为 `registerAs` 多段或直接在 `validate` 中返回嵌套对象（见 §11 备选方案 A）。
- `configuration` 只做映射，不写业务默认值；默认值一律在 schema 上。
- Kafka brokers 在此处拆成 `string[]`，避免下游重复 split。

## 7. 启动装配（`app.module.ts`）

```ts
import {
  configuration,
  resolveEnvFilePaths,
  resolveNodeEnv,
  validateEnv,
} from './config';

// NODE_ENV 来自 shell / CI / K8s，决定读哪套文件
const nodeEnv = resolveNodeEnv(process.env.NODE_ENV);
const envFilePaths = resolveEnvFilePaths(nodeEnv); // ['.env.<env>.local', '.env.<env>']

ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: envFilePaths,
  validate: (raw) => validateEnv(raw, nodeEnv),
  load: [configuration],
}),

TypeOrmModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    type: 'mysql' as const,
    host: config.getOrThrow<string>('config.db.host'),
    port: config.getOrThrow<number>('config.db.port'),
    username: config.getOrThrow<string>('config.db.username'),
    password: config.get<string>('config.db.password'),
    database: config.getOrThrow<string>('config.db.database'),
    autoLoadEntities: true,
    synchronize: config.getOrThrow<boolean>('config.db.sync'),
    logging: config.getOrThrow<boolean>('config.db.logging'),
    poolSize: config.getOrThrow<number>('config.db.poolSize'),
  }),
}),
```

可选依赖按开关决定是否注册，避免本地未起 RabbitMQ/Kafka 就无法启动：

```ts
// AppModule 构造外先取一次 bootstrap 用配置时，也可在 DynamicModule 内判断
imports: [
  ConfigModule.forRoot(/* … */),
  TypeOrmModule.forRootAsync(/* … */),
  ...(process.env.FEATURE_AI_AGENT === 'true' ? [AiAgentModule] : []),
]
```

推荐做法：在 `AppModule` 通过 `ConfigService` 判断后再拼 `imports`（或封装 `AppConfigModule` 提供 bootstrap 配置），不希望业务模块内部再吞「未配置就静默禁用」的错误。

## 8. 三种读取方式

### 8.1 启动参数（`main.ts`）

```ts
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(),
);
const config = app.get(ConfigService);
await app.listen({
  port: config.getOrThrow<number>('config.app.port'),
  host: config.getOrThrow<string>('config.app.host'),
});
```

### 8.2 基础设施装配（`forRootAsync`）

TypeORM、Redis、MQ、LangGraph checkpoint 一律：

```ts
SomeModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    // getOrThrow 拼连接参数；optional 用 get
  },
})
```

规则：`useFactory` 内只读配置、只拼参数，不写业务逻辑。

### 8.3 业务 Service —— 只注入 `AppConfigService`

```ts
// app-config.service.ts
@Injectable()
export class AppConfigService {
  readonly nodeEnv: string;
  readonly port: number;
  readonly jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };
  readonly feature: {
    aiAgent: boolean;
    auditLog: boolean;
  };

  constructor(config: ConfigService) {
    this.nodeEnv = config.getOrThrow('config.app.nodeEnv');
    this.port = config.getOrThrow('config.app.port');
    this.jwt = {
      secret: config.getOrThrow('config.jwt.secret'),
      expiresIn: config.getOrThrow('config.jwt.expiresIn'),
      refreshExpiresIn: config.getOrThrow('config.jwt.refreshExpiresIn'),
    };
    this.feature = {
      aiAgent: config.getOrThrow('config.feature.aiAgent'),
      auditLog: config.getOrThrow('config.feature.auditLog'),
    };
  }
}
```

```ts
// auth.service.ts
@Injectable()
export class AuthService {
  constructor(private readonly appConfig: AppConfigService) {}

  signAccessToken(payload: JwtPayload) {
    return sign(payload, this.appConfig.jwt.secret, {
      expiresIn: this.appConfig.jwt.expiresIn,
    });
  }
}
```

门面按需暴露字段，**默认不暴露** `db.password`、`llm.*.apiKey` 等，避免误日志。

## 9. 配置加载优先级

```text
部署平台 / shell 注入的 process.env（CI、K8s Secret）
        ↓ 最高，可覆盖文件任意键
.env.<env>.local          （个人/机器覆盖，gitignore）
        ↓
.env.<env>                （development | test | staging | production）
        ↓
zod schema 默认值
```

| 场景 | NODE_ENV | 主配置文件 | 个人覆盖 |
| --- | --- | --- | --- |
| 本地开发 | `development` | `.env.development` | `.env.development.local` |
| 测试 / e2e | `test` | `.env.test` | `.env.test.local` |
| 预发 | `staging` | `.env.staging` | `.env.staging.local` |
| 生产 | `production` | `.env.production` | `.env.production.local` |

说明：

- **文件名由 `NODE_ENV` 决定**，不是反过来；`NODE_ENV` 应在启动命令或部署平台设置。
- `@nestjs/config` 对 `envFilePath` 数组中靠前的文件优先，故 `.local` 放在前面。
- 预发/生产文件入库的是键结构与占位值；真实密钥优先用部署平台注入覆盖。生产文件中 `JWT_SECRET=change-me` 是故意不可用的哨兵值，未替换前启动失败。

## 10. 错误与安全约定

1. **启动错误可读**：`validateEnv` 按字段列出问题，缺什么一次看清。
2. **禁止打印全量配置**：日志、`/health`、异常响应不输出完整 config；排查只打 `nodeEnv`、`db.host:port`、`mq.driver` 等非敏感字段。
3. **密钥不进仓库**：`.env.staging` / `.env.production` 只放占位；真实值用 `.local`（不入库）或部署平台注入。
4. **生产强校验**：`DB_SYNC`、`JWT_SECRET` 见 §5 `superRefine`。
5. **测试环境放宽**：`NODE_ENV=test` 允许短 `JWT_SECRET`（如 `test-secret`），便于 e2e；`staging` / `production` 与生产同等严格。

## 11. 备选方案与取舍

### 方案 A：不用 `registerAs`，在 `validate` 中直接返回嵌套对象

`validateEnv` 返回 `AppConfigShape` 而非 `Env`，则读取键可省略 `config.` 前缀（如 `db.host`）。

- 优点：键更短，少一层 namespace。
- 缺点：`validate` 的返回值与 `process.env` 形状不一致，部分 `@nestjs/config` 用法（如 `get()` 回退到 env 原始键）会变得隐晦；与官方 `registerAs` 惯例不完全一致。

**本设计暂定：`registerAs('config')` + 嵌套子键。** 若 CR 认为前缀多余，可切到方案 A，代码结构不变。

### 方案 B：业务直接注入 `ConfigService`

- 优点：少一个类。
- 缺点：键名字符串散落各模块，无补全；无法在单处收敛「不暴露密钥」策略。

**本设计选择门面 `AppConfigService`。** 样板代码换类型安全与可测性。

### 方案 C：只用 URL 连接串（`DATABASE_URL`、`REDIS_URL`）

- 优点：与 PaaS 习惯一致，一条变量搞定。
- 缺点：本地想只改端口/库名时必须拼整串；与 K8s 分字段 Secret 注入风格冲突。

**本设计：对外服务用离散字段；MongoDB 保持 URI（生态习惯）。** 若后续接云厂商，可在 schema 增加可选 `DATABASE_URL` 并优先解析，不在本期范围。

## 12. 落地步骤

1. 新增 `src/config/env.schema.ts`、`configuration.ts`、`app-config.service.ts`、`index.ts`。
2. 新增分环境配置 `.env.development` / `.env.test` / `.env.staging` / `.env.production`，`.gitignore` 忽略 `.env` 与 `.env.*.local`。
3. `AppModule` 接入 `ConfigModule.forRoot`；`main.ts` 改为 `app.listen({ port, host })`。
4. `AppConfigService` 注册为 `@Global` 或由 `ConfigModule` 共享模块导出，供 `AuthModule` 等注入。
5. （随功能推进）TypeORM / Redis / MQ / LangGraph 各自 `forRootAsync` 接入；本期可只搭骨架。
6. 单测：`validateEnv` 覆盖缺字段、布尔解析、production 规则、MQ 交叉校验。

## 13. CR 关注点

- [ ] 变量清单（§3）是否与近期规划一致，有无多变量 / 漏变量
- [ ] 命名前缀 `eas:`、`config.*` 是否可接受
- [ ] `AppConfigService` 门面 vs 直接 `ConfigService`（§11-B）
- [ ] `registerAs('config')` vs validate 返回嵌套（§11-A）
- [ ] 分环境文件命名 `.env.<env>` 与 `staging` 这一预发命名是否符合团队习惯
- [ ] staging / production 校验规则（`DB_SYNC`、`JWT_SECRET`）是否够严
- [ ] 预发/生产密钥：入库占位 + 部署注入覆盖，还是整文件不入库
- [ ] MQ 默认 `rabbitmq` 是否符合 [mq-selection.md](./mq-selection.md) 的落地方向
- [ ] 本期是否需要一并接好 TypeORM/Redis，还是先只落配置骨架
