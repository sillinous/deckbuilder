const fs = require('fs');
const file = 'dist/assets/index--AsrYuaM.js';
const content = fs.readFileSync(file, 'utf8');
const search = 'Gt';
const regex = new RegExp(`.{0,100}${search}.{0,100}`, 'g');
let match;
const matches = [];
while ((match = regex.exec(content)) !== null) {
  matches.push(match[0]);
  if (matches.length > 20) break;
}
console.log(matches.join('\n---\n'));
