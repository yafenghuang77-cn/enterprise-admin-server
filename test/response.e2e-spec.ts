import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  StreamableFile,
} from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { SkipResponseEnvelope } from '../src/common/response/skip-response-envelope.decorator';

@Controller('response-test')
class ResponseTestController {
  @Get('object')
  object() {
    return { id: 1, name: '张三' };
  }

  @Get('empty')
  empty() {}

  @Get('bad-request')
  badRequest() {
    throw new BadRequestException('邮箱格式不正确', {
      errorCode: 'INVALID_PARAMETER',
    });
  }

  @Get('validation')
  validation() {
    throw new BadRequestException(['email is invalid', 'name is required']);
  }

  @Get('unexpected')
  unexpected() {
    throw new Error('private database details');
  }

  @Get('raw')
  @SkipResponseEnvelope()
  raw() {
    return { status: 'ok' };
  }

  @Get('file')
  file() {
    return new StreamableFile(Buffer.from('file contents'));
  }

  @Get('no-content')
  @HttpCode(204)
  noContent() {}
}

describe('Response envelope (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ResponseTestController],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps objects and empty results', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/response-test/object',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { id: 1, name: '张三' },
      errorCode: null,
      errorMessage: null,
    });
    const empty = await app.inject({
      method: 'GET',
      url: '/response-test/empty',
    });
    expect(empty.json()).toEqual({
      success: true,
      data: null,
      errorCode: null,
      errorMessage: null,
    });
  });

  it('preserves the HTTP status and explicit business error code', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/response-test/bad-request',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      data: null,
      errorCode: 'INVALID_PARAMETER',
      errorMessage: '邮箱格式不正确',
    });
  });

  it('formats validation and not-found errors', async () => {
    const validation = await app.inject({
      method: 'GET',
      url: '/response-test/validation',
    });
    expect(validation.statusCode).toBe(400);
    expect(validation.json()).toEqual({
      success: false,
      data: null,
      errorCode: '9000',
      errorMessage: 'email is invalid, name is required',
    });
    const missing = await app.inject({ method: 'GET', url: '/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      success: false,
      data: null,
      errorCode: '9000',
    });
  });

  it('does not expose unexpected errors', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/response-test/unexpected',
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      data: null,
      errorCode: '9000',
      errorMessage: 'Internal server error',
    });
  });

  it('leaves opted-out, file and no-content responses intact', async () => {
    const raw = await app.inject({ method: 'GET', url: '/response-test/raw' });
    expect(raw.json()).toEqual({ status: 'ok' });
    const file = await app.inject({
      method: 'GET',
      url: '/response-test/file',
    });
    expect(file.payload).toBe('file contents');
    const empty = await app.inject({
      method: 'GET',
      url: '/response-test/no-content',
    });
    expect(empty.statusCode).toBe(204);
    expect(empty.payload).toBe('');
  });
});
