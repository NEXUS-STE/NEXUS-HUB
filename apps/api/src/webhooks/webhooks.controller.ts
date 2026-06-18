import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WebhooksService } from './webhooks.service';
import { CreateEndpointDto } from './dto/create-endpoint.dto';
import { UpdateEndpointDto } from './dto/update-endpoint.dto';

@ApiTags('Webhooks')
@ApiBearerAuth('JWT')
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('endpoints')
  @ApiOperation({ summary: 'Register a webhook endpoint' })
  createEndpoint(@CurrentUser('id') userId: string, @Body() dto: CreateEndpointDto) {
    return this.webhooksService.createEndpoint(userId, dto);
  }

  @Get('endpoints')
  @ApiOperation({ summary: 'List your webhook endpoints (secret is never returned)' })
  findEndpoints(@CurrentUser('id') userId: string) {
    return this.webhooksService.findEndpoints(userId);
  }

  @Patch('endpoints/:id')
  @ApiOperation({ summary: 'Update a webhook endpoint' })
  updateEndpoint(
    @CurrentUser('id') userId: string,
    @Param('id') endpointId: string,
    @Body() dto: UpdateEndpointDto,
  ) {
    return this.webhooksService.updateEndpoint(userId, endpointId, dto);
  }

  @Delete('endpoints/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  deleteEndpoint(@CurrentUser('id') userId: string, @Param('id') endpointId: string) {
    return this.webhooksService.deleteEndpoint(userId, endpointId);
  }

  @Post('endpoints/:id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the signing secret for a webhook endpoint' })
  rotateSecret(@CurrentUser('id') userId: string, @Param('id') endpointId: string) {
    return this.webhooksService.rotateSecret(userId, endpointId);
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'List webhook delivery history' })
  getDeliveries(
    @CurrentUser('id') userId: string,
    @Query('endpointId') endpointId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.webhooksService.getDeliveries(userId, endpointId, +page, +limit);
  }
}
