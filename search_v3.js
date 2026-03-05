import fs from 'fs';
import path from 'path';

const file = 'dist/assets/index-lnNI-145.js';
const searchStr = 'Gt';

if (!fs.existsSync(file)) {
    console.error(`Error: File not found at ${file}`);
    process.exit(1);
}

const data = fs.readFileSync(file, 'utf8');

console.log(`\n🔍 SEARCHING FOR "${searchStr}" IN ${file}...\n`);

// 1. Find Definitions (const, let, var, function, class)
const defRegex = new RegExp(`(?:const|let|var|function|class)\\s+${searchStr}\\b`, 'g');
const definitions = [];
let match;
while ((match = defRegex.exec(data)) !== null) {
    const start = Math.max(0, match.index - 50);
    const end = Math.min(data.length, match.index + match[0].length + 50);
    definitions.push({
        context: data.substring(start, end).replace(/\n/g, ' '),
        index: match.index
    });
}

if (definitions.length > 0) {
    console.log(`✅ FOUND ${definitions.length} DEFINITION(S):`);
    definitions.forEach((d, i) => {
        console.log(`  [${i + 1}] ...${d.context}... (index: ${d.index})`);
    });
} else {
    console.log(`❌ NO DEFINITIONS FOUND FOR "${searchStr}".`);
}

console.log('\n' + '-'.repeat(50) + '\n');

// 2. Find All Usages with More Context
const usageRegex = new RegExp(`.{0,60}${searchStr}.{0,60}`, 'g');
const usages = [];
while ((match = usageRegex.exec(data)) !== null) {
    // Basic filter to avoid showing the definition again if it's already caught
    const isDef = definitions.some(d => Math.abs(d.index - match.index) < 20);
    usages.push({
        context: match[0].replace(/\n/g, ' '),
        index: match.index,
        isDef
    });
    if (usages.length >= 30) break; // Cap results
}

console.log(`📋 TOP ${usages.length} USAGES/CONTEXTUAL MATCHES:`);
usages.forEach((u, i) => {
    const prefix = u.isDef ? '⭐ [DEF]' : `   [${i + 1}]`;
    console.log(`${prefix} ...${u.context}...`);
});

if (usages.length >= 30) {
    console.log('\n... (results capped at 30)');
}

console.log(`\n✅ SEARCH COMPLETE.\n`);
