import { PDFLoader } from "langchain/document_loaders/fs/pdf"
import mammoth from "mammoth"
import * as XLSX from "xlsx"
import pdfParse from "pdf-parse"
import { Document } from "langchain/document"
import { v4 as uuidv4 } from "uuid"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

/**
 * Interface for reporting progress during PDF extraction
 */
export interface ExtractionProgress {
  currentPage: number
  totalPages: number
  percentComplete: number
  fileName: string
}

type ProgressCallback = (progress: ExtractionProgress) => void

/**
 * Extracts text content from a given file based on its extension.
 * Now supports page-by-page extraction for PDFs with progress reporting.
 *
 * @param file The file object (Blob) to process.
 * @param onProgress Optional callback for reporting extraction progress.
 * @returns A promise that resolves to the extracted text content as a string.
 * @throws If the file type is unsupported or extraction fails.
 */
export const extractTextFromFile = async (
  file: File,
  onProgress?: ProgressCallback
): Promise<string | string[]> => {
  const extension = file.name.split(".").pop()?.toLowerCase()

  if (!extension) {
    throw new Error("Could not determine file extension.")
  }

  console.log(
    `Attempting to extract text from file: ${file.name} (type: ${extension})`
  )

  try {
    switch (extension) {
      case "pdf":
        return await extractTextFromPDF(file, onProgress)

      case "txt":
      case "md": // Treat Markdown as plain text for extraction
        const text = await file.text()
        console.log(
          `Successfully extracted ${text.length} characters from text file.`
        )
        return text

      case "docx":
        return await extractTextFromDOCX(file)

      case "text/plain":
        const plainText = await file.text()
        console.log("Plain text processed, no extraction needed")
        return plainText

      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        // Redirect to our docx handler
        return extractTextFromFile(
          new File([await file.arrayBuffer()], "document.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          })
        )

      // TODO: Add cases for other supported types (e.g., csv, json) if needed

      default:
        console.warn(`Unsupported file type: ${extension}`)
        throw new Error(`Unsupported file type: ${extension}`)
    }
  } catch (error: any) {
    console.error(`Error extracting text from ${file.name}:`, error)
    throw new Error(
      `Failed to extract text from ${file.name}: ${error.message}`
    )
  }
}

/**
 * Enhanced PDF extraction with multiple fallback methods for problematic PDFs.
 *
 * @param file The PDF file to process
 * @param onProgress Optional callback for reporting extraction progress
 * @returns An array of strings containing the extracted text per page
 */
async function extractTextFromPDF(
  file: File,
  onProgress?: ProgressCallback
): Promise<string[]> {
  console.log(`Starting PDF extraction for: ${file.name}`)
  
  // Method 1: Try LangChain PDFLoader (primary method)
  try {
    console.log("Attempting PDF extraction with LangChain PDFLoader...")
    return await extractWithLangChainPDFLoader(file, onProgress)
  } catch (error: any) {
    console.warn("LangChain PDFLoader failed:", error.message)
  }

  // Method 2: Try with pdf-parse library (completely different engine)
  try {
    console.log("Attempting PDF extraction with pdf-parse...")
    return await extractWithPdfParse(file, onProgress)
  } catch (error: any) {
    console.warn("pdf-parse failed:", error.message)
  }

  // Method 3: Try basic text extraction with minimal options
  try {
    console.log("Attempting minimal PDF text extraction...")
    return await extractMinimalPDFText(file, onProgress)
  } catch (error: any) {
    console.warn("Minimal PDF extraction failed:", error.message)
  }

  // Method 5: Try raw binary text extraction (last resort for corrupted PDFs)
  try {
    console.log("Attempting raw binary text extraction...")
    return await extractRawBinaryText(file, onProgress)
  } catch (error: any) {
    console.warn("Raw binary extraction failed:", error.message)
  }

  // Method 6: Last resort - return error with helpful message
  const errorMessage = `Unable to extract text from PDF "${file.name}". This PDF may be corrupted, password-protected, or use an unsupported format. Please try converting it to a different format or use a different PDF file.`
  console.error(errorMessage)
  throw new Error(errorMessage)
}

/**
 * Primary extraction method using LangChain PDFLoader
 */
async function extractWithLangChainPDFLoader(
  file: File,
  onProgress?: ProgressCallback
): Promise<string[]> {
    const loader = new PDFLoader(file, {
    splitPages: true
    })

    const docs = await loader.load()
    const totalPages = docs.length
  console.log(`PDF has ${totalPages} pages (LangChain method)`)

    const processedPages: string[] = []
    let pageIndex = 0

    for (const doc of docs) {
    const pageContent = doc.pageContent.replace(/\s+/g, ' ').trim()
      processedPages.push(pageContent)

      pageIndex++
      if (onProgress) {
        onProgress({
          currentPage: pageIndex,
          totalPages,
          percentComplete: Math.round((pageIndex / totalPages) * 100),
          fileName: file.name
        })
      }

    console.log(`Processed page ${pageIndex}/${totalPages} with ${pageContent.length} characters`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }

  console.log(`Successfully extracted ${processedPages.length} pages from PDF (LangChain method)`)
  return processedPages
}

/**
 * Fallback method using pdf-parse library
 */
async function extractWithPdfParse(
  file: File,
  onProgress?: ProgressCallback
): Promise<string[]> {
  const buffer = await file.arrayBuffer()
  const nodeBuffer = Buffer.from(buffer)
  
  // pdf-parse can handle many problematic PDFs that other libraries can't
  const data = await pdfParse(nodeBuffer, {
    // More lenient parsing options
    max: 0, // No page limit
    version: 'v1.10.100' // Use specific version for compatibility
  })

  const fullText = data.text
  const totalPages = data.numpages
  console.log(`PDF has ${totalPages} pages (pdf-parse method)`)
  
  if (!fullText || fullText.trim().length === 0) {
    throw new Error("No text content extracted from PDF")
  }

  // Split text into pages - pdf-parse doesn't give us per-page content
  // so we'll estimate pages by splitting on common page separators
  let pages: string[] = []
  
  if (totalPages > 1) {
    // Try to split by form feed characters or multiple newlines
    const pageSeparators = fullText.split(/\f|\n\s*\n\s*\n/)
    
    if (pageSeparators.length >= totalPages * 0.7) {
      // If we get reasonable number of splits, use them
      pages = pageSeparators.filter(page => page.trim().length > 50)
    } else {
      // Otherwise, split text into roughly equal chunks
      const textLength = fullText.length
      const chunkSize = Math.ceil(textLength / totalPages)
      
      for (let i = 0; i < totalPages; i++) {
        const start = i * chunkSize
        const end = Math.min(start + chunkSize, textLength)
        const chunk = fullText.slice(start, end).trim()
        if (chunk.length > 0) {
          pages.push(chunk)
        }
      }
    }
  } else {
    pages = [fullText]
  }

  const processedPages = pages.map(page => page.replace(/\s+/g, ' ').trim())

  if (onProgress) {
    onProgress({
      currentPage: processedPages.length,
      totalPages: processedPages.length,
      percentComplete: 100,
      fileName: file.name
    })
  }

  console.log(`Successfully extracted ${processedPages.length} pages from PDF (pdf-parse method)`)
    return processedPages
}



/**
 * Minimal PDF text extraction with most lenient settings
 */
async function extractMinimalPDFText(
  file: File,
  onProgress?: ProgressCallback
): Promise<string[]> {
  try {
    // Try pdf-parse with absolute minimal options
    const buffer = await file.arrayBuffer()
    const nodeBuffer = Buffer.from(buffer)
    
    const data = await pdfParse(nodeBuffer, {
      // Absolutely minimal parsing - just get any text we can
      max: 0,
      // Don't use any version specification
    })

    if (!data.text || data.text.trim().length === 0) {
      throw new Error("No text content found")
    }

    // Just return the entire text as one page
    const singlePage = data.text.replace(/\s+/g, ' ').trim()
    
    if (onProgress) {
      onProgress({
        currentPage: 1,
        totalPages: 1,
        percentComplete: 100,
        fileName: file.name
      })
    }

    console.log(`Successfully extracted text as single page (minimal method): ${singlePage.length} characters`)
    return [singlePage]
  } catch (error: any) {
    throw new Error(`Minimal extraction failed: ${error.message}`)
  }
}

/**
 * Raw binary text extraction - last resort for completely corrupted PDFs
 * This method attempts to extract readable text from the raw binary data
 */
async function extractRawBinaryText(
  file: File,
  onProgress?: ProgressCallback
): Promise<string[]> {
  console.log("Attempting raw binary text extraction as last resort...")
  
  try {
    const buffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(buffer)
    console.log(`PDF file size: ${uint8Array.length} bytes`)
    
    // Try different text extraction approaches
    let allExtractedTexts: string[] = []
    
    // Approach 1: Standard ASCII and extended characters
    let rawText = ""
    let consecutiveTextBytes = 0
    
    for (let i = 0; i < uint8Array.length; i++) {
      const byte = uint8Array[i]
      
      // Include a wider range of characters
      if ((byte >= 32 && byte <= 126) || // Standard ASCII
          byte === 9 || byte === 10 || byte === 13 || // Tab, LF, CR
          (byte >= 128 && byte <= 255)) { // Extended ASCII/Latin-1
        rawText += String.fromCharCode(byte)
        consecutiveTextBytes++
      } else {
        // If we hit non-text bytes, check if we have accumulated meaningful text
        if (consecutiveTextBytes > 20) {
          rawText += " " // Add space as separator
        }
        consecutiveTextBytes = 0
      }
    }
    
    // Approach 2: Try to decode as UTF-16 (sometimes PDFs use this)
    let utf16Text = ""
    try {
      // Try UTF-16 BE (Big Endian)
      const utf16beDecoder = new TextDecoder('utf-16be', { fatal: false })
      utf16Text = utf16beDecoder.decode(uint8Array)
      
      // Also try UTF-16 LE (Little Endian)
      const utf16leDecoder = new TextDecoder('utf-16le', { fatal: false })
      const utf16leText = utf16leDecoder.decode(uint8Array)
      
      // Use whichever has more readable content
      if (utf16leText.length > utf16Text.length) {
        utf16Text = utf16leText
      }
    } catch (e) {
      console.log("UTF-16 decoding failed:", e)
    }
    
    // Combine both extraction approaches
    allExtractedTexts.push(rawText)
    if (utf16Text.length > 100) {
      allExtractedTexts.push(utf16Text)
    }
    
    // Process all extracted texts and find the best one
    let bestText = ""
    let mostLines = 0
    
    for (const extractedText of allExtractedTexts) {
      const lines = extractedText.split(/[\n\r]+/)
      const meaningfulLines = lines.filter(line => {
        const trimmed = line.trim()
        return trimmed.length >= 3 && trimmed.match(/[a-zA-Z0-9äöüÄÖÜß]/)
      })
      
      if (meaningfulLines.length > mostLines) {
        mostLines = meaningfulLines.length
        bestText = extractedText
      }
    }
    
    console.log(`Best extraction method found ${mostLines} potential lines`)
    
    // Filter out PDF-specific noise and extract meaningful text
    const lines = bestText.split(/[\n\r]+/)
    const meaningfulLines: string[] = []
    
    console.log(`Total lines found before filtering: ${lines.length}`)
    let skippedReasons = {
      tooShort: 0,
      pdfMarkers: 0,
      noAlphaNum: 0,
      other: 0
    }
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      
      // Skip only very short lines or obviously binary data
      if (trimmedLine.length < 2) {
        skippedReasons.tooShort++
        continue
      }
      
      // Skip specific PDF structure markers (more precise matching)
      if (line.match(/^%%EOF$/) || line.match(/^%PDF-/) || line.match(/^\d+\s+\d+\s+obj$/)) {
        skippedReasons.pdfMarkers++
        continue
      }
      
      // Skip lines that are purely numeric with specific patterns
      if (line.match(/^\d+\s+\d+\s+R$/)) { // PDF object references
        skippedReasons.pdfMarkers++
        continue
      }
      if (line.match(/^\/\w+\s*$/)) { // PDF commands like /Type
        skippedReasons.pdfMarkers++
        continue
      }
      
      // Clean the line but preserve more characters (including German umlauts and special chars)
      // Allow: letters, numbers, spaces, common punctuation, German chars (äöüÄÖÜß), currency symbols, etc.
      const cleanLine = line.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ') // Remove control characters
                           .replace(/\s+/g, ' ')
                           .trim()
      
      // Be much more lenient - accept lines with at least 3 characters
      if (cleanLine.length >= 3) {
        // Additional check: line should contain at least one letter or number
        if (cleanLine.match(/[a-zA-Z0-9äöüÄÖÜß]/)) {
          meaningfulLines.push(cleanLine)
        } else {
          skippedReasons.noAlphaNum++
        }
      } else {
        skippedReasons.other++
      }
    }
    
    console.log(`Lines filtered - Too short: ${skippedReasons.tooShort}, PDF markers: ${skippedReasons.pdfMarkers}, No alphanumeric: ${skippedReasons.noAlphaNum}, Other: ${skippedReasons.other}`)
    
    // Group meaningful lines into pages/chunks
    const chunks: string[] = []
    let currentChunk = ""
    const maxChunkSize = 3000 // Increased chunk size for better context
    
    // If we have very few lines, just return them as one chunk
    if (meaningfulLines.length <= 10) {
      const singleChunk = meaningfulLines.join(" ").trim()
      if (singleChunk.length > 0) {
        chunks.push(singleChunk)
      }
    } else {
      // Otherwise, group lines into logical chunks
      for (let i = 0; i < meaningfulLines.length; i++) {
        const line = meaningfulLines[i]
        
        // Check if this looks like a page break or section header
        const nextLine = i < meaningfulLines.length - 1 ? meaningfulLines[i + 1] : ""
        const isPageBreak = line.match(/^(Page|Seite)\s+\d+/i) || 
                           line.match(/^\d+$/) && nextLine.length > 20
        
        if (currentChunk.length + line.length > maxChunkSize || isPageBreak) {
          if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk.trim())
          }
          currentChunk = line
        } else {
          currentChunk += (currentChunk.length > 0 ? " " : "") + line
        }
      }
      
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim())
      }
    }
    
    if (chunks.length === 0) {
      throw new Error("No readable text found in binary data")
    }
    
    if (onProgress) {
      onProgress({
        currentPage: chunks.length,
        totalPages: chunks.length,
        percentComplete: 100,
        fileName: file.name
      })
    }
    
    console.log(`Successfully extracted ${chunks.length} text chunks from binary data (${meaningfulLines.length} meaningful lines found)`)
    return chunks
    
  } catch (error: any) {
    throw new Error(`Raw binary extraction failed: ${error.message}`)
  }
}

