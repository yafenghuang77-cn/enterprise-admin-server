import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule, type Params } from 'nestjs-pino';

import { AllExceptionsFilter } from './common/response/all-exceptions.filter';
import { ResponseInterceptor } from './common/response/response.interceptor';
import {
  configuration,
  resolveEnvFilePaths,
  resolveNodeEnv,
  validateEnv,
} from './config';
import { RedisModule } from './config/redis.module';
import { buildTypeOrmOptions } from './config/typeorm.config';
import { AuthModule } from './modules/auth/auth.module';

// 启动时确定环境：NODE_ENV 未设则默认 development；非法值直接抛错
const nodeEnv = resolveNodeEnv(process.env.NODE_ENV);
// 例如 NODE_ENV=staging → ['.env.staging.local', '.env.staging']
const envFilePaths = resolveEnvFilePaths(nodeEnv);

/** pino-http 请求序列化：只保留排障需要的字段，避免刷屏 */
function serializeReq(req: IncomingMessage & { id?: unknown }) {
  return {
    method: req.method,
    url: req.url,
    id: req.id,
  };
}

/** pino-http 响应序列化 */
function serializeRes(res: ServerResponse) {
  return {
    statusCode: res.statusCode,
  };
}

function buildPinoParams(config: ConfigService): Params {
  const env = config.getOrThrow<
    'development' | 'test' | 'staging' | 'production'
  >('config.app.nodeEnv');
  const level = config.getOrThrow<string>('config.app.logLevel');
  // 开发/测试用 pino-pretty 彩色可读；预发/生产输出纯 JSON，便于采集
  const usePretty = env === 'development' || env === 'test';

  return {
    pinoHttp: {
      level,
      transport: usePretty
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
      // 敏感字段脱敏，禁止落入日志
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'res.headers["set-cookie"]',
        ],
        censor: '***',
      },
      autoLogging: {
        // 健康检查/根路径不刷访问日志
        ignore: (req: IncomingMessage) =>
          req.url === '/health' || req.url === '/',
      },
      serializers: {
        req: serializeReq,
        res: serializeRes,
      },
    },
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      // 全局可用，各模块注入 ConfigService 无需再 import ConfigModule
      isGlobal: true,
      envFilePath: envFilePaths,
      // 启动期校验；selectedNodeEnv 用于检查文件内 NODE_ENV 与文件名一致
      validate: (raw) => validateEnv(raw, nodeEnv),
      // 扁平 env → config.* 嵌套命名空间，见 configuration.ts
      load: [configuration],
    }),
    // nestjs-pino：只在根模块注册一次；LoggerModule 自身 @Global，子模块直接注入
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildPinoParams,
    }),
    // MySQL 直连（TypeORM）；实体通过 TypeOrmModule.forFeature 注册
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    // Redis 直连；全局提供 REDIS_CLIENT
    RedisModule,
    AuthModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
