import { readFile } from 'fs/promises';
import { join } from 'path';
import { PackManifestSchema, type PackManifest } from '@eurocomply/types';
import type { ASTNode } from '@eurocomply/types';
import type { ValidationSuite } from '@eurocomply/kernel-vm';

export interface LoadedPack {
  manifest: PackManifest;
  ruleAST: ASTNode | null;
  validationSuite: ValidationSuite | null;
  directory: string;
}

export async function loadPack(directory: string): Promise<LoadedPack> {
  const manifestPath = join(directory, 'pack.json');
  const raw = await readFile(manifestPath, 'utf-8');
  const manifest = PackManifestSchema.parse(JSON.parse(raw));

  let ruleAST: ASTNode | null = null;
  if (manifest.logic_root) {
    const astPath = join(directory, manifest.logic_root);
    const astRaw = await readFile(astPath, 'utf-8');
    ruleAST = JSON.parse(astRaw) as ASTNode;
  }

  let validationSuite: ValidationSuite | null = null;
  if (manifest.validation_suite) {
    const suitePath = join(directory, manifest.validation_suite);
    const suiteRaw = await readFile(suitePath, 'utf-8');
    validationSuite = JSON.parse(suiteRaw) as ValidationSuite;
  }

  return { manifest, ruleAST, validationSuite, directory };
}
