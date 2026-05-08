import * as vscode from 'vscode';
import { ExecutionChunk, ExecutionProvider, ExecutionRequest, ExecutionUsage } from '../../types';

export class OpenAiCompatibleProvider implements ExecutionProvider {
  constructor(
    readonly id: string,
    readonly displayName: string
  ) {}

  async *sendChat(request: ExecutionRequest, token: vscode.CancellationToken): AsyncIterable<ExecutionChunk> {
    const response = await this.fetchChatCompletion(request, token);
    const json = await response.json() as OpenAiChatResponse;
    const content = json.choices?.[0]?.message?.content ?? '';
    yield {
      content,
      usage: normalizeUsage(json.usage)
    };
  }

  async validateConfig(request: ExecutionRequest, token: vscode.CancellationToken): Promise<void> {
    const validationRequest: ExecutionRequest = {
      ...request,
      messages: [
        { role: 'system', content: 'Return exactly ok.' },
        { role: 'user', content: 'ping' }
      ],
      temperature: 0
    };

    await this.fetchChatCompletion(validationRequest, token);
  }

  private async fetchChatCompletion(request: ExecutionRequest, token: vscode.CancellationToken): Promise<Response> {
    const controller = new AbortController();
    const disposable = token.onCancellationRequested(() => controller.abort());
    try {
      const response = await fetch(`${request.provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${request.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          stream: false
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${this.displayName} request failed (${response.status}): ${sanitizeProviderError(body)}`);
      }

      return response;
    } finally {
      disposable.dispose();
    }
  }
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
  };
}

function normalizeUsage(usage: OpenAiChatResponse['usage']): ExecutionUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cacheHitTokens: usage.prompt_cache_hit_tokens
  };
}

function sanitizeProviderError(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}