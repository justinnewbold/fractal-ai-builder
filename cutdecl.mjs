import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import traverseMod from '@babel/traverse'
const traverse = traverseMod.default || traverseMod
const file = process.argv[2]
const names = new Set(process.argv.slice(3))
const src = readFileSync(file, 'utf8')
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
const cuts = []
traverse(ast, {
  VariableDeclaration(path) {
    const p = path.parentPath.type
    if (p !== 'BlockStatement' && p !== 'Program') return
    const d = path.node.declarations[0]
    if (!d?.id?.name || !names.has(d.id.name)) return
    let start = path.node.start
    // take the doc comment directly above it
    const lead = path.node.leadingComments
    if (lead?.length) start = Math.min(start, lead[lead.length - 1].start)
    cuts.push([start, path.node.end, d.id.name, path.node.loc.start.line])
  }
})
cuts.sort((a, b) => b[0] - a[0])
let out = src
for (const [s, e, name, line] of cuts) {
  let end = e
  while (end < out.length && out[end] !== '\n') end++
  out = out.slice(0, s) + out.slice(end + 1)
  console.log(`cut ${name} (line ${line})`)
}
writeFileSync(file, out)
