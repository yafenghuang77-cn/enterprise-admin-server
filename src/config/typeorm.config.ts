import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { sysEntities } from '../entities';

/**
 * MySQL 直连配置（无代理/隧道）。
 * 从 config.db.* 读取；字段与 .env 契约一致，见 env.schema.ts。
 */
export function buildTypeOrmOptions(
  config: ConfigService,
): TypeOrmModuleOptions {
  return {
    type: 'mysql',
    host: config.getOrThrow<string>('config.db.host'),
    port: config.getOrThrow<number>('config.db.port'),
    username: config.getOrThrow<string>('config.db.username'),
    password: config.get<string>('config.db.password') ?? '',
    database: config.getOrThrow<string>('config.db.database'),
    entities: [...sysEntities] as TypeOrmModuleOptions['entities'],
    autoLoadEntities: true,
    synchronize: config.getOrThrow<boolean>('config.db.sync'),
    logging: config.getOrThrow<boolean>('config.db.logging'),
    poolSize: config.getOrThrow<number>('config.db.poolSize'),
    // 字符集按常见企业库约定；如需 utf8mb4 可在 env 扩展
    charset: 'utf8mb4',
  };
}
