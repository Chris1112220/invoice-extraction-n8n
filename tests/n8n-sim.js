// A small, offline stand-in for the n8n runtime, used only for tests.
// It walks the workflow's real connections (depth-first, like n8n's v1 execution order),
// runs every Code node's real JavaScript and every IF / Set / expression parameter, and
// replaces Google Drive, Google Sheets, Gmail and the Gemini HTTP calls with mocks.
// It is NOT n8n: it models only the features this workflow uses.
'use strict';
const { DateTime } = require('luxon');

class NodeError extends Error {}

class Sim {
  constructor(workflow, mocks) {
    this.wf = workflow;
    this.mocks = mocks;
    this.byName = Object.fromEntries(workflow.nodes.map(n => [n.name, n]));
    this.runData = {};
    this.staticData = mocks.staticData || {};
    this.executionId = mocks.executionId || String(Math.floor(Math.random() * 1e6));
    this.log = { sheetAppends: [], renames: [], moves: [], emails: [], geminiCalls: [], downloads: [], executed: [] };
  }

  // ---- item lineage (n8n "paired items") -------------------------------------------
  mk(json, node, parent, extra = {}) { return { json, _node: node, _parent: parent, ...extra }; }
  trace(name, item) {
    for (let it = item; it; it = it._parent) if (it._node === name) return it;
    throw new NodeError(`Paired item data missing: cannot trace back to "${name}"`);
  }

  ctx(node, item, inputItems, prevNode) {
    const sim = this;
    const runsOf = name => {
      const runs = sim.runData[name];
      if (!runs || !runs.length) throw new NodeError(`Referenced node "${name}" has not executed`);
      return runs;
    };
    const $ = name => {
      if (!sim.byName[name]) throw new NodeError(`Referenced node "${name}" does not exist`);
      const all = (branch = 0, run) => { const r = runsOf(name); return (r[run ?? r.length - 1].outputs[branch] || []); };
      return {
        get item() { return sim.trace(name, item); },
        all, first: (b = 0, r) => all(b, r)[0], last: (b = 0, r) => all(b, r).slice(-1)[0],
      };
    };
    return {
      $json: item ? item.json : undefined,
      $input: { all: () => inputItems, first: () => inputItems[0], last: () => inputItems.slice(-1)[0], item },
      $, $prevNode: { name: prevNode }, $execution: { id: this.executionId, mode: 'test' },
      $getWorkflowStaticData: () => this.staticData, $runIndex: (this.runData[node.name] || []).length,
      items: inputItems, DateTime,
    };
  }

  // ---- expressions ---------------------------------------------------------------
  evalExpr(value, node, item, inputItems, prevNode) {
    if (typeof value !== 'string' || !value.startsWith('=')) return value;
    const s = value.slice(1).trim();
    if (!(s.startsWith('{{') && s.endsWith('}}'))) throw new Error(`Unsupported expression form in ${node.name}: ${value.slice(0, 60)}`);
    const body = s.slice(2, -2);
    const c = this.ctx(node, item, inputItems, prevNode);
    const keys = Object.keys(c);
    // eslint-disable-next-line no-new-func
    return new Function(...keys, `return (${body});`)(...keys.map(k => c[k]));
  }

  runCode(node, inputItems, prevNode) {
    const code = node.parameters.jsCode;
    const exec = (item) => {
      const c = this.ctx(node, item, inputItems, prevNode);
      const keys = Object.keys(c);
      return new Function(...keys, code)(...keys.map(k => c[k]));
    };
    const wrap = (r, parent) => this.mk(r && r.json !== undefined ? r.json : r, node.name, parent);
    if (node.parameters.mode === 'runOnceForEachItem') {
      return [inputItems.map(it => wrap(exec(it), it))];
    }
    const res = exec(inputItems[0]);
    if (!Array.isArray(res)) throw new NodeError(`${node.name}: all-items Code node must return an array`);
    return [res.map((r, i) => {
      const p = r.pairedItem && typeof r.pairedItem.item === 'number' ? inputItems[r.pairedItem.item]
        : (res.length === inputItems.length ? inputItems[i] : undefined);
      return wrap(r, p);
    })];
  }

  execNode(node, inputItems, prevNode) {
    const P = node.parameters;
    const ev = (v, it) => this.evalExpr(v, node, it, inputItems, prevNode);
    const items = node.executeOnce ? inputItems.slice(0, 1) : inputItems;
    switch (node.type) {
      case 'n8n-nodes-base.manualTrigger':
      case 'n8n-nodes-base.googleDriveTrigger':
        return [inputItems.map(it => this.mk(it.json, node.name, undefined))];
      case 'n8n-nodes-base.noOp':
        return [inputItems.map(it => this.mk(it.json, node.name, it))];
      case 'n8n-nodes-base.set': {
        const add = {};
        for (const a of P.assignments.assignments) {
          let v = ev(a.value, inputItems[0]);
          if (a.type === 'object' && typeof v === 'string') v = JSON.parse(v);
          if (a.type === 'number') v = Number(v);
          add[a.name] = v;
        }
        return [inputItems.map(it => this.mk({ ...(P.includeOtherFields ? it.json : {}), ...add }, node.name, it))];
      }
      case 'n8n-nodes-base.if': {
        const conds = P.conditions.conditions;
        const out = [[], []];
        for (const it of inputItems) {
          const ok = conds.every(c => {
            if (c.operator.type !== 'boolean' || c.operator.operation !== 'true') throw new Error('sim: unsupported IF operator');
            return ev(c.leftValue, it) === true;
          });
          out[ok ? 0 : 1].push(this.mk(it.json, node.name, it));
        }
        return out;
      }
      case 'n8n-nodes-base.code':
        return this.runCode(node, inputItems, prevNode);
      case 'n8n-nodes-base.extractFromFile':
        return [inputItems.map(it => this.mk({ data: it.binary[P.binaryPropertyName].data }, node.name, it))];
      case 'n8n-nodes-base.googleDrive': {
        if (P.resource === 'fileFolder') {
          return [(this.mocks.inboxFiles || []).filter(f => f.mimeType === 'application/pdf')
            .map(f => this.mk({ ...f }, node.name, inputItems[0]))];
        }
        const out = [];
        for (const it of items) {
          const fileId = ev(P.fileId.value, it);
          if (!fileId) throw new NodeError(`${node.name}: empty file ID`);
          if (P.operation === 'download') {
            this.log.downloads.push(fileId);
            out.push(this.mk(it.json, node.name, it, { binary: { data: { data: this.mocks.fileBase64(fileId), mimeType: 'application/pdf' } } }));
          } else if (P.operation === 'update') {
            const name = ev(P.newUpdatedFileName, it);
            this.log.renames.push({ fileId, name });
            out.push(this.mk({ id: fileId, name }, node.name, it));
          } else if (P.operation === 'move') {
            const folderId = ev(P.folderId.value, it);
            this.log.moves.push({ fileId, folderId });
            out.push(this.mk({ id: fileId, parents: [folderId] }, node.name, it));
          } else throw new Error(`sim: unsupported Drive operation ${P.operation}`);
        }
        return [out];
      }
      case 'n8n-nodes-base.googleSheets': {
        const docId = ev(P.documentId.value, items[0]);
        if (P.operation === 'read') {
          const rows = (this.mocks.sheetRows || []).map((r, i) => this.mk({ row_number: i + 2, ...r }, node.name, items[0]));
          if (!rows.length && node.alwaysOutputData) rows.push(this.mk({}, node.name, items[0]));
          this.log.sheetReads = (this.log.sheetReads || 0) + 1;
          this.log.sheetDocIds = [...(this.log.sheetDocIds || []), docId];
          return [rows];
        }
        if (P.operation === 'append') {
          const schemaIds = new Set(P.columns.schema.map(s => s.id));
          const out = [];
          for (const it of items) {
            const row = {};
            for (const [col, expr] of Object.entries(P.columns.value)) {
              if (!schemaIds.has(col)) throw new Error(`${node.name}: column "${col}" not in schema`);
              row[col] = ev(expr, it);
            }
            this.log.sheetAppends.push({ node: node.name, docId, row });
            out.push(this.mk(row, node.name, it));
          }
          return [out];
        }
        throw new Error(`sim: unsupported Sheets operation ${P.operation}`);
      }
      case 'n8n-nodes-base.httpRequest': {
        const out = [[], []];
        for (const it of items) {
          let res;
          try {
            const url = ev(P.url, it);
            const body = JSON.parse(ev(P.jsonBody, it));
            const model = url.match(/models\/([^:]+):/)[1];
            this.log.geminiCalls.push({ node: node.name, model, body });
            res = this.mocks.gemini(model, body);
          } catch (e) {
            if (e instanceof NodeError || e.name === 'AssertionError') throw e;
            if (node.onError !== 'continueErrorOutput') throw new NodeError(`${node.name}: ${e.message}`);
            out[1].push(this.mk({ error: { message: e.message, description: e.description || '' } }, node.name, it));
            continue;
          }
          out[0].push(this.mk(res, node.name, it));
        }
        return out;
      }
      case 'n8n-nodes-base.gmail': {
        const out = [];
        for (const it of items) {
          const mail = { node: node.name, to: ev(P.sendTo, it), subject: ev(P.subject, it), message: ev(P.message, it) };
          this.log.emails.push(mail);
          out.push(this.mk({ id: 'msg-' + this.log.emails.length, labelIds: ['SENT'] }, node.name, it));
        }
        return [out];
      }
      default:
        throw new Error(`sim: node type ${node.type} not supported`);
    }
  }

  exec(name, inputItems, prevNode) {
    const node = this.byName[name];
    if (!node) throw new Error(`Connection points to missing node "${name}"`);
    if (node.disabled) return;
    this.log.executed.push(name);
    const outputs = this.execNode(node, inputItems, prevNode);
    (this.runData[name] = this.runData[name] || []).push({ outputs });
    const conns = (this.wf.connections[name] || {}).main || [];
    outputs.forEach((items, b) => {
      if (!items.length) return;
      for (const c of conns[b] || []) this.exec(c.node, items, name);
    });
  }

  run(triggerName, triggerJson) {
    try {
      this.exec(triggerName, triggerJson.map(j => ({ json: j })), undefined);
    } catch (e) {
      this.error = e;
    }
    return this;
  }
}

module.exports = { Sim };
