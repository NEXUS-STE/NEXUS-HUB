import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@nexus-hub/shared';
import { TopupsController } from './topups.controller';
import { TopupsService } from './topups.service';

@Module({
  imports: [BullModule.registerQueue({ name: QueueName.TOPUP })],
  controllers: [TopupsController],
  providers: [TopupsService],
})
export class TopupsModule {}
