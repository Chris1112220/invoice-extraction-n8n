// Offline test suite for workflow/invoice-pdf-to-sheet.json
//   cd tests && npm install && npm test        (writes tests/results.md)
// 1) Structural checks on the workflow JSON.
// 2) Scenario tests: the real Code-node JavaScript, IF conditions, Config (Set) node and
//    parameter expressions are run by tests/n8n-sim.js, with Google Drive / Sheets / Gmail /
//    Gemini mocked. Gemini responses for the 5 sample PDFs use the values printed on the PDFs
//    (checked with `pdftotext -layout`).
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Settings } = require('luxon');
const { Sim } = require('./n8n-sim');

const ROOT = path.join(__dirname, '..');
const WF_PATH = process.env.WORKFLOW_FILE || path.join(ROOT, 'workflow', 'invoice-pdf-to-sheet.json');
const raw = fs.readFileSync(WF_PATH, 'utf8');
const results = [];
const record = (group, name, expected, fn) => {
  try { const got = fn(); results.push({ group, name, expected, got: got || 'as expected', pass: true }); }
  catch (e) { results.push({ group, name, expected, got: e.message.split('\n')[0], pass: false }); }
};

// ------------------------------------------------------------------ 1. structure
let wf;
record('structure', 'Workflow JSON parses', 'valid JSON', () => { wf = JSON.parse(raw); return `${wf.nodes.length} nodes`; });
const KNOWN = {
  'n8n-nodes-base.googleDriveTrigger': [1], 'n8n-nodes-base.manualTrigger': [1], 'n8n-nodes-base.googleDrive': [3],
  'n8n-nodes-base.set': [3.4], 'n8n-nodes-base.if': [2], 'n8n-nodes-base.code': [2], 'n8n-nodes-base.noOp': [1],
  'n8n-nodes-base.extractFromFile': [1], 'n8n-nodes-base.httpRequest': [4.2], 'n8n-nodes-base.googleSheets': [4.5],
  'n8n-nodes-base.gmail': [2.1], 'n8n-nodes-base.stickyNote': [1],
};
const TRIGGERS = new Set(['n8n-nodes-base.googleDriveTrigger', 'n8n-nodes-base.manualTrigger']);
const names = new Set(wf.nodes.map(n => n.name));
const flowNodes = wf.nodes.filter(n => n.type !== 'n8n-nodes-base.stickyNote');
record('structure', 'Node ids and names are unique', 'no duplicates', () => {
  assert.strictEqual(new Set(wf.nodes.map(n => n.id)).size, wf.nodes.length, 'duplicate id');
  assert.strictEqual(names.size, wf.nodes.length, 'duplicate name');
  wf.nodes.forEach(n => assert.ok(n.id, `${n.name} has no id`));
});
record('structure', 'Node types/typeVersions are ones this workflow already used (or standard Set/NoOp/Sticky)', 'all known', () => {
  for (const n of wf.nodes) assert.ok((KNOWN[n.type] || []).includes(n.typeVersion), `${n.name}: ${n.type} v${n.typeVersion}`);
});
const incoming = {}; const edges = [];
record('structure', 'Every connection points to an existing node', 'no dangling links', () => {
  for (const [src, c] of Object.entries(wf.connections)) {
    assert.ok(names.has(src), `source "${src}" missing`);
    for (const [type, outs] of Object.entries(c)) {
      assert.strictEqual(type, 'main');
      outs.forEach((targets, outIdx) => (targets || []).forEach(t => {
        assert.ok(names.has(t.node), `"${src}" -> missing "${t.node}"`);
        assert.strictEqual(t.type, 'main'); assert.strictEqual(t.index, 0);
        (incoming[t.node] = incoming[t.node] || []).push(src); edges.push([src, outIdx, t.node]);
      }));
    }
  }
  return `${edges.length} connections`;
});
const ancestors = name => { const seen = new Set(); const st = [...(incoming[name] || [])]; while (st.length) { const a = st.pop(); if (!seen.has(a)) { seen.add(a); st.push(...(incoming[a] || [])); } } return seen; };
record('structure', 'No orphan nodes (all non-trigger nodes have an input and are reachable from a trigger; sticky note excluded)', 'none', () => {
  const reach = new Set(); const st = flowNodes.filter(n => TRIGGERS.has(n.type)).map(n => n.name);
  while (st.length) { const n = st.pop(); if (reach.has(n)) continue; reach.add(n); for (const outs of (wf.connections[n] || {}).main || []) for (const t of outs || []) st.push(t.node); }
  for (const n of flowNodes) {
    if (!TRIGGERS.has(n.type)) assert.ok(incoming[n.name], `${n.name} has no input`);
    assert.ok(reach.has(n.name), `${n.name} unreachable`);
  }
});
record('structure', "Every $('Node') reference names an existing upstream node", 'all resolve', () => {
  let count = 0;
  for (const n of wf.nodes) {
    const text = JSON.stringify(n.parameters);
    for (const m of text.matchAll(/\$\(\\?['"]([^'"\\]+)\\?['"]\)/g)) {
      count++;
      assert.ok(names.has(m[1]), `${n.name} references missing node "${m[1]}"`);
      assert.ok(ancestors(n.name).has(m[1]), `${n.name} references "${m[1]}", which is not upstream`);
    }
  }
  return `${count} references checked`;
});
record('structure', 'All Code nodes compile', 'no syntax errors', () => {
  const code = wf.nodes.filter(n => n.type === 'n8n-nodes-base.code');
  for (const n of code) { try { new Function(n.parameters.jsCode); } catch (e) { throw new Error(`${n.name}: ${e.message}`); } }
  return `${code.length} Code nodes`;
});
record('structure', 'Prompt + schema defined once (Config); all 3 Gemini nodes share one body expression', '1 copy, 3 references', () => {
  const g = wf.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest');
  assert.strictEqual(g.length, 3);
  assert.strictEqual(new Set(g.map(n => n.parameters.jsonBody)).size, 1, 'bodies differ');
  assert.ok(g[0].parameters.jsonBody.includes("$('Config').first().json.extractionPrompt"));
  assert.ok(g[0].parameters.jsonBody.includes("$('Config').first().json.responseSchema"));
  assert.strictEqual(raw.split('accounts-payable data extraction assistant').length - 1, 1, 'prompt text appears more than once');
  assert.strictEqual(raw.split('invoice_number').length - 1 >= 1, true);
});
record('structure', 'All 3 Gemini nodes have a connected error output; the last one routes to the failure alert', 'yes', () => {
  for (const n of wf.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest')) {
    assert.strictEqual(n.onError, 'continueErrorOutput', n.name);
    assert.ok(((wf.connections[n.name].main[1]) || []).length, `${n.name} error output not connected`);
  }
  assert.strictEqual(wf.connections['Fallback: Gemini 3.7 Flash'].main[1][0].node, 'Build Failure Alert');
});
record('structure', 'Placeholders present', '4 placeholders', () => {
  for (const p of ['YOUR_INBOX_FOLDER_ID', 'YOUR_PROCESSED_FOLDER_ID', 'YOUR_INVOICE_LOG_SHEET_ID', 'you@example.com']) assert.ok(raw.includes(p), p);
});

