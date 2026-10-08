// Summarizes the real n8n execution output (out.json) produced by run.sh.
const fs = require('fs');
const txt = fs.readFileSync(__dirname + '/out.json', 'utf8');
const o = JSON.parse(txt.slice(txt.indexOf('\n{') + 1)); // CLI prints log lines before the JSON
const rd = o.data.resultData.runData;
console.log('execution error:', o.data.resultData.error ? o.data.resultData.error.message : 'none', '| status:', o.status, o.finished);
for (const [n, runs] of Object.entries(rd)) console.log(n.padEnd(34), runs.map(r => `${r.executionStatus}[${(r.data && r.data.main || []).map(b => (b || []).length).join('/')}]${r.error ? ' ERR ' + r.error.message : ''}`).join(' '));
const items = (n, b = 0) => (rd[n] || []).flatMap(r => (r.data.main[b] || []).map(i => i.json));
console.log('\nLOGGED:'); for (const r of items('Log to Invoice Log')) console.log(' ', JSON.stringify(r));
console.log('\nNON-PDF:'); for (const r of items('Log Non-PDF')) console.log(' ', JSON.stringify(r));
console.log('\nRENAMES:', JSON.stringify(items('Rename PDF')));
console.log('MOVES:', JSON.stringify(items('Move to Processed')));
console.log('\nEMAILS:'); for (const r of [...items('Email Needs Review'), ...items('Email Failure Alert')]) console.log('  TO', r.to, '|', r.subject, '\n    ' + r.message.replace(/\n/g, '\n    '));
console.log('\nSKIP FILE:', JSON.stringify(items('Skip: File Already Logged').map(i => [i.file_id, i.skip_reason])));
console.log('SKIP DUP:', JSON.stringify(items('Skip: Duplicate Invoice').map(i => [i.source_file_id, i.duplicate_reason])));
console.log('OK only:', JSON.stringify(items('OK: Logged Only')));
const reqs = require(__dirname + '/requests.json');
console.log('\nGemini requests:', reqs.length, reqs.map(r => r.model.replace('gemini-', '') + ':' + r.id).join(', '));
console.log('all prompts identical & non-empty:', new Set(reqs.map(r => r.prompt)).size === 1 && !!reqs[0].prompt, '| schema has 8 props:', reqs.every(r => Object.keys(r.schema.properties).length === 8), '| temp 0:', reqs.every(r => r.temperature === 0));
