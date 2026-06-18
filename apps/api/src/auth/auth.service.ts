import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { UserRole, UserStatus } from '@nexus-hub/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  airtmAccountId: true,
  stellarPublicKey: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          role: dto.role ?? UserRole.CLIENT,
          stellarPublicKey: dto.stellarPublicKey,
        },
        select: USER_SELECT,
      });

      await tx.balance.create({
        data: { userId: created.id },
      });

      await tx.auditLog.create({
        data: {
          userId: created.id,
          action: 'REGISTER',
          entity: 'User',
          entityId: created.id,
          newValues: { email: created.email, role: created.role },
        },
      });

      return created;
    });

    return this.generateTokens(user.id, user.email, user.role);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account suspended');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        entity: 'User',
        entityId: user.id,
      },
    });

    return this.generateTokens(user.id, user.email, user.role);
  }

  async refresh(token: string): Promise<AuthTokens> {
    const record = await this.prisma.refreshToken.findUnique({ where: { token } });
    if (!record || record.isRevoked || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { isRevoked: true },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');

    return this.generateTokens(user.id, user.email, user.role);
  }

  async logout(userId: string, token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, token },
      data: { isRevoked: true },
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
  ): Promise<AuthTokens> {
    const expiresIn = 15 * 60; // 15 minutes in seconds
    const accessToken = this.jwt.sign(
      { sub: userId, email, role },
      { expiresIn },
    );

    const refreshToken = randomUUID();
    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const expiresAt = new Date(Date.now() + this.parseDuration(refreshExpiresIn));

    await this.prisma.refreshToken.create({
      data: { token: refreshToken, userId, expiresAt },
    });

    return { accessToken, refreshToken, expiresIn };
  }

  private parseDuration(duration: string): number {
    const unit = duration.slice(-1);
    const value = parseInt(duration.slice(0, -1), 10);
    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return value * (multipliers[unit] ?? 86_400_000);
  }
}
