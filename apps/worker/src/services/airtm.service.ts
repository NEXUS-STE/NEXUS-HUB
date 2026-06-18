import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface TopupSessionResult {
  airtmReference: string;
  redirectUrl: string;
}

export interface WithdrawalResult {
  airtmReference: string;
  status: string;
}

@Injectable()
export class AirtmService {
  private readonly logger = new Logger(AirtmService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.client = axios.create({
      baseURL: config.get<string>('AIRTM_API_URL'),
      headers: {
        Authorization: `Bearer ${config.get<string>('AIRTM_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  async createTopupSession(params: {
    transactionId: string;
    userId: string;
    amount: number;
    currency: string;
  }): Promise<TopupSessionResult> {
    this.logger.log(`Creating Airtm top-up session for transaction ${params.transactionId}`);
    const { data } = await this.client.post<TopupSessionResult>('/payments/session', {
      reference: params.transactionId,
      amount: params.amount,
      currency: params.currency,
    });
    return data;
  }

  async initiateWithdrawal(params: {
    transactionId: string;
    airtmAccountId: string;
    amount: number;
  }): Promise<WithdrawalResult> {
    this.logger.log(`Initiating Airtm withdrawal for transaction ${params.transactionId}`);
    const { data } = await this.client.post<WithdrawalResult>('/withdrawals', {
      reference: params.transactionId,
      destination: params.airtmAccountId,
      amount: params.amount,
    });
    return data;
  }
}