// ------------------------------------------------------------------ 2. scenarios
const FIXED_NOW = Date.parse('2026-10-09T02:30:00Z'); // 10:30 PM ET on Oct 8; UTC is already Oct 9
Settings.now = () => FIXED_NOW;
const ET_DATE = '2026-10-08';
const ET_STAMP = '2026-10-08 22:30:00 EDT';
const cfgNode = wf.nodes.find(n => n.name === 'Config');
const CFG = cfgNode ? Object.fromEntries(cfgNode.parameters.assignments.assignments.map(a => [a.name, a.type === 'object' ? JSON.parse(a.value) : a.value])) : {};

const PDF_DIR = path.join(ROOT, 'test-data', 'invoices');
const SAMPLES = {
  '01_clean_liberty_bell.pdf': { vendor: 'Liberty Bell Office Supply', invoice_number: 'INV-10482', invoice_date: '2026-09-15', due_date: '2026-10-15', due_date_note: null, subtotal: 1236.00, tax: 74.16, total: 1310.16 },
  '02_clean_schuylkill_it.pdf': { vendor: 'Schuylkill IT Services LLC', invoice_number: 'SIT-2026-0917', invoice_date: '2026-09-17', due_date: '2026-10-17', due_date_note: null, subtotal: 3500.00, tax: 0.00, total: 3500.00 },
  '03_math_error_fishtown_print.pdf': { vendor: 'Fishtown Print & Copy', invoice_number: '7731', invoice_date: '2026-09-22', due_date: '2026-10-22', due_date_note: null, subtotal: 860.00, tax: 51.60, total: 921.60 },
  '04_missing_invoice_number_rittenhouse.pdf': { vendor: 'Rittenhouse Cleaning Co.', invoice_number: null, invoice_date: '2026-09-25', due_date: '2026-10-10', due_date_note: null, subtotal: 450.00, tax: 27.00, total: 477.00 },
  '05_no_due_date_delaware_valley.pdf': { vendor: 'Delaware Valley Courier', invoice_number: '55-0193', invoice_date: '2026-09-28', due_date: null, due_date_note: 'Due upon receipt', subtotal: 312.50, tax: 25.00, total: 337.50 },
};
const geminiOk = (fields, model, asText) => ({
  candidates: [{ content: { role: 'model', parts: [{ text: asText !== undefined ? asText : JSON.stringify(fields) }] }, finishReason: 'STOP', index: 0 }],
  usageMetadata: { promptTokenCount: 1290, candidatesTokenCount: 95 }, modelVersion: model,
});
const httpError = (msg) => Object.assign(new Error(msg), { description: 'mock HTTP error' });
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.7-flash'];

