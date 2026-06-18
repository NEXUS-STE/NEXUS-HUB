import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@nexus-hub/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { EscrowService } from './escrow.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';

@ApiTags('Escrow')
@ApiBearerAuth('JWT')
@Controller({ path: 'escrow', version: '1' })
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post()
  @Roles(UserRole.CLIENT, UserRole.MARKETPLACE)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a new escrow (CLIENT only)' })
  create(
    @CurrentUser('id') clientId: string,
    @Body() dto: CreateEscrowDto,
    @IdempotencyKey() key: string,
  ) {
    return this.escrowService.create(clientId, dto, key);
  }

  @Get()
  @ApiOperation({ summary: 'List escrows for current user' })
  findAll(@CurrentUser('id') userId: string, @CurrentUser('role') role: string) {
    return this.escrowService.findAll(userId, role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single escrow' })
  findOne(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Param('id') escrowId: string,
  ) {
    return this.escrowService.findOne(userId, role, escrowId);
  }

  @Post(':id/fund')
  @Roles(UserRole.CLIENT, UserRole.MARKETPLACE)
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Fund an escrow — locks client balance and deploys Stellar contract' })
  fund(
    @CurrentUser('id') clientId: string,
    @Param('id') escrowId: string,
    @IdempotencyKey() key: string,
  ) {
    return this.escrowService.fund(clientId, escrowId, key);
  }

  @Post(':id/release')
  @Roles(UserRole.CLIENT, UserRole.MARKETPLACE)
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Release escrow funds to freelancer' })
  release(@CurrentUser('id') clientId: string, @Param('id') escrowId: string) {
    return this.escrowService.release(clientId, escrowId);
  }

  @Post(':id/refund')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Refund escrow to client (admin only)' })
  refund(@CurrentUser('id') adminId: string, @Param('id') escrowId: string) {
    return this.escrowService.refund(adminId, escrowId);
  }
}
