import { getRuntime } from '@fc/game-runtime';
import { registerBuiltinRuntimes } from '@fc/game-templates/register-runtimes';

let registered = false;

export function ensureRuntimesRegistered() {
  if (registered) return;
  registerBuiltinRuntimes();
  registered = true;
}

export { getRuntime };