// files: [{id,name,mimeType,fields?, plan?}] ; plan[model] = 'ok' | 'empty' | 'blocked' | 'error' | 'badjson' | 'fenced' | fn
function runScenario({ files, trigger = 'drive', sheetRows = [], staticData }) {
  const byId = Object.fromEntries(files.map(f => [f.id, f]));
  const mocks = {
    sheetRows, staticData, inboxFiles: files.map(({ id, name, mimeType }) => ({ id, name, mimeType })),
    fileBase64: id => {
      const f = byId[id]; const p = path.join(PDF_DIR, f.pdf || f.name);
      return fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : Buffer.from('%PDF-1.4 fake').toString('base64');
    },
    gemini: (model, body) => {
      // Request-shape checks: shared prompt + schema from Config, PDF bytes attached.
      const parts = body.contents[0].parts;
      if (cfgNode) {
        assert.strictEqual(parts[0].text, CFG.extractionPrompt, 'prompt not taken from Config');
        assert.deepStrictEqual(body.generationConfig.responseSchema, CFG.responseSchema, 'schema not taken from Config');
      }
      assert.strictEqual(body.generationConfig.temperature, 0);
      const pdf = Buffer.from(parts[1].inline_data.data, 'base64');
      assert.ok(pdf.subarray(0, 4).toString() === '%PDF', 'attachment is not a PDF');
      const f = files.find(x => mocks.fileBase64(x.id) === parts[1].inline_data.data);
      const step = (f.plan && f.plan[model]) || 'ok';
      if (step === 'error') throw httpError(`429 - RESOURCE_EXHAUSTED quota exceeded for ${model}`);
      if (step === 'empty') return { candidates: [], usageMetadata: {}, modelVersion: model };
      if (step === 'blocked') return { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: {}, modelVersion: model };
      if (step === 'badjson') return geminiOk(null, model, '{"vendor": "Liberty Bell Office Supply", "invoice_number": "INV-10482", "total": 13');
      if (step === 'fenced') return geminiOk(null, model, '```json\n' + JSON.stringify(f.fields) + '\n```');
      return geminiOk(f.fields, model);
    },
  };
  const sim = new Sim(wf, mocks);
  if (trigger === 'drive') sim.run('Google Drive Trigger', files.map(({ id, name, mimeType }) => ({ id, name, mimeType, kind: 'drive#file' })));
  else sim.run('Reprocess Inbox (manual)', [{}]);
  return sim;
}
const outOf = (sim, node) => ((sim.runData[node] || []).flatMap(r => r.outputs[0] || [])).map(i => i.json);
const validated = (sim) => outOf(sim, 'Validate Invoice');
const logRows = (sim) => sim.log.sheetAppends.filter(a => a.node === 'Log to Invoice Log').map(a => a.row);
const describe = (sim) => {
  const v = validated(sim);
  const st = v.map(x => x.status + (x.notes ? `: "${x.notes}"` : '')).join(' | ') || '(not validated)';
  const mails = sim.log.emails.map(e => e.subject).join(' | ') || 'no email';
  return `${st}; ${logRows(sim).length} logged; ${sim.log.renames.length} renamed; ${sim.log.moves.length} moved; ${mails}`;
};
const pdf = (n, extra = {}) => ({ id: `drv_${n.slice(0, 2)}`, name: n, mimeType: 'application/pdf', fields: SAMPLES[n], ...extra });
const noError = sim => { if (sim.error) throw new Error('Execution failed: ' + sim.error.message); };

