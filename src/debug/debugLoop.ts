import * as vscode from 'vscode';
import { CopilotController } from '../planning/copilotController';
import { ExecutionRouter } from '../execution/executionRouter';

export class DebugLoop {
  constructor(
    private readonly controller: CopilotController,
    private readonly executionRouter: ExecutionRouter
  ) {}

  async run(userPrompt: string, requestModel: vscode.LanguageModelChat | undefined, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
    stream.progress('贵模型正在理解调试目标，并把文件/工具需求下发给便宜模型。');
    const controllerBrief = await this.controller.buildControllerBriefForPrompt();
    let directive = await this.controller.createDirective(`Debug task: ${userPrompt}`, controllerBrief, requestModel, token);
    directive = { ...directive, routeMode: 'debugLoop', requiresContextDiagnosis: true };

    stream.progress('便宜模型正在读取调试上下文并整理报告。');
    const contextReport = await this.executionRouter.createContextReport(userPrompt, directive, stream, token);
    stream.markdown(`\n\n### 便宜模型调试读取报告\n\n${this.truncateForDisplay(contextReport.result.content)}\n`);

    stream.progress('贵模型正在诊断便宜模型读取到的调试结果。');
    const contextDiagnosis = await this.controller.diagnoseWorkerContext(userPrompt, directive, contextReport.result, requestModel, token);
    const contextIssues = contextDiagnosis.issues.length > 0 ? contextDiagnosis.issues.join('；') : '未发现明显上下文问题。';
    stream.markdown(`\n\n**贵模型调试读取诊断：**${contextDiagnosis.diagnosis}（置信度：${contextDiagnosis.confidence}）。${contextIssues}`);

    stream.progress('便宜模型正在执行调试、整理证据和生成修复建议。');
    const result = await this.executionRouter.executeDirective(userPrompt, directive, stream, token, contextDiagnosis, contextReport.context);

    stream.progress('中间审查模型正在检查调试输出。');
    const reviewResult = await this.executionRouter.reviewWorkerResult(userPrompt, directive, result, token, contextDiagnosis, stream);
    if (reviewResult) {
      const reviewIssues = reviewResult.issues.length > 0 ? reviewResult.issues.join('；') : '未发现明显问题。';
      stream.markdown(`\n\n**中间审查模型：**${reviewResult.passed ? '通过' : '未通过'}（置信度：${reviewResult.confidence}）。${reviewResult.summary} ${reviewIssues}`);
    } else {
      stream.markdown('\n\n**中间审查模型：**已关闭，直接进入贵模型终检。');
    }

    stream.progress('贵模型正在进行唯一一次调试终检。');
    const judgement = await this.controller.judgeWorkerResult(userPrompt, directive, result, requestModel, token, reviewResult);
    const issues = judgement.issues.length > 0 ? judgement.issues.join('；') : (judgement.stopReason ?? '未发现明显问题。');
    stream.markdown(`\n\n**贵模型调试终检：**${judgement.passed ? '通过' : '未完全通过'}（置信度：${judgement.confidence}）。${issues}`);
  }

  private truncateForDisplay(value: string): string {
    if (value.length <= 1600) {
      return value;
    }

    return `${value.slice(0, 1200)}\n\n[读取报告过长，已截断显示]\n\n${value.slice(-300)}`;
  }
}