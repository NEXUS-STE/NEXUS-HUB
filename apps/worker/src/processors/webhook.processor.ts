import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import axios from 'axios';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { JobName, QueueName, WebhookDeliveryStatus, WebhookEvent } from '@nexus-hub/shared';
import { PrismaService } from '../common/prisma/prisma.service';

@Processor(QueueName.WEBHOOK)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JobName.DELIVER_WEBHOOK) return;

    const { event, payload } = job.data as {
      event: WebhookEvent;
      payload: Record<string, unknown>;
    };

    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { events: { has: event }, isActive: true },
    });

    if (endpoints.length === 0) return;

    await Promise.allSettled(
      endpoints.map((endpoint) => this.deliver(endpoint, event, payload)),
    );
  }

  private async deliver(
    endpoint: { id: string; url: string; secret: string },
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ) {
    const body = JSON.stringify({ event, payload, deliveredAt: new Date().toISOString() });
    const signature = `sha256=${createHmac('sha256', endpoint.secret).update(body).digest('hex')}`;

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        event,
        payload: { event, payload } as Prisma.InputJsonValue,
        status: WebhookDeliveryStatus.PENDING,
        attempts: 1,
      },
    });

    try {
      const response = await axios.post(endpoint.url, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Signature': signature,
          'X-Nexus-Event': event,
        },
        timeout: 10_000,
      });

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.DELIVERED,
          responseStatus: response.status,
        },
      });
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      this.logger.warn(`Webhook delivery failed for endpoint ${endpoint.id}: ${err instanceof Error ? err.message : err}`);

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.FAILED,
          responseStatus: status,
          nextRetryAt: new Date(Date.now() + 5 * 60 * 1_000),
        },
      });
    }
  }
}
