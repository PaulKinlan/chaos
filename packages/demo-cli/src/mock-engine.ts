import type { EngineConnection, ApiMessage, ApiResponse, ApiEvent } from '@chaos/sdk/connections';
import type { AgentMeta } from '@chaos/sdk';
import type { AgentStore } from '@chaos/sdk/stores';

/**
 * Mock engine that handles SDK commands locally.
 * Proves the EngineConnection interface works without any real backend.
 */
export class MockEngine implements EngineConnection {
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  constructor(private agentStore: AgentStore) {}

  async send(message: ApiMessage): Promise<ApiResponse> {
    console.log(`  [engine] handling: ${message.type}`);

    switch (message.type) {
      case 'createAgent': {
        const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const agent: AgentMeta = {
          id,
          name: message.name as string,
          role: (message.role as string) ?? 'neutral',
          visibility: 'visible',
          createdAt: new Date().toISOString(),
        };
        await this.agentStore.add(agent);
        return agent as unknown as ApiResponse;
      }

      case 'deleteAgent': {
        const agentId = message.agentId as string;
        await this.agentStore.remove(agentId);
        return { ok: true };
      }

      case 'getAgentDetail': {
        const agent = await this.agentStore.get(message.agentId as string);
        if (!agent) throw new Error(`Agent not found: ${message.agentId}`);
        return {
          ...agent,
          claudeMd: '',
          journal: [],
          bookmarks: [],
        } as unknown as ApiResponse;
      }

      case 'archiveAgent':
      case 'restoreAgent':
      case 'listArchivedAgents':
      case 'getModelConfig':
      case 'setModelConfig':
      case 'triggerHook':
      case 'registerChannel':
      case 'listChannels':
      case 'updateChannel':
      case 'removeChannel':
      case 'getChannelMessages':
      case 'listArtifacts':
      case 'getArtifact':
      case 'deleteArtifact':
      case 'listSkills':
      case 'installSkill':
      case 'removeSkill':
      case 'searchSkills':
      case 'listTasks':
      case 'createTask':
      case 'getTask':
      case 'cancelTask':
      case 'stopChat':
        return {};

      default:
        console.log(`  [engine] unhandled message type: ${message.type}`);
        return {};
    }
  }

  async *stream(message: ApiMessage): AsyncIterable<ApiEvent> {
    console.log(`  [engine] streaming: ${message.type}`);

    if (message.type === 'chat' || message.type === 'agenticChat') {
      yield { type: 'thinking', content: 'Thinking...' };
      yield {
        type: 'text',
        content: `I can help you with research, writing, and analysis. You said: "${message.message}"`,
      };
      yield { type: 'step-complete', iteration: 1, totalIterations: 1, content: '' };
      yield { type: 'done', content: 'Response complete.' };
    }
  }

  subscribe(event: string, handler: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  disconnect(): void {
    this.listeners.clear();
  }
}
