// Just enough of node:fs for tests that read source files (vitest runs in Node), without @types/node.
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}
