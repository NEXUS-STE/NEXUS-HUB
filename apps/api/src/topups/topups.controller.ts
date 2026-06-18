import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { TopupsService } from './topups.service';
import { InitiateTopupDto } from './dto/initiate-topup.dto';

@ApiTags('Topups')
@ApiBearerAuth('JWT')
@Controller({ path: 'topups', version: '1' })
export class TopupsController {
  constructor(private readonly topupsService: TopupsService) {}

  @Post('initiate')
  @ApiOperation({ summary: 'Initiate an Airtm top-up' })
  initiate(
    @CurrentUser('id') userId: string,
    @Body() dto: InitiateTopupDto,
    @IdempotencyKey() key: string,
  ) {
    return this.topupsService.initiate(userId, dto, key);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get top-up transaction status' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.topupsService.findOne(userId, id);
  }

  @Public()
  @Post('webhook/airtm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Airtm webhook receiver (HMAC-verified, no JWT)' })
  airtmWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers('x-airtm-signature') signature: string,
  ) {
    return this.topupsService.handleAirtmWebhook(payload, signature ?? '');
  }
}
