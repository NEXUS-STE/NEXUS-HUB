import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class AddEvidenceDto {
  @ApiProperty({ description: 'Additional evidence to append to the dispute' })
  @IsObject()
  evidence: Record<string, unknown>;
}
