import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const AccessToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    
    const requestRecord = request as unknown as {
      cookies?: Record<string, unknown>;
      headers?: Record<string, unknown>;
    };

    // Try to extract from Authorization header first
    const authHeader = request.headers?.authorization;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Fallback to cookie
    const cookieToken = requestRecord.cookies?.accessToken;
    return typeof cookieToken === 'string' ? cookieToken : undefined;
  },
);
