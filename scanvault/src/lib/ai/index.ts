import { getPrefs } from '../prefs';
import { claudeEngine } from './claude';
import { localEngine } from './local';
import type { AiEngine } from './types';

export { claudeAvailable } from './claude';
export type { AiEngine, DocContext, ImageStats } from './types';

export function currentEngine(): AiEngine {
  return getPrefs().aiEngine === 'claude' ? claudeEngine : localEngine;
}

/** Run with the selected engine; if Claude is unreachable, fall back to on-device. */
export async function withEngine<T>(fn: (e: AiEngine) => Promise<T>): Promise<{ value: T; engine: 'local' | 'claude'; fellBack?: string }> {
  const engine = currentEngine();
  try {
    return { value: await fn(engine), engine: engine.id };
  } catch (err) {
    if (engine.id === 'local') throw err;
    return { value: await fn(localEngine), engine: 'local', fellBack: (err as Error).message };
  }
}
