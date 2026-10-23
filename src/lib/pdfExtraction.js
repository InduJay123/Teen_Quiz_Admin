import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { extractPdfText } from './pdfExtractionCore.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
export const extractLessonPdf = (file, maxBytes) => extractPdfText(file, pdfjs, maxBytes)
