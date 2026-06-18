import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { UserStatus } from '@nexus-hub/shared';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'airtm-account-123' })
  @IsString()
  @IsOptional()
  airtmAccountId?: string;

  @ApiPropertyOptional({ example: 'GABC123...' })
  @IsString()
  @IsOptional()
  stellarPublicKey?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status: UserStatus;
}