const sampleCases = [
  ['01_clean_liberty_bell.pdf', 'OK', '', '2026-09_LibertyBellOfficeSupply_INV10482.pdf'],
  ['02_clean_schuylkill_it.pdf', 'OK', '', '2026-09_SchuylkillITServicesLLC_SIT20260917.pdf'],
  ['03_math_error_fishtown_print.pdf', 'Needs Review', 'Total mismatch: subtotal + tax = 911.60, invoice says 921.60', '2026-09_FishtownPrintCopy_7731.pdf'],
  ['04_missing_invoice_number_rittenhouse.pdf', 'Needs Review', 'Missing Invoice #', '2026-09_RittenhouseCleaningCo_NOINV.pdf'],
  ['05_no_due_date_delaware_valley.pdf', 'Needs Review', 'No due date (Due upon receipt)', '2026-09_DelawareValleyCourier_550193.pdf'],
];
for (const [file, status, notes, newName] of sampleCases) {
  const exp = `${status}${notes ? ` ("${notes}")` : ''}; logged; renamed ${newName}; moved; ${status === 'OK' ? 'no email' : 'Needs Review email'}`;
  record('sample PDFs', file, exp, () => {
    const sim = runScenario({ files: [pdf(file)] }); noError(sim);
    const [v] = validated(sim);
    assert.strictEqual(v.status, status); assert.strictEqual(v.notes, notes);
    assert.strictEqual(v.new_file_name, newName);
    assert.strictEqual(v.model_used, 'Gemini 3.5 Flash Lite');
    const [row] = logRows(sim);
    assert.ok(row, 'not logged');
    assert.strictEqual(row['Source File ID'], `drv_${file.slice(0, 2)}`);
    assert.strictEqual(row['Date Processed'], ET_DATE); assert.strictEqual(row['Processed At'], ET_STAMP);
    assert.strictEqual(row['Model Used'], 'Gemini 3.5 Flash Lite');
    assert.strictEqual(row['Due Date Note'], SAMPLES[file].due_date_note);
    assert.deepStrictEqual(sim.log.renames, [{ fileId: `drv_${file.slice(0, 2)}`, name: newName }]);
    assert.deepStrictEqual(sim.log.moves, [{ fileId: `drv_${file.slice(0, 2)}`, folderId: 'YOUR_PROCESSED_FOLDER_ID' }]);
    assert.strictEqual(sim.log.emails.length, status === 'OK' ? 0 : 1);
    if (status !== 'OK') {
      const m = sim.log.emails[0];
      assert.strictEqual(m.to, 'you@example.com'); assert.ok(m.subject.startsWith('[Needs Review]'));
      assert.ok(m.message.includes(notes)); assert.ok(m.message.includes(`https://drive.google.com/file/d/drv_${file.slice(0, 2)}/view`));
    }
    return describe(sim);
  });
}

record('batch', 'Reprocess Inbox backfill: all 5 samples at once, empty sheet', '5 logged/renamed/moved, 3 Needs Review emails, 0 OK emails', () => {
  const sim = runScenario({ files: Object.keys(SAMPLES).map(n => pdf(n)), trigger: 'manual' }); noError(sim);
  assert.strictEqual(logRows(sim).length, 5); assert.strictEqual(sim.log.moves.length, 5);
  assert.strictEqual(sim.log.emails.length, 3);
  assert.ok(sim.log.emails.every(e => e.subject.startsWith('[Needs Review]')));
  assert.strictEqual(sim.log.sheetReads, 1, 'sheet should be read once per execution');
  return describe(sim).replace(/^.*?; (\d+ logged)/, '$1');
});

