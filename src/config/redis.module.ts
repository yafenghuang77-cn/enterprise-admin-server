import {
  Global,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Redis 直连客户端（无代理）。
 * 全局导出 Redis 实例；业务模块注入 REDIS_CLIENT 使用。
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.getOrThrow<string>('config.redis.host'),
          port: config.getOrThrow<number>('config.redis.port'),
          password: config.get<string>('config.redis.password') || undefined,
          db: config.getOrThrow<number>('config.redis.db'),
          // 多服务共用 Redis 时作为 key 前缀
          keyPrefix: config.getOrThrow<string>('config.redis.prefix'),
          lazyConnect: true,
          maxRetriesPerRequest: 3,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    await this.redis.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
