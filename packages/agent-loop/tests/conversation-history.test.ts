import { describe, it, expect } from 'vitest';
import { createAgent, type ConversationMessage } from '../src/index.js';
import { createMockModel } from '../src/testing/index.js';

describe('conversation history', () => {
  it('run() with history completes successfully', async () => {
    const model = createMockModel({
      responses: [{ text: 'Your name is Alice.' }],
    });

    const agent = createAgent({
      id: 'test',
      name: 'Test',
      model: model as any,
      maxIterations: 3,
    });

    const history: ConversationMessage[] = [
      { role: 'user', content: 'My name is Alice.' },
      { role: 'assistant', content: 'Nice to meet you, Alice!' },
    ];

    const result = await agent.run('What is my name?', undefined, history);
    expect(result).toBe('Your name is Alice.');
  });

  it('works with empty history', async () => {
    const model = createMockModel({
      responses: [{ text: 'Hello!' }],
    });

    const agent = createAgent({
      id: 'test',
      name: 'Test',
      model: model as any,
      maxIterations: 3,
    });

    const result = await agent.run('Hi', undefined, []);
    expect(result).toBe('Hello!');
  });

  it('works without history parameter', async () => {
    const model = createMockModel({
      responses: [{ text: 'Hello!' }],
    });

    const agent = createAgent({
      id: 'test',
      name: 'Test',
      model: model as any,
      maxIterations: 3,
    });

    const result = await agent.run('Hi');
    expect(result).toBe('Hello!');
  });

  it('stream() accepts history', async () => {
    const model = createMockModel({
      responses: [{ text: 'Your name is Bob.' }],
    });

    const agent = createAgent({
      id: 'test',
      name: 'Test',
      model: model as any,
      maxIterations: 3,
    });

    const history: ConversationMessage[] = [
      { role: 'user', content: 'My name is Bob.' },
      { role: 'assistant', content: 'Hi Bob!' },
    ];

    const events: string[] = [];
    for await (const event of agent.stream('What is my name?', undefined, history)) {
      events.push(event.type);
    }
    expect(events).toContain('done');
  });
});
