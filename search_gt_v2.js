import fs from 'fs';
const data = fs.readFileSync('dist/assets/index--AsrYuaM.js', 'utf8');
const searchStr = 'Gt';

// Find definition
const defRegex = new RegExp(`(?:const|let|var|function)\\s+${searchStr}\\b`, 'g');
const usages = [];
let match;
const contextRegex = new RegExp(`.{0,100}${searchStr}.{0,100}`, 'g');
while((match = contextRegex.exec(data)) !== null) {
    usages.push(match[0]);
    if (usages.length > 20) break;
}

console.log('USAGES OF Gt:');
console.log(usages.join('\n---\n'));
