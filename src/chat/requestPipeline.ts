import * as vscode from 'vscode';
import { CopilotController } from '../planning/copilotController';
import { ExecutionRouter } from '../execution/executionRouter';
import { DebugLoop } from '../debug/debugLoop';
import { ContextDiagnosis, ControllerDirective, ReviewResult } from '../types';
import { SettingsStore } from '../storage/settingsStore';

export class RequestPipeline {
  constructor(
    private readonly controller: CopilotController,
    private readonly executionRouter: ExecutionRouter,
    private readonly debugLoop: DebugLoop,
    private readonly settings: SettingsStore
  ) {}

  async handle(request: vscode.ChatRequest, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
    if (request.command === 'valueMode') {
      await this.settings.updatePremiumModelSource('copilot');
      await this.settings.updateValueModeEnabled(true);
      await this.settings.updatePlannerModelId(request.model.id);
      await this.settings.updateFollowCurrentChatModel(true);
      stream.markdown(`已启用性价比模式。贵模型将跟随当前 Copilot 模型 **${this.getModelLabel(request.model)}**，但只负责需求理解、读取结果诊断和最终检查；生成、改写和调试执行均由便宜模型完成。`);
      return;
    }

    if (request.command === 'useCurrentModel') {
      await this.settings.updatePremiumModelSource('copilot');
      await this.settings.updatePlannerModelId(request.model.id);
      await this.settings.updateValueModeEnabled(true);
      await this.settings.updateFollowCurrentChatModel(true);
      stream.markdown(`贵模型已切换为当前 Copilot 模型：**${this.getModelLabel(request.model)}**。性价比模式保持开启。`);
      return;
    }

    this.renderCurrentModelOption(request, stream);

    if (request.command === 'debug') {
      await this.debugLoop.run(request.prompt, request.model, stream, token);
      return;
    }

    stream.progress('贵模型正在低 token 理解需求，并把文件/工具需求下发给便宜模型。');
    const controllerBrief = await this.controller.buildControllerBriefForPrompt();
    const directive = await this.controller.createDirective(request.prompt, controllerBrief, request.model, token);
    stream.markdown(this.renderDirective(directive));

    let contextDiagnosis: ContextDiagnosis | undefined;
    let contextOverride = undefined;
    if (directive.requiresContextDiagnosis) {
      stream.progress('便宜模型正在按贵模型计划读取上下文并整理报告。');
      const contextReport = await this.executionRouter.createContextReport(request.prompt, directive, stream, token);
      stream.markdown(`\n\n### 便宜模型读取报告\n\n${this.truncateForDisplay(contextReport.result.content)}\n`);

      stream.progress('贵模型正在诊断便宜模型读取结果。');
      contextDiagnosis = await this.controller.diagnoseWorkerContext(request.prompt, directive, contextReport.result, request.model, token);
      stream.markdown(this.renderContextDiagnosis(contextDiagnosis));
      contextOverride = contextReport.context;
    } else {
      stream.markdown('\n\n**贵模型读取结果诊断：**规划阶段已判定为低风险任务，跳过本轮读取结果诊断，便宜模型直接执行。');
    }

    stream.markdown('\n\n### 便宜模型最终执行\n\n');
    const result = await this.executionRouter.executeDirective(request.prompt, directive, stream, token, contextDiagnosis, contextOverride);

    let reviewResult: ReviewResult | undefined;
    if (this.settings.reviewModel.enabled) {
      stream.progress('中间审查模型正在检查便宜模型输出。');
      reviewResult = await this.executionRouter.reviewWorkerResult(request.prompt, directive, result, token, contextDiagnosis, stream);
      if (reviewResult) {
        stream.markdown(this.renderReviewResult(reviewResult));
      }
    } else {
      stream.markdown('\n\n**中间审查模型：**已关闭，直接进入贵模型终检或结束。');
    }

    if (this.shouldRunFinalReview(contextDiagnosis)) {
      stream.progress('贵模型正在进行唯一一次终检。');
      const judgement = await this.controller.judgeWorkerResult(request.prompt, directive, result, request.model, token, reviewResult);
      const issues = judgement.issues.length > 0 ? judgement.issues.join('；') : '未发现明显问题。';
      stream.markdown(`\n\n**贵模型终检：**${judgement.passed ? '通过' : '未完全通过'}（置信度：${judgement.confidence}）。${issues}`);
    } else {
      stream.markdown('\n\n**贵模型终检：**已按读取结果诊断自动跳过，本轮交由便宜模型直接完成。');
    }
  }

