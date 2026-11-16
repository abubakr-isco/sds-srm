import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

const STATUS_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 422: 'BUSINESS_RULE', 423: 'LOCKED', 429: 'TOO_MANY_REQUESTS',
};

/**
 * Every error leaves the API as
 *   { "statusCode": 400, "error": "VALIDATION_ERROR", "message": "…", "path": "/api/…", "timestamp": "…" }
 * Unexpected errors are logged without request bodies (which may contain passwords or tokens).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error.';
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as string | { message?: string | string[]; code?: string };
      if (typeof body === 'string') message = body;
      else {
        message = Array.isArray(body.message) ? body.message.join('; ') : body.message || exception.message;
        code = body.code;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') { status = 409; message = uniqueMessage(exception); }
      else if (exception.code === 'P2003') { status = 409; message = 'This record is still referenced by other records.'; }
      else if (exception.code === 'P2025') { status = 404; message = 'Record not found.'; }
      else this.logger.error(`Prisma error ${exception.code} on ${req.method} ${req.path}`);
    } else if (exception instanceof Prisma.PrismaClientUnknownRequestError && /violates check constraint/.test(exception.message)) {
      status = 422; message = 'The data violates a database rule.';
    } else if ((exception as { type?: string })?.type === 'entity.too.large') {
      status = 413; message = 'Request body is too large.';
    } else if ((exception as { type?: string })?.type === 'entity.parse.failed') {
      status = 400; message = 'Malformed JSON body.';
    } else {
      this.logger.error(`Unhandled error on ${req.method} ${req.path}: ${(exception as Error)?.stack || exception}`);
    }
    if (status >= 500 && exception instanceof HttpException) this.logger.error(`${req.method} ${req.path} -> ${status}`);

    res.status(status).json({
      statusCode: status,
      error: code || STATUS_CODES[status] || (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
      message,
      path: req.originalUrl?.split('?')[0],
      timestamp: new Date().toISOString(),
    });
  }
}

function uniqueMessage(e: Prisma.PrismaClientKnownRequestError): string {
  const target = String((e.meta as { target?: string[] | string })?.target ?? '');
  if (target.includes('load_number')) return 'This load number already exists (duplicate).';
  if (target.includes('email')) return 'This email is already in use.';
  if (target.includes('city')) return 'This city already exists.';
  return 'A record with these values already exists (duplicate).';
}
