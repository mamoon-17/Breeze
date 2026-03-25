import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtRefreshPayload } from '../types/auth.types';

export const RefreshPayload = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtRefreshPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtRefreshPayload }>();
    return request.user;
  },
);
