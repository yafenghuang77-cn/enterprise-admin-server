import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the default user in the response envelope', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { id: 1, username: 'admin', name: '管理员' },
      errorCode: null,
      errorMessage: null,
    });
  });
});
