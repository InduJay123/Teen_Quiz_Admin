import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPdfText } from '../src/lib/pdfExtractionCore.js'

async function pdfFile(pages) {
  const doc = await PDFDocument.create()
  for (const text of pages) { const page = doc.addPage(); if (text) page.drawText(text, { x: 30, y: 700, size: 12, maxWidth: 500, lineHeight: 16 }) }
  const bytes = await doc.save()
  return { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }
}
test('PDF.js extracts every actual PDF page in order with page boundaries', async () => {
  const text = 'Lesson: Businesses plan expected income and expenditure using a budget. '.repeat(4)
  const result = await extractPdfText(await pdfFile(['FIRST '+text,'SECOND '+text]), pdfjs)
  assert.equal(result.pageCount,2)
  assert.ok(result.text.indexOf('FIRST') < result.text.indexOf('SECOND'))
  assert.match(result.text,/\f/)
})
test('empty/image-only content and corrupt files are rejected without a submission', async () => {
  await assert.rejects(extractPdfText(await pdfFile(['']),pdfjs),/OCR/)
  const bad=new TextEncoder().encode('%PDF-1.7 invalid %%EOF')
  await assert.rejects(extractPdfText({size:bad.length,arrayBuffer:async()=>bad.buffer},pdfjs),/corrupt|unreadable/)
})
test('overlong documents are rejected rather than truncated and encrypted parser response is rejected',async()=>{
  const file=await pdfFile(['A valid PDF'])
  let destroyed=false
  const fake={getDocument:()=>({promise:Promise.resolve({numPages:1,getMetadata:async()=>({info:{}}),getPage:async()=>({getTextContent:async()=>({items:[{str:'a'.repeat(120001)}]}),cleanup(){}})}),destroy:async()=>{destroyed=true}})}
  await assert.rejects(extractPdfText(file,fake),/No text was submitted or truncated/);assert.ok(destroyed)
  const encrypted={getDocument:()=>({promise:Promise.reject(Object.assign(new Error('password'),{name:'PasswordException'})),destroy:async()=>{}})}
  await assert.rejects(extractPdfText(file,encrypted),/Encrypted/)
})
