import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Decimal } from '@prisma/client/runtime/library';
import {
  EscrowStatus,
  JobName,
  QueueName,
  TransactionStatus,
  TransactionType,
  UserRole,
} from '@nexus-hub/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';

@Injectable()
export class EscrowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(QueueName.ESCROW) private readonly escrowQueue: Queue,
  ) {}

  async create(clientId: string, dto: CreateEscrowDto, idempotencyKey: string) {
    const existing = await this.prisma.transaction.findUnique({ where: { idempotencyKey } });
    if (existing?.escrowId) {
      return this.prisma.escrow.findUnique({ where: { id: existing.escrowId } });
    }

    const freelancer = await this.prisma.user.findUnique({ where: { id: dto.freelancerId } });
    if (!freelancer) throw new NotFoundException('Freelancer not found');
    if (freelancer.id === clientId) throw new BadRequestException('Cannot create escrow with yourself');

    const feeBps = this.config.get<number>('PLATFORM_FEE_BPS', 100);
    const fee = new Decimal(dto.amount).mul(feeBps).div(10_000);

    const escrow = await this.prisma.$transaction(async (tx) => {
      const created = await tx.escrow.create({
        data: {
          clientId,
          freelancerId: dto.freelancerId,
          amount: dto.amount,
          fee,
          description: dto.description,
          milestoneId: dto.milestoneId,
        },
      });

      await tx.transaction.create({
        data: {
          idempotencyKey,
          userId: clientId,
          type: TransactionType.ESCROW_LOCK,
          status: TransactionStatus.PENDING,
          amount: dto.amount,
          fee,
          escrowId: created.id,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: clientId,
          action: 'CREATE_ESCROW',
          entity: 'Escrow',
          entityId: created.id,
          newValues: { freelancerId: dto.freelancerId, amount: dto.amount },
        },
      });

      return created;
    });

    return escrow;
  }

  async findAll(userId: string, role: string) {
    const where =
      role === UserRole.ADMIN
        ? {}
        : role === UserRole.CLIENT
        ? { clientId: userId }
        : { freelancerId: userId };

    return this.prisma.escrow.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        clientId: true,
        freelancerId: true,
        amount: true,
        fee: true,
        status: true,
        stellarContractId: true,
        description: true,
        milestoneId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(userId: string, role: string, escrowId: string) {
    const escrow = await this.prisma.escrow.findUnique({
      where: { id: escrowId },
      include: { dispute: true },
    });
    if (!escrow) throw new NotFoundException('Escrow not found');

    if (
      role !== UserRole.ADMIN &&
      escrow.clientId !== userId &&
      escrow.freelancerId !== userId
    ) {
      throw new ForbiddenException('Not your resource');
    }

    return escrow;
  }

  async fund(clientId: string, escrowId: string, idempotencyKey: string) {
    const existing = await this.prisma.transaction.findUnique({ where: { idempotencyKey } });
    if (existing) return { escrowId: existing.escrowId!, status: 'FUNDING' };

    const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) throw new NotFoundException('Escrow not found');
    if (escrow.clientId !== clientId) throw new ForbiddenException('Not your escrow');
    if (escrow.status !== EscrowStatus.PENDING) {
      throw new BadRequestException(`Cannot fund escrow in status ${escrow.status}`);
    }

    const total = new Decimal(escrow.amount).add(escrow.fee);

    await this.prisma.$transaction(async (tx) => {
      const balance = await tx.balance.findUnique({ where: { userId: clientId } });
      if (!balance) throw new NotFoundException('Balance not found');
      if (new Decimal(balance.availableAmount).lt(total)) {
        throw new BadRequestException('Insufficient balance');
      }

      const updated = await tx.balance.updateMany({
        where: { userId: clientId, version: balance.version },
        data: {
          availableAmount: { decrement: total },
          reservedAmount: { increment: total },
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConflictException('Balance modified concurrently');

      await tx.transaction.create({
        data: {
          idempotencyKey,
          userId: clientId,
          type: TransactionType.ESCROW_LOCK,
          status: TransactionStatus.PENDING,
          amount: escrow.amount,
          fee: escrow.fee,
          escrowId,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: clientId,
          action: 'FUND_ESCROW',
          entity: 'Escrow',
          entityId: escrowId,
          newValues: { amount: escrow.amount, fee: escrow.fee },
        },
      });
    });

    await this.escrowQueue.add(
      JobName.FUND_ESCROW,
      { escrowId, clientId },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, jobId: `fund-escrow-${escrowId}` },
    );

    return { escrowId, status: 'FUNDING' };
  }

  async release(clientId: string, escrowId: string) {
    const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) throw new NotFoundException('Escrow not found');
    if (escrow.clientId !== clientId) throw new ForbiddenException('Not your escrow');
    if (escrow.status !== EscrowStatus.FUNDED && escrow.status !== EscrowStatus.ACTIVE) {
      throw new BadRequestException(`Cannot release escrow in status ${escrow.status}`);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: clientId,
        action: 'REQUEST_RELEASE_ESCROW',
        entity: 'Escrow',
        entityId: escrowId,
      },
    });

    await this.escrowQueue.add(
      JobName.RELEASE_ESCROW,
      { escrowId, clientId },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, jobId: `release-escrow-${escrowId}` },
    );

    return { escrowId, status: 'RELEASING' };
  }

  async refund(adminId: string, escrowId: string) {
    const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) throw new NotFoundException('Escrow not found');
    if (
      escrow.status !== EscrowStatus.FUNDED &&
      escrow.status !== EscrowStatus.ACTIVE &&
      escrow.status !== EscrowStatus.DISPUTED
    ) {
      throw new BadRequestException(`Cannot refund escrow in status ${escrow.status}`);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'REQUEST_REFUND_ESCROW',
        entity: 'Escrow',
        entityId: escrowId,
      },
    });

    await this.escrowQueue.add(
      JobName.REFUND_ESCROW,
      { escrowId, adminId },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, jobId: `refund-escrow-${escrowId}` },
    );

    return { escrowId, status: 'REFUNDING' };
  }
}
