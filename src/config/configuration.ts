import { registerAs } from '@nestjs/config';

import { type Env, envSchema } from './env.schema';

/**
 * 代码内嵌套配置结构（ConfigService 读取用）。
 *
 * 环境变量是「扁平大写」契约（DB_HOST），代码内统一用命名空间键（config.db.host），
 * 业务不要直接读 process.env 或散落的 DB_HOST 字符串。
 */
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

/**
 * 注册为 ConfigService 下的 `config` 命名空间。
 * 读取示例：config.getOrThrow<number>('config.app.port')
 *
 * 职责只做「已校验 env → 嵌套对象」映射：
 * - 默认值、类型、必填一律在 env.schema.ts，这里不写业务默认值
 * - 再次 envSchema.parse 是为了拿到 coerce 后的 number/boolean，
 *   而不是 process.env 里的字符串
 */
export default registerAs('config', (): AppConfigShape => {
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
      // 文件里是逗号分隔字符串，这里一次拆好，下游直接用数组
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
