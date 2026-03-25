import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshSession } from '../refresh-session.entity';

@Injectable()
export class StepUpRequiredGuard implements CanActivate {
  constructor(
    @InjectRepository(RefreshSession)
    private readonly refreshSessionRepository: Repository<RefreshSession>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    const userId = request.user?.id;
    const sessionId = request.refreshPayload?.sid;

    if (!userId || !sessionId) {
      return true;
    }

    try {
      const session = await this.refreshSessionRepository.findOne({
        where: { id: sessionId, userId },
        select: ['requiresStepUp'],
      });

      if (session?.requiresStepUp) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'STEP_UP_REQUIRED',
          message: 'Step-up authentication required for this action',
          stepUpUrl: '/auth/step-up',
        });
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      return true;
    }
  }
}
