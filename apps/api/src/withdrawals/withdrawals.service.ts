import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Decimal } from '@prisma/client/runtime/library';
import { JobName, QueueName, TransactionStatus, TransactionType } from '@nexus-hub/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.WITHDRAWAL) private readonly withdrawalQueue: Queue,
  ) {}

  async create(userId: string, dto: CreateWithdrawalDto, idempotencyKey: string) {
    const existing = await this.prisma.transaction.findUnique({ where: { idempotencyKey } });
    if (existing) return { transactionId: existing.id, status: existing.status };

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const airtmAccountId = dto.airtmAccountId ?? user.airtmAccountId;
    if (!airtmAccountId) {
      throw new BadRequestException('No Airtm account linked. Provide airtmAccountId or update your profile.');
    }

    const amount = new Decimal(dto.amount);

    const transaction = await this.prisma.$transaction(async (tx) => {
      const balance = await tx.balance.findUnique({ where: { userId } });
      if (!balance) throw new NotFoundException('Balance not found');
      if (new Decimal(balance.availableAmount).lt(amount)) {
        throw new BadRequestException('Insufficient balance');
      }

      const updated = await tx.balance.updateMany({
        where: { userId, version: balance.version },
        data: {
          availableAmount: { decrement: amount },
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConflictException('Balance modified concurrently');

      const created = await tx.transaction.create({
        data: {
          idempotencyKey,
          userId,
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.PENDING,
          amount,
          metadata: { airtmAccountId },
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'INITIATE_WITHDRAWAL',
          entity: 'Transaction',
          entityId: created.id,
          newValues: { amount: dto.amount, airtmAccountId },
        },
      });

      return created;
    });

    await this.withdrawalQueue.add(
      JobName.PROCESS_WITHDRAWAL,
      { transactionId: transaction.id, userId, amount: dto.amount, airtmAccountId },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    );

    return { transactionId: transaction.id, status: transaction.status };
  }

  async findAll(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [withdrawals, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId, type: TransactionType.WITHDRAWAL },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.transaction.count({ where: { userId, type: TransactionType.WITHDRAWAL } }),
    ]);
    return { withdrawals, total, page, limit };
  }
}
