import fs from 'node:fs/promises';
const css=await fs.readFile(new URL('./docs/style.css',import.meta.url),'utf8');
const planning=await fs.readFile(new URL('./docs/planning.js',import.meta.url),'utf8');
const app=(await fs.readFile(new URL('./docs/app.js',import.meta.url),'utf8')).replace(/^import .*?;\n/,'');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance desk — Sample preview</title><link rel="icon" href="./favicon.svg"><style>${css}</style></head><body><div id="app"></div><dialog id="dialog" aria-labelledby="dialog-title"></dialog><div id="toast" role="status"></div><script>window.MAINTENANCE_CONFIG={};</script><script type="module">${planning}\n${app}\n</script></body></html>`;
await fs.writeFile(new URL('./docs/preview.html',import.meta.url),html);
console.log('Created self-contained sample preview. Open docs/preview.html in a browser.');
