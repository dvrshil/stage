#!/usr/bin/env node
// Node runs the TypeScript itself (type stripping, Node 22.18 and later),
// so the command line has no build step. Node 22 still warns about it once
// per run; that warning is noise on an MCP server's stderr, so it is dropped.
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`stage needs Node 22.18 or later; this is ${process.version}`)
  process.exit(1)
}
const emit = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type
  if (type === 'ExperimentalWarning' || /Type Stripping/i.test(String(warning))) return
  emit.call(process, warning, ...rest)
}
await import('../src/cli/index.ts')
