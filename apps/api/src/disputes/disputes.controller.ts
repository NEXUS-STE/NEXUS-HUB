import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@nexus-hub/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { DisputesService } from './disputes.service';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { AddEvidenceDto } from './dto/add-evidence.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@ApiTags('Disputes')
@ApiBearerAuth('JWT')
@Controller({ path: 'disputes', version: '1' })
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post()
  @ApiOperation({ summary: 'Open a dispute for a funded escrow' })
  open(
    @CurrentUser('id') userId: string,
    @Body() dto: OpenDisputeDto,
  ) {
    return this.disputesService.open(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get dispute details' })
  findOne(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Param('id') disputeId: string,
  ) {
    return this.disputesService.findOne(userId, role, disputeId);
  }

  @Patch(':id/evidence')
  @ApiOperation({ summary: 'Add evidence to an open dispute' })
  addEvidence(
    @CurrentUser('id') userId: string,
    @Param('id') disputeId: string,
    @Body() dto: AddEvidenceDto,
  ) {
    return this.disputesService.addEvidence(userId, disputeId, dto);
  }

  @Patch(':id/review')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move dispute to UNDER_REVIEW (admin only)' })
  setUnderReview(@CurrentUser('id') adminId: string, @Param('id') disputeId: string) {
    return this.disputesService.setUnderReview(adminId, disputeId);
  }

  @Patch(':id/resolve')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a dispute and trigger escrow release or refund (admin only)' })
  resolve(
    @CurrentUser('id') adminId: string,
    @Param('id') disputeId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.disputesService.resolve(adminId, disputeId, dto);
  }
}