/**
 * Splits DOCX text content into logical sections based on various separators
 * 
 * @param text The full text content from DOCX
 * @returns Array of text sections
 */
function splitDocxIntoSections(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return []
  }

  // Strategy 1: Split by explicit page breaks (form feed characters)
  if (text.includes('\f')) {
    const pageBreakSections = text.split('\f').filter(section => section.trim().length > 0)
    if (pageBreakSections.length > 1) {
      console.log(`Found ${pageBreakSections.length} sections using page breaks`)
      return pageBreakSections.map(section => section.trim())
    }
  }

  // Strategy 2: Split by major headings (lines that are all caps or start with numbers/bullets)
  const lines = text.split('\n')
  const headingSections: string[] = []
  let currentSection: string[] = []

  for (const line of lines) {
    const trimmedLine = line.trim()
    
    // Check if this is likely a heading (all caps, numbered, or bullet point)
    const isHeading = trimmedLine.length > 0 && (
      // All caps and reasonable length
      (trimmedLine === trimmedLine.toUpperCase() && trimmedLine.length > 3 && trimmedLine.length < 100) ||
      // Starts with number and dot/parenthesis
      /^\d+[\.\)]\s/.test(trimmedLine) ||
      // Starts with Roman numerals
      /^[IVX]+[\.\)]\s/.test(trimmedLine) ||
      // Starts with letters and dot/parenthesis  
      /^[A-Z][\.\)]\s/.test(trimmedLine)
    )

    if (isHeading && currentSection.length > 0) {
      // Save the previous section
      const sectionText = currentSection.join('\n').trim()
      if (sectionText.length > 100) { // Only keep substantial sections
        headingSections.push(sectionText)
      }
      currentSection = [line]
    } else {
      currentSection.push(line)
    }
  }

  // Add the last section
  if (currentSection.length > 0) {
    const sectionText = currentSection.join('\n').trim()
    if (sectionText.length > 100) {
      headingSections.push(sectionText)
    }
  }

  if (headingSections.length > 1) {
    console.log(`Found ${headingSections.length} sections using heading detection`)
    return headingSections
  }

  // Strategy 3: Split by multiple empty lines (paragraph breaks)
  const paragraphSections = text.split(/\n\s*\n\s*\n/).filter(section => section.trim().length > 0)
  if (paragraphSections.length > 1) {
    console.log(`Found ${paragraphSections.length} sections using paragraph breaks`)
    return paragraphSections.map(section => section.trim())
  }

  // Strategy 4: Split large documents into chunks of reasonable size
  const targetChunkSize = 3000 // Characters per chunk
  if (text.length > targetChunkSize * 1.5) {
    const chunks: string[] = []
    const sentences = text.split(/[.!?]+\s+/)
    let currentChunk = ''

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > targetChunkSize && currentChunk.length > 500) {
        chunks.push(currentChunk.trim())
        currentChunk = sentence
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim())
    }

    if (chunks.length > 1) {
      console.log(`Split large document into ${chunks.length} chunks`)
      return chunks
    }
  }

  // Fallback: Return the entire text as one section
  console.log('No suitable split points found, returning entire document as one section')
  return [text.trim()]
}

