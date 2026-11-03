import { betterAuth } from 'better-auth';
import { admin, organization, twoFactor } from 'better-auth/plugins';
import { z } from 'zod';

/**
 * Better Auth 实例（嵌入现有 admin 服务，不单独部署认证中心）。
 *
 * 启动前需已通过 --env-file / ConfigModule 注入 DB_* 与 JWT_SECRET。
 * 数据库直接连 MySQL（与 TypeORM 同一套库），会话/用户表由 Better Auth 迁移创建。
 */
const env = z
  .object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    JWT_SECRET: z.string().min(1),
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().default(3306),
    DB_USERNAME: z.string().min(1),
    DB_PASSWORD: z.string().default(''),
    DB_DATABASE: z.string().min(1),
  })
  .parse(process.env);

/** Better Auth 回调地址；生产用真实域名（可再抽 BASE_URL 配置） */
const baseURL =
  process.env.AUTH_BASE_URL ??
  `http://${env.HOST === '0.0.0.0' || env.HOST === '::' ? 'localhost' : env.HOST}:${env.PORT}`;

const password = encodeURIComponent(env.DB_PASSWORD);
const databaseUrl = `mysql://${encodeURIComponent(env.DB_USERNAME)}:${password}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_DATABASE}`;

export const auth = betterAuth({
  appName: 'enterprise-admin-server',
  baseURL,
  // 复用 JWT_SECRET 作为 Better Auth 密钥（与业务 JWT 可后续拆分）
  secret: env.JWT_SECRET,
  database: {
    provider: 'mysql',
    url: databaseUrl,
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  /**
   * 能力以插件扩展（类似 Sa-Token 的能力模块）：
   * - admin：用户列表、封禁、角色 role / 权限 permission
   * - organization：多租户/部门组织（不用可去掉）
   * - twoFactor：2FA（登录校验插件）
   */
  plugins: [
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
      impersonationSessionDuration: 60 * 60,
    }),
    organization(),
    twoFactor(),
  ],
  session: {
    // access/refresh 业务侧若自签 JWT，可只把 Better Auth 当登录态/账号中心
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});

export type AuthInstance = typeof auth;
