import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateEndpointDto } from './dto/create-endpoint.dto';
import { UpdateEndpointDto } from './dto/update-endpoint.dto';

const ENDPOINT_SELECT = {
  id: true,
  userId: true,
  url: true,
  events: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  async createEndpoint(userId: string, dto: CreateEndpointDto) {
    return this.prisma.webhookEndpoint.create({
      data: {
        userId,
        url: dto.url,
        events: dto.events,
        secret: this.generateSecret(),
      },
      select: ENDPOINT_SELECT,
    });
  }

  async findEndpoints(userId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: { userId },
      select: ENDPOINT_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateEndpoint(userId: string, endpointId: string, dto: UpdateEndpointDto) {
    await this.assertOwner(userId, endpointId);
    return this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: dto,
      select: ENDPOINT_SELECT,
    });
  }

  async deleteEndpoint(userId: string, endpointId: string) {
    await this.assertOwner(userId, endpointId);
    await this.prisma.webhookEndpoint.delete({ where: { id: endpointId } });
    return { deleted: true };
  }

  async rotateSecret(userId: string, endpointId: string) {
    await this.assertOwner(userId, endpointId);
    const newSecret = this.generateSecret();
    await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { secret: newSecret },
    });
    return { secret: newSecret };
  }

  async getDeliveries(userId: string, endpointId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const endpointWhere = endpointId
      ? { id: endpointId, userId }
      : { userId };

    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: endpointWhere,
      select: { id: true },
    });
    const endpointIds = endpoints.map((e) => e.id);

    const [deliveries, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where: { endpointId: { in: endpointIds } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.webhookDelivery.count({ where: { endpointId: { in: endpointIds } } }),
    ]);

    return { deliveries, total, page, limit };
  }

  private async assertOwner(userId: string, endpointId: string) {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id: endpointId },
      select: { userId: true },
    });
    if (!endpoint) throw new NotFoundException('Webhook endpoint not found');
    if (endpoint.userId !== userId) throw new ForbiddenException('Not your endpoint');
  }

  private generateSecret(): string {
    return `whsec_${randomBytes(32).toString('hex')}`;
  }
}
