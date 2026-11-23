import { A2uiError, A2uiValidationError } from '@a2ui/web_core/errors';
import { mapErrorToRendererMessage } from '@a2ui/web_core/processing';

export class ClassicA2uiValidationError extends A2uiValidationError {
  constructor(readonly reason: string, path?: string, code: 'VALIDATION_FAILED' | 'UNALLOWED_PARENT' | 'UNALLOWED_CHILD' = 'VALIDATION_FAILED') {
    super(`Invalid Classic A2UI: ${reason}`, undefined, code, { path });
  }
}

type WireError = { version: '1.0'; error: { code: string; surfaceId: string; path?: string; message: string } };

export class ClassicA2uiProtocolError extends Error {
  constructor(readonly rendererMessage: WireError) { super(rendererMessage.error.message); }
}

/** Validation feedback only. Do not disclose SDK diagnostics, raw source, or persisted values. */
export function publicationProtocolError(error: unknown, surfaceId: string): ClassicA2uiProtocolError | undefined {
  if (!(error instanceof A2uiError)) return;
  const { error: mapped } = mapErrorToRendererMessage(error, { version: '1.0', surfaceId });
  const composition = ['UNALLOWED_PARENT', 'UNALLOWED_CHILD'].includes(mapped.code);
  const code = composition ? mapped.code : ['INTEGRITY_ERROR', 'CATALOG_NOT_FOUND', 'DATA_ERROR'].includes(mapped.code)
    ? mapped.code : 'VALIDATION_FAILED';
  const path = mapped.path && mapped.path.length <= 256 && !/[\x00-\x1f\x7f]/.test(mapped.path) ? mapped.path : undefined;
  const message = error instanceof ClassicA2uiValidationError ? error.reason : code === 'INTEGRITY_ERROR'
    ? 'The surface update conflicts with its current state.' : 'The renderer rejected the surface definition.';
  return new ClassicA2uiProtocolError({ version: '1.0', error: { code, surfaceId,
    ...(composition || code === 'VALIDATION_FAILED' ? { path: path ?? '/' } : {}), message } });
}
