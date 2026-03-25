/**
 * Centralized error types for the application
 * Using neverthrow Result<T, E> pattern instead of throwing exceptions
 */

export enum ErrorCode {
  // Config errors
  MISSING_ENV_VAR = 'MISSING_ENV_VAR',
  INVALID_CONFIG = 'INVALID_CONFIG',

  // Auth errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_TOKEN = 'INVALID_TOKEN',
  INVALID_REFRESH_TOKEN = 'INVALID_REFRESH_TOKEN',
  MISSING_EMAIL = 'MISSING_EMAIL',
  INVALID_TOKEN_TYPE = 'INVALID_TOKEN_TYPE',

  // Anomaly detection errors
  HIGH_RISK_SESSION = 'HIGH_RISK_SESSION',
  STEP_UP_REQUIRED = 'STEP_UP_REQUIRED',
  SESSION_FAMILY_REVOKED = 'SESSION_FAMILY_REVOKED',

  // User errors
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_CREATION_FAILED = 'USER_CREATION_FAILED',
  USER_UPDATE_FAILED = 'USER_UPDATE_FAILED',

  // Database errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  QUERY_FAILED = 'QUERY_FAILED',

  // Validation errors
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  INVALID_INPUT = 'INVALID_INPUT',

  // Generic errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface AppError {
  code: ErrorCode;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
  originalError?: Error;
}

/**
 * Create an AppError with all required properties
 */
export const createError = (
  code: ErrorCode,
  message: string,
  statusCode: number,
  details?: Record<string, unknown>,
  originalError?: Error,
): AppError => ({
  code,
  message,
  statusCode,
  details,
  originalError,
});

/**
 * Predefined error factories
 */
export const Errors = {
  missingEnvVar: (varName: string): AppError =>
    createError(
      ErrorCode.MISSING_ENV_VAR,
      `Environment variable ${varName} is required but not set`,
      500,
      { varName },
    ),

  unauthorized: (message = 'Unauthorized'): AppError =>
    createError(ErrorCode.UNAUTHORIZED, message, 401),

  forbidden: (message = 'Forbidden'): AppError =>
    createError(ErrorCode.FORBIDDEN, message, 403),

  invalidToken: (): AppError =>
    createError(ErrorCode.INVALID_TOKEN, 'Invalid or expired token', 401),

  invalidRefreshToken: (): AppError =>
    createError(
      ErrorCode.INVALID_REFRESH_TOKEN,
      'Invalid or expired refresh token',
      401,
    ),

  missingEmail: (): AppError =>
    createError(
      ErrorCode.MISSING_EMAIL,
      'Google account does not have an email address',
      400,
      { provider: 'google' },
    ),

  invalidTokenType: (expected: string, received: string): AppError =>
    createError(
      ErrorCode.INVALID_TOKEN_TYPE,
      `Invalid token type: expected ${expected}, received ${received}`,
      401,
      { expected, received },
    ),

  highRiskSession: (riskScore: number, signals: string[]): AppError =>
    createError(
      ErrorCode.HIGH_RISK_SESSION,
      'Session terminated due to high-risk activity',
      401,
      { riskScore, signals, requiresReauth: true },
    ),

  stepUpRequired: (riskScore: number): AppError =>
    createError(
      ErrorCode.STEP_UP_REQUIRED,
      'Step-up authentication required for this action',
      403,
      { riskScore, stepUpUrl: '/auth/step-up' },
    ),

  sessionFamilyRevoked: (familyId: string): AppError =>
    createError(
      ErrorCode.SESSION_FAMILY_REVOKED,
      'Session family has been revoked',
      401,
      { familyId },
    ),

  userNotFound: (): AppError =>
    createError(ErrorCode.USER_NOT_FOUND, 'User not found', 404),

  userCreationFailed: (reason?: string): AppError =>
    createError(
      ErrorCode.USER_CREATION_FAILED,
      `Failed to create user${reason ? `: ${reason}` : ''}`,
      500,
      { reason },
    ),

  userUpdateFailed: (reason?: string): AppError =>
    createError(
      ErrorCode.USER_UPDATE_FAILED,
      `Failed to update user${reason ? `: ${reason}` : ''}`,
      500,
      { reason },
    ),

  databaseError: (reason?: string, originalError?: Error): AppError =>
    createError(
      ErrorCode.DATABASE_ERROR,
      `Database operation failed${reason ? `: ${reason}` : ''}`,
      500,
      { reason },
      originalError,
    ),

  validationFailed: (reason?: string): AppError =>
    createError(
      ErrorCode.VALIDATION_FAILED,
      `Validation failed${reason ? `: ${reason}` : ''}`,
      400,
      { reason },
    ),

  internalError: (originalError?: Error): AppError =>
    createError(
      ErrorCode.INTERNAL_ERROR,
      'An unexpected error occurred',
      500,
      undefined,
      originalError,
    ),
};
