import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AppConfigService } from '../../../config/app-config.service';

@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  constructor(private readonly appConfigService: AppConfigService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;

    if (!origin) {
      throw new ForbiddenException('Missing Origin header');
    }

    const allowedOrigins = this.appConfigService.allowedOrigins;

    if (!allowedOrigins.includes(origin)) {
      throw new ForbiddenException('Invalid Origin');
    }

    next();
  }
}
