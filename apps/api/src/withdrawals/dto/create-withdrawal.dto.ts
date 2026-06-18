import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @ApiProperty({ example: 200.0, description: 'Amount to withdraw in USD' })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ example: 'airtm-account-123' })
  @IsString()
  @IsOptional()
  airtmAccountId?: string;
}
