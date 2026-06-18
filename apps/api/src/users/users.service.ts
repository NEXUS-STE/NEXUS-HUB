import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@nexus-hub/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { UpdateUserDto, UpdateUserStatusDto } from './dto/update-user.dto';

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

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({ skip, take: limit, select: USER_SELECT, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count(),
    ]);
    return { users, total, page, limit };
  }

  async findOne(requesterId: string, requesterRole: string, targetId: string) {
    if (requesterRole !== UserRole.ADMIN && requesterId !== targetId) {
      throw new ForbiddenException('Not your resource');
    }
    const user = await this.prisma.user.findUnique({ where: { id: targetId }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(requesterId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: requesterId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: requesterId },
      data: dto,
      select: USER_SELECT,
    });
  }

  async updateStatus(adminId: string, targetId: string, dto: UpdateUserStatusDto) {
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: USER_SELECT });
    if (!target) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { status: dto.status },
      select: USER_SELECT,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'UPDATE_STATUS',
        entity: 'User',
        entityId: targetId,
        oldValues: { status: target.status },
        newValues: { status: dto.status },
      },
    });

    return updated;
  }
}