/**
 * Extracts text from a DOCX file using mammoth and splits it into logical sections/pages
 *
 * @param file The DOCX file to process
 * @returns An array of strings containing the extracted text split into sections
 */
async function extractTextFromDOCX(file: File): Promise<string[]> {
  console.log("Extracting text from DOCX file")
  console.log(`Received file size: ${file.size} bytes`)

  try {
    const arrayBuffer = await file.arrayBuffer()
    console.log(
      `Received array buffer of size: ${arrayBuffer.byteLength} bytes`
    )

    // Try multiple approaches to extract text using mammoth
    // This handles differences between browser and server environments
    let result

    // First try with arrayBuffer (generally works in browser)
    try {
      result = await mammoth.extractRawText({
        arrayBuffer: arrayBuffer
      })
      console.log("arrayBuffer approach succeeded")
    } catch (err) {
      console.log("arrayBuffer approach failed:", err)

      // Second try with buffer (may work in some Node.js environments)
      try {
        const buffer = Buffer.from(arrayBuffer)
        result = await mammoth.extractRawText({
          buffer: buffer
        })
        console.log("buffer approach succeeded")
      } catch (err2) {
        console.log("buffer approach failed:", err2)

        // Third approach - write to temporary file and use path
        // This should work in a server environment
        try {
          // Create a temporary file path
          const tempDir = os.tmpdir()
          const tempFilePath = path.join(tempDir, `docx-${uuidv4()}.docx`)

          console.log(`Writing temp file to: ${tempFilePath}`)

          // Write the buffer to a temporary file
          await fs.promises.writeFile(tempFilePath, Buffer.from(arrayBuffer))

          // Use the path approach
          result = await mammoth.extractRawText({
            path: tempFilePath
          })

          console.log("path approach succeeded")

          // Clean up the temporary file
          try {
            await fs.promises.unlink(tempFilePath)
            console.log("Temporary file removed")
          } catch (cleanupErr) {
            console.warn("Failed to clean up temporary file:", cleanupErr)
          }
        } catch (err3) {
          console.error("All approaches failed:", err3)
          throw new Error(
            "Could not extract DOCX content with any available method"
          )
        }
      }
    }

    if (!result || !result.value) {
      console.error("Mammoth returned no text content")
      throw new Error("No text content could be extracted from DOCX")
    }

    const text = result.value.trim()
    console.log(`Extracted ${text.length} characters from DOCX`)

    if (result.messages && result.messages.length > 0) {
      console.log("Mammoth warnings:", result.messages)
    }

    // Split DOCX content into logical sections/pages
    const sections = splitDocxIntoSections(text)
    console.log(`Split DOCX into ${sections.length} sections`)
    
    return sections
  } catch (error: any) {
    console.error("Error extracting text from DOCX:", error)
    throw new Error(`Failed to extract text from DOCX: ${error.message}`)
  }
}
