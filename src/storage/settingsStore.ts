import * as vscode from 'vscode';
import { PremiumModelConfig, ProviderSettings, ReviewModelConfig, ThirdPartyModelSelection, TokenBudget } from '../types';

const SECTION = 'modelRouter';

const DEFAULT_PROVIDERS: ProviderSettings[] = [
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-flash',
    fallbackModel: 'deepseek-v4-pro',
    enabled: true
  },
  {
    id: 'kimi',
    displayName: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.6',
    enabled: false
  }
];

export class SettingsStore {
  get valueModeEnabled(): boolean {
    return this.config.get<boolean>('routing.valueModeEnabled', true);
  }

  get plannerModelId(): string {
    return this.premiumModel.copilotModelId;
  }

  get followCurrentChatModel(): boolean {
    return this.premiumModel.followCurrentChatModel;
  }

  get premiumModel(): PremiumModelConfig {
    return {
      source: this.config.get<PremiumModelConfig['source']>('planner.source', 'copilot'),
      copilotModelId: this.config.get<string>('planner.modelId', ''),
      thirdPartyProviderId: this.config.get<string>('planner.thirdPartyProviderId', this.defaultExecutionProviderId),
      thirdPartyModel: this.config.get<string>('planner.thirdPartyModel', this.fallbackExecutionModel),
      followCurrentChatModel: this.config.get<boolean>('planner.followCurrentChatModel', false)
    };
  }

  get reviewModel(): ReviewModelConfig {
    return {
      enabled: this.config.get<boolean>('reviewer.enabled', true),
      providerId: this.config.get<string>('reviewer.providerId', this.defaultExecutionProviderId),
      model: this.config.get<string>('reviewer.model', this.fallbackExecutionModel)
    };
  }

  get tokenBudget(): TokenBudget {
    return {
      expensiveInputChars: this.config.get<number>('controller.maxExpensiveInputChars', 3500),
      expensiveOutputChars: this.config.get<number>('controller.maxExpensiveOutputChars', 1200),
      cheapContextChars: this.config.get<number>('worker.maxCheapContextChars', 30000)
    };
  }

  get maxCheapIterations(): number {
    return this.config.get<number>('debug.maxCheapIterations', 3);
  }

  get finalReviewEnabled(): boolean {
    return this.config.get<boolean>('controller.finalReviewEnabled', true);
  }

  get allowTerminalTools(): boolean {
    return this.config.get<boolean>('debug.allowTerminalTools', false);
  }

  get tokenStatsEnabled(): boolean {
    return this.config.get<boolean>('tokenStats.enabled', true);
  }

  get defaultExecutionProviderId(): string {
    return this.config.get<string>('execution.defaultProvider', 'deepseek');
  }

  get defaultExecutionModel(): string {
    return this.config.get<string>('execution.defaultModel', 'deepseek-v4-flash');
  }

  get fallbackExecutionModel(): string {
    return this.config.get<string>('execution.fallbackModel', 'deepseek-v4-pro');
  }

  get providers(): ProviderSettings[] {
    const providers = this.config.get<ProviderSettings[]>('execution.providers', DEFAULT_PROVIDERS);
    return providers.length > 0 ? providers : DEFAULT_PROVIDERS;
  }

  getProvider(id = this.defaultExecutionProviderId): ProviderSettings {
    const provider = this.providers.find((item) => item.id === id);
    if (provider) {
      return provider;
    }

    return DEFAULT_PROVIDERS[0];
  }

  async updatePlannerModelId(modelId: string): Promise<void> {
    await this.config.update('planner.modelId', modelId, this.configurationTarget);
  }

  async updateValueModeEnabled(enabled: boolean): Promise<void> {
    await this.config.update('routing.valueModeEnabled', enabled, this.configurationTarget);
  }

  async updateFollowCurrentChatModel(enabled: boolean): Promise<void> {
    await this.config.update('planner.followCurrentChatModel', enabled, this.configurationTarget);
  }

  async updatePremiumModelSource(source: PremiumModelConfig['source']): Promise<void> {
    await this.config.update('planner.source', source, this.configurationTarget);
  }

  async updateThirdPartyPlanner(selection: ThirdPartyModelSelection): Promise<void> {
    await this.config.update('planner.thirdPartyProviderId', selection.providerId, this.configurationTarget);
    await this.config.update('planner.thirdPartyModel', selection.model, this.configurationTarget);
  }

  async updateReviewModel(config: ReviewModelConfig): Promise<void> {
    await this.config.update('reviewer.enabled', config.enabled, this.configurationTarget);
    await this.config.update('reviewer.providerId', config.providerId, this.configurationTarget);
    await this.config.update('reviewer.model', config.model, this.configurationTarget);
  }

  async updateExecutionDefaults(providerId: string, model: string, fallbackModel?: string): Promise<void> {
    await this.config.update('execution.defaultProvider', providerId, this.configurationTarget);
    await this.config.update('execution.defaultModel', model, this.configurationTarget);
    if (fallbackModel !== undefined) {
      await this.config.update('execution.fallbackModel', fallbackModel, this.configurationTarget);
    }
  }

  async updateProviders(providers: ProviderSettings[]): Promise<void> {
    await this.config.update('execution.providers', providers, this.configurationTarget);
  }

  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(SECTION);
  }

  private get configurationTarget(): vscode.ConfigurationTarget {
    return vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  }
}