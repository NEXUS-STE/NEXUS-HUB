import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateEscrowDto {
  @ApiProperty({ description: 'Freelancer user ID' })
  @IsUUID()
  freelancerId: string;

  @ApiProperty({ example: 500.0, description: 'Escrow amount in USD' })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ example: 'Build landing page' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'milestone-uuid' })
  @IsString()
  @IsOptional()
  milestoneId?: string;
}
