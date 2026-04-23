import { Global, Module } from '@nestjs/common';
import { SocketStateService } from './socket-state.service';

@Global() // makes SocketStateService injectable everywhere without re-importing
@Module({
  providers: [SocketStateService],
  exports: [SocketStateService],
})
export class SocketModule {}