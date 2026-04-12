/**
 * Core autonomous agent loop.
 *
 * Calls streamText() in a loop, executing tools and continuing
 * until the model responds with text only (no tool calls) or
 * the iteration limit is reached.
 */

import { streamText, stepCountIs, type ToolSet, type ModelMessage, type LanguageModel, type JSONValue } from 'ai';
import type {
  AgentConfig,
  ConversationMessage,
  ProgressEvent,
  RunResult,
  RunUsage,
  HookDecision,
} from './types.js';

// ── Cache Control ──

function isAnthropicModel(model: LanguageModel): boolean {
  if (typeof model === 'string') return model.includes('anthropic') || model.includes('claude');
  return model.provider === 'anthropic' || model.provider?.includes('anthropic') ||
    model.modelId?.includes('anthropic') || model.modelId?.includes('claude');
}

/**
 * Add cache control breakpoints to messages for Anthropic models.
 * Marks the last message with ephemeral caching so that previous turns
 * are cached across agentic loop steps, reducing cost significantly.
 */
function addCacheControl(messages: ModelMessage[], model: LanguageModel): ModelMessage[] {
  if (messages.length === 0 || !isAnthropicModel(model)) return messages;

  return messages.map((message, index) => {
    if (index === messages.length - 1) {
      return {
        ...message,
        providerOptions: {
          ...(message as Record<string, unknown>).providerOptions as Record<string, Record<string, JSONValue>> | undefined,
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      };
    }
    return message;
  });
}
import { evaluatePermission } from './permissions.js';
import { buildSkillsPrompt, createSkillTools } from './skills.js';
import { UsageTracker } from './usage.js';

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_INNER_STEP_LIMIT = 5;

/**
 * Build the full system prompt from config.
 */
async function buildSystemPrompt(
  config: AgentConfig,
  context?: string,
): Promise<string> {
  const parts: string[] = [];

  // Base system prompt
  if (config.systemPrompt) {
    parts.push(config.systemPrompt);
  }

  // Skills from store
  if (config.skills) {
    const skills = await config.skills.list();
    const skillsSection = buildSkillsPrompt(skills);
    if (skillsSection) {
      parts.push(skillsSection);
    }
  }

  // Agentic loop instruction
  parts.push(`
## Autonomous Task Mode

You are running an autonomous task. Work through it step by step.
Use your tools to gather information, do analysis, and produce output.
When you have completed the task, respond with your final summary
without calling any more tools.

## HTML Generation Order

When generating HTML content (reports, dashboards, interactive apps),
always write in this order:
1. **HTML structure first** — write all the DOM elements, classes, IDs
2. **CSS styles second** — now you know what elements exist to style
3. **JavaScript last** — the DOM and styles are ready for scripts to reference

This produces better output because you can't predict what styles are
needed until the DOM structure is defined.`);

  // Context
  if (context) {
    parts.push('\n## Context\n');
    parts.push(context);
  }

  return parts.join('\n');
}

/**
 * Wrap a tool's execute function with permission checks and hooks.
 */
function wrapToolWithPermissions(
  name: string,
  originalTool: ToolSet[string],
  config: AgentConfig,
  step: number,
): ToolSet[string] {
  const originalExecute = originalTool.execute;
  if (!originalExecute) return originalTool;

  const exec = originalExecute;

  return {
    ...originalTool,
    execute: async (args: unknown, options: unknown) => {
      let effectiveArgs = args;

      // Permission check
      if (config.permissions) {
        const allowed = await evaluatePermission(
          name,
          effectiveArgs,
          config.permissions,
        );
        if (!allowed) {
          return `Error: Permission denied for tool "${name}".`;
        }
      }

      // Pre-tool-use hook
      if (config.hooks?.onPreToolUse) {
        const decision = await config.hooks.onPreToolUse({
          toolName: name,
          args: effectiveArgs,
          step,
        });

        if (decision) {
          if (decision.decision === 'deny') {
            return `Error: Tool "${name}" was denied${decision.reason ? `: ${decision.reason}` : ''}.`;
          }
          if (decision.decision === 'stop') {
            return `Error: Execution stopped${decision.reason ? `: ${decision.reason}` : ''}.`;
          }
          if (decision.modifiedArgs !== undefined) {
            effectiveArgs = decision.modifiedArgs;
          }
        }
      }

      // Execute
      const startTime = Date.now();
      const result = await (exec as Function)(effectiveArgs, options);
      const durationMs = Date.now() - startTime;

      // Post-tool-use hook
      if (config.hooks?.onPostToolUse) {
        await config.hooks.onPostToolUse({
          toolName: name,
          args: effectiveArgs,
          result,
          step,
          durationMs,
        });
      }

      return result;
    },
  } as typeof originalTool;
}

/**
 * Build the full tool set with permission wrapping.
 */
function buildTools(config: AgentConfig, step: number): ToolSet {
  const tools: ToolSet = {};

  // Add user-provided tools
  if (config.tools) {
    for (const [name, t] of Object.entries(config.tools)) {
      tools[name] = wrapToolWithPermissions(name, t, config, step);
    }
  }

  // Add skill tools if a store is provided
  if (config.skills) {
    const skillTools = createSkillTools(config.skills);
    for (const [name, t] of Object.entries(skillTools)) {
      tools[name] = wrapToolWithPermissions(name, t, config, step);
    }
  }

  return tools;
}

/**
 * Run the agent loop and return the final result.
 */
export async function runAgentLoop(
  config: AgentConfig,
  task: string,
  context?: string,
  history?: ConversationMessage[],
): Promise<RunResult> {
  return runAgentLoopDirect(config, task, context, history);
}

/**
 * Direct (non-streaming) implementation of the agent loop.
 */
async function runAgentLoopDirect(
  config: AgentConfig,
  task: string,
  context?: string,
  history?: ConversationMessage[],
): Promise<RunResult> {
  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const innerStepLimit = config.innerStepLimit ?? DEFAULT_INNER_STEP_LIMIT;
  const signal = config.signal;

  // Usage tracking
  const tracker = new UsageTracker({
    pricing: config.usage?.pricing,
    perRunLimit: config.usage?.limits?.perRun,
    perDayLimit: config.usage?.limits?.perDay,
    onLimitExceeded: config.usage?.onLimitExceeded,
  });

  // Build system prompt
  const systemPrompt = await buildSystemPrompt(config, context);

  // Message history — prepend conversation history if provided
  const messages: ModelMessage[] = [];
  if (history) {
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content } as ModelMessage);
    }
  }
  messages.push({ role: 'user', content: task });

  let lastText = '';
  let aborted = false;

  for (let i = 0; i < maxIterations; i++) {
    // Check abort
    if (signal?.aborted) {
      aborted = true;
      break;
    }

    // Step start hook
    if (config.hooks?.onStepStart) {
      const summary = tracker.getSummary();
      const decision = await config.hooks.onStepStart({
        step: i,
        totalSteps: maxIterations,
        tokensSoFar: summary.totalInputTokens + summary.totalOutputTokens,
        costSoFar: summary.totalCost,
      });
      if (decision?.decision === 'stop') {
        break;
      }
    }

    // Check spending limits (skip first iteration)
    if (i > 0 && config.usage?.enabled !== false) {
      const withinLimits = await tracker.checkLimits();
      if (!withinLimits) {
        break;
      }
    }

    // Build tools for this step (so hooks get the current step number)
    const tools = buildTools(config, i);

    // Call streamText
    const result = streamText({
      model: config.model,
      system: systemPrompt,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      stopWhen: stepCountIs(innerStepLimit),
      abortSignal: signal,
      prepareStep: ({ messages: stepMsgs }) => ({
        messages: addCacheControl(stepMsgs, config.model as LanguageModel),
      }),
    });

    // Consume the stream
    let iterationText = '';
    let hasToolCalls = false;

    for await (const part of result.fullStream) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }

      switch (part.type) {
        case 'text-delta':
          iterationText += part.text;
          break;
        case 'tool-call':
          hasToolCalls = true;
          break;
      }
    }

    if (aborted) break;

    // Get response messages and append to history
    const response = await result.response;
    for (const msg of response.messages) {
      messages.push(msg as ModelMessage);
    }

    // Record usage
    const usage = await result.totalUsage;
    const modelId =
      typeof config.model === 'string'
        ? config.model
        : config.model.modelId;
    const record = tracker.record(
      i,
      modelId,
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
    );

    if (config.hooks?.onUsage) {
      await config.hooks.onUsage(record);
    }

    // Get final text
    const finalText = await result.text;
    lastText = finalText || iterationText;

    // Step complete hook
    if (config.hooks?.onStepComplete) {
      await config.hooks.onStepComplete({
        step: i,
        hasToolCalls,
        text: lastText,
      });
    }

    // If no tool calls, the agent is done
    if (!hasToolCalls) {
      break;
    }

    // Continue — add continuation prompt
    messages.push({
      role: 'user',
      content:
        'Continue working on the task. If you are done, respond with your final summary without calling any tools.',
    });
  }

  const finalUsage = tracker.getSummary();

  // Complete hook
  if (config.hooks?.onComplete) {
    await config.hooks.onComplete({
      result: lastText,
      totalSteps: finalUsage.steps,
      usage: finalUsage,
      aborted,
    });
  }

  return {
    text: lastText,
    usage: finalUsage,
    steps: finalUsage.steps,
    aborted,
  };
}

