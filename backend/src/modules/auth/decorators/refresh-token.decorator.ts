import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const RefreshToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    
    const requestRecord = request as unknown as {
      cookies?: Record<string, unknown>;
      body?: Record<string, unknown>;
    };

    const cookieToken = requestRecord.cookies?.refreshToken;
    if (typeof cookieToken === 'string') {
      return cookieToken;
    }

    const bodyToken = requestRecord.body?.refreshToken;
    return typeof bodyToken === 'string' ? bodyToken : undefined;
  },
);
