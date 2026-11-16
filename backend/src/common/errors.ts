import { HttpException, HttpStatus } from '@nestjs/common';

/** Throws an HttpException whose body follows the API's single error format. */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, message: string, public readonly code?: string) {
    super({ message, code }, status);
  }
}
export const badRequest = (message: string, code = 'VALIDATION_ERROR') => new ApiError(HttpStatus.BAD_REQUEST, message, code);
export const unauthorized = (message = 'Sign in required.', code = 'UNAUTHORIZED') => new ApiError(HttpStatus.UNAUTHORIZED, message, code);
export const forbidden = (message = 'Permission denied.', code = 'FORBIDDEN') => new ApiError(HttpStatus.FORBIDDEN, message, code);
export const notFound = (message = 'Not found.', code = 'NOT_FOUND') => new ApiError(HttpStatus.NOT_FOUND, message, code);
export const conflict = (message: string, code = 'CONFLICT') => new ApiError(HttpStatus.CONFLICT, message, code);
export const unprocessable = (message: string, code = 'BUSINESS_RULE') => new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, message, code);