/**
 * Stream the agent loop, yielding progress events.
 */
export async function* streamAgentLoop(
  config: AgentConfig,
  task: string,
  context?: string,
  history?: ConversationMessage[],
): AsyncGenerator<ProgressEvent> {
  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const innerStepLimit = config.innerStepLimit ?? DEFAULT_INNER_STEP_LIMIT;
  const signal = config.signal;

  // Usage tracking
  const tracker = new UsageTracker({
    pricing: config.usage?.pricing,
    perRunLimit: config.usage?.limits?.perRun,
    perDayLimit: config.usage?.limits?.perDay,
    onLimitExceeded: config.usage?.onLimitExceeded,
  });

  // Build system prompt
  const systemPrompt = await buildSystemPrompt(config, context);

  // Message history — prepend conversation history if provided
  const messages: ModelMessage[] = [];
  if (history) {
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content } as ModelMessage);
    }
  }
  messages.push({ role: 'user', content: task });

  let lastText = '';
  let aborted = false;

  for (let i = 0; i < maxIterations; i++) {
    // Check abort
    if (signal?.aborted) {
      aborted = true;
      yield {
        type: 'error',
        content: 'Aborted',
        step: i,
        totalSteps: maxIterations,
      };
      break;
    }

    // Step start hook
    if (config.hooks?.onStepStart) {
      const summary = tracker.getSummary();
      const decision = await config.hooks.onStepStart({
        step: i,
        totalSteps: maxIterations,
        tokensSoFar: summary.totalInputTokens + summary.totalOutputTokens,
        costSoFar: summary.totalCost,
      });
      if (decision?.decision === 'stop') {
        break;
      }
    }

    // Check spending limits (skip first iteration)
    if (i > 0 && config.usage?.enabled !== false) {
      const withinLimits = await tracker.checkLimits();
      if (!withinLimits) {
        yield {
          type: 'error',
          content: 'Spending limit exceeded',
          step: i,
          totalSteps: maxIterations,
        };
        break;
      }
    }

    yield {
      type: 'thinking',
      content: `Step ${i + 1}...`,
      step: i,
      totalSteps: maxIterations,
    };

    // Build tools for this step
    const tools = buildTools(config, i);

    // Call streamText
    const result = streamText({
      model: config.model,
      system: systemPrompt,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      stopWhen: stepCountIs(innerStepLimit),
      abortSignal: signal,
      prepareStep: ({ messages: stepMsgs }) => ({
        messages: addCacheControl(stepMsgs, config.model as LanguageModel),
      }),
    });

    // Consume the stream and yield events
    let iterationText = '';
    let hasToolCalls = false;

    for await (const part of result.fullStream) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }

      switch (part.type) {
        case 'text-delta':
          iterationText += part.text;
          yield {
            type: 'thinking',
            content: part.text,
            step: i,
            totalSteps: maxIterations,
          };
          break;

        case 'tool-call': {
          hasToolCalls = true;
          const toolArgs =
            'args' in part
              ? part.args
              : 'input' in part
                ? (part as Record<string, unknown>).input
                : undefined;
          yield {
            type: 'tool-call',
            content: `Called ${part.toolName}`,
            toolName: part.toolName,
            toolArgs,
            step: i,
            totalSteps: maxIterations,
          };
          break;
        }

        case 'tool-result':
          yield {
            type: 'tool-result',
            content: '',
            toolName: part.toolName,
            toolResult:
              'result' in part
                ? part.result
                : 'output' in part
                  ? (part as Record<string, unknown>).output
                  : undefined,
            step: i,
            totalSteps: maxIterations,
          };
          break;
      }
    }

    if (aborted) break;

    // Append response messages
    const response = await result.response;
    for (const msg of response.messages) {
      messages.push(msg as ModelMessage);
    }

    // Record usage
    const usage = await result.totalUsage;
    const modelId =
      typeof config.model === 'string'
        ? config.model
        : config.model.modelId;
    const record = tracker.record(
      i,
      modelId,
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
    );

    if (config.hooks?.onUsage) {
      await config.hooks.onUsage(record);
    }

    // Get final text
    const finalText = await result.text;
    lastText = finalText || iterationText;

    if (lastText) {
      yield {
        type: 'text',
        content: lastText,
        step: i,
        totalSteps: maxIterations,
      };
    }

    // Step complete hook
    if (config.hooks?.onStepComplete) {
      await config.hooks.onStepComplete({
        step: i,
        hasToolCalls,
        text: lastText,
      });
    }

    yield {
      type: 'step-complete',
      content: `Step ${i + 1} complete`,
      step: i,
      totalSteps: maxIterations,
    };

    // If no tool calls, done
    if (!hasToolCalls) {
      yield {
        type: 'done',
        content: lastText,
        step: i,
        totalSteps: maxIterations,
      };

      // Complete hook
      if (config.hooks?.onComplete) {
        const finalUsage = tracker.getSummary();
        await config.hooks.onComplete({
          result: lastText,
          totalSteps: finalUsage.steps,
          usage: finalUsage,
          aborted: false,
        });
      }

      return;
    }

    // Continue
    messages.push({
      role: 'user',
      content:
        'Continue working on the task. If you are done, respond with your final summary without calling any tools.',
    });
  }

  // Hit max iterations or aborted
  const finalUsage = tracker.getSummary();

  if (!aborted) {
    yield {
      type: 'error',
      content: `Reached maximum ${maxIterations} iterations`,
      step: maxIterations - 1,
      totalSteps: maxIterations,
    };
  }

  if (config.hooks?.onComplete) {
    await config.hooks.onComplete({
      result: lastText,
      totalSteps: finalUsage.steps,
      usage: finalUsage,
      aborted,
    });
  }
}
