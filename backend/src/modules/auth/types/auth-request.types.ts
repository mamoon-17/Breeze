import type { Request } from 'express';
import { JwtAccessPayload, JwtRefreshPayload } from './auth.types';

export interface RequestWithJwtAccessPayload extends Request {
  user: JwtAccessPayload;
}

export interface RequestWithJwtRefreshPayload extends Request {
  user: JwtRefreshPayload;
}
