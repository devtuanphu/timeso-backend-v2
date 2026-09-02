import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { isAppReadOnlyMode } from '../../common/utils/app-read-only-mode';
import { chatNotReady } from './chat-errors';
import { ChatSingleInstanceRuntimeGuardService } from './chat-single-instance-runtime-guard.service';

@Injectable()
export class ChatRuntimeHttpGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly singletonGuard: ChatSingleInstanceRuntimeGuardService,
  ) {}

  canActivate(_context: ExecutionContext): boolean {
    if (
      isAppReadOnlyMode(this.configService) ||
      !this.singletonGuard.isHeld()
    ) {
      throw chatNotReady();
    }
    return true;
  }
}

