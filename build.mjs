import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';

await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
const html = await readFile('index.html', 'utf8');
await writeFile('dist/server/index.js', `const html=${JSON.stringify(html)};export default {async fetch(request){const url=new URL(request.url);if(url.pathname==='/health')return new Response('ok');return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=300','x-content-type-options':'nosniff'}})}};`);
