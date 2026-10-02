// Dev helper for scripted multi-line edits (CRLF-safe). Usage: import { edit } from './_edit.mjs';
import fs from 'node:fs';

export const edit = (path, pairs) => {
  let s = fs.readFileSync(path, 'utf8');
  const crlf = s.includes('\r\n');
  s = s.replace(/\r\n/g, '\n');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(`${path}: missing\n${a.slice(0, 120)}`);
    s = s.replace(a, b);
  }
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
};
