import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsOptional, IsUrl } from 'class-validator';
import { WebhookEvent } from '@nexus-hub/shared';

export class UpdateEndpointDto {
  @ApiPropertyOptional()
  @IsUrl({ require_tld: false })
  @IsOptional()
  url?: string;

  @ApiPropertyOptional({ enum: WebhookEvent, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(WebhookEvent, { each: true })
  @IsOptional()
  events?: WebhookEvent[];

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
