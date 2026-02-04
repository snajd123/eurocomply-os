import type { EntityService } from './services/entity.js';
import type { RelationService } from './services/relation.js';
import type { AuditLogger } from './services/audit.js';
import type { AIBridge } from './services/llm-gateway.js';
import type { PostgresConnectionManager } from './db/postgres.js';
import type { PlatformServiceContext } from './context.js';
import type { HandlerRegistry } from '@eurocomply/kernel-vm';
import { evaluate, isDataReference } from '@eurocomply/kernel-vm';
import type {
  ServiceResult, ASTNode, HandlerResult, ExecutionContext,
} from '@eurocomply/types';

export interface EvaluateInput {
  entity_type: string;
  entity_id: string;
  rule: ASTNode;
  compliance_lock_id: string;
  vertical_id: string;
  market: string;
  data?: Record<string, unknown>;
}

export interface EvaluateOutput {
  handler_result: HandlerResult;
  entity_id: string;
  entity_type: string;
  compliance_lock_id: string;
}

function collectDataKeys(ast: ASTNode): Set<string> {
  const keys = new Set<string>();

  function walkValue(val: unknown): void {
    if (val && typeof val === 'object') {
      if (isDataReference(val)) {
        keys.add((val as { data_key: string }).data_key);
        return;
      }
      if (Array.isArray(val)) {
        for (const item of val) walkValue(item);
      } else {
        for (const v of Object.values(val as Record<string, unknown>)) walkValue(v);
      }
    }
  }

  walkValue(ast.config);

  const config = ast.config;
  if (config.conditions && Array.isArray(config.conditions)) {
    for (const child of config.conditions as ASTNode[]) {
      for (const key of collectDataKeys(child)) keys.add(key);
    }
  }
  if (config.steps && Array.isArray(config.steps)) {
    for (const child of config.steps as ASTNode[]) {
      for (const key of collectDataKeys(child)) keys.add(key);
    }
  }
  if (config.then && typeof config.then === 'object' && 'handler' in (config.then as object)) {
    for (const key of collectDataKeys(config.then as ASTNode)) keys.add(key);
  }

  return keys;
}

export class ExecutionLoop {
  constructor(
    private db: PostgresConnectionManager,
    private entityService: EntityService,
    private audit: AuditLogger,
    private registry: HandlerRegistry,
    private relationService?: RelationService,
    private aiBridge?: AIBridge,
  ) {}

  async evaluate(
    ctx: PlatformServiceContext,
    input: EvaluateInput,
  ): Promise<ServiceResult<EvaluateOutput>> {
    const uow = await this.db.beginTransaction();
    const txCtx: PlatformServiceContext = { ...ctx, tx: uow };

    try {
      // Phase 1: Assemble ExecutionContext
      const entityResult = await this.entityService.get(txCtx, {
        entity_type: input.entity_type,
        entity_id: input.entity_id,
      });

      if (!entityResult.success) {
        await uow.rollback();
        return {
          success: false,
          data: {
            handler_result: {
              success: false,
              value: null,
              explanation: { summary: `Entity ${input.entity_id} not found`, steps: [] },
              trace: {
                handler_id: 'execution_loop',
                handler_version: '1.0.0',
                duration_ms: 0,
                input: input,
                output: null,
                execution_path: 'root',
                status: 'error',
                error: { message: `Entity ${input.entity_id} not found` },
              },
            },
            entity_id: input.entity_id,
            entity_type: input.entity_type,
            compliance_lock_id: input.compliance_lock_id,
          },
        };
      }

      // Phase 1a: Pre-load graph data for { data_key } references
      // RelationService reads from Neo4j — doesn't need PG transaction
      const preloadedData: Record<string, unknown> = { ...(input.data ?? {}) };

      if (this.relationService) {
        const dataKeys = collectDataKeys(input.rule);
        for (const key of dataKeys) {
          if (preloadedData[key] !== undefined) continue;
          const relResult = await this.relationService.list(ctx, {
            entity_type: input.entity_type,
            entity_id: input.entity_id,
            direction: 'both',
          });
          if (relResult.success) {
            preloadedData[key] = relResult.data.items;
          }
        }
      }

      // Phase 1b: Pre-evaluate AI nodes via bridge
      if (this.aiBridge) {
        const aiResults = await this.aiBridge.preEvaluateAINodes(
          input.rule,
          entityResult.data.data,
        );
        Object.assign(preloadedData, aiResults);
      }

      const executionContext: ExecutionContext = {
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        entity_data: entityResult.data.data,
        data: preloadedData,
        compliance_lock_id: input.compliance_lock_id,
        vertical_id: input.vertical_id,
        market: input.market,
        timestamp: new Date().toISOString(),
      };

      // Phase 2: Kernel VM evaluates (pure, synchronous)
      const handlerResult = evaluate(input.rule, executionContext, this.registry);

      // Normalize the handler result: success means "executed without error",
      // the compliance outcome is in value.pass. The kernel-vm uses makeFailure
      // for non-compliant results (success=false), but at the platform level
      // a successful execution that returns pass=false is still a successful evaluation.
      const normalizedResult: HandlerResult = {
        ...handlerResult,
        success: true,
        trace: {
          ...handlerResult.trace,
          status: 'success',
        },
      };

      // Phase 3: Persist audit entry (within same transaction)
      await this.audit.log(txCtx, {
        action: 'evaluate',
        resource: { entity_type: input.entity_type, entity_id: input.entity_id },
        changes: {
          fields_changed: ['compliance_evaluation'],
          after: {
            compliance_lock_id: input.compliance_lock_id,
            pass: handlerResult.value && typeof handlerResult.value === 'object' && 'pass' in handlerResult.value
              ? (handlerResult.value as { pass: boolean }).pass
              : handlerResult.success,
            handler_id: input.rule.handler,
          },
        },
        success: true,
      });

      await uow.commit();

      return {
        success: true,
        data: {
          handler_result: normalizedResult,
          entity_id: input.entity_id,
          entity_type: input.entity_type,
          compliance_lock_id: input.compliance_lock_id,
        },
      };
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
