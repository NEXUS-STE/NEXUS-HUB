import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Decimal } from '@prisma/client/runtime/library';
import {
  EscrowStatus,
  JobName,
  QueueName,
  TransactionStatus,
  TransactionType,
  WebhookEvent,
} from '@nexus-hub/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { TrustlessWorkService } from '../services/trustless-work.service';

@Processor(QueueName.ESCROW)
export class EscrowProcessor extends WorkerHost {
  private readonly logger = new Logger(EscrowProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trustlessWork: TrustlessWorkService,
    @InjectQueue(QueueName.WEBHOOK) private readonly webhookQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JobName.FUND_ESCROW:
        return this.fundEscrow(job.data);
      case JobName.RELEASE_ESCROW:
        return this.releaseEscrow(job.data);
      case JobName.REFUND_ESCROW:
        return this.refundEscrow(job.data);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async fundEscrow(data: { escrowId: string; clientId: string }) {
    const { escrowId, clientId } = data;
    this.logger.log(`Funding escrow ${escrowId}`);

    const escrow = await this.prisma.escrow.findUnique({
      where: { id: escrowId },
      include: { client: true, freelancer: true },
    });
    if (!escrow) throw new Error(`Escrow ${escrowId} not found`);

    try {
      const result = await this.trustlessWork.deployEscrowContract({
        escrowId,
        clientStellarKey: escrow.client.stellarPublicKey ?? '',
        freelancerStellarKey: escrow.freelancer.stellarPublicKey ?? '',
        amount: escrow.amount.toString(),
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.escrow.update({
          where: { id: escrowId },
          data: {
            status: EscrowStatus.FUNDED,
            stellarContractId: result.contractId,
            stellarTxHash: result.txHash,
          },
        });

        await tx.transaction.updateMany({
          where: { escrowId, type: TransactionType.ESCROW_LOCK, status: TransactionStatus.PENDING },
          data: { status: TransactionStatus.COMPLETED, reference: result.txHash },
        });

        await tx.auditLog.create({
          data: {
            userId: clientId,
            action: 'ESCROW_FUNDED',
            entity: 'Escrow',
            entityId: escrowId,
            newValues: { contractId: result.contractId, txHash: result.txHash },
          },
        });
      });

      await this.webhookQueue.add(JobName.DELIVER_WEBHOOK, {
        event: WebhookEvent.ESCROW_FUNDED,
        payload: { escrowId, clientId, freelancerId: escrow.freelancerId, amount: escrow.amount },
      });
    } catch (err) {
      this.logger.error(`Failed to fund escrow ${escrowId}`, err);
      await this.rollbackClientBalance(clientId, escrow.amount, escrow.fee);
      await this.prisma.transaction.updateMany({
        where: { escrowId, type: TransactionType.ESCROW_LOCK, status: TransactionStatus.PENDING },
        data: { status: TransactionStatus.FAILED },
      });
      throw err;
    }
  }

  private async releaseEscrow(data: { escrowId: string; clientId?: string; adminId?: string; disputeResolution?: boolean }) {
    const { escrowId } = data;
    this.logger.log(`Releasing escrow ${escrowId}`);

    const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) throw new Error(`Escrow ${escrowId} not found`);
    if (!escrow.stellarContractId) throw new Error(`Escrow ${escrowId} has no Stellar contract`);

    const result = await this.trustlessWork.releaseEscrow({
      contractId: escrow.stellarContractId,
    });

    const total = new Decimal(escrow.amount).add(escrow.fee);

    await this.prisma.$transaction(async (tx) => {
      await tx.escrow.update({
        where: { id: escrowId },
        data: { status: EscrowStatus.RELEASED, stellarTxHash: result.txHash },
      });

      const freelancerBalance = await tx.balance.findUnique({ where: { userId: escrow.freelancerId } });
      if (freelancerBalance) {
        const fUpdate = await tx.balance.updateMany({
          where: { userId: escrow.freelancerId, version: freelancerBalance.version },
          data: { availableAmount: { increment: escrow.amount }, version: { increment: 1 } },
        });
        if (fUpdate.count === 0) throw new Error('Freelancer balance version conflict — will retry');
      }

      const clientBalance = await tx.balance.findUnique({ where: { userId: escrow.clientId } });
      if (clientBalance) {
        const cUpdate = await tx.balance.updateMany({
          where: { userId: escrow.clientId, version: clientBalance.version },
          data: { reservedAmount: { decrement: total }, version: { increment: 1 } },
        });
        if (cUpdate.count === 0) throw new Error('Client balance version conflict — will retry');
      }

      await tx.transaction.create({
        data: {
          idempotencyKey: `release-${escrowId}-${result.txHash}`,
          userId: escrow.freelancerId,
          type: TransactionType.ESCROW_RELEASE,
          status: TransactionStatus.COMPLETED,
          amount: escrow.amount,
          fee: escrow.fee,
          escrowId,
          reference: result.txHash,
        },
      });
    });

    await this.webhookQueue.add(JobName.DELIVER_WEBHOOK, {
      event: WebhookEvent.ESCROW_RELEASED,
      payload: { escrowId, freelancerId: escrow.freelancerId, amount: escrow.amount, txHash: result.txHash },
    });
  }

  private async refundEscrow(data: { escrowId: string; adminId?: string }) {
    const { escrowId } = data;
    this.logger.log(`Refunding escrow ${escrowId}`);

    const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) throw new Error(`Escrow ${escrowId} not found`);
    if (!escrow.stellarContractId) throw new Error(`Escrow ${escrowId} has no Stellar contract`);

    const result = await this.trustlessWork.refundEscrow({ contractId: escrow.stellarContractId });
    const total = new Decimal(escrow.amount).add(escrow.fee);

    await this.prisma.$transaction(async (tx) => {
      await tx.escrow.update({
        where: { id: escrowId },
        data: { status: EscrowStatus.REFUNDED, stellarTxHash: result.txHash },
      });

      const clientBalance = await tx.balance.findUnique({ where: { userId: escrow.clientId } });
      if (clientBalance) {
        const cUpdate = await tx.balance.updateMany({
          where: { userId: escrow.clientId, version: clientBalance.version },
          data: {
            availableAmount: { increment: total },
            reservedAmount: { decrement: total },
            version: { increment: 1 },
          },
        });
        if (cUpdate.count === 0) throw new Error('Client balance version conflict — will retry');
      }

      await tx.transaction.create({
        data: {
          idempotencyKey: `refund-${escrowId}-${result.txHash}`,
          userId: escrow.clientId,
          type: TransactionType.ESCROW_REFUND,
          status: TransactionStatus.COMPLETED,
          amount: escrow.amount,
          fee: escrow.fee,
          escrowId,
          reference: result.txHash,
        },
      });
    });

    await this.webhookQueue.add(JobName.DELIVER_WEBHOOK, {
      event: WebhookEvent.ESCROW_REFUNDED,
      payload: { escrowId, clientId: escrow.clientId, amount: escrow.amount, txHash: result.txHash },
    });
  }

  private async rollbackClientBalance(clientId: string, amount: Decimal, fee: Decimal) {
    const total = new Decimal(amount).add(fee);
    const balance = await this.prisma.balance.findUnique({ where: { userId: clientId } });
    if (!balance) return;

    const updated = await this.prisma.balance.updateMany({
      where: { userId: clientId, version: balance.version },
      data: {
        availableAmount: { increment: total },
        reservedAmount: { decrement: total },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      this.logger.warn(`Rollback balance version conflict for ${clientId} — balance may be inconsistent`);
    }
  }
}
