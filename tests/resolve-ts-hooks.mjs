// Hook de resolución para `node --test`: resuelve imports relativos SIN extensión
// a `.ts` (el código de la app usa imports extensionless tipo `./config`, que
// funcionan bajo el bundler de Next pero no bajo el ESM crudo de Node). Solo
// reescribe el specifier; el type-stripping nativo de Node sigue su curso.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExt = /\.(ts|tsx|js|mjs|cjs|json|node)$/.test(specifier);
  if (relative && !hasExt && context.parentURL) {
    const candidate = new URL(specifier + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return nextResolve(specifier + ".ts", context);
  }
  return nextResolve(specifier, context);
}
