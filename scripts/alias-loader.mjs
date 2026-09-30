const projectRoot = new URL('../', import.meta.url);

export function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context);

  const projectPath = specifier.slice(2);
  if (!projectPath || projectPath.split('/').includes('..')) {
    throw new Error(`Alias de proyecto no válido: ${specifier}`);
  }

  return nextResolve(new URL(projectPath, projectRoot).href, context);
}
