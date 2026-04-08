import type { Agent, AgentConfig, ProgressEvent } from './types.js';
import { runAgentLoop, streamAgentLoop } from './loop.js';

/**
 * Create an Agent instance from configuration.
 *
 * Returns an agent with run() and stream() methods that drive the
 * autonomous agent loop.
 */
export function createAgent(config: AgentConfig): Agent {
  let abortController: AbortController | null = null;

  return {
    get id() {
      return config.id;
    },
    get name() {
      return config.name;
    },

    async run(task: string, context?: string): Promise<string> {
      abortController = new AbortController();
      const mergedConfig: AgentConfig = {
        ...config,
        signal: config.signal ?? abortController.signal,
      };

      const result = await runAgentLoop(mergedConfig, task, context);
      abortController = null;
      return result.text;
    },

    stream(task: string, context?: string): AsyncIterable<ProgressEvent> {
      abortController = new AbortController();
      const mergedConfig: AgentConfig = {
        ...config,
        signal: config.signal ?? abortController.signal,
      };

      return streamAgentLoop(mergedConfig, task, context);
    },

    abort() {
      abortController?.abort();
      abortController = null;
    },
  };
}
