import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BalancesService } from './balances.service';

@ApiTags('Balances')
@ApiBearerAuth('JWT')
@Controller({ path: 'balances', version: '1' })
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user balance' })
  getBalance(@CurrentUser('id') userId: string) {
    return this.balancesService.getBalance(userId);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction history for current user' })
  getTransactions(
    @CurrentUser('id') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.balancesService.getTransactionHistory(userId, +page, +limit);
  }
}
