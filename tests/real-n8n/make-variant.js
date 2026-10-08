// Builds a runnable copy of the workflow for the real n8n CLI: Google nodes are swapped for
// Code/Set nodes with the SAME names (so every $('...') reference and expression is real),
// Gemini HTTP nodes stay real HTTP Request nodes but point to a local mock server.
const fs = require('fs');
const wf = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', '..', 'workflow', 'invoice-pdf-to-sheet.json'), 'utf8'));
const byName = Object.fromEntries(wf.nodes.map(n => [n.name, n]));
const asCode = (name, code, mode = 'runOnceForAllItems') => Object.assign(byName[name], { type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: code, mode }, executeOnce: undefined, alwaysOutputData: undefined });
let ai = 0;
const asSet = (name, fields) => Object.assign(byName[name], { type: 'n8n-nodes-base.set', typeVersion: 3.4, parameters: {
  mode: 'manual', includeOtherFields: false, options: {},
  assignments: { assignments: Object.entries(fields).map(([k, v]) => ({ id: 'a' + (ai++), name: k, value: v, type: 'string' })) } } });

// Drop the Drive trigger (CLI execute starts from the manual trigger).
wf.nodes = wf.nodes.filter(n => n.name !== 'Google Drive Trigger');
delete wf.connections['Google Drive Trigger'];
const files = [
  ['drv_01', '01_clean_liberty_bell.pdf'], ['drv_02', '02_clean_schuylkill_it.pdf'], ['drv_03', '03_math_error_fishtown_print.pdf'],
  ['drv_04', '04_missing_invoice_number_rittenhouse.pdf'], ['drv_05', '05_no_due_date_delaware_valley.pdf'],
  ['drv_DUPFILE', 'already_logged.pdf'], ['drv_COPY05', 'scan_0042.pdf'], ['drv_EMPTYALL', 'blank_scan.pdf'],
  ['drv_BADJSON', 'garbled.pdf'], ['drv_FALLBACK_COPY01', 'liberty_copy.pdf'],
].map(([id, name]) => ({ id, name, mimeType: 'application/pdf' }));
files.push({ id: 'drv_IMG', name: 'receipt.jpg', mimeType: 'image/jpeg' });
asCode('List Inbox PDFs', `return ${JSON.stringify(files)}.map(j => ({ json: j }));`);
asCode('Read Invoice Log', `return [
  { json: { row_number: 2, 'Date Processed': '2026-10-04', Vendor: 'Delaware Valley Courier', 'Invoice #': '55-0193', Status: 'Needs Review', 'Source File ID': 'drv_OLD05' } },
  { json: { row_number: 3, 'Date Processed': '2026-10-04', Vendor: 'Some Vendor', 'Invoice #': 'X-1', Status: 'OK', 'Source File ID': 'drv_DUPFILE' } },
];`);
asCode('Download Invoice PDF', `return { json: $json, binary: { data: { data: Buffer.from('%PDF-1.4 mock id=' + $json.file_id).toString('base64'), mimeType: 'application/pdf', fileName: $json.file_name } } };`, 'runOnceForEachItem');
for (const n of wf.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest')) {
  n.parameters.url = n.parameters.url.replace('https://generativelanguage.googleapis.com', 'http://127.0.0.1:5899');
  n.parameters.authentication = 'none'; delete n.parameters.nodeCredentialType;
  n.parameters.options = {}; // no 5s batching in the test
}
const log = byName['Log to Invoice Log'].parameters.columns.value;
asSet('Log to Invoice Log', log);
asSet('Log Non-PDF', byName['Log Non-PDF'].parameters.columns.value);
asSet('Rename PDF', { fileId: byName['Rename PDF'].parameters.fileId.value, newName: byName['Rename PDF'].parameters.newUpdatedFileName });
asSet('Move to Processed', { fileId: byName['Move to Processed'].parameters.fileId.value, folderId: byName['Move to Processed'].parameters.folderId.value });
for (const g of ['Email Needs Review', 'Email Failure Alert']) asSet(g, { to: byName[g].parameters.sendTo, subject: byName[g].parameters.subject, message: byName[g].parameters.message });
wf.id = 'InvoiceV13RealRun';
wf.name = 'v1.3 real-runtime test (mocked Google + Gemini)';
fs.writeFileSync(require('path').join(__dirname, 'variant.json'), JSON.stringify(wf, null, 1));
console.log('nodes', wf.nodes.length);
