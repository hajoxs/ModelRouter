import * as vscode from 'vscode';
import { CopilotController } from '../planning/copilotController';
import { ExecutionRouter } from '../execution/executionRouter';
import { SecretStore } from '../storage/secretStore';
import { SettingsStore } from '../storage/settingsStore';
import { ProviderSettings } from '../types';
import { TokenUsageStore } from '../usage/tokenUsageStore';

export class ConfigViewProvider implements vscode.WebviewViewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private readonly webviews = new Set<vscode.Webview>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly settings: SettingsStore,
    private readonly secrets: SecretStore,
    private readonly controller: CopilotController,
    private readonly executionRouter: ExecutionRouter,
    private readonly tokenUsageStore: TokenUsageStore
  ) {
    this.context.subscriptions.push(this.tokenUsageStore.onDidChange(() => {
      for (const webview of this.webviews) {
        void this.postState(webview);
      }
    }));
  }

  openPanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'modelRouter.configPanel',
      'Copilot Model Switcher',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri]
      }
    );

    const panel = this.panel;
    this.panel.onDidDispose(() => {
      this.webviews.delete(panel.webview);
      this.panel = undefined;
    });

    this.initializeWebview(this.panel.webview);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.initializeWebview(webviewView.webview);
  }

  private initializeWebview(webview: vscode.Webview): void {
    this.webviews.add(webview);
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };
    webview.html = this.getHtml();

    webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        if (message.type === 'ready') {
          await this.postState(webview);
        }
        if (message.type === 'resetTokenStats') {
          this.tokenUsageStore.reset();
          webview.postMessage({ type: 'status', text: 'Token 统计已重置。' });
          await this.postState(webview);
        }
        if (message.type === 'setApiKey') {
          await vscode.commands.executeCommand('modelRouter.setProviderApiKey', message.providerId);
          await this.postState(webview);
        }
        if (message.type === 'testProvider') {
          const provider = message.provider ? this.normalizeProviders([message.provider])[0] : this.settings.getProvider(message.providerId);
          if (!provider) {
            throw new Error('Provider 配置无效，无法测试连接。');
          }
          await this.executionRouter.testProvider(provider, message.model || provider.defaultModel, new vscode.CancellationTokenSource().token);
          webview.postMessage({ type: 'status', text: `${provider.displayName} 连接成功。` });
        }
        if (message.type === 'saveProviders') {
          const providers = this.normalizeProviders(message.providers);
          if (providers.length === 0) {
            throw new Error('至少保留一个有效的第三方 provider。');
          }

          await this.settings.updateProviders(providers);
          await this.reconcileProviderSelections(providers);
          webview.postMessage({ type: 'status', text: `已保存 ${providers.length} 个第三方 provider。` });
          await this.postState(webview);
        }
        if (message.type === 'saveDefaults') {
          await this.settings.updateExecutionDefaults(message.providerId, message.model, message.fallbackModel);
          webview.postMessage({ type: 'status', text: '执行模型配置已保存。' });
          await this.postState(webview);
        }
        if (message.type === 'selectPlanner') {
          await this.settings.updatePremiumModelSource('copilot');
          await this.settings.updatePlannerModelId(message.modelId);
          await this.settings.updateValueModeEnabled(false);
          await this.settings.updateFollowCurrentChatModel(false);
          webview.postMessage({ type: 'status', text: '固定贵模型已保存，性价比模式已关闭。' });
          await this.postState(webview);
        }
        if (message.type === 'saveThirdPartyPlanner') {
          await this.settings.updatePremiumModelSource('thirdParty');
          await this.settings.updateThirdPartyPlanner({ providerId: message.providerId, model: message.model });
          await this.settings.updateValueModeEnabled(false);
          await this.settings.updateFollowCurrentChatModel(false);
          webview.postMessage({ type: 'status', text: '第三方贵模型已保存，性价比模式已关闭。' });
          await this.postState(webview);
        }
        if (message.type === 'saveReviewModel') {
          await this.settings.updateReviewModel({
            enabled: message.enabled,
            providerId: message.providerId,
            model: message.model
          });
          webview.postMessage({ type: 'status', text: '中间审查模型配置已保存。' });
          await this.postState(webview);
        }
        if (message.type === 'enableValueMode') {
          await this.settings.updatePremiumModelSource('copilot');
          await this.settings.updateValueModeEnabled(true);
          await this.settings.updateFollowCurrentChatModel(true);
          webview.postMessage({ type: 'status', text: '已启用性价比模式。' });
          await this.postState(webview);
        }
        if (message.type === 'disableValueMode') {
          await this.settings.updateValueModeEnabled(false);
          webview.postMessage({ type: 'status', text: '已关闭性价比模式。' });
          await this.postState(webview);
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        webview.postMessage({ type: 'status', text });
      }
    });
  }

  private async postState(webview: vscode.Webview): Promise<void> {
    const models = await this.controller.listAvailableModels().catch(() => []);
    const providers = await Promise.all(this.settings.providers.map(async (provider) => ({
      ...provider,
      apiKeyStatus: this.secrets.mask(await this.secrets.getApiKey(provider.id))
    })));

    await webview.postMessage({
      type: 'state',
      state: {
        plannerModelId: this.settings.plannerModelId,
        valueModeEnabled: this.settings.valueModeEnabled,
        followCurrentChatModel: this.settings.followCurrentChatModel,
        premiumModel: this.settings.premiumModel,
        reviewModel: this.settings.reviewModel,
        defaultProvider: this.settings.defaultExecutionProviderId,
        defaultModel: this.settings.defaultExecutionModel,
        fallbackModel: this.settings.fallbackExecutionModel,
        tokenUsage: this.tokenUsageStore.getSnapshot(),
        models,
        providers
      }
    });
  }

  private normalizeProviders(providers: ProviderSettings[]): ProviderSettings[] {
    const seen = new Set<string>();
    const normalized: ProviderSettings[] = [];

    for (const provider of providers) {
      const id = provider.id.trim();
      const displayName = provider.displayName.trim();
      const baseUrl = provider.baseUrl.trim().replace(/\/$/, '');
      const defaultModel = provider.defaultModel.trim();
      const fallbackModel = provider.fallbackModel?.trim() || undefined;

      if (!id || seen.has(id) || !displayName || !baseUrl || !defaultModel) {
        continue;
      }

      seen.add(id);
      normalized.push({
        id,
        displayName,
        baseUrl,
        defaultModel,
        fallbackModel,
        enabled: provider.enabled !== false
      });
    }

    return normalized;
  }

  private async reconcileProviderSelections(providers: ProviderSettings[]): Promise<void> {
    const fallbackProvider = providers[0];
    if (!fallbackProvider) {
      return;
    }

    if (!providers.some((provider) => provider.id === this.settings.defaultExecutionProviderId)) {
      await this.settings.updateExecutionDefaults(fallbackProvider.id, fallbackProvider.defaultModel, fallbackProvider.fallbackModel);
    }

    const premiumModel = this.settings.premiumModel;
    if (premiumModel.source === 'thirdParty' && !providers.some((provider) => provider.id === premiumModel.thirdPartyProviderId)) {
      await this.settings.updateThirdPartyPlanner({
        providerId: fallbackProvider.id,
        model: fallbackProvider.fallbackModel ?? fallbackProvider.defaultModel
      });
    }

    const reviewModel = this.settings.reviewModel;
    if (!providers.some((provider) => provider.id === reviewModel.providerId)) {
      await this.settings.updateReviewModel({
        ...reviewModel,
        providerId: fallbackProvider.id,
        model: fallbackProvider.fallbackModel ?? fallbackProvider.defaultModel
      });
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>模型路由器</title>
  <style>
    body { padding: 14px 14px 52px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    h2 { font-size: 15px; margin: 0 0 12px; }
    h3 { font-size: 13px; margin: 18px 0 8px; }
    label { display: block; margin: 8px 0 4px; color: var(--vscode-descriptionForeground); }
    select, input { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px; }
    button { margin-top: 8px; margin-right: 6px; }
    .panel, .provider, .token-stats { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px; margin: 10px 0; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    #status { margin-top: 12px; color: var(--vscode-notificationsInfoIcon-foreground); }
    .metric { display: flex; justify-content: space-between; gap: 10px; margin: 5px 0; }
    .metric strong { font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .provider-header { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .provider-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .inline-note { margin-top: 4px; }
    .bottom-mode { position: fixed; left: 0; right: 0; bottom: 0; padding: 9px 14px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-statusBarItem-prominentBackground, var(--vscode-sideBar-background)); color: var(--vscode-statusBarItem-prominentForeground, var(--vscode-foreground)); display: none; box-sizing: border-box; }
    .bottom-mode.visible { display: block; }
  </style>
</head>
<body>
  <h2>Copilot 性价比模型路由器</h2>
  <p class="muted">配置默认保存到当前工作区，多个 VS Code 窗口互不跟随。Token 统计会自动记录并在重开窗口后恢复，无需再次手动运行命令。贵模型可使用 Copilot 或第三方 API；便宜模型负责执行；中间审查模型负责检查便宜模型输出是否满足贵模型要求。</p>

  <h3>路由模式</h3>
  <div id="valueMode" class="panel"></div>

  <h3>实时 Token 统计</h3>
  <div id="tokenStats" class="token-stats"></div>
  <button id="resetTokenStats">重置 Token 统计</button>

  <h3>贵模型控制器</h3>
  <div id="plannerMode" class="muted"></div>
  <label for="plannerSource">贵模型来源</label>
  <select id="plannerSource">
    <option value="copilot">Copilot / VS Code Language Model</option>
    <option value="thirdParty">第三方 API</option>
  </select>
  <div id="plannerCopilotSection" class="panel">
    <label for="planner">固定 Copilot 贵模型</label>
    <select id="planner"></select>
    <button id="savePlanner">保存固定 Copilot 贵模型</button>
  </div>
  <div id="plannerThirdPartySection" class="panel">
    <label for="thirdPartyPlannerProvider">第三方贵模型 Provider</label>
    <select id="thirdPartyPlannerProvider"></select>
    <label for="thirdPartyPlannerModel">第三方贵模型</label>
    <input id="thirdPartyPlannerModel" placeholder="例如 deepseek-v4-pro">
    <button id="saveThirdPartyPlanner">保存第三方贵模型</button>
  </div>

  <h3>中间审查模型</h3>
  <div class="panel">
    <label for="reviewEnabled">启用中间审查模型</label>
    <select id="reviewEnabled">
      <option value="true">开启</option>
      <option value="false">关闭</option>
    </select>
    <label for="reviewProvider">审查模型 Provider</label>
    <select id="reviewProvider"></select>
    <label for="reviewModel">审查模型</label>
    <input id="reviewModel" placeholder="例如 deepseek-v4-pro">
    <button id="saveReviewModel">保存中间审查模型</button>
  </div>

  <h3>便宜执行模型</h3>
  <div class="panel">
    <label for="executionProvider">默认执行 Provider</label>
    <select id="executionProvider"></select>
    <label for="executionModel">默认执行模型</label>
    <input id="executionModel" placeholder="例如 deepseek-v4-flash">
    <label for="executionFallback">失败升级模型</label>
    <input id="executionFallback" placeholder="例如 deepseek-v4-pro">
    <button id="saveExecutionDefaults">保存默认执行模型</button>
  </div>

  <h3>第三方 Provider</h3>
  <p class="muted">这里的 provider 可供便宜执行模型、第三方贵模型和中间审查模型共用。支持任意 OpenAI-compatible 接口。</p>
  <div id="providers"></div>
  <button id="addProvider">新增 Provider</button>
  <button id="saveProviders">保存 Provider 列表</button>
  <div id="status" class="muted"></div>
  <div id="bottomMode" class="bottom-mode">已启用性价比模式</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = undefined;
    let providerDrafts = [];

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'state') {
        state = message.state;
        providerDrafts = cloneProviders(state.providers || []);
        render();
      }
      if (message.type === 'status') {
        document.getElementById('status').textContent = message.text;
      }
    });

    document.getElementById('resetTokenStats').addEventListener('click', () => vscode.postMessage({ type: 'resetTokenStats' }));
    document.getElementById('addProvider').addEventListener('click', () => {
      providerDrafts.push({
        id: '',
        displayName: '',
        baseUrl: 'https://',
        defaultModel: '',
        fallbackModel: '',
        enabled: true,
        apiKeyStatus: 'Not configured'
      });
      render();
    });
    document.getElementById('saveProviders').addEventListener('click', () => {
      vscode.postMessage({ type: 'saveProviders', providers: providerDrafts.map(stripProviderUiFields) });
    });
    document.getElementById('savePlanner').addEventListener('click', () => {
      vscode.postMessage({ type: 'selectPlanner', modelId: document.getElementById('planner').value });
    });
    document.getElementById('saveThirdPartyPlanner').addEventListener('click', () => {
      vscode.postMessage({
        type: 'saveThirdPartyPlanner',
        providerId: document.getElementById('thirdPartyPlannerProvider').value,
        model: document.getElementById('thirdPartyPlannerModel').value.trim()
      });
    });
    document.getElementById('saveReviewModel').addEventListener('click', () => {
      vscode.postMessage({
        type: 'saveReviewModel',
        enabled: document.getElementById('reviewEnabled').value === 'true',
        providerId: document.getElementById('reviewProvider').value,
        model: document.getElementById('reviewModel').value.trim()
      });
    });
    document.getElementById('saveExecutionDefaults').addEventListener('click', () => {
      vscode.postMessage({
        type: 'saveDefaults',
        providerId: document.getElementById('executionProvider').value,
        model: document.getElementById('executionModel').value.trim(),
        fallbackModel: document.getElementById('executionFallback').value.trim()
      });
    });
    document.getElementById('plannerSource').addEventListener('change', renderPlannerSections);

    function render() {
      const valueMode = document.getElementById('valueMode');
      valueMode.innerHTML = '<strong>' + (state.valueModeEnabled ? '性价比模式已开启' : '性价比模式未开启') + '</strong>'
        + '<div class="muted">' + (state.valueModeEnabled
          ? '贵模型自动跟随当前 Copilot Chat 选择的模型，但只做需求理解、按需读取结果诊断和终检；低风险任务会自动跳过一次贵模型诊断。'
          : '关闭后可使用固定 Copilot 贵模型，或改为第三方贵模型。') + '</div>'
        + '<button id="enableValueMode">启用性价比模式</button> '
        + '<button id="disableValueMode">关闭</button>';
      document.getElementById('enableValueMode').addEventListener('click', () => vscode.postMessage({ type: 'enableValueMode' }));
      document.getElementById('disableValueMode').addEventListener('click', () => vscode.postMessage({ type: 'disableValueMode' }));

      renderTokenStats();

      document.getElementById('plannerSource').value = state.premiumModel.source;
      document.getElementById('plannerMode').textContent = state.valueModeEnabled
        ? '当前模式：贵模型跟随 Copilot Chat 当前选择的模型。'
        : state.premiumModel.source === 'thirdParty'
          ? '当前模式：使用第三方贵模型执行需求理解、读取结果诊断和终检。'
          : state.followCurrentChatModel
            ? '当前模式：贵模型跟随 Copilot Chat 当前选择的模型。'
            : '当前模式：使用固定 Copilot 贵模型，空值时自动选择。';

      renderPlannerSection();
      renderExecutionDefaults();
      renderReviewSection();
      renderProviders();

      document.getElementById('bottomMode').className = state.valueModeEnabled ? 'bottom-mode visible' : 'bottom-mode';
    }

    function renderPlannerSection() {
      const planner = document.getElementById('planner');
      planner.innerHTML = '';
      (state.models || []).forEach((model) => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name + ' (' + model.id + ')';
        option.selected = model.id === state.plannerModelId;
        planner.appendChild(option);
      });

      fillProviderSelect(document.getElementById('thirdPartyPlannerProvider'), state.premiumModel.thirdPartyProviderId);
      document.getElementById('thirdPartyPlannerModel').value = state.premiumModel.thirdPartyModel || '';
      renderPlannerSections();
    }

    function renderPlannerSections() {
      const source = document.getElementById('plannerSource').value;
      document.getElementById('plannerCopilotSection').style.display = source === 'copilot' ? 'block' : 'none';
      document.getElementById('plannerThirdPartySection').style.display = source === 'thirdParty' ? 'block' : 'none';
    }

    function renderReviewSection() {
      document.getElementById('reviewEnabled').value = state.reviewModel.enabled ? 'true' : 'false';
      fillProviderSelect(document.getElementById('reviewProvider'), state.reviewModel.providerId);
      document.getElementById('reviewModel').value = state.reviewModel.model || '';
    }

    function renderExecutionDefaults() {
      fillProviderSelect(document.getElementById('executionProvider'), state.defaultProvider);
      document.getElementById('executionModel').value = state.defaultModel || '';
      document.getElementById('executionFallback').value = state.fallbackModel || '';
    }

    function renderProviders() {
      const container = document.getElementById('providers');
      container.innerHTML = '';
      providerDrafts.forEach((provider, index) => {
        const node = document.createElement('div');
        node.className = 'provider';
        node.innerHTML = '<div class="provider-header"><strong>' + escapeHtml(provider.displayName || '未命名 Provider') + '</strong><span class="muted">' + escapeHtml(provider.id || 'new-provider') + '</span></div>'
          + '<div class="muted inline-note">API Key：' + escapeHtml(provider.apiKeyStatus || 'Not configured') + '</div>'
          + '<div class="grid">'
          + '<div><label>Provider ID</label><input data-index="' + index + '" data-field="id" value="' + escapeHtml(provider.id || '') + '"></div>'
          + '<div><label>显示名称</label><input data-index="' + index + '" data-field="displayName" value="' + escapeHtml(provider.displayName || '') + '"></div>'
          + '<div><label>Base URL</label><input data-index="' + index + '" data-field="baseUrl" value="' + escapeHtml(provider.baseUrl || '') + '"></div>'
          + '<div><label>默认模型</label><input data-index="' + index + '" data-field="defaultModel" value="' + escapeHtml(provider.defaultModel || '') + '"></div>'
          + '<div><label>失败升级模型</label><input data-index="' + index + '" data-field="fallbackModel" value="' + escapeHtml(provider.fallbackModel || '') + '"></div>'
          + '<div><label>启用</label><select data-index="' + index + '" data-field="enabled"><option value="true"' + (provider.enabled !== false ? ' selected' : '') + '>启用</option><option value="false"' + (provider.enabled === false ? ' selected' : '') + '>停用</option></select></div>'
          + '</div>'
          + '<div class="provider-actions">'
          + '<button data-key-provider="' + index + '">设置 API Key</button>'
          + '<button data-test-provider="' + index + '">测试连接</button>'
          + '<button data-delete-provider="' + index + '">删除</button>'
          + '</div>';
        container.appendChild(node);
      });

      container.querySelectorAll('[data-field]').forEach((input) => {
        input.addEventListener('input', updateProviderDraftFromInput);
        input.addEventListener('change', updateProviderDraftFromInput);
      });

      container.querySelectorAll('[data-key-provider]').forEach((button) => button.addEventListener('click', (event) => {
        const provider = providerDrafts[Number(event.target.getAttribute('data-key-provider'))];
        if (!provider || !provider.id.trim()) {
          document.getElementById('status').textContent = '请先填写 Provider ID，再设置 API Key。';
          return;
        }

        vscode.postMessage({ type: 'setApiKey', providerId: provider.id.trim() });
      }));

      container.querySelectorAll('[data-test-provider]').forEach((button) => button.addEventListener('click', (event) => {
        const provider = providerDrafts[Number(event.target.getAttribute('data-test-provider'))];
        if (!provider) {
          return;
        }

        vscode.postMessage({
          type: 'testProvider',
          providerId: provider.id,
          model: provider.defaultModel,
          provider: stripProviderUiFields(provider)
        });
      }));

      container.querySelectorAll('[data-delete-provider]').forEach((button) => button.addEventListener('click', (event) => {
        if (providerDrafts.length <= 1) {
          document.getElementById('status').textContent = '至少保留一个 provider。';
          return;
        }

        providerDrafts.splice(Number(event.target.getAttribute('data-delete-provider')), 1);
        render();
      }));
    }

    function renderTokenStats() {
      const tokenUsage = state.tokenUsage || {};
      const last = tokenUsage.lastRecord;
      document.getElementById('tokenStats').innerHTML = last
        ? '<div class="metric"><span>最近调用</span><strong>' + roleLabel(last.source) + ' / ' + escapeHtml(last.providerId) + ' / ' + escapeHtml(last.model) + '</strong></div>'
          + '<div class="metric"><span>本次输入</span><strong>' + last.inputTokens + ' tokens</strong></div>'
          + '<div class="metric"><span>本次输出</span><strong>' + last.outputTokens + ' tokens</strong></div>'
          + '<div class="metric"><span>本次总量</span><strong>' + last.totalTokens + ' tokens</strong></div>'
          + '<div class="metric"><span>会话总请求</span><strong>' + tokenUsage.requestCount + ' 次</strong></div>'
          + '<div class="metric"><span>贵模型会话</span><strong>' + tokenUsage.premiumRequestCount + ' 次 / ' + tokenUsage.premiumTotalTokens + ' tokens</strong></div>'
          + '<div class="metric"><span>便宜模型会话</span><strong>' + tokenUsage.cheapRequestCount + ' 次 / ' + tokenUsage.cheapTotalTokens + ' tokens</strong></div>'
          + '<div class="metric"><span>中间审查会话</span><strong>' + (tokenUsage.reviewRequestCount || 0) + ' 次 / ' + (tokenUsage.reviewTotalTokens || 0) + ' tokens</strong></div>'
          + '<div class="metric"><span>会话输入</span><strong>' + tokenUsage.sessionInputTokens + ' tokens</strong></div>'
          + '<div class="metric"><span>会话输出</span><strong>' + tokenUsage.sessionOutputTokens + ' tokens</strong></div>'
          + '<div class="metric"><span>会话总量</span><strong>' + tokenUsage.sessionTotalTokens + ' tokens</strong></div>'
          + '<div class="muted">' + (last.isApproximate ? '当前为本地估算，厂商返回 usage 后会优先使用厂商数据。' : '当前使用厂商返回 usage 统计。') + '</div>'
        : '<div class="muted">暂无 Token 数据。后续通过 @model-router 的请求会自动累计并在这里恢复显示，无需手动再次运行统计命令。</div>';
    }

    function updateProviderDraftFromInput(event) {
      const index = Number(event.target.getAttribute('data-index'));
      const field = event.target.getAttribute('data-field');
      if (!providerDrafts[index] || !field) {
        return;
      }

      providerDrafts[index][field] = field === 'enabled' ? event.target.value === 'true' : event.target.value;
    }

    function fillProviderSelect(select, selectedId) {
      select.innerHTML = '';
      (providerDrafts.length > 0 ? providerDrafts : state.providers || []).forEach((provider) => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.displayName + ' (' + provider.id + ')';
        option.selected = provider.id === selectedId;
        select.appendChild(option);
      });
    }

    function cloneProviders(providers) {
      return (providers || []).map((provider) => Object.assign({}, provider));
    }

    function stripProviderUiFields(provider) {
      return {
        id: (provider.id || '').trim(),
        displayName: (provider.displayName || '').trim(),
        baseUrl: (provider.baseUrl || '').trim(),
        defaultModel: (provider.defaultModel || '').trim(),
        fallbackModel: (provider.fallbackModel || '').trim(),
        enabled: provider.enabled !== false
      };
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function roleLabel(source) {
      if (source === 'premium') {
        return '贵模型';
      }
      if (source === 'review') {
        return '中间审查模型';
      }
      return '便宜模型';
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'setApiKey'; providerId?: string }
  | { type: 'resetTokenStats' }
  | { type: 'testProvider'; providerId: string; model?: string; provider?: ProviderSettings }
  | { type: 'saveProviders'; providers: ProviderSettings[] }
  | { type: 'saveDefaults'; providerId: string; model: string; fallbackModel?: string }
  | { type: 'selectPlanner'; modelId: string }
  | { type: 'saveThirdPartyPlanner'; providerId: string; model: string }
  | { type: 'saveReviewModel'; enabled: boolean; providerId: string; model: string }
  | { type: 'enableValueMode' }
  | { type: 'disableValueMode' };

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}