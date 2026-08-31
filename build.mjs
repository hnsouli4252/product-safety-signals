import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';

await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
const html = await readFile('index.html', 'utf8');
const evidence = JSON.parse(await readFile('data/august-2026-recalls.json', 'utf8'));
const worker = `const html=${JSON.stringify(html)};\nconst evidence=${JSON.stringify(evidence)};\nexport default {async fetch(request){const url=new URL(request.url);if(url.pathname==='/health')return new Response('ok',{headers:{'content-type':'text/plain'}});if(url.pathname==='/api/evidence')return Response.json(evidence,{headers:{'cache-control':'public, max-age=300','access-control-allow-origin':'*'}});return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=300','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}})}};`;
await writeFile('dist/server/index.js', worker);
