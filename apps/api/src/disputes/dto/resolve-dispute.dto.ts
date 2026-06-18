import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DisputeStatus } from '@nexus-hub/shared';

export class ResolveDisputeDto {
  @ApiProperty({ enum: [DisputeStatus.RESOLVED_CLIENT, DisputeStatus.RESOLVED_FREELANCER, DisputeStatus.CLOSED] })
  @IsEnum(DisputeStatus)
  resolution: DisputeStatus.RESOLVED_CLIENT | DisputeStatus.RESOLVED_FREELANCER | DisputeStatus.CLOSED;

  @ApiPropertyOptional({ example: 'Evidence reviewed. Client wins.' })
  @IsString()
  @IsOptional()
  notes?: string;
}
