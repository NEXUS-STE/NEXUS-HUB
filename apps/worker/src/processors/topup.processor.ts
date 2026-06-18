import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { JobName, QueueName, TransactionStatus, WebhookEvent } from '@nexus-hub/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AirtmService } from '../services/airtm.service';

@Processor(QueueName.TOPUP)
export class TopupProcessor extends WorkerHost {
  private readonly logger = new Logger(TopupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly airtm: AirtmService,
    @InjectQueue(QueueName.WEBHOOK) private readonly webhookQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JobName.PROCESS_TOPUP) return;

    const { transactionId, userId, amount, confirmed } = job.data as {
      transactionId: string;
      userId: string;
      amount: number;
      confirmed?: boolean;
    };

    this.logger.log(`Processing top-up ${transactionId}`);

    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) throw new Error(`Transaction ${transactionId} not found`);

    if (confirmed) {
      await this.creditBalance(userId, amount, transactionId);
      await this.webhookQueue.add(JobName.DELIVER_WEBHOOK, {
        event: WebhookEvent.TOPUP_COMPLETED,
        payload: { transactionId, userId, amount },
      });
      return;
    }

    try {
      const metadata = (transaction.metadata as Record<string, string>) ?? {};
      const session = await this.airtm.createTopupSession({
        transactionId,
        userId,
        amount,
        currency: metadata['currency'] ?? 'USD',
      });

      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          metadata: { ...metadata, airtmReference: session.airtmReference, redirectUrl: session.redirectUrl },
        },
      });
    } catch (err) {
      this.logger.error(`Failed to create Airtm top-up session for ${transactionId}`, err);
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.FAILED },
      });
      await this.webhookQueue.add(JobName.DELIVER_WEBHOOK, {
        event: WebhookEvent.TOPUP_FAILED,
        payload: { transactionId, userId, amount },
      });
      throw err;
    }
  }

  private async creditBalance(userId: string, amount: number, transactionId: string) {
    await this.prisma.$transaction(async (tx) => {
      const balance = await tx.balance.findUnique({ where: { userId } });
      if (!balance) {
        await tx.balance.create({ data: { userId, availableAmount: amount } });
      } else {
        const updated = await tx.balance.updateMany({
          where: { userId, version: balance.version },
          data: { availableAmount: { increment: amount }, version: { increment: 1 } },
        });
        if (updated.count === 0) throw new Error('Balance version conflict crediting top-up — will retry');
      }

      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.COMPLETED },
      });
    });
  }
}