record('edge', 'Empty candidates from all 3 models', 'tries 3 models, failure-alert email with file name/ID + reason, nothing logged/renamed', () => {
  const sim = runScenario({ files: [pdf('01_clean_liberty_bell.pdf', { plan: { [MODELS[0]]: 'empty', [MODELS[1]]: 'empty', [MODELS[2]]: 'empty' } })] }); noError(sim);
  assert.deepStrictEqual(sim.log.geminiCalls.map(c => c.model), MODELS);
  assert.strictEqual(logRows(sim).length, 0); assert.strictEqual(sim.log.renames.length, 0);
  assert.strictEqual(sim.log.emails.length, 1);
  const m = sim.log.emails[0];
  assert.strictEqual(m.subject, '[Extraction Failed] 01_clean_liberty_bell.pdf');
  assert.ok(m.message.includes('drv_01')); assert.ok(m.message.includes('no usable content (empty response)'), m.message);
  return `${m.subject}; "${m.message.split('\n').find(l => l.startsWith('Error'))}"`;
});
record('edge', 'Empty candidates from primary, fallback 3.1 answers', 'falls back, OK, Model Used = Gemini 3.1 Flash Lite', () => {
  const sim = runScenario({ files: [pdf('01_clean_liberty_bell.pdf', { plan: { [MODELS[0]]: 'empty' } })] }); noError(sim);
  assert.deepStrictEqual(sim.log.geminiCalls.map(c => c.model), MODELS.slice(0, 2));
  assert.strictEqual(logRows(sim)[0]['Model Used'], 'Gemini 3.1 Flash Lite');
  assert.strictEqual(validated(sim)[0].status, 'OK');
  return describe(sim);
});
record('edge', 'Prompt blocked (promptFeedback.blockReason=SAFETY) on all 3', 'failure alert naming SAFETY, nothing logged', () => {
  const sim = runScenario({ files: [pdf('03_math_error_fishtown_print.pdf', { plan: Object.fromEntries(MODELS.map(m => [m, 'blocked'])) })] }); noError(sim);
  assert.strictEqual(logRows(sim).length, 0); assert.strictEqual(sim.log.emails.length, 1);
  assert.ok(sim.log.emails[0].message.includes('(SAFETY)'));
  return sim.log.emails[0].subject;
});
record('edge', 'HTTP error (429) on all 3 models', 'failure alert with the last error message, nothing logged', () => {
  const sim = runScenario({ files: [pdf('02_clean_schuylkill_it.pdf', { plan: Object.fromEntries(MODELS.map(m => [m, 'error'])) })] }); noError(sim);
  assert.strictEqual(logRows(sim).length, 0); assert.strictEqual(sim.log.emails.length, 1);
  assert.ok(sim.log.emails[0].message.includes('429 - RESOURCE_EXHAUSTED quota exceeded for gemini-3.7-flash'));
  return sim.log.emails[0].subject;
});
record('edge', 'HTTP 429 on primary, then 3.1 returns empty, then 3.7 answers', 'OK via Gemini 3.7 Flash', () => {
  const sim = runScenario({ files: [pdf('02_clean_schuylkill_it.pdf', { plan: { [MODELS[0]]: 'error', [MODELS[1]]: 'empty' } })] }); noError(sim);
  assert.strictEqual(logRows(sim)[0]['Model Used'], 'Gemini 3.7 Flash'); assert.strictEqual(sim.log.emails.length, 0);
  return describe(sim);
});
record('edge', 'Malformed JSON from Gemini (truncated object)', 'no crash; Needs Review "AI response was not valid JSON ... Enter this invoice manually"; original file name kept; email', () => {
  const sim = runScenario({ files: [pdf('01_clean_liberty_bell.pdf', { plan: { [MODELS[0]]: 'badjson' } })] }); noError(sim);
  const [v] = validated(sim);
  assert.strictEqual(v.status, 'Needs Review');
  assert.ok(/^AI response was not valid JSON \(.+\)\. Enter this invoice manually$/.test(v.notes), v.notes);
  assert.strictEqual(v.new_file_name, '01_clean_liberty_bell.pdf');
  assert.strictEqual(logRows(sim).length, 1); assert.strictEqual(sim.log.emails.length, 1);
  return describe(sim);
});
record('edge', 'Gemini wraps JSON in ```json fences', 'parsed normally, OK', () => {
  const sim = runScenario({ files: [pdf('01_clean_liberty_bell.pdf', { plan: { [MODELS[0]]: 'fenced' } })] }); noError(sim);
  assert.strictEqual(validated(sim)[0].status, 'OK');
  return describe(sim);
});
const loggedRow = (file, id, n) => ({ 'Date Processed': '2026-10-04', Vendor: SAMPLES[file].vendor, 'Invoice #': SAMPLES[file].invoice_number, Status: 'Needs Review', 'Source File ID': id, 'File Name': n });
record('dedupe', 'Same Drive file seen again (file ID already in Invoice Log)', 'skipped before download: 0 Gemini calls, no log/rename/move/email', () => {
  const sim = runScenario({ files: [pdf('05_no_due_date_delaware_valley.pdf')], sheetRows: [loggedRow('05_no_due_date_delaware_valley.pdf', 'drv_05', 'x.pdf')] }); noError(sim);
  assert.strictEqual(sim.log.downloads.length, 0); assert.strictEqual(sim.log.geminiCalls.length, 0);
  assert.strictEqual(sim.log.sheetAppends.length + sim.log.renames.length + sim.log.moves.length + sim.log.emails.length, 0);
  assert.ok(sim.log.executed.includes('Skip: File Already Logged'));
  return 'routed to "Skip: File Already Logged"';
});
record('dedupe', 'Re-uploaded copy (new file ID) of an already-logged invoice; vendor/invoice # differ only in format ("Delaware Valley Courier LLC", "55 0193")', 'skipped after extraction: no log/rename/move/email', () => {
  const f = pdf('05_no_due_date_delaware_valley.pdf', { id: 'drv_NEW', name: 'scan_0042.pdf', pdf: '05_no_due_date_delaware_valley.pdf' });
  f.fields = { ...f.fields, vendor: 'Delaware Valley Courier LLC', invoice_number: '55 0193' };
  const sim = runScenario({ files: [f], sheetRows: [loggedRow('05_no_due_date_delaware_valley.pdf', 'drv_05', 'x.pdf')] }); noError(sim);
  assert.strictEqual(sim.log.geminiCalls.length, 1);
  assert.strictEqual(sim.log.sheetAppends.length + sim.log.renames.length + sim.log.moves.length + sim.log.emails.length, 0);
  const d = outOf(sim, 'Check Duplicate Invoice')[0];
  assert.ok(d.is_duplicate); assert.ok(d.duplicate_reason.includes('sheet row 2'), d.duplicate_reason);
  return `"${d.duplicate_reason}"`;
});
record('dedupe', 'Two copies of the same invoice in one backfill (different file IDs)', 'first logged, second skipped', () => {
  const a = pdf('01_clean_liberty_bell.pdf', { id: 'drv_A' }); const b = pdf('01_clean_liberty_bell.pdf', { id: 'drv_B', name: 'copy.pdf', pdf: '01_clean_liberty_bell.pdf' });
  const sim = runScenario({ files: [a, b], trigger: 'manual' }); noError(sim);
  assert.strictEqual(logRows(sim).length, 1); assert.strictEqual(logRows(sim)[0]['Source File ID'], 'drv_A');
  return describe(sim);
});
record('dedupe', 'Two copies in one run, answered by different models (Parse/Check Duplicate run twice)', 'still only one logged', () => {
  const a = pdf('01_clean_liberty_bell.pdf', { id: 'drv_A' });
  const b = { id: 'drv_B', name: 'copy.pdf', mimeType: 'application/pdf', pdf: '04_missing_invoice_number_rittenhouse.pdf', fields: SAMPLES['01_clean_liberty_bell.pdf'], plan: { [MODELS[0]]: 'error' } };
  const sim = runScenario({ files: [a, b], trigger: 'manual' }); noError(sim);
  assert.strictEqual((sim.runData['Check Duplicate Invoice'] || []).length, 2, 'expected two runs');
  assert.strictEqual(logRows(sim).length, 1);
  return describe(sim);
});
record('dedupe', 'Invoice with no invoice # is not deduped on vendor alone', 'Rittenhouse logged even though a Rittenhouse row exists', () => {
  const f = pdf('04_missing_invoice_number_rittenhouse.pdf', { id: 'drv_NEW4' });
  const sim = runScenario({ files: [f], sheetRows: [loggedRow('04_missing_invoice_number_rittenhouse.pdf', 'drv_04', 'x.pdf')] }); noError(sim);
  assert.strictEqual(logRows(sim).length, 1);
  return describe(sim);
});
record('edge', 'Non-PDF dropped in the Inbox (image/jpeg)', 'logged as "Skipped - Not a PDF", no download/Gemini/rename/email', () => {
  const sim = runScenario({ files: [{ id: 'drv_IMG', name: 'receipt.jpg', mimeType: 'image/jpeg' }] }); noError(sim);
  assert.strictEqual(sim.log.geminiCalls.length + sim.log.downloads.length + sim.log.renames.length + sim.log.emails.length, 0);
  const [a] = sim.log.sheetAppends; assert.strictEqual(a.node, 'Log Non-PDF');
  assert.strictEqual(a.row.Status, 'Skipped - Not a PDF'); assert.strictEqual(a.row['Source File ID'], 'drv_IMG');
  assert.strictEqual(a.row['Date Processed'], ET_DATE);
  return `${a.row.Status}: "${a.row.Notes}"`;
});
record('edge', 'Mixed poll: 1 PDF + 1 non-PDF', 'PDF processed, non-PDF logged', () => {
  const sim = runScenario({ files: [pdf('02_clean_schuylkill_it.pdf'), { id: 'drv_DOC', name: 'notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] }); noError(sim);
  assert.deepStrictEqual(sim.log.sheetAppends.map(a => a.node).sort(), ['Log Non-PDF', 'Log to Invoice Log']);
  return describe(sim);
});
record('validation', 'Date returned as 09/15/2026 instead of YYYY-MM-DD', 'Needs Review with date note; file month = UNDATED', () => {
  const f = pdf('01_clean_liberty_bell.pdf'); f.fields = { ...f.fields, invoice_date: '09/15/2026', due_date: '2026-02-30' };
  const sim = runScenario({ files: [f] }); noError(sim);
  const [v] = validated(sim);
  assert.strictEqual(v.status, 'Needs Review');
  assert.strictEqual(v.notes, 'Invoice Date is not a valid YYYY-MM-DD date ("09/15/2026"); Due Date is not a valid YYYY-MM-DD date ("2026-02-30")');
  assert.strictEqual(v.new_file_name, 'UNDATED_LibertyBellOfficeSupply_INV10482.pdf');
  return `"${v.notes}"`;
});
record('validation', 'Total present but tax missing', 'Needs Review "Cannot verify total: missing Tax"', () => {
  const f = pdf('01_clean_liberty_bell.pdf'); f.fields = { ...f.fields, tax: null };
  const sim = runScenario({ files: [f] }); noError(sim);
  assert.strictEqual(validated(sim)[0].notes, 'Cannot verify total: missing Tax');
  return describe(sim);
});
record('validation', 'Amounts returned as strings ("1,236.00")', 'coerced to numbers, OK', () => {
  const f = pdf('01_clean_liberty_bell.pdf'); f.fields = { ...f.fields, subtotal: '1,236.00', tax: '$74.16', total: '1310.16' };
  const sim = runScenario({ files: [f] }); noError(sim);
  const [v] = validated(sim); assert.strictEqual(v.status, 'OK'); assert.strictEqual(v.total, 1310.16);
  return describe(sim);
});
record('timezone', 'Processed date uses America/New_York at 10:30 PM ET (02:30 UTC next day)', `Date Processed ${ET_DATE}, Processed At "${ET_STAMP}" (v1.2 would have written 2026-10-09)`, () => {
  const sim = runScenario({ files: [pdf('01_clean_liberty_bell.pdf')] }); noError(sim);
  const [row] = logRows(sim);
  assert.strictEqual(row['Date Processed'], ET_DATE); assert.strictEqual(row['Processed At'], ET_STAMP);
  assert.strictEqual(new Date(FIXED_NOW).toISOString().slice(0, 10), '2026-10-09');
  return `${row['Date Processed']} / ${row['Processed At']}`;
});

// ------------------------------------------------------------------ report
const pass = results.filter(r => r.pass).length;
const esc = s => String(s).replace(/\|/g, '\\|');
const md = ['| Group | Case | Expected | Result | Pass |', '|---|---|---|---|---|',
  ...results.map(r => `| ${r.group} | ${esc(r.name)} | ${esc(r.expected)} | ${esc(r.got)} | ${r.pass ? '✅' : '❌'} |`),
  '', `**${pass} / ${results.length} passed** (offline simulator, fixed clock ${new Date(FIXED_NOW).toISOString()}).`].join('\n');
fs.writeFileSync(path.join(__dirname, 'results.md'), md + '\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.group}] ${r.name}\n      -> ${r.got}`);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
