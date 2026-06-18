import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEnum, IsUrl } from 'class-validator';
import { WebhookEvent } from '@nexus-hub/shared';

export class CreateEndpointDto {
  @ApiProperty({ example: 'https://yourdomain.com/webhooks/nexus' })
  @IsUrl({ require_tld: false })
  url: string;

  @ApiProperty({ enum: WebhookEvent, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(WebhookEvent, { each: true })
  events: WebhookEvent[];
}
