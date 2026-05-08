import { ExecutionResult, TokenUsageRecord } from '../types';

export class TokenUsageEstimator {
  toRecord(result: ExecutionResult, source: TokenUsageRecord['source'] = 'cheap'): TokenUsageRecord | undefined {
    const usage = result.usage;
    if (!usage?.inputTokens && !usage?.outputTokens) {
      return undefined;
    }

    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    return {
      source,
      providerId: result.providerId,
      model: result.model,
      inputTokens,
      outputTokens,
      totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
      cacheHitTokens: usage.cacheHitTokens,
      isApproximate: Boolean(usage.isApproximate),
      createdAt: Date.now()
    };
  }

  estimateFromText(providerId: string, model: string, inputText: string, outputText: string, source: TokenUsageRecord['source']): TokenUsageRecord {
    const inputTokens = this.estimateTokenCount(inputText);
    const outputTokens = this.estimateTokenCount(outputText);
    return {
      source,
      providerId,
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      isApproximate: true,
      createdAt: Date.now()
    };
  }

  format(record: TokenUsageRecord): string {
    const role = record.source === 'premium' ? '贵模型' : record.source === 'review' ? '中间审查模型' : '便宜模型';
    const source = record.isApproximate ? '本地估算' : '厂商用量';
    return `${role} ${source}: 输入 ${record.inputTokens} tokens + 输出 ${record.outputTokens} tokens = 共 ${record.totalTokens} tokens（${record.model}）。`;
  }

  private estimateTokenCount(value: string): number {
    return Math.max(1, Math.ceil(value.length / 4));
  }
}