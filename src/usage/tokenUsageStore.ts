import * as vscode from 'vscode';
import { TokenUsageRecord, TokenUsageSnapshot } from '../types';

const STORAGE_KEY = 'modelRouter.tokenUsageSnapshot';

export class TokenUsageStore implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<TokenUsageSnapshot>();
  private snapshot: TokenUsageSnapshot;

  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly storage?: vscode.Memento) {
    this.snapshot = this.restoreSnapshot();
  }

  getSnapshot(): TokenUsageSnapshot {
    return { ...this.snapshot };
  }

  record(record: TokenUsageRecord): void {
    const isPremium = record.source === 'premium';
    const isReview = record.source === 'review';
    this.snapshot = {
      lastRecord: record,
      requestCount: this.snapshot.requestCount + 1,
      sessionInputTokens: this.snapshot.sessionInputTokens + record.inputTokens,
      sessionOutputTokens: this.snapshot.sessionOutputTokens + record.outputTokens,
      sessionTotalTokens: this.snapshot.sessionTotalTokens + record.totalTokens,
      premiumRequestCount: this.snapshot.premiumRequestCount + (isPremium ? 1 : 0),
      cheapRequestCount: this.snapshot.cheapRequestCount + (!isPremium && !isReview ? 1 : 0),
      reviewRequestCount: this.snapshot.reviewRequestCount + (isReview ? 1 : 0),
      premiumInputTokens: this.snapshot.premiumInputTokens + (isPremium ? record.inputTokens : 0),
      premiumOutputTokens: this.snapshot.premiumOutputTokens + (isPremium ? record.outputTokens : 0),
      premiumTotalTokens: this.snapshot.premiumTotalTokens + (isPremium ? record.totalTokens : 0),
      cheapInputTokens: this.snapshot.cheapInputTokens + (!isPremium && !isReview ? record.inputTokens : 0),
      cheapOutputTokens: this.snapshot.cheapOutputTokens + (!isPremium && !isReview ? record.outputTokens : 0),
      cheapTotalTokens: this.snapshot.cheapTotalTokens + (!isPremium && !isReview ? record.totalTokens : 0),
      reviewInputTokens: this.snapshot.reviewInputTokens + (isReview ? record.inputTokens : 0),
      reviewOutputTokens: this.snapshot.reviewOutputTokens + (isReview ? record.outputTokens : 0),
      reviewTotalTokens: this.snapshot.reviewTotalTokens + (isReview ? record.totalTokens : 0),
      sessionCacheHitTokens: (this.snapshot.sessionCacheHitTokens ?? 0) + (record.cacheHitTokens ?? 0),
      updatedAt: record.createdAt
    };
    void this.persistSnapshot();
    this.onDidChangeEmitter.fire(this.getSnapshot());
  }

  reset(): void {
    this.snapshot = this.createEmptySnapshot(Date.now());
    void this.persistSnapshot();
    this.onDidChangeEmitter.fire(this.getSnapshot());
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }

  private restoreSnapshot(): TokenUsageSnapshot {
    const stored = this.storage?.get<TokenUsageSnapshot>(STORAGE_KEY);
    if (!stored) {
      return this.createEmptySnapshot();
    }

    return {
      ...this.createEmptySnapshot(),
      ...stored
    };
  }

  private createEmptySnapshot(updatedAt?: number): TokenUsageSnapshot {
    return {
      requestCount: 0,
      sessionInputTokens: 0,
      sessionOutputTokens: 0,
      sessionTotalTokens: 0,
      premiumRequestCount: 0,
      cheapRequestCount: 0,
      reviewRequestCount: 0,
      premiumInputTokens: 0,
      premiumOutputTokens: 0,
      premiumTotalTokens: 0,
      cheapInputTokens: 0,
      cheapOutputTokens: 0,
      cheapTotalTokens: 0,
      reviewInputTokens: 0,
      reviewOutputTokens: 0,
      reviewTotalTokens: 0,
      sessionCacheHitTokens: 0,
      updatedAt
    };
  }

  private async persistSnapshot(): Promise<void> {
    await this.storage?.update(STORAGE_KEY, this.snapshot);
  }
}