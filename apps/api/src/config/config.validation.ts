import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsString()
  DATABASE_URL: string;

  @IsString()
  @IsOptional()
  REDIS_HOST?: string = 'localhost';

  @IsInt()
  @Min(1)
  @IsOptional()
  REDIS_PORT?: number = 6379;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN?: string = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN?: string = '7d';

  @IsUrl()
  AIRTM_API_URL: string;

  @IsString()
  AIRTM_API_KEY: string;

  @IsString()
  AIRTM_WEBHOOK_SECRET: string;

  @IsUrl()
  TRUSTLESS_WORK_API_URL: string;

  @IsString()
  TRUSTLESS_WORK_API_KEY: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  PORT?: number = 3000;

  @IsInt()
  @Min(0)
  @IsOptional()
  PLATFORM_FEE_BPS?: number = 100;

  @IsString()
  @IsOptional()
  CORS_ORIGIN?: string = '*';

  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV?: Environment = Environment.Development;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
