import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import {
  DisputeStatus,
  EscrowStatus,
  JobName,
  QueueName,
  UserRole,
  WebhookEvent,
} from '@nexus-hub/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { AddEvidenceDto } from './dto/add-evidence.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.ESCROW) private readonly escrowQueue: Queue,
    @InjectQueue(QueueName.WEBHOOK) private readonly webhookQueue: Queue,
  ) {}

  async open(userId: string, dto: OpenDisputeDto) {
    const escrow = await this.prisma.escrow.findUnique({ where: { id: dto.escrowId } });
    if (!escrow) throw new NotFoundException('Escrow not found');
    if (escrow.clientId !== userId && escrow.freelancerId !== userId) {
      throw new ForbiddenException('Not your escrow');
    }
    if (escrow.status !== EscrowStatus.FUNDED && escrow.status !== EscrowStatus.ACTIVE) {
      throw new BadRequestException(`Cannot dispute escrow in status ${escrow.status}`);
    }

    // Natural idempotency: unique constraint on escrowId means retrying returns the same dispute
    const existingDispute = await this.prisma.dispute.findUnique({ where: { escrowId: dto.escrowId } });
    if (existingDispute) return existingDispute;

    const dispute = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dispute.create({
        data: {
          escrowId: dto.escrowId,
          raisedById: userId,
          reason: dto.reason,
          evidence: (dto.evidence ?? {}) as Prisma.InputJsonValue,
        },
      });

      await tx.escrow.update({
        where: { id: dto.escrowId },
        data: { status: EscrowStatus.DISPUTED },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'OPEN_DISPUTE',
          entity: 'Dispute',
          entityId: created.id,
          newValues: { escrowId: dto.escrowId, reason: dto.reason },
        },
      });

      return created;
    });

    await this.webhookQueue.add(JobName.DELIVER_WEBHOOK, {
      event: WebhookEvent.DISPUTE_OPENED,
      payload: { disputeId: dispute.id, escrowId: dto.escrowId, raisedById: userId },
    });

    return dispute;
  }

  async findOne(userId: string, role: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { escrow: true },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    if (role !== UserRole.ADMIN) {
      const escrow = dispute.escrow;
      if (escrow.clientId !== userId && escrow.freelancerId !== userId) {
        throw new ForbiddenException('Not your resource');
      }
    }

    return dispute;
  }

  async addEvidence(userId: string, disputeId: string, dto: AddEvidenceDto) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { escrow: true },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.escrow.clientId !== userId && dispute.escrow.freelancerId !== userId) {
      throw new ForbiddenException('Not your dispute');
    }
    if (dispute.status !== DisputeStatus.OPEN && dispute.status !== DisputeStatus.UNDER_REVIEW) {
      throw new BadRequestException('Cannot add evidence to a closed dispute');
    }

    const mergedEvidence = { ...(dispute.evidence as Record<string, unknown>), ...dto.evidence };

    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: { evidence: mergedEvidence as Prisma.InputJsonValue },
    });
  }

  async setUnderReview(adminId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status !== DisputeStatus.OPEN) {
      throw new BadRequestException('Dispute is not in OPEN status');
    }

    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: DisputeStatus.UNDER_REVIEW },
    });
  }

  async resolve(adminId: string, disputeId: string, dto: ResolveDisputeDto) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { escrow: true },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (
      dispute.status !== DisputeStatus.OPEN &&
      dispute.status !== DisputeStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException('Dispute is already resolved');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: dto.resolution,
          resolution: dto.notes,
          resolvedById: adminId,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: 'RESOLVE_DISPUTE',
          entity: 'Dispute',
          entityId: disputeId,
          oldValues: { status: dispute.status },
          newValues: { resolution: dto.resolution, notes: dto.notes },
        },
      });
    });

    if (dto.resolution === DisputeStatus.RESOLVED_FREELANCER) {
      await this.escrowQueue.add(
        JobName.RELEASE_ESCROW,
        { escrowId: dispute.escrowId, adminId, disputeResolution: true },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          jobId: `release-escrow-${dispute.escrowId}`,
        },
      );
    } else if (dto.resolution === DisputeStatus.RESOLVED_CLIENT) {
      await this.escrowQueue.add(
        JobName.REFUND_ESCROW,
        { escrowId: dispute.escrowId, adminId, disputeResolution: true },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          jobId: `refund-escrow-${dispute.escrowId}`,
        },
      );
    }

    await this.webhookQueue.add(JobName.DELIVER_WEBHOOK, {
      event: WebhookEvent.DISPUTE_RESOLVED,
      payload: { disputeId, resolution: dto.resolution, escrowId: dispute.escrowId },
    });

    return { disputeId, resolution: dto.resolution };
  }
}
