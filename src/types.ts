import * as vscode from 'vscode';

export type RouteMode = 'fast' | 'balanced' | 'longContext' | 'debugLoop';

export type PremiumModelSource = 'copilot' | 'thirdParty';

export interface ProviderSettings {
  id: string;
  displayName: string;
  baseUrl: string;
  defaultModel: string;
  fallbackModel?: string;
  enabled: boolean;
}

export interface ThirdPartyModelSelection {
  providerId: string;
  model: string;
}

export interface PremiumModelConfig {
  source: PremiumModelSource;
  copilotModelId: string;
  thirdPartyProviderId: string;
  thirdPartyModel: string;
  followCurrentChatModel: boolean;
}

export interface ReviewModelConfig {
  enabled: boolean;
  providerId: string;
  model: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  vendor?: string;
  family?: string;
  maxInputTokens?: number;
}

export interface TokenBudget {
  expensiveInputChars: number;
  expensiveOutputChars: number;
  cheapContextChars: number;
}

export interface ToolDirective {
  kind: 'activeFile' | 'selection' | 'diagnostics' | 'workspaceFile' | 'workspaceSearch' | 'terminalCommand';
  target?: string;
  reason: string;
  requiresApproval?: boolean;
}

export interface ControllerDirective {
  intent: string;
  routeMode: RouteMode;
  filesToInspect: string[];
  toolsToUse: ToolDirective[];
  requiresContextDiagnosis: boolean;
  workerInstruction: string;
  acceptanceCriteria: string[];
  judgeChecklist: string[];
  maxCheapIterations: number;
  tokenBudget: TokenBudget;
}

export interface JudgeResult {
  passed: boolean;
  confidence: 'low' | 'medium' | 'high';
  issues: string[];
  nextInstruction?: string;
  stopReason?: string;
}

export interface ContextDiagnosis {
  proceed: boolean;
  confidence: 'low' | 'medium' | 'high';
  diagnosis: string;
  issues: string[];
  missingContext: string[];
  workerInstructionPatch?: string;
  acceptanceCriteria: string[];
  requiresFinalReview: boolean;
}

export interface DiagnosticSummary {
  file: string;
  severity: string;
  message: string;
  line: number;
}

export interface ContextSnippet {
  label: string;
  path?: string;
  content: string;
}

export interface ContextSnapshot {
  workspaceFolders: string[];
  activeFile?: string;
  activeLanguage?: string;
  selection?: string;
  fileManifest: string[];
  diagnostics: DiagnosticSummary[];
  snippets: ContextSnippet[];
}

export interface ExecutionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheHitTokens?: number;
  isApproximate?: boolean;
}

export interface ExecutionResult {
  content: string;
  model: string;
  providerId: string;
  usage?: ExecutionUsage;
  reviewerSummary?: string;
}

export interface TokenUsageRecord {
  source: 'premium' | 'cheap' | 'review';
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitTokens?: number;
  isApproximate: boolean;
  createdAt: number;
}

export interface TokenUsageSnapshot {
  lastRecord?: TokenUsageRecord;
  requestCount: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionTotalTokens: number;
  premiumRequestCount: number;
  cheapRequestCount: number;
  reviewRequestCount: number;
  premiumInputTokens: number;
  premiumOutputTokens: number;
  premiumTotalTokens: number;
  cheapInputTokens: number;
  cheapOutputTokens: number;
  cheapTotalTokens: number;
  reviewInputTokens: number;
  reviewOutputTokens: number;
  reviewTotalTokens: number;
  sessionCacheHitTokens?: number;
  updatedAt?: number;
}

export interface ExecutionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ExecutionRequest {
  provider: ProviderSettings;
  apiKey: string;
  model: string;
  messages: ExecutionMessage[];
  temperature?: number;
}

export interface ExecutionChunk {
  content: string;
  usage?: ExecutionUsage;
}

export interface ExecutionProvider {
  readonly id: string;
  readonly displayName: string;
  sendChat(request: ExecutionRequest, token: vscode.CancellationToken): AsyncIterable<ExecutionChunk>;
  validateConfig(request: ExecutionRequest, token: vscode.CancellationToken): Promise<void>;
}

export interface WorkerContextReport {
  result: ExecutionResult;
  context: ContextSnapshot;
}

export interface ReviewResult {
  passed: boolean;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  issues: string[];
  recommendedNextStep?: string;
}