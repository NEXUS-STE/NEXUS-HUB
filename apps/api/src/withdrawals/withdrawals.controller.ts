import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { WithdrawalsService } from './withdrawals.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

@ApiTags('Withdrawals')
@ApiBearerAuth('JWT')
@Controller({ path: 'withdrawals', version: '1' })
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Post()
  @ApiOperation({ summary: 'Initiate a withdrawal via Airtm' })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWithdrawalDto,
    @IdempotencyKey() key: string,
  ) {
    return this.withdrawalsService.create(userId, dto, key);
  }

  @Get()
  @ApiOperation({ summary: 'List withdrawal history for current user' })
  findAll(
    @CurrentUser('id') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.withdrawalsService.findAll(userId, +page, +limit);
  }
}
