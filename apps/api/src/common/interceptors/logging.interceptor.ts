import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, ip } = request;
    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const status = context.switchToHttp().getResponse().statusCode;
          this.logger.log(`${method} ${url} ${status} +${Date.now() - now}ms [${ip}]`);
        },
        error: (err) => {
          const status = err.status ?? 500;
          this.logger.warn(`${method} ${url} ${status} +${Date.now() - now}ms [${ip}]`);
        },
      }),
    );
  }
}
