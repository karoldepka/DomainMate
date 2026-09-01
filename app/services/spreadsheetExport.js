/** Create a minimal, standards-compliant XLSX workbook without a large client-side dependency. */
export function createXlsxWorkbook(rows) {
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const reference = `${columnName(columnIndex + 1)}${rowIndex + 1}`
    return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
  }).join('')}</row>`).join('')

  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Domains" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  }
  return new Blob([createZip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function columnName(index) {
  let name = ''
  while (index > 0) {
    index -= 1
    name = String.fromCharCode(65 + (index % 26)) + name
    index = Math.floor(index / 26)
  }
  return name
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character])
}

/** ZIP "store" archives are valid XLSX containers and keep export dependency-free. */
function createZip(files) {
  const encoder = new TextEncoder()
  const entries = Object.entries(files).map(([name, content]) => ({ name: encoder.encode(name), content: encoder.encode(content) }))
  const parts = []
  const centralDirectory = []
  let offset = 0
  for (const entry of entries) {
    const checksum = crc32(entry.content)
    const header = new Uint8Array(30 + entry.name.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint32(14, checksum, true)
    view.setUint32(18, entry.content.length, true)
    view.setUint32(22, entry.content.length, true)
    view.setUint16(26, entry.name.length, true)
    header.set(entry.name, 30)
    parts.push(header, entry.content)

    const central = new Uint8Array(46 + entry.name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, entry.content.length, true)
    centralView.setUint32(24, entry.content.length, true)
    centralView.setUint16(28, entry.name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(entry.name, 46)
    centralDirectory.push(central)
    offset += header.length + entry.content.length
  }
  const directorySize = centralDirectory.reduce((size, entry) => size + entry.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, directorySize, true)
  endView.setUint32(16, offset, true)
  return new Blob([...parts, ...centralDirectory, end])
}

function crc32(bytes) {
  let checksum = 0xffffffff
  for (const byte of bytes) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit += 1) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0)
  }
  return (checksum ^ 0xffffffff) >>> 0
}
