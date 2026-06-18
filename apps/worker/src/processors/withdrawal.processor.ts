import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Decimal } from '@prisma/client/runtime/library';
import { JobName, QueueName, TransactionStatus, WebhookEvent } from '@nexus-hub/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AirtmService } from '../services/airtm.service';

@Processor(QueueName.WITHDRAWAL)
export class WithdrawalProcessor extends WorkerHost {
  private readonly logger = new Logger(WithdrawalProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly airtm: AirtmService,
    @InjectQueue(QueueName.WEBHOOK) private readonly webhookQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JobName.PROCESS_WITHDRAWAL) return;

    const { transactionId, userId, amount, airtmAccountId } = job.data as {
      transactionId: string;
      userId: string;
      amount: number;
      airtmAccountId: string;
    };

    this.logger.log(`Processing withdrawal ${transactionId}`);

    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) throw new Error(`Transaction ${transactionId} not found`);

    try {
      const result = await this.airtm.initiateWithdrawal({
        transactionId,
        airtmAccountId,
        amount,
      });

      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: TransactionStatus.COMPLETED,
          reference: result.airtmReference,
        },
      });

      await this.webhookQueue.add(JobName.DELIVER_WEBHOOK, {
        event: WebhookEvent.WITHDRAWAL_COMPLETED,
        payload: { transactionId, userId, amount, airtmReference: result.airtmReference },
      });
    } catch (err) {
      this.logger.error(`Failed to process withdrawal ${transactionId}`, err);
      await this.restoreBalance(userId, amount, transactionId);
      throw err;
    }
  }

  private async restoreBalance(userId: string, amount: number, transactionId: string) {
    await this.prisma.$transaction(async (tx) => {
      const balance = await tx.balance.findUnique({ where: { userId } });
      if (balance) {
        const updated = await tx.balance.updateMany({
          where: { userId, version: balance.version },
          data: { availableAmount: { increment: new Decimal(amount) }, version: { increment: 1 } },
        });
        if (updated.count === 0) throw new Error('Balance version conflict restoring withdrawal — will retry');
      }
      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.FAILED },
      });
    });

    await this.webhookQueue.add(JobName.DELIVER_WEBHOOK, {
      event: WebhookEvent.WITHDRAWAL_FAILED,
      payload: { transactionId, userId, amount },
    });
  }
}
