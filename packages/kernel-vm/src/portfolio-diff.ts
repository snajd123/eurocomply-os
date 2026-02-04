import { evaluate } from './evaluator.js';
import type { HandlerRegistry } from './registry.js';
import type { ASTNode, ExecutionContext } from '@eurocomply/types';

export interface EntityRecord {
  entity_id: string;
  entity_type: string;
  data: Record<string, unknown>;
}

export interface StatusChange {
  entity_id: string;
  entity_type: string;
  oldStatus: 'compliant' | 'non_compliant' | 'unknown';
  newStatus: 'compliant' | 'non_compliant';
}

export interface PortfolioDiffInput {
  oldRule: ASTNode | null;
  newRule: ASTNode;
  entities: EntityRecord[];
  registry: HandlerRegistry;
  verticalId: string;
}

export interface PortfolioDiffResult {
  totalEvaluated: number;
  statusChanges: StatusChange[];
  newEvaluations: number;
  unchangedCompliant: number;
  unchangedNonCompliant: number;
}

function evaluateEntity(
  rule: ASTNode,
  entity: EntityRecord,
  registry: HandlerRegistry,
  verticalId: string,
): 'compliant' | 'non_compliant' {
  const ctx: ExecutionContext = {
    entity_type: entity.entity_type,
    entity_id: entity.entity_id,
    entity_data: entity.data,
    data: {},
    compliance_lock_id: 'portfolio-diff',
    vertical_id: verticalId,
    market: 'diff',
    timestamp: new Date().toISOString(),
  };
  const result = evaluate(rule, ctx, registry);
  return result.success ? 'compliant' : 'non_compliant';
}

export function portfolioDiff(input: PortfolioDiffInput): PortfolioDiffResult {
  const statusChanges: StatusChange[] = [];
  let newEvaluations = 0;
  let unchangedCompliant = 0;
  let unchangedNonCompliant = 0;

  for (const entity of input.entities) {
    const newStatus = evaluateEntity(input.newRule, entity, input.registry, input.verticalId);

    if (input.oldRule === null) {
      newEvaluations++;
      continue;
    }

    const oldStatus = evaluateEntity(input.oldRule, entity, input.registry, input.verticalId);

    if (oldStatus !== newStatus) {
      statusChanges.push({
        entity_id: entity.entity_id,
        entity_type: entity.entity_type,
        oldStatus,
        newStatus,
      });
    } else if (newStatus === 'compliant') {
      unchangedCompliant++;
    } else {
      unchangedNonCompliant++;
    }
  }

  return {
    totalEvaluated: input.entities.length,
    statusChanges,
    newEvaluations,
    unchangedCompliant,
    unchangedNonCompliant,
  };
}
