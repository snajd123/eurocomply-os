import type { ExecutionContext } from '@eurocomply/types';

export function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function isFieldReference(value: unknown): value is { field: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'field' in value &&
    typeof (value as Record<string, unknown>).field === 'string'
  );
}

export function isDataReference(value: unknown): value is { data_key: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data_key' in value &&
    typeof (value as Record<string, unknown>).data_key === 'string'
  );
}

export function isInputReference(value: unknown): value is { input_field: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'input_field' in value &&
    typeof (value as Record<string, unknown>).input_field === 'string'
  );
}

export function resolveValue(
  ref: unknown,
  context: ExecutionContext,
  input?: unknown
): unknown {
  if (isFieldReference(ref)) {
    return getNestedValue(context.entity_data, ref.field);
  }
  if (isDataReference(ref)) {
    return getNestedValue(context.data, ref.data_key);
  }
  if (isInputReference(ref)) {
    return getNestedValue(input, ref.input_field);
  }
  return ref;
}
