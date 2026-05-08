import * as vscode from 'vscode';
import { ContextCollector } from '../context/contextCollector';
import { ContextDiagnosis, ControllerDirective, ExecutionResult, JudgeResult, ModelInfo, ReviewResult } from '../types';
import { ProviderRegistry } from '../execution/providers/providerRegistry';
import { SecretStore } from '../storage/secretStore';
import { SettingsStore } from '../storage/settingsStore';
import { TokenUsageEstimator } from '../usage/tokenUsageEstimator';
import { TokenUsageStore } from '../usage/tokenUsageStore';
import { extractJsonObject, normalizeContextDiagnosis, normalizeDirective, normalizeJudgeResult } from './controlSchemas';

export class CopilotController {
  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretStore,
    private readonly providers: ProviderRegistry,
    private readonly contextCollector: ContextCollector,
    private readonly tokenUsageEstimator: TokenUsageEstimator,
    private readonly tokenUsageStore: TokenUsageStore
  ) {}

  async listAvailableModels(): Promise<ModelInfo[]> {
    const models = await vscode.lm.selectChatModels();
    return models.map((model) => {
      const typed = model as vscode.LanguageModelChat & Partial<ModelInfo>;
      return {
        id: model.id,
        name: typed.name ?? model.id,
        vendor: typed.vendor,
        family: typed.family,
        maxInputTokens: typed.maxInputTokens
      };
    });
  }

  async createDirective(userPrompt: string, controllerEnvironment: string, requestModel: vscode.LanguageModelChat | undefined, token: vscode.CancellationToken): Promise<ControllerDirective> {
    const model = await this.selectPlannerModel(requestModel);
    const budget = this.settings.tokenBudget;
    const prompt = this.truncate(`
You are the premium controller for a hybrid VS Code model router.
Spend as few tokens as possible. Do not solve or generate code.
Your only job is to understand the user's request and tell the cheap worker what files/tools to inspect and what result must satisfy the user.
You cannot inspect project files, read diagnostics, search the workspace, or run terminal commands for yourself.
If the task needs project files or tool results, encode that need in filesToInspect, toolsToUse, and workerInstruction so the cheap worker does it.
All implementation, debugging, rewriting, explanation, and long output must be done by the cheap worker.
Return compact JSON only. Max output ${budget.expensiveOutputChars} chars.

Schema:
{
  "intent":"short goal",
  "routeMode":"fast|balanced|longContext|debugLoop",
  "filesToInspect":["workspace/relative/path"],
  "toolsToUse":[{"kind":"activeFile|selection|diagnostics|workspaceFile|workspaceSearch|terminalCommand","target":"optional","reason":"short","requiresApproval":true}],
  "requiresContextDiagnosis":true,
  "workerInstruction":"direct instruction for cheap model",
  "acceptanceCriteria":["short checks"],
  "judgeChecklist":["short checks for the premium judge"],
  "maxCheapIterations":${this.settings.maxCheapIterations}
}

Rules:
- Prefer activeFile, selection, diagnostics, workspaceFile, workspaceSearch.
- Terminal commands are proposals only and require approval.
- Do not ask for full file contents unless needed.
- Keep workerInstruction clear enough for the cheap model to act without more premium tokens.
- Do not include implementation details beyond constraints and acceptance criteria.
- Treat the environment below as orientation only. It is not project evidence.
- Never request extra file/tool context for the premium model; route every such need to the cheap worker.
- Set requiresContextDiagnosis to false only for low-risk, direct tasks where the cheap worker can likely finish from the provided context without a premium diagnosis pass.
- Keep requiresContextDiagnosis true for multi-file work, ambiguous requirements, debug-like tasks, risky edits, diagnostics-heavy tasks, or when tool/file evidence still needs premium judgement.

User request:
${userPrompt}

Minimal controller environment:
${controllerEnvironment}
`, budget.expensiveInputChars);

    const raw = await this.sendJsonRequest(model, prompt, token);
    return normalizeDirective(extractJsonObject(raw), userPrompt, budget, this.settings.maxCheapIterations);
  }

  async diagnoseWorkerContext(userPrompt: string, directive: ControllerDirective, contextReport: ExecutionResult, requestModel: vscode.LanguageModelChat | undefined, token: vscode.CancellationToken): Promise<ContextDiagnosis> {
    const model = await this.selectPlannerModel(requestModel);
    const budget = this.settings.tokenBudget;
    const prompt = this.truncate(`
You are the premium context diagnostician for a hybrid VS Code model router.
Spend as few tokens as possible. Do not solve the task, generate code, rewrite the answer, inspect files, search the workspace, read diagnostics, or run tools.
Your only job is to diagnose the cheap worker's context-reading report and decide whether it collected enough evidence for the cheap worker to proceed.
If more context is needed, describe the missing context as instructions for the cheap worker only. Never ask for raw files or tool output for yourself.
Return compact JSON only. Max output ${budget.expensiveOutputChars} chars.

Schema:
{"proceed":true,"confidence":"low|medium|high","diagnosis":"short","issues":["short"],"missingContext":["short"],"workerInstructionPatch":"short optional","acceptanceCriteria":["short optional"],"requiresFinalReview":true}

Rules:
- Set requiresFinalReview to false only when the task is routine, the collected context is sufficient, and the cheap worker can likely finish without another premium-model pass.
- Set requiresFinalReview to true for risky edits, ambiguous requirements, debug-like situations, missing context, or when final acceptance still needs premium judgement.

User request:
${userPrompt}

Original worker plan:
${JSON.stringify({
  intent: directive.intent,
  filesToInspect: directive.filesToInspect,
  toolsToUse: directive.toolsToUse,
  workerInstruction: directive.workerInstruction,
  acceptanceCriteria: directive.acceptanceCriteria
})}

Cheap worker context-reading report:
${this.summarizeWorkerOutput(contextReport.content)}
`, budget.expensiveInputChars);

    const raw = await this.sendJsonRequest(model, prompt, token);
    return normalizeContextDiagnosis(extractJsonObject(raw));
  }

  async judgeWorkerResult(userPrompt: string, directive: ControllerDirective, result: ExecutionResult, requestModel: vscode.LanguageModelChat | undefined, token: vscode.CancellationToken, reviewResult?: ReviewResult): Promise<JudgeResult> {
    const model = await this.selectPlannerModel(requestModel);
    const budget = this.settings.tokenBudget;
    const prompt = this.truncate(`
You are the premium judge for a hybrid VS Code model router.
Spend as few tokens as possible. Do not rewrite the answer.
This is the final inspection only. Judge whether the cheap worker satisfied the user request.
Do not generate code, do not rewrite the answer, and do not start another premium-model planning round.
Return compact JSON only. Max output ${budget.expensiveOutputChars} chars.

Schema:
{"passed":true,"confidence":"low|medium|high","issues":["short"],"nextInstruction":"short instruction for cheap worker","stopReason":"optional"}

User request:
${userPrompt}

Acceptance criteria:
${JSON.stringify(directive.acceptanceCriteria)}

Judge checklist:
${JSON.stringify(directive.judgeChecklist)}

Intermediate reviewer result:
${reviewResult ? JSON.stringify(reviewResult) : 'No intermediate reviewer was used.'}

Cheap worker model: ${result.providerId}/${result.model}
Cheap worker output summary:
${this.summarizeWorkerOutput(result.content)}
`, budget.expensiveInputChars);

    const raw = await this.sendJsonRequest(model, prompt, token);
    return normalizeJudgeResult(extractJsonObject(raw));
  }

  async buildControllerBriefForPrompt(): Promise<string> {
    return this.contextCollector.summarizeControllerEnvironment(this.settings.tokenBudget.expensiveInputChars);
  }

  private async selectPlannerModel(requestModel: vscode.LanguageModelChat | undefined): Promise<PlannerTarget> {
    const premiumModel = this.settings.premiumModel;

    if (this.settings.valueModeEnabled && requestModel) {
      return { kind: 'copilot', model: requestModel };
    }

    if (premiumModel.followCurrentChatModel && requestModel) {
      return { kind: 'copilot', model: requestModel };
    }

    if (premiumModel.source === 'thirdParty') {
      const provider = this.settings.getProvider(premiumModel.thirdPartyProviderId);
      const apiKey = await this.secrets.getApiKey(provider.id);
      if (!apiKey) {
        throw new Error(`尚未配置 ${provider.displayName} 的 API Key。请先为第三方贵模型配置密钥。`);
      }

      return {
        kind: 'thirdParty',
        provider,
        apiKey,
        model: premiumModel.thirdPartyModel || provider.fallbackModel || provider.defaultModel
      };
    }

    const configuredModelId = premiumModel.copilotModelId;
    const models = await vscode.lm.selectChatModels();
    if (configuredModelId) {
      const configured = models.find((item) => item.id === configuredModelId);
      if (configured) {
        return { kind: 'copilot', model: configured };
      }
    }

    if (requestModel) {
      return { kind: 'copilot', model: requestModel };
    }

    const first = models[0];
    if (!first) {
      throw new Error('当前没有可用的 VS Code 语言模型，无法执行贵模型需求理解。');
    }

    return { kind: 'copilot', model: first };
  }

  private async sendJsonRequest(target: PlannerTarget, prompt: string, token: vscode.CancellationToken): Promise<string> {
    if (target.kind === 'copilot') {
      const response = await target.model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
      let content = '';
      for await (const chunk of response.text) {
        content += chunk;
        if (content.length > this.settings.tokenBudget.expensiveOutputChars * 3) {
          break;
        }
      }

      if (this.settings.tokenStatsEnabled) {
        const record = this.tokenUsageEstimator.estimateFromText('copilot', target.model.id, prompt, content, 'premium');
        this.tokenUsageStore.record(record);
      }

      return content;
    }

    const provider = this.providers.create(target.provider);
    let content = '';
    let usage: ExecutionResult['usage'];

    for await (const chunk of provider.sendChat({
      provider: target.provider,
      apiKey: target.apiKey,
      model: target.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    }, token)) {
      content += chunk.content;
      usage = chunk.usage ?? usage;
    }

    if (this.settings.tokenStatsEnabled) {
      const result: ExecutionResult = {
        content,
        model: target.model,
        providerId: target.provider.id,
        usage
      };
      const record = this.tokenUsageEstimator.toRecord(result, 'premium')
        ?? this.tokenUsageEstimator.estimateFromText(target.provider.id, target.model, prompt, content, 'premium');
      this.tokenUsageStore.record(record);
    }

    return content;
  }

  private summarizeWorkerOutput(content: string): string {
    if (content.length <= 1800) {
      return content;
    }

    return `${content.slice(0, 900)}\n[output truncated for premium judge]\n${content.slice(-900)}`;
  }

  private truncate(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
      return value;
    }

    return `${value.slice(0, maxChars)}\n[truncated]`;
  }
}

type PlannerTarget =
  | { kind: 'copilot'; model: vscode.LanguageModelChat }
  | { kind: 'thirdParty'; provider: ReturnType<SettingsStore['getProvider']>; apiKey: string; model: string };