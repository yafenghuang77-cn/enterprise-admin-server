import { z } from 'zod';

import type { NodeEnv } from './env-file';

/**
 * 环境变量 Schema（启动期强校验）。
 *
 * 设计约定：
 * 1. 这里是环境变量契约的唯一真相来源；新增变量必须同时改 .env.<env> 四套文件与 configuration.ts。
 * 2. 数字用 z.coerce.number()，把文件里的 "3000" 转成真数字，避免传给 TypeORM 时类型错误。
 * 3. 布尔禁止直接 truthy 判断（"false" 也是真值），统一走下方 bool。
 * 4. 单字段约束写在 schema 上；跨字段 / 环境相关约束写在 superRefine。
 * 5. 校验失败在进程启动前抛错，并按字段列出原因，不要在业务运行期才暴露。
 */

/** 环境变量里布尔的统一解析：接受 boolean 或字符串 "true"/"false"。 */
const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true');

export const envSchema = z
  .object({
    // ── 应用 ──────────────────────────────────────────
    /** 决定读取哪套配置文件，须与文件名一致（见 env-file.ts / validateEnv） */
    NODE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

    // ── MySQL（TypeORM）──────────────────────────────
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().default(3306),
    DB_USERNAME: z.string().min(1),
    DB_PASSWORD: z.string().default(''),
    DB_DATABASE: z.string().min(1),
    DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
    /** TypeORM synchronize；staging/production 强制禁止，见 superRefine */
    DB_SYNC: bool.default(false),
    DB_LOGGING: bool.default(false),

    // ── Redis ────────────────────────────────────────
    REDIS_HOST: z.string().min(1),
    REDIS_PORT: z.coerce.number().int().default(6379),
    REDIS_PASSWORD: z.string().default(''),
    REDIS_DB: z.coerce.number().int().min(0).default(0),
    /** 多服务共用 Redis 时避免 cache key 撞车 */
    REDIS_PREFIX: z.string().default('eas:'),

    // ── MongoDB（LangGraph checkpoint，可选）──────────
    MONGODB_URI: z.string().startsWith('mongodb').optional(),

    // ── 认证 ─────────────────────────────────────────
    JWT_SECRET: z.string().min(1),
    JWT_EXPIRES_IN: z.string().default('2h'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    // ── LLM（可选；开启 AI 时至少配一个 Key）──────────
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),

    // ── MQ ───────────────────────────────────────────
    /** none=不启用；rabbitmq / kafka 时对应连接字段必填 */
    MQ_DRIVER: z.enum(['none', 'rabbitmq', 'kafka']).default('rabbitmq'),
    RABBITMQ_URL: z.string().optional(),
    /** 逗号分隔，如 "127.0.0.1:9092,127.0.0.1:9093" */
    KAFKA_BROKERS: z.string().optional(),
    KAFKA_CLIENT_ID: z.string().default('enterprise-admin'),
    KAFKA_GROUP_ID: z.string().default('eas-admin'),

    // ── 功能开关 ─────────────────────────────────────
    /** 关闭时不注册 AI 相关 Module，避免本地强依赖 LLM Key */
    FEATURE_AI_AGENT: bool.default(false),
    FEATURE_AUDIT_LOG: bool.default(true),
  })
  .superRefine((v, ctx) => {
    // 跨字段约束：依赖组合才成立的必填项
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

    // 预发 / 生产与本地隔离：禁止误开同步、禁止弱密钥
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

/**
 * ConfigModule.validate 入口。
 *
 * @param raw 合并后的环境变量（文件 + process.env）
 * @param selectedNodeEnv 启动时按 NODE_ENV 选出的环境；用于校验「文件内容与文件名一致」
 * @returns 校验并 coerce 后的 Env；失败抛出可读错误，阻断启动
 */
export function validateEnv(
  raw: Record<string, unknown>,
  selectedNodeEnv?: NodeEnv,
): Env {
  // 防止 .env.staging 里误写 NODE_ENV=production 这类贴错配置
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

  // 以启动时选定的 NODE_ENV 为准（文件名即环境真值）
  const input =
    selectedNodeEnv === undefined ? raw : { ...raw, NODE_ENV: selectedNodeEnv };
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    // 汇总所有字段问题，避免修一个再爆一个
    const detail = parsed.error.issues
      .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`环境变量校验失败:\n${detail}`);
  }
  return parsed.data;
}
