import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }

    const adapter = this.adapterHost.httpAdapter;
    const response = host.switchToHttp().getResponse<unknown>();
    if (adapter.isHeadersSent(response)) {
      adapter.end(response);
      return;
    }

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
    } else if (this.isHttpError(exception)) {
      status = exception.statusCode;
    }
    const body =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const details =
      typeof body === 'object' && body !== null
        ? (body as { message?: unknown; errorCode?: unknown })
        : undefined;
    const message = typeof body === 'string' ? body : details?.message;
    const errorCode =
      exception instanceof HttpException
        ? (exception.errorCode ?? details?.errorCode)
        : undefined;

    if (status >= 500) {
      this.logger.error(exception);
    }

    let errorMessage = 'Request failed';
    if (status >= 500) {
      errorMessage = 'Internal server error';
    } else if (Array.isArray(message)) {
      errorMessage = message
        .filter((item): item is string => typeof item === 'string')
        .join(', ');
    } else if (typeof message === 'string') {
      errorMessage = message;
    } else if (this.isHttpError(exception)) {
      errorMessage = exception.message;
    }

    adapter.reply(
      response,
      {
        success: false,
        data: null,
        errorCode: typeof errorCode === 'string' ? errorCode : '9000',
        errorMessage,
      },
      status,
    );
  }
}
