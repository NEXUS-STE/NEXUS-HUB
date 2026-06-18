import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@nexus-hub/shared';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.ESCROW }),
    BullModule.registerQueue({ name: QueueName.WEBHOOK }),
  ],
  controllers: [DisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}
