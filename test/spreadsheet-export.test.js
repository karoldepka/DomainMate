import assert from 'node:assert/strict'
import test from 'node:test'
import { createXlsxWorkbook } from '../app/services/spreadsheetExport.js'

test('creates an Excel-compatible XLSX workbook containing escaped domain data', async () => {
  const workbook = createXlsxWorkbook([['Domain', 'Comment'], ['example.com', 'A & B < C']])
  const content = new Uint8Array(await workbook.arrayBuffer())

  assert.equal(workbook.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.deepEqual([...content.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  assert.match(new TextDecoder().decode(content), /A &amp; B &lt; C/)
  assert.match(new TextDecoder().decode(content), /xl\/worksheets\/sheet1.xml/)
})
