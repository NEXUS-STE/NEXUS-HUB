import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const key = request.headers['x-idempotency-key'] as string;
    if (!key) {
      throw new BadRequestException('X-Idempotency-Key header is required');
    }
    return key;
  },
);
