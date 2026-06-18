import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class BalancesService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: string) {
    const balance = await this.prisma.balance.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        availableAmount: true,
        reservedAmount: true,
        currency: true,
        updatedAt: true,
      },
    });
    if (!balance) throw new NotFoundException('Balance not found');
    return balance;
  }

  async getTransactionHistory(
    userId: string,
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          idempotencyKey: true,
          type: true,
          status: true,
          amount: true,
          fee: true,
          escrowId: true,
          reference: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.transaction.count({ where: { userId } }),
    ]);
    return { transactions, total, page, limit };
  }
}
