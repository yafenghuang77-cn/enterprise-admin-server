import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';

import { SKIP_RESPONSE_ENVELOPE } from './skip-response-envelope.decorator';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (
      context.getType() !== 'http' ||
      this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_ENVELOPE, [
        context.getHandler(),
        context.getClass(),
      ]) ||
      this.reflector.get<boolean>(SSE_METADATA, context.getHandler())
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data: unknown) => {
        const response = context
          .switchToHttp()
          .getResponse<{ statusCode: number }>();
        if (
          data instanceof StreamableFile ||
          response.statusCode === 204 ||
          response.statusCode === 304
        ) {
          return data;
        }
        return {
          success: true,
          data: data ?? null,
          errorCode: null,
          errorMessage: null,
        };
      }),
    );
  }
}
