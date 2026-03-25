import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface ClientInfo {
  ipAddress?: string;
  userAgent?: string;
  country?: string;
  isVpnOrProxy?: boolean;
}

export const ClientInfo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientInfo => {
    const request = ctx.switchToHttp().getRequest<Request>();

    const ipAddress =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (request.headers['x-real-ip'] as string) ||
      request.ip ||
      request.socket?.remoteAddress;

    const userAgent = request.headers['user-agent'];

    const country =
      (request.headers['cf-ipcountry'] as string) ||
      (request.headers['x-vercel-ip-country'] as string) ||
      (request.headers['x-country-code'] as string) ||
      undefined;

    const isVpnOrProxy = detectVpnOrProxy(request);

    return {
      ipAddress,
      userAgent,
      country,
      isVpnOrProxy,
    };
  },
);

function detectVpnOrProxy(request: Request): boolean {
  const xForwardedFor = request.headers['x-forwarded-for'] as string;
  if (xForwardedFor && xForwardedFor.split(',').length > 2) {
    return true;
  }

  const proxyHeaders = [
    'via',
    'x-forwarded-host',
    'x-originating-ip',
    'x-remote-ip',
    'x-remote-addr',
    'forwarded',
  ];

  for (const header of proxyHeaders) {
    if (request.headers[header]) {
      return true;
    }
  }

  return false;
}
