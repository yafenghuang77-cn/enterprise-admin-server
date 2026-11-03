import { Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { formatEnvBanner, resolveNodeEnv } from './config';

async function bootstrap() {
  // 启动时先在控制台标出当前环境，避免跑错配置文件
  const nodeEnv = resolveNodeEnv(process.env.NODE_ENV);
  new NestLogger('Bootstrap').log(formatEnvBanner(nodeEnv));

  // bufferLogs：创建期日志先缓冲，待 useLogger 后由 pino 统一输出
  // bodyParser:false：Better Auth 需要自行解析原始请求体
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true, bodyParser: false },
  );

  app.setGlobalPrefix('enterprise', { exclude: ['health'] });

  // nestjs-pino 接管 Nest 内置日志（含框架与业务 Logger）
  const pinoLogger = app.get(Logger);
  app.useLogger(pinoLogger);

  // 监听地址/端口走已校验配置，不再读裸 process.env.PORT
  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('config.app.port');
  const host = config.getOrThrow<string>('config.app.host');
  await app.listen({ port, host });

  // 打出可直接点击/复制的访问地址
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  pinoLogger.log(`服务已启动: http://${displayHost}:${port}/enterprise`);
}
void bootstrap();
