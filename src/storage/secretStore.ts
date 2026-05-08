import * as vscode from 'vscode';

export class SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getApiKey(providerId: string): Promise<string | undefined> {
    return this.secrets.get(this.key(providerId));
  }

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.secrets.store(this.key(providerId), apiKey);
  }

  async deleteApiKey(providerId: string): Promise<void> {
    await this.secrets.delete(this.key(providerId));
  }

  async hasApiKey(providerId: string): Promise<boolean> {
    const value = await this.getApiKey(providerId);
    return Boolean(value);
  }

  mask(value: string | undefined): string {
    if (!value) {
      return 'Not configured';
    }

    if (value.length <= 8) {
      return 'Configured';
    }

    return `${value.slice(0, 3)}****${value.slice(-4)}`;
  }

  private key(providerId: string): string {
    return `modelRouter.provider.${providerId}.apiKey`;
  }
}