import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const files = readdirSync('dist/assets').filter((name) => name.endsWith('.js'));
assert(files.length, 'No client JavaScript assets were built');
const source = files.map((name) => readFileSync('dist/assets/' + name, 'utf8')).join('\n');
for (const value of ['generativelanguage.googleapis.com', 'x-goog-api-key', 'GEMINI_API_KEY']) {
  assert(!source.includes(value), 'Server Gemini code was included in the client bundle');
}
if (process.env.GEMINI_API_KEY) {
  assert(
    !source.includes(process.env.GEMINI_API_KEY),
    'A server secret was included in the client bundle',
  );
}
console.log('Client bundle contains no Gemini transport or server key.');
