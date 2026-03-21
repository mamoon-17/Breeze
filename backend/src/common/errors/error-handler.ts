import { HttpException } from '@nestjs/common';
import { AppError } from './app-error';

/**
 * Convert AppError to NestJS HttpException for response handling
 */
export const toHttpException = (error: AppError): HttpException => {
  return new HttpException(
    {
      code: error.code,
      message: error.message,
      details: error.details,
      timestamp: new Date().toISOString(),
    },
    error.statusCode,
  );
};

/**
 * Wrap database operations with error handling
 */
export const wrapDatabaseOperation = async <T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new Error(`${operationName} failed: ${err.message}`);
  }
};