  private renderDirective(directive: ControllerDirective): string {
    const files = directive.filesToInspect.length > 0 ? directive.filesToInspect.join(', ') : '由便宜模型根据当前上下文判断';
    return [
      '### 贵模型执行指令',
      '',
      `- 需求意图：${directive.intent}`,
      `- 路由模式：${directive.routeMode}`,
      `- 读取结果诊断：${directive.requiresContextDiagnosis ? '需要' : '跳过'}`,
      `- 文件/工具：${files}`,
      `- 便宜模型指令：${directive.workerInstruction}`,
      ''
    ].join('\n');
  }

  private renderContextDiagnosis(diagnosis: { confidence: string; diagnosis: string; issues: string[]; missingContext: string[] }): string {
    const issues = diagnosis.issues.length > 0 ? diagnosis.issues.join('；') : '未发现明显上下文问题。';
    const missing = diagnosis.missingContext.length > 0 ? `缺失上下文：${diagnosis.missingContext.join('；')}。` : '';
    return `\n\n**贵模型读取结果诊断：**${diagnosis.diagnosis}（置信度：${diagnosis.confidence}）。${issues}${missing}`;
  }

  private renderReviewResult(reviewResult: ReviewResult): string {
    const issues = reviewResult.issues.length > 0 ? reviewResult.issues.join('；') : '未发现明显问题。';
    const nextStep = reviewResult.recommendedNextStep ? `下一步：${reviewResult.recommendedNextStep}` : '';
    return `\n\n**中间审查模型：**${reviewResult.passed ? '通过' : '未通过'}（置信度：${reviewResult.confidence}）。${reviewResult.summary} ${issues} ${nextStep}`.trimEnd();
  }

  private shouldRunFinalReview(diagnosis?: { requiresFinalReview?: boolean }): boolean {
    return this.settings.finalReviewEnabled && (diagnosis?.requiresFinalReview !== false);
  }

  private renderCurrentModelOption(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): void {
    const label = this.getModelLabel(request.model);
    const executionProvider = this.settings.getProvider();
    const mode = this.settings.valueModeEnabled
      ? '性价比模式：贵模型跟随当前 Copilot 模型，便宜模型执行'
      : this.settings.premiumModel.source === 'thirdParty'
        ? `第三方贵模型：${this.settings.premiumModel.thirdPartyProviderId}/${this.settings.premiumModel.thirdPartyModel}`
        : this.settings.followCurrentChatModel ? '跟随当前 Copilot 模型' : '固定/自动选择贵模型';
    stream.markdown(`当前请求入口：**@model-router**。路由模式：**${mode}**。当前 Copilot 模型：**${label}**。便宜执行模型：**${executionProvider.displayName} / ${executionProvider.defaultModel}**。`);
    if (!this.settings.valueModeEnabled) {
      stream.button({
        command: 'modelRouter.enableValueMode',
        title: '启用性价比模式'
      });
    }
    stream.button({
      command: 'modelRouter.openRoutedChat',
      title: '继续在 @model-router 中提问'
    });
    stream.button({
      command: 'modelRouter.useChatModelAsPlanner',
      title: '贵模型跟随当前模型',
      arguments: [request.model.id, label]
    });
    stream.markdown('\n\n');
  }

  private getModelLabel(model: vscode.LanguageModelChat): string {
    const metadata = model as vscode.LanguageModelChat & { name?: string };
    return metadata.name ? `${metadata.name} (${model.id})` : model.id;
  }

  private truncateForDisplay(value: string): string {
    if (value.length <= 1600) {
      return value;
    }

    return `${value.slice(0, 1200)}\n\n[读取报告过长，已截断显示]\n\n${value.slice(-300)}`;
  }

}