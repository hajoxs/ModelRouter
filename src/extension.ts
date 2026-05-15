import * as vscode from 'vscode';
import { registerModelRouterParticipant } from './chat/participant';
import { RequestPipeline } from './chat/requestPipeline';
import { ContextCollector } from './context/contextCollector';
import { DebugLoop } from './debug/debugLoop';
import { ExecutionRouter } from './execution/executionRouter';
import { ProviderRegistry } from './execution/providers/providerRegistry';
import { CopilotController } from './planning/copilotController';
import { SecretStore } from './storage/secretStore';
import { SettingsStore } from './storage/settingsStore';
import { TokenUsageEstimator } from './usage/tokenUsageEstimator';
import { TokenUsageStore } from './usage/tokenUsageStore';
import { ConfigViewProvider } from './webview/configPanel';

export function activate(context: vscode.ExtensionContext): void {
  const settings = new SettingsStore();
  const secrets = new SecretStore(context.secrets);
  const contextCollector = new ContextCollector();
  const tokenUsageStore = new TokenUsageStore(context.workspaceState);
  const tokenUsageEstimator = new TokenUsageEstimator();
  const providerRegistry = new ProviderRegistry();
  const controller = new CopilotController(settings, secrets, providerRegistry, contextCollector, tokenUsageEstimator, tokenUsageStore);
  const executionRouter = new ExecutionRouter(settings, secrets, providerRegistry, contextCollector, tokenUsageEstimator, tokenUsageStore);
  const debugLoop = new DebugLoop(controller, executionRouter);
  const pipeline = new RequestPipeline(controller, executionRouter, debugLoop, settings);
  context.subscriptions.push(tokenUsageStore);

  registerModelRouterParticipant(context, pipeline);

  const configViewProvider = new ConfigViewProvider(context, settings, secrets, controller, executionRouter, tokenUsageStore);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('modelRouter.configView', configViewProvider));

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  updateStatusBar(statusBarItem, settings);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('modelRouter.routing.valueModeEnabled') || event.affectsConfiguration('modelRouter.planner.source')) {
      updateStatusBar(statusBarItem, settings);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('modelRouter.openRoutedChat', async () => {
    await vscode.commands.executeCommand('workbench.action.chat.open', '@model-router ');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('modelRouter.openConfig', async () => {
    configViewProvider.openPanel();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('modelRouter.setProviderApiKey', async (providerId?: string) => {
    let selectedProviderId = providerId;
    if (!selectedProviderId) {
      const provider = await vscode.window.showQuickPick(settings.providers.map((item) => ({ label: item.displayName, description: item.id, providerId: item.id })), {
        placeHolder: 'Select the third-party provider'
      });
      if (!provider) {
        return;
      }

      selectedProviderId = provider.providerId;
    }

    const provider = settings.providers.find((item) => item.id === selectedProviderId);
    const providerDisplayName = provider?.displayName ?? selectedProviderId;

    const apiKey = await vscode.window.showInputBox({
      title: `Set API key for ${providerDisplayName}`,
      prompt: 'The key is stored in VS Code SecretStorage and is never written to settings.',
      password: true,
      ignoreFocusOut: true
    });
    if (!apiKey) {
      return;
    }

    await secrets.setApiKey(selectedProviderId, apiKey);
    vscode.window.showInformationMessage(`${providerDisplayName} API key saved in SecretStorage.`);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('modelRouter.testExecutionProvider', async () => {
    const provider = settings.getProvider();
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Testing ${provider.displayName}` }, async (_progress, token) => {
      await executionRouter.testProvider(provider, provider.defaultModel, token);
    });
    vscode.window.showInformationMessage(`${provider.displayName} 连接成功。`);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('modelRouter.useChatModelAsPlanner', async (modelId: string | undefined, label: string | undefined) => {
    if (!modelId) {
      vscode.window.showWarningMessage('未收到当前 Copilot Chat 模型。请在聊天中使用 @model-router /useCurrentModel。');
      return;
    }

    const models = await vscode.lm.selectChatModels();
    const selectedModel = models.find((model) => model.id === modelId);
    if (!selectedModel) {
      vscode.window.showWarningMessage(`当前选择的 Copilot 模型已不可用：${modelId}`);
      return;
    }

    await settings.updatePremiumModelSource('copilot');
    await settings.updatePlannerModelId(modelId);
    await settings.updateValueModeEnabled(true);
    await settings.updateFollowCurrentChatModel(true);
    vscode.window.showInformationMessage(`性价比模式已启用，贵模型将跟随当前 Copilot 模型：${label ?? modelId}。注意：该模式仅对 @model-router 对话生效。`);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('modelRouter.enableValueMode', async () => {
    await settings.updatePremiumModelSource('copilot');
    await settings.updateValueModeEnabled(true);
    await settings.updateFollowCurrentChatModel(true);
    vscode.window.showInformationMessage('已启用性价比模式。注意：该模式仅对 @model-router 对话生效；普通 Copilot 对话不会被本扩展接管。');
    await vscode.commands.executeCommand('workbench.action.chat.open', '@model-router ');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('modelRouter.disableValueMode', async () => {
    await settings.updateValueModeEnabled(false);
    vscode.window.showInformationMessage('已关闭性价比模式。');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('modelRouter.runDebugLoop', async () => {
    const prompt = await vscode.window.showInputBox({
      title: '运行性价比调试',
      prompt: '描述错误或异常表现。贵模型只理解目标、诊断便宜模型读取结果和终检，便宜模型负责调试执行。',
      ignoreFocusOut: true
    });
    if (!prompt) {
      return;
    }

    await vscode.commands.executeCommand('workbench.action.chat.open', `@model-router /debug ${prompt}`);
  }));
}

export function deactivate(): void {}

function updateStatusBar(statusBarItem: vscode.StatusBarItem, settings: SettingsStore): void {
  if (settings.valueModeEnabled) {
    statusBarItem.text = '$(zap) 性价比模式 @model-router';
    statusBarItem.tooltip = '仅对 @model-router 对话生效：贵模型跟随当前 Copilot 模型，但只做需求理解、按需读取结果诊断和终检；便宜模型负责执行。点击直接打开 @model-router。';
    statusBarItem.command = 'modelRouter.openRoutedChat';
    return;
  }

  if (settings.premiumModel.source === 'thirdParty') {
    statusBarItem.text = '$(cloud) 第三方贵模型';
    statusBarItem.tooltip = '当前贵模型来自第三方 provider。该路由仅在 @model-router 对话中生效，点击直接打开 @model-router。';
    statusBarItem.command = 'modelRouter.openRoutedChat';
    return;
  }

  statusBarItem.text = '$(circuit-board) 模型路由器';
  statusBarItem.tooltip = '启用性价比模式并打开 @model-router 对话';
  statusBarItem.command = 'modelRouter.enableValueMode';
}