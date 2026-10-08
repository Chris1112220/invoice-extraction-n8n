const http = require('http');
const fs = require('fs');
const S = {
  drv_01: { vendor: 'Liberty Bell Office Supply', invoice_number: 'INV-10482', invoice_date: '2026-09-15', due_date: '2026-10-15', due_date_note: null, subtotal: 1236.00, tax: 74.16, total: 1310.16 },
  drv_02: { vendor: 'Schuylkill IT Services LLC', invoice_number: 'SIT-2026-0917', invoice_date: '2026-09-17', due_date: '2026-10-17', due_date_note: null, subtotal: 3500.00, tax: 0.00, total: 3500.00 },
  drv_03: { vendor: 'Fishtown Print & Copy', invoice_number: '7731', invoice_date: '2026-09-22', due_date: '2026-10-22', due_date_note: null, subtotal: 860.00, tax: 51.60, total: 921.60 },
  drv_04: { vendor: 'Rittenhouse Cleaning Co.', invoice_number: null, invoice_date: '2026-09-25', due_date: '2026-10-10', due_date_note: null, subtotal: 450.00, tax: 27.00, total: 477.00 },
  drv_05: { vendor: 'Delaware Valley Courier', invoice_number: '55-0193', invoice_date: '2026-09-28', due_date: null, due_date_note: 'Due upon receipt', subtotal: 312.50, tax: 25.00, total: 337.50 },
};
S.drv_COPY05 = { ...S.drv_05, vendor: 'Delaware Valley Courier LLC', invoice_number: '55 0193' };
S.drv_FALLBACK_COPY01 = S.drv_01;
const ok = (text, model) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], modelVersion: model });
const reqLog = [];
http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const model = req.url.match(/models\/([^:]+):/)[1];
    const body = JSON.parse(b);
    const id = Buffer.from(body.contents[0].parts[1].inline_data.data, 'base64').toString().split('id=')[1];
    reqLog.push({ model, id, prompt: body.contents[0].parts[0].text, schema: body.generationConfig.responseSchema, temperature: body.generationConfig.temperature });
    fs.writeFileSync(__dirname + '/requests.json', JSON.stringify(reqLog, null, 1));
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (id === 'drv_EMPTYALL') return send(200, { candidates: [], modelVersion: model });
    if (id === 'drv_FALLBACK_COPY01' && model === 'gemini-3.5-flash-lite') return send(429, { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } });
    if (id === 'drv_BADJSON') return send(200, ok('{"vendor": "Garbled Inc", "total": 13', model));
    if (S[id]) return send(200, ok(JSON.stringify(S[id]), model));
    send(500, { error: { message: 'unknown id ' + id } });
  });
}).listen(5899, () => console.log('mock gemini on 5899'));
