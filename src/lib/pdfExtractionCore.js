import { validatePdfEnvelope, validateUploadSize, validateExtractedText, MAX_PDF_BYTES } from '../../supabase/functions/_shared/quizValidation.js'

export function pageText(items) {
  let text = ''; let previousY = null
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    const y = item.transform?.[5]
    if (previousY !== null && Number.isFinite(y) && Math.abs(y - previousY) > 2 && !text.endsWith('\n')) text += '\n'
    text += item.str
    text += item.hasEOL ? '\n' : ' '
    previousY = y
  }
  return text.replace(/[ \t]+\n/g, '\n').trim()
}

export async function extractPdfText(file, pdfjs, maxBytes = MAX_PDF_BYTES) {
  validateUploadSize(file.size, maxBytes)
  const bytes = new Uint8Array(await file.arrayBuffer())
  validatePdfEnvelope(bytes, maxBytes)
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, stopAtErrors: true, useSystemFonts: true })
  try {
    const document = await task.promise
    const metadata = await document.getMetadata()
    if (metadata.info?.EncryptFilterName) throw new Error('ENCRYPTED')
    if (document.numPages < 1 || document.numPages > 200) throw new Error('PAGE_LIMIT')
    const pages = []; let length = 0
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      try {
        const text = pageText((await page.getTextContent()).items)
        pages.push(text); length += text.length + 3
        if (length > 120000) throw new Error('TEXT_LIMIT')
      } finally { page.cleanup() }
    }
    return { text: validateExtractedText(pages.join('\n\f\n')), pageCount: document.numPages }
  } catch (error) {
    if (error.name === 'PasswordException' || error.message === 'ENCRYPTED') throw new Error('Encrypted PDFs are not supported. Select an unencrypted lesson PDF.')
    if (error.message === 'PAGE_LIMIT') throw new Error('PDF must contain 1–200 pages.')
    if (error.message === 'TEXT_LIMIT') throw new Error('Lesson text exceeds 120,000 characters. No text was submitted or truncated.')
    if (error.name === 'InvalidPDFException' || error.name === 'UnknownErrorException') throw new Error('The PDF is corrupt or unreadable.')
    throw error
  } finally { await task.destroy() }
}
