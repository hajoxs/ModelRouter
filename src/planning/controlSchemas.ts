import { ContextDiagnosis, ControllerDirective, JudgeResult, ReviewResult, TokenBudget, ToolDirective } from '../types';

export function defaultDirective(goal: string, tokenBudget: TokenBudget, maxCheapIterations: number): ControllerDirective {
  return {
    intent: goal,
    routeMode: 'balanced',
    filesToInspect: [],
    toolsToUse: [
      {
        kind: 'activeFile',
        reason: 'Use the active file as the primary execution context.'
      },
      {
        kind: 'selection',
        reason: 'Prefer the selected code when present.'
      },
      {
        kind: 'diagnostics',
        reason: 'Use current diagnostics to avoid generating code that ignores visible errors.'
      }
    ],
    requiresContextDiagnosis: true,
    workerInstruction: goal,
    acceptanceCriteria: ['The output directly addresses the user request.', 'The output follows the visible project context.'],
    judgeChecklist: ['Check whether the cheap worker answered the user request.', 'Check whether obvious project constraints were followed.'],
    maxCheapIterations,
    tokenBudget
  };
}

export function normalizeDirective(value: unknown, fallbackGoal: string, tokenBudget: TokenBudget, maxCheapIterations: number): ControllerDirective {
  const fallback = defaultDirective(fallbackGoal, tokenBudget, maxCheapIterations);
  if (!isRecord(value)) {
    return fallback;
  }

  const routeMode = value.routeMode === 'fast' || value.routeMode === 'balanced' || value.routeMode === 'longContext' || value.routeMode === 'debugLoop'
    ? value.routeMode
    : fallback.routeMode;

  return {
    intent: stringOr(value.intent, fallback.intent),
    routeMode,
    filesToInspect: stringArray(value.filesToInspect),
    toolsToUse: normalizeTools(value.toolsToUse, fallback.toolsToUse),
    requiresContextDiagnosis: typeof value.requiresContextDiagnosis === 'boolean' ? value.requiresContextDiagnosis : fallback.requiresContextDiagnosis,
    workerInstruction: stringOr(value.workerInstruction, fallback.workerInstruction),
    acceptanceCriteria: stringArray(value.acceptanceCriteria, fallback.acceptanceCriteria),
    judgeChecklist: stringArray(value.judgeChecklist, fallback.judgeChecklist),
    maxCheapIterations: numberOr(value.maxCheapIterations, maxCheapIterations),
    tokenBudget
  };
}

export function normalizeJudgeResult(value: unknown): JudgeResult {
  if (!isRecord(value)) {
    return {
      passed: false,
      confidence: 'low',
      issues: ['Premium judge returned invalid JSON.'],
      nextInstruction: 'Revise the previous answer against the original request and visible diagnostics.'
    };
  }

  const confidence = value.confidence === 'low' || value.confidence === 'medium' || value.confidence === 'high' ? value.confidence : 'medium';
  return {
    passed: Boolean(value.passed),
    confidence,
    issues: stringArray(value.issues),
    nextInstruction: typeof value.nextInstruction === 'string' ? value.nextInstruction : undefined,
    stopReason: typeof value.stopReason === 'string' ? value.stopReason : undefined
  };
}

export function normalizeContextDiagnosis(value: unknown): ContextDiagnosis {
  if (!isRecord(value)) {
    return {
      proceed: true,
      confidence: 'low',
      diagnosis: '贵模型读取结果诊断返回了无效 JSON，继续让便宜模型按原计划执行。',
      issues: ['读取结果诊断 JSON 无效。'],
      missingContext: [],
      acceptanceCriteria: [],
      requiresFinalReview: true
    };
  }

  const confidence = value.confidence === 'low' || value.confidence === 'medium' || value.confidence === 'high' ? value.confidence : 'medium';
  return {
    proceed: value.proceed !== false,
    confidence,
    diagnosis: stringOr(value.diagnosis, '贵模型已诊断便宜模型读取结果。'),
    issues: stringArray(value.issues),
    missingContext: stringArray(value.missingContext),
    workerInstructionPatch: typeof value.workerInstructionPatch === 'string' ? value.workerInstructionPatch : undefined,
    acceptanceCriteria: stringArray(value.acceptanceCriteria),
    requiresFinalReview: value.requiresFinalReview !== false
  };
}

export function normalizeReviewResult(value: unknown): ReviewResult {
  if (!isRecord(value)) {
    return {
      passed: false,
      confidence: 'low',
      summary: '中间审查模型返回了无效 JSON。',
      issues: ['审查结果 JSON 无效。'],
      recommendedNextStep: '根据验收标准重新检查便宜模型输出。'
    };
  }

  const confidence = value.confidence === 'low' || value.confidence === 'medium' || value.confidence === 'high' ? value.confidence : 'medium';
  return {
    passed: value.passed !== false,
    confidence,
    summary: stringOr(value.summary, '中间审查模型已完成一致性检查。'),
    issues: stringArray(value.issues),
    recommendedNextStep: typeof value.recommendedNextStep === 'string' ? value.recommendedNextStep : undefined
  };
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error('No JSON object found.');
  }
}

function normalizeTools(value: unknown, fallback: ControllerDirective['toolsToUse']): ControllerDirective['toolsToUse'] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const tools: ToolDirective[] = value.flatMap((item): ToolDirective[] => {
    if (!isRecord(item)) {
      return [];
    }

    const kind = item.kind;
    if (!isToolKind(kind)) {
      return [];
    }

    return [{
      kind,
      target: typeof item.target === 'string' ? item.target : undefined,
      reason: stringOr(item.reason, 'Controller selected this tool.'),
      requiresApproval: Boolean(item.requiresApproval)
    }];
  });

  return tools.length > 0 ? tools : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return items.length > 0 ? items : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isToolKind(value: unknown): value is ToolDirective['kind'] {
  return value === 'activeFile'
    || value === 'selection'
    || value === 'diagnostics'
    || value === 'workspaceFile'
    || value === 'workspaceSearch'
    || value === 'terminalCommand';
}