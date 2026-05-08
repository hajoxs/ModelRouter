import { ExecutionProvider, ProviderSettings } from '../../types';
import { OpenAiCompatibleProvider } from './openAiCompatibleProvider';

export class ProviderRegistry {
  create(settings: ProviderSettings): ExecutionProvider {
    return new OpenAiCompatibleProvider(settings.id, settings.displayName);
  }
}