import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Account,
  AccountStatus,
} from '../../accounts/entities/account.entity';
import {
  JWT_ACCESS_TOKEN_USE,
  isLegacyUntypedAccessAccepted,
  requireJwtSecret,
  type TimesoJwtPayload,
} from '../jwt.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly configService: ConfigService;

  constructor(
    configService: ConfigService,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(configService),
    });
    this.configService = configService;
  }

  async validate(payload: Partial<TimesoJwtPayload>) {
    // Tokens issued before the tokenUse claim require a one-time re-login.
    // Failing closed is required because a missing discriminator cannot prove
    // that the credential is an access token.
    const acceptedUse =
      payload.tokenUse === JWT_ACCESS_TOKEN_USE ||
      (payload.tokenUse === undefined &&
        isLegacyUntypedAccessAccepted(this.configService));
    if (!payload.sub || !acceptedUse) {
      throw new UnauthorizedException('AUTH_TOKEN_REVOKED');
    }
    const account = await this.accountRepository.findOne({
      where: { id: payload.sub, status: AccountStatus.ACTIVE },
      select: { id: true },
    });
    if (!account) throw new UnauthorizedException('AUTH_TOKEN_REVOKED');
    return { userId: account.id, email: payload.email };
  }
}
