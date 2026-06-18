import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class OpenDisputeDto {
  @ApiProperty({ description: 'Escrow ID to dispute' })
  @IsUUID()
  escrowId: string;

  @ApiProperty({ example: 'Work not delivered as agreed', minLength: 20 })
  @IsString()
  @MinLength(20)
  reason: string;

  @ApiPropertyOptional({ description: 'Supporting evidence as key-value pairs' })
  @IsObject()
  @IsOptional()
  evidence?: Record<string, unknown>;
}
