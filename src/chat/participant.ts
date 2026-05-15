import * as vscode from 'vscode';
import { RequestPipeline } from './requestPipeline';

const PARTICIPANT_ID = 'model-router.chat';

export function registerModelRouterParticipant(context: vscode.ExtensionContext, pipeline: RequestPipeline): void {
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, async (request, _context, stream, token) => {
    try {
      stream.progress('已进入 @model-router，正在开始路由。');
      await pipeline.handle(request, stream, token);
      return {
        metadata: {
          command: request.command ?? 'default'
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stream.markdown(`模型路由器执行失败：${message}`);
      return {
        errorDetails: {
          message
        }
      };
    }
  });

  participant.followupProvider = {
    provideFollowups: (_result, context) => buildFollowups(context)
  };

  context.subscriptions.push(participant);
}

function buildFollowups(context: vscode.ChatContext): vscode.ChatFollowup[] {
  const lastRequest = [...context.history].reverse().find(isChatRequestTurn);
  if (lastRequest?.command === 'debug') {
    return [
      {
        participant: PARTICIPANT_ID,
        command: 'debug',
        label: '继续用 @model-router 调试',
        prompt: '继续调试这个问题。'
      },
      {
        participant: PARTICIPANT_ID,
        label: '继续在 @model-router 中提问',
        prompt: '我还有补充，请继续按 @model-router 路由处理。'
      }
    ];
  }

  return [
    {
      participant: PARTICIPANT_ID,
      label: '继续用 @model-router 处理',
      prompt: '请继续处理这个任务。'
    },
    {
      participant: PARTICIPANT_ID,
      label: '继续在 @model-router 中提问',
      prompt: '我还有补充，请继续按 @model-router 路由处理。'
    }
  ];
}

function isChatRequestTurn(turn: vscode.ChatRequestTurn | vscode.ChatResponseTurn): turn is vscode.ChatRequestTurn {
  return 'prompt' in turn;
}