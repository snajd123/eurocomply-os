import type { ASTNode } from '@eurocomply/types';

// --- LLM Provider Interface ---

export interface LLMProvider {
  generate(prompt: string, options?: Record<string, unknown>): Promise<{
    text: string;
    tokens_used: { input: number; output: number };
  }>;
}

// --- Gateway Types ---

export interface LLMGatewayConfig {
  tierA: LLMProvider;
  tierB: LLMProvider;
}

export interface GenerateInput {
  prompt: string;
  tier?: 'A' | 'B';
  model_preference?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface GenerateOutput {
  text: string;
  tier_used: 'A' | 'B';
  tokens_used: { input: number; output: number };
}

export interface ExtractInput {
  document_content: string;
  extraction_schema: {
    fields: Array<{
      name: string;
      type: string;
      description: string;
      required?: boolean;
    }>;
  };
  tier?: 'A' | 'B';
}

export interface ExtractOutput {
  raw_response: string;
  tier_used: 'A' | 'B';
  tokens_used: { input: number; output: number };
}

// --- LLM Gateway ---

export class LLMGateway {
  private tierA: LLMProvider;
  private tierB: LLMProvider;

  constructor(config: LLMGatewayConfig) {
    this.tierA = config.tierA;
    this.tierB = config.tierB;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    // Default to tier A (fail-safe: self-hosted when ambiguous)
    const tier = input.tier ?? 'A';
    const provider = tier === 'A' ? this.tierA : this.tierB;

    const result = await provider.generate(input.prompt, {
      temperature: input.temperature,
      max_tokens: input.max_tokens,
      model: input.model_preference,
    });

    return {
      text: result.text,
      tier_used: tier,
      tokens_used: result.tokens_used,
    };
  }

  async extract(input: ExtractInput): Promise<ExtractOutput> {
    const tier = input.tier ?? 'A';
    const provider = tier === 'A' ? this.tierA : this.tierB;

    const prompt = buildExtractionPrompt(input.document_content, input.extraction_schema);
    const result = await provider.generate(prompt);

    return {
      raw_response: result.text,
      tier_used: tier,
      tokens_used: result.tokens_used,
    };
  }
}

function buildExtractionPrompt(
  content: string,
  schema: ExtractInput['extraction_schema'],
): string {
  const fieldDescriptions = schema.fields
    .map(f => `- ${f.name} (${f.type}): ${f.description}${f.required ? ' [REQUIRED]' : ''}`)
    .join('\n');

  return `Extract the following fields from the document below.
Return the result as JSON.

Fields to extract:
${fieldDescriptions}

Document:
${content}`;
}

// --- AI Bridge ---

export interface AIBridge {
  preEvaluateAINodes(
    ast: ASTNode,
    entityData: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

function collectAINodes(
  ast: ASTNode,
  prefix: string = 'ai_result',
): Array<{ node: ASTNode; data_key: string }> {
  const results: Array<{ node: ASTNode; data_key: string }> = [];

  if (ast.handler.startsWith('ai:')) {
    const key = `${prefix}_${ast.handler.replace(':', '_')}`;
    results.push({ node: ast, data_key: key });
  }

  const config = ast.config;
  if (config.conditions && Array.isArray(config.conditions)) {
    for (const child of config.conditions as ASTNode[]) {
      results.push(...collectAINodes(child, prefix));
    }
  }
  if (config.steps && Array.isArray(config.steps)) {
    for (const child of config.steps as ASTNode[]) {
      results.push(...collectAINodes(child, prefix));
    }
  }
  if (config.then && typeof config.then === 'object' && 'handler' in (config.then as object)) {
    results.push(...collectAINodes(config.then as ASTNode, prefix));
  }

  return results;
}

export function createAIBridge(gateway: LLMGateway): AIBridge {
  return {
    async preEvaluateAINodes(
      ast: ASTNode,
      entityData: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const aiNodes = collectAINodes(ast);
      if (aiNodes.length === 0) return {};

      const results: Record<string, unknown> = {};

      for (const { node, data_key } of aiNodes) {
        const config = node.config as Record<string, unknown>;

        if (node.handler === 'ai:document_extract') {
          const extractResult = await gateway.extract({
            document_content: String(config.document_content ?? entityData[config.source_field as string] ?? ''),
            extraction_schema: config.schema as ExtractInput['extraction_schema'],
            tier: 'A',
          });
          results[data_key] = extractResult.raw_response;
        } else {
          const generateResult = await gateway.generate({
            prompt: String(config.prompt ?? JSON.stringify(config)),
            tier: 'A',
          });
          results[data_key] = generateResult.text;
        }
      }

      return results;
    },
  };
}
