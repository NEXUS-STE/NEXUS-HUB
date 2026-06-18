import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { createHmac, timingSafeEqual } from 'crypto';
import { JobName, QueueName, TransactionStatus, TransactionType } from '@nexus-hub/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { InitiateTopupDto } from './dto/initiate-topup.dto';

@Injectable()
export class TopupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(QueueName.TOPUP) private readonly topupQueue: Queue,
  ) {}

  async initiate(userId: string, dto: InitiateTopupDto, idempotencyKey: string) {
    const existing = await this.prisma.transaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return { transactionId: existing.id, status: existing.status };

    const transaction = await this.prisma.transaction.create({
      data: {
        idempotencyKey,
        userId,
        type: TransactionType.TOPUP,
        status: TransactionStatus.PENDING,
        amount: dto.amount,
        metadata: { currency: dto.currency ?? 'USD' },
      },
    });

    await this.topupQueue.add(
      JobName.PROCESS_TOPUP,
      { transactionId: transaction.id, userId, amount: dto.amount },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    );

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'INITIATE_TOPUP',
        entity: 'Transaction',
        entityId: transaction.id,
        newValues: { amount: dto.amount, idempotencyKey },
      },
    });

    return { transactionId: transaction.id, status: transaction.status };
  }

  async findOne(userId: string, transactionId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, userId, type: TransactionType.TOPUP },
    });
    if (!tx) throw new NotFoundException('Top-up not found');
    return tx;
  }

  async handleAirtmWebhook(
    payload: Record<string, unknown>,
    rawSignature: string,
  ): Promise<void> {
    this.verifyAirtmSignature(payload, rawSignature);

    const transactionId = payload['nexusTransactionId'] as string;
    const airtmStatus = payload['status'] as string;

    if (!transactionId) return;

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) return;

    const succeeded = airtmStatus === 'COMPLETED' || airtmStatus === 'SUCCESS';

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: succeeded ? TransactionStatus.COMPLETED : TransactionStatus.FAILED,
        reference: payload['airtmReference'] as string,
      },
    });

    if (succeeded) {
      await this.topupQueue.add(
        JobName.PROCESS_TOPUP,
        { transactionId, userId: transaction.userId, amount: Number(transaction.amount), confirmed: true },
        { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
      );
    }
  }

  private verifyAirtmSignature(payload: Record<string, unknown>, signature: string): void {
    const secret = this.config.get<string>('AIRTM_WEBHOOK_SECRET', '');
    if (!secret) return;

    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    const provided = signature.replace(/^sha256=/, '');

    try {
      const match = timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(provided, 'hex'),
      );
      if (!match) throw new UnauthorizedException('Invalid webhook signature');
    } catch {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
