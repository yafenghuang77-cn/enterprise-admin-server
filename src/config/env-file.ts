/**
 * 按 NODE_ENV 选择配置文件。
 *
 * 文件映射：
 *   development → .env.development(.local)
 *   test        → .env.test(.local)
 *   staging     → .env.staging(.local)
 *   production  → .env.production(.local)
 *
 * 加载优先级（高 → 低）：
 *   shell / CI / K8s 注入的 process.env
 *     > .env.<env>.local（个人覆盖，不入库）
 *     > .env.<env>
 *     > schema 默认值
 *
 * 约定：NODE_ENV 由启动命令或部署平台设置（决定读哪套文件），
 * 文件内 NODE_ENV 必须与文件名一致（validateEnv 校验，防止贴错配置）。
 */

/** 四套运行环境；新增环境时改这里 + 增加对应 .env.<env> 文件 + 更新 schema 枚举 */
export type NodeEnv = 'development' | 'test' | 'staging' | 'production';

export const NODE_ENVS: NodeEnv[] = [
  'development',
  'test',
  'staging',
  'production',
];

export function isNodeEnv(value: string): value is NodeEnv {
  return (NODE_ENVS as string[]).includes(value);
}

/**
 * 解析并校验 NODE_ENV。
 * 未设置时默认 development（本地直接 pnpm start:dev）；
 * 非法值直接抛错，避免落到错误配置上。
 */
export function resolveNodeEnv(raw: string | undefined): NodeEnv {
  const value = raw ?? 'development';
  if (!isNodeEnv(value)) {
    throw new Error(
      `NODE_ENV 非法: "${value}"，可选值: ${NODE_ENVS.join(' / ')}`,
    );
  }
  return value;
}

/**
 * 生成 ConfigModule.envFilePath 列表。
 * local 放在前面：@nestjs/config 对数组中靠前的文件优先，
 * 同名变量以 .local 为准（已对照源码验证）。
 */
export function resolveEnvFilePaths(nodeEnv: NodeEnv): string[] {
  const base = `.env.${nodeEnv}`;
  return [`${base}.local`, base];
}

/**
 * 控制台环境横幅：启动时一眼看到当前环境与配置文件。
 */
export function formatEnvBanner(nodeEnv: NodeEnv): string {
  return `当前环境: ${nodeEnv} | 配置文件: .env.${nodeEnv}(.local 可选)`;
}
