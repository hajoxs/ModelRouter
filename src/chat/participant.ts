import * as vscode from 'vscode';
import { RequestPipeline } from './requestPipeline';

export function registerModelRouterParticipant(context: vscode.ExtensionContext, pipeline: RequestPipeline): void {
  const participant = vscode.chat.createChatParticipant('model-router.chat', async (request, _context, stream, token) => {
    try {
      await pipeline.handle(request, stream, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stream.markdown(`Model Router failed: ${message}`);
    }
  });

  context.subscriptions.push(participant);
}