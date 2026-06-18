import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface DeployContractResult {
  contractId: string;
  txHash: string;
}

@Injectable()
export class TrustlessWorkService {
  private readonly logger = new Logger(TrustlessWorkService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.client = axios.create({
      baseURL: config.get<string>('TRUSTLESS_WORK_API_URL'),
      headers: {
        Authorization: `Bearer ${config.get<string>('TRUSTLESS_WORK_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  async deployEscrowContract(params: {
    escrowId: string;
    clientStellarKey: string;
    freelancerStellarKey: string;
    amount: string;
  }): Promise<DeployContractResult> {
    this.logger.log(`Deploying Stellar contract for escrow ${params.escrowId}`);
    const { data } = await this.client.post<DeployContractResult>('/escrow/deploy', params);
    return data;
  }

  async releaseEscrow(params: {
    contractId: string;
    txHash?: string;
  }): Promise<{ txHash: string }> {
    this.logger.log(`Releasing Stellar contract ${params.contractId}`);
    const { data } = await this.client.post<{ txHash: string }>('/escrow/release', params);
    return data;
  }

  async refundEscrow(params: {
    contractId: string;
  }): Promise<{ txHash: string }> {
    this.logger.log(`Refunding Stellar contract ${params.contractId}`);
    const { data } = await this.client.post<{ txHash: string }>('/escrow/refund', params);
    return data;
  }
}
