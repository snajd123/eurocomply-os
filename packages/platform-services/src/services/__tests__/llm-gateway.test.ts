import { describe, it, expect } from 'vitest';
import { LLMGateway, type LLMProvider } from '../llm-gateway.js';

// Mock provider for testing
class MockLLMProvider implements LLMProvider {
  readonly calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];

  async generate(prompt: string, options: Record<string, unknown> = {}): Promise<{ text: string; tokens_used: { input: number; output: number } }> {
    this.calls.push({ prompt, options });
    return {
      text: `Mock response for: ${prompt.slice(0, 50)}`,
      tokens_used: { input: 100, output: 50 },
    };
  }
}

describe('LLMGateway', () => {
  it('should route tier A requests to self-hosted provider', async () => {
    const tierA = new MockLLMProvider();
    const tierB = new MockLLMProvider();
    const gateway = new LLMGateway({ tierA, tierB });

    const result = await gateway.generate({
      prompt: 'Extract substances from this document',
      tier: 'A',
      model_preference: 'default',
    });

    expect(result.text).toBeDefined();
    expect(tierA.calls.length).toBe(1);
    expect(tierB.calls.length).toBe(0);
  });

  it('should route tier B requests to cloud provider', async () => {
    const tierA = new MockLLMProvider();
    const tierB = new MockLLMProvider();
    const gateway = new LLMGateway({ tierA, tierB });

    const result = await gateway.generate({
      prompt: 'Interpret this regulation text',
      tier: 'B',
      model_preference: 'default',
    });

    expect(result.text).toBeDefined();
    expect(tierA.calls.length).toBe(0);
    expect(tierB.calls.length).toBe(1);
  });

  it('should classify ambiguous tier to A (fail-safe)', async () => {
    const tierA = new MockLLMProvider();
    const tierB = new MockLLMProvider();
    const gateway = new LLMGateway({ tierA, tierB });

    const result = await gateway.generate({
      prompt: 'Analyze this data',
      model_preference: 'default',
    });

    expect(result.text).toBeDefined();
    expect(tierA.calls.length).toBe(1); // defaults to tier A
  });

  it('should extract structured data', async () => {
    const tierA = new MockLLMProvider();
    const tierB = new MockLLMProvider();
    const gateway = new LLMGateway({ tierA, tierB });

    const result = await gateway.extract({
      document_content: 'Lead concentration: 0.05%',
      extraction_schema: {
        fields: [
          { name: 'lead_concentration', type: 'number', description: 'Lead ppm' },
        ],
      },
      tier: 'A',
    });

    expect(result.raw_response).toBeDefined();
    expect(tierA.calls.length).toBe(1);
  });
});
