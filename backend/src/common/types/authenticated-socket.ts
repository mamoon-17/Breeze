import type { Socket } from 'socket.io';
import type { User } from '../../modules/user/user.entity';

export type AuthenticatedSocket = Socket & {
  data: {
    user: User;
    accessTokenJti?: string;
    accessTokenExp?: number;
    refreshSessionId?: string;
    refreshTokenExp?: number;
  };
};
