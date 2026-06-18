import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@nexus-hub/shared';
import { PrismaModule } from './common/prisma/prisma.module';
import { TrustlessWorkService } from './services/trustless-work.service';
import { AirtmService } from './services/airtm.service';
import { EscrowProcessor } from './processors/escrow.processor';
import { TopupProcessor } from './processors/topup.processor';
import { WithdrawalProcessor } from './processors/withdrawal.processor';
import { WebhookProcessor } from './processors/webhook.processor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
      inject: [ConfigService],
    }),

    BullModule.registerQueue(
      { name: QueueName.ESCROW },
      { name: QueueName.TOPUP },
      { name: QueueName.WITHDRAWAL },
      { name: QueueName.WEBHOOK },
    ),

    PrismaModule,
  ],
  providers: [
    TrustlessWorkService,
    AirtmService,
    EscrowProcessor,
    TopupProcessor,
    WithdrawalProcessor,
    WebhookProcessor,
  ],
})
export class WorkerModule {}
