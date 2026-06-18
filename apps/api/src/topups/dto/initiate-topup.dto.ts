import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class InitiateTopupDto {
  @ApiProperty({ example: 100.0, description: 'Amount in USD' })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;
}
