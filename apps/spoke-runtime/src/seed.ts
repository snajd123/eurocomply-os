import { readFile } from 'fs/promises';
import type { EntityService } from '@eurocomply/platform-services';
import type { PlatformServiceContext } from '@eurocomply/platform-services';

interface SeedData {
  entity_types: Array<{
    entity_type: string;
    schema: { fields: Array<{ name: string; type: string; required?: boolean }> };
  }>;
  entities: Record<string, Array<Record<string, unknown>>>;
}

export async function loadSeedData(
  seedFile: string,
  entityService: EntityService,
  ctx: PlatformServiceContext,
): Promise<{ typesCreated: number; entitiesCreated: number }> {
  const raw = await readFile(seedFile, 'utf-8');
  const seed: SeedData = JSON.parse(raw);

  let typesCreated = 0;
  for (const typeDef of seed.entity_types) {
    await entityService.defineType(ctx, typeDef);
    typesCreated++;
  }

  let entitiesCreated = 0;
  for (const [entityType, entities] of Object.entries(seed.entities)) {
    for (const data of entities) {
      await entityService.create(ctx, { entity_type: entityType, data });
      entitiesCreated++;
    }
  }

  return { typesCreated, entitiesCreated };
}
