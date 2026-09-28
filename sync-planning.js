import {copyFile} from 'node:fs/promises';
await copyFile(new URL('./docs/planning.js',import.meta.url),new URL('./supabase/functions/_shared/planning.js',import.meta.url));
console.log('Browser and email planning rules synchronized.');
