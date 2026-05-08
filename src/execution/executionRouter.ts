import * as vscode from 'vscode';
import { ContextCollector } from '../context/contextCollector';
import { SecretStore } from '../storage/secretStore';
import { SettingsStore } from '../storage/settingsStore';
import { ContextDiagnosis, ContextSnapshot, ControllerDirective, ExecutionMessage, ExecutionResult, ProviderSettings, ReviewResult, TokenUsageRecord, WorkerContextReport } from '../types';
import { TokenUsageEstimator } from '../usage/tokenUsageEstimator';
import { TokenUsageStore } from '../usage/tokenUsageStore';
import { ProviderRegistry } from './providers/providerRegistry';
import { extractJsonObject, normalizeReviewResult } from '../planning/controlSchemas';

export class ExecutionRouter {
  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretStore,
    private readonly providers: ProviderRegistry,
    private readonly contextCollector: ContextCollector,
    private readonly tokenUsageEstimator: TokenUsageEstimator,
    private readonly tokenUsageStore: TokenUsageStore
  ) {}

  async createContextReport(userPrompt: string, directive: ControllerDirective, stream: vscode.ChatResponseStream | undefined, token: vscode.CancellationToken): Promise<WorkerContextReport> {
    const providerSettings = this.settings.getProvider();
    const apiKey = await this.secrets.getApiKey(providerSettings.id);
    if (!apiKey) {
      throw new Error(`尚未配置 ${providerSettings.displayName} 的 API Key。请先运行“模型路由器：设置执行模型 API Key”。`);
    }

    const directedContext = await this.contextCollector.collectForDirective(directive);
    const primaryModel = this.pickModel(directive, providerSettings, false);
    const messages = this.buildContextReportMessages(userPrompt, directive, directedContext);

    try {
      const result = await this.executeMessages(providerSettings, apiKey, primaryModel, messages, stream, token, {
        progress: `${providerSettings.displayName} / ${primaryModel} 正在读取上下文并整理诊断报告。`,
        renderOutput: false,
        showTokenUsage: false,
        usageSource: 'cheap'
      });
      return { result, context: directedContext };
    } catch (error) {
      const fallbackModel = this.pickModel(directive, providerSettings, true);
      if (!fallbackModel || fallbackModel === primaryModel) {
        throw error;
      }

      stream?.progress(`廉价执行模型 ${primaryModel} 读取上下文失败，正在升级为 ${fallbackModel} 重试。`);
      const result = await this.executeMessages(providerSettings, apiKey, fallbackModel, messages, stream, token, {
        progress: `${providerSettings.displayName} / ${fallbackModel} 正在读取上下文并整理诊断报告。`,
        renderOutput: false,
        showTokenUsage: false,
        usageSource: 'cheap'
      });
      return { result, context: directedContext };
    }
  }

  async executeDirective(
    userPrompt: string,
    directive: ControllerDirective,
    stream: vscode.ChatResponseStream | undefined,
    token: vscode.CancellationToken,
    contextDiagnosis?: ContextDiagnosis,
    contextOverride?: ContextSnapshot
  ): Promise<ExecutionResult> {
    const providerSettings = this.settings.getProvider();
    const apiKey = await this.secrets.getApiKey(providerSettings.id);
    if (!apiKey) {
      throw new Error(`尚未配置 ${providerSettings.displayName} 的 API Key。请先运行“模型路由器：设置执行模型 API Key”。`);
    }

    const directedContext = contextOverride ?? await this.contextCollector.collectForDirective(directive);
    const primaryModel = this.pickModel(directive, providerSettings, false);

    try {
      return await this.executeWithModel(userPrompt, directive, directedContext, contextDiagnosis, providerSettings, apiKey, primaryModel, stream, token);
    } catch (error) {
      const fallbackModel = this.pickModel(directive, providerSettings, true);
      if (!fallbackModel || fallbackModel === primaryModel) {
        throw error;
      }

      stream?.progress(`廉价执行模型 ${primaryModel} 调用失败，正在升级为 ${fallbackModel} 重试。`);
      return this.executeWithModel(userPrompt, directive, directedContext, contextDiagnosis, providerSettings, apiKey, fallbackModel, stream, token);
    }
  }

  async testProvider(providerSettings: ProviderSettings, model: string, token: vscode.CancellationToken): Promise<void> {
    const apiKey = await this.secrets.getApiKey(providerSettings.id);
    if (!apiKey) {
      throw new Error(`尚未配置 ${providerSettings.displayName} 的 API Key。`);
    }

    const provider = this.providers.create(providerSettings);
    await provider.validateConfig({
      provider: providerSettings,
      apiKey,
      model,
      messages: []
    }, token);
  }

  async reviewWorkerResult(
    userPrompt: string,
    directive: ControllerDirective,
    result: ExecutionResult,
    token: vscode.CancellationToken,
    contextDiagnosis?: ContextDiagnosis,
    stream?: vscode.ChatResponseStream
  ): Promise<ReviewResult | undefined> {
    const reviewModel = this.settings.reviewModel;
    if (!reviewModel.enabled) {
      return undefined;
    }

    const providerSettings = this.settings.getProvider(reviewModel.providerId);
    const apiKey = await this.secrets.getApiKey(providerSettings.id);
    if (!apiKey) {
      throw new Error(`尚未配置 ${providerSettings.displayName} 的 API Key。请先为中间审查模型配置密钥。`);
    }

    const model = reviewModel.model || providerSettings.fallbackModel || providerSettings.defaultModel;
    const messages = this.buildReviewMessages(userPrompt, directive, result, contextDiagnosis);
    const reviewExecution = await this.executeMessages(providerSettings, apiKey, model, messages, stream, token, {
      progress: `${providerSettings.displayName} / ${model} 正在审查便宜模型输出是否满足贵模型要求。`,
      renderOutput: false,
      showTokenUsage: false,
      usageSource: 'review'
    });

    try {
      return normalizeReviewResult(extractJsonObject(reviewExecution.content));
    } catch {
      return normalizeReviewResult({
        passed: false,
        confidence: 'low',
        summary: '中间审查模型未返回有效 JSON，已按未通过处理。',
        issues: ['审查模型输出无法解析。'],
        recommendedNextStep: '重新检查便宜模型输出与验收标准。'
      });
    }
  }

  private async executeWithModel(
    userPrompt: string,
    directive: ControllerDirective,
    context: ContextSnapshot,
    contextDiagnosis: ContextDiagnosis | undefined,
    providerSettings: ProviderSettings,
    apiKey: string,
    model: string,
    stream: vscode.ChatResponseStream | undefined,
    token: vscode.CancellationToken
  ): Promise<ExecutionResult> {
    const messages = this.buildWorkerMessages(userPrompt, directive, context, contextDiagnosis);
    return this.executeMessages(providerSettings, apiKey, model, messages, stream, token, {
      progress: `${providerSettings.displayName} / ${model} 正在执行贵模型诊断后的最终指令。`,
      renderOutput: true,
      showTokenUsage: true,
      usageSource: 'cheap'
    });
  }

  private async executeMessages(
    providerSettings: ProviderSettings,
    apiKey: string,
    model: string,
    messages: ExecutionMessage[],
    stream: vscode.ChatResponseStream | undefined,
    token: vscode.CancellationToken,
    options: { progress: string; renderOutput: boolean; showTokenUsage: boolean; usageSource: TokenUsageRecord['source'] }
  ): Promise<ExecutionResult> {
    const provider = this.providers.create(providerSettings);
    let content = '';
    let usage: ExecutionResult['usage'];

    stream?.progress(options.progress);
    for await (const chunk of provider.sendChat({ provider: providerSettings, apiKey, model, messages }, token)) {
      content += chunk.content;
      usage = chunk.usage ?? usage;
      if (options.renderOutput) {
        stream?.markdown(chunk.content);
      }
    }

    const result: ExecutionResult = {
      content,
      model,
      providerId: providerSettings.id,
      usage: usage ?? this.estimateUsage(messages, content)
    };

    const tokenUsage = this.settings.tokenStatsEnabled ? this.tokenUsageEstimator.toRecord(result, options.usageSource) : undefined;
    if (tokenUsage) {
      this.tokenUsageStore.record(tokenUsage);
      if (options.showTokenUsage) {
        stream?.markdown(`\n\n> ${this.tokenUsageEstimator.format(tokenUsage)}\n`);
      }
    }

    return result;
  }

  private buildContextReportMessages(userPrompt: string, directive: ControllerDirective, context: ContextSnapshot): ExecutionMessage[] {
    return [
      {
        role: 'system',
        content: '你是混合模型路由器中的便宜模型上下文读取员。你负责按照贵模型的文件/工具计划读取已提供的上下文、诊断和片段，并输出给贵模型诊断用的简洁报告。不要生成最终代码、补丁或长解释；只报告已读到的事实、相关证据、缺失信息、风险和建议的最终执行重点。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          originalUserRequest: userPrompt,
          controllerInstruction: directive.workerInstruction,
          filesToInspect: directive.filesToInspect,
          workerToolPlan: directive.toolsToUse,
          collectedContext: {
            activeFile: context.activeFile,
            activeLanguage: context.activeLanguage,
            diagnostics: context.diagnostics,
            snippets: context.snippets
          },
          requiredReportShape: {
            findings: '与用户请求直接相关的事实和证据',
            gaps: '尚缺的最小文件或工具结果',
            risks: '执行时必须避免的问题',
            suggestedFinalFocus: '最终执行模型应重点完成的事项'
          }
        })
      }
    ];
  }

  private buildWorkerMessages(userPrompt: string, directive: ControllerDirective, context: ContextSnapshot, contextDiagnosis: ContextDiagnosis | undefined): ExecutionMessage[] {
    const combinedAcceptanceCriteria = contextDiagnosis?.acceptanceCriteria.length
      ? [...directive.acceptanceCriteria, ...contextDiagnosis.acceptanceCriteria]
      : directive.acceptanceCriteria;
    const combinedInstruction = [
      directive.workerInstruction,
      contextDiagnosis?.workerInstructionPatch ? `贵模型对读取结果的诊断补充：${contextDiagnosis.workerInstructionPatch}` : undefined,
      contextDiagnosis && !contextDiagnosis.proceed ? `贵模型认为上下文仍可能不足；优先处理缺失项：${contextDiagnosis.missingContext.join('；')}` : undefined
    ].filter((item): item is string => Boolean(item)).join('\n');

    return [
      {
        role: 'system',
        content: '你是混合模型路由器中的便宜执行模型。贵模型只负责理解需求、给出约束、列出文件/工具计划、诊断你读取到的上下文报告和最终检查；你负责按照这些计划完成实际分析、上下文综合、实现、改写、解释、调试证据整理和自检。当前请求中已由扩展收集的上下文和工具结果会放在 collectedContext；如果仍然信息不足，只说明还缺少的最小文件或工具结果。输出最终代码、补丁、调试报告或答案前，先自行检查是否满足验收标准。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          originalUserRequest: userPrompt,
          controllerInstruction: combinedInstruction,
          acceptanceCriteria: combinedAcceptanceCriteria,
          premiumContextDiagnosis: contextDiagnosis,
          filesToInspect: directive.filesToInspect,
          workerToolPlan: directive.toolsToUse,
          collectedContext: {
            activeFile: context.activeFile,
            activeLanguage: context.activeLanguage,
            diagnostics: context.diagnostics,
            snippets: context.snippets
          }
        })
      }
    ];
  }

  private buildReviewMessages(
    userPrompt: string,
    directive: ControllerDirective,
    result: ExecutionResult,
    contextDiagnosis: ContextDiagnosis | undefined
  ): ExecutionMessage[] {
    return [
      {
        role: 'system',
        content: '你是混合模型路由器中的中间审查模型。你的任务是检查便宜执行模型的输出是否满足贵模型提出的要求。不要重写答案，不要生成新实现，不要输出长解释。只输出紧凑 JSON。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          originalUserRequest: userPrompt,
          acceptanceCriteria: directive.acceptanceCriteria,
          judgeChecklist: directive.judgeChecklist,
          contextDiagnosis,
          cheapWorker: {
            providerId: result.providerId,
            model: result.model,
            output: result.content
          },
          requiredSchema: {
            passed: true,
            confidence: 'low|medium|high',
            summary: 'short summary',
            issues: ['short issue'],
            recommendedNextStep: 'short next step'
          }
        })
      }
    ];
  }

  private pickModel(directive: ControllerDirective, provider: ProviderSettings, fallback: boolean): string {
    if (fallback) {
      return provider.fallbackModel ?? this.settings.fallbackExecutionModel;
    }

    if (directive.routeMode === 'fast') {
      return this.settings.defaultExecutionModel;
    }

    if (directive.routeMode === 'longContext' && provider.id === 'kimi') {
      return provider.defaultModel;
    }

    return provider.defaultModel || this.settings.defaultExecutionModel;
  }

  private estimateUsage(messages: ExecutionMessage[], content: string): ExecutionResult['usage'] {
    const inputText = messages.map((message) => message.content).join('\n');
    const inputTokens = this.estimateTokenCount(inputText);
    const outputTokens = this.estimateTokenCount(content);
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      isApproximate: true
    };
  }

  private estimateTokenCount(value: string): number {
    return Math.max(1, Math.ceil(value.length / 4));
  }
}