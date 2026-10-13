import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

/**
 * Extract text content and {{placeholder}} patterns from a DOCX file.
 * DOCX is a ZIP file containing word/document.xml with the main content.
 */
export function extractTextFromDocx(filePath: string): string {
  try {
    const buffer = fs.readFileSync(filePath);
    return extractTextFromDocxBuffer(buffer);
  } catch (error) {
    throw new Error(`Cannot read DOCX file: ${(error as Error).message}`);
  }
}

export function extractTextFromDocxBuffer(buffer: Buffer): string {
  // Convert buffer to base64 then to string for processing
  const zipContent = buffer.toString('binary');

  // Find the start of word/document.xml within the ZIP
  // ZIP local file headers start with "PK\x03\x04"
  // We need to find the document.xml entry
  const files: Array<{ name: string; data: string }> = [];

  let offset = 0;
  const zipBin = buffer;

  while (offset < zipBin.length) {
    // Check for ZIP local file header signature
    if (zipBin.readUInt32LE(offset) !== 0x04034b50) break;

    const compression = zipBin.readUInt16LE(offset + 8);
    const compressedSize = zipBin.readUInt32LE(offset + 18);
    const fileNameLen = zipBin.readUInt16LE(offset + 26);
    const extraLen = zipBin.readUInt16LE(offset + 28);
    const fileName = zipBin
      .slice(offset + 30, offset + 30 + fileNameLen)
      .toString('utf8');
    const dataOffset = offset + 30 + fileNameLen + extraLen;

    if (fileName === 'word/document.xml') {
      let xmlData: Buffer;
      if (compression === 0) {
        // Stored
        xmlData = zipBin.slice(dataOffset, dataOffset + compressedSize);
      } else if (compression === 8) {
        // Deflated
        try {
          xmlData = zlib.inflateRawSync(
            zipBin.slice(dataOffset, dataOffset + compressedSize),
          );
        } catch {
          break;
        }
      } else {
        break;
      }
      return extractTextFromXml(xmlData.toString('utf8'));
    }

    offset = dataOffset + compressedSize;
    if (offset <= 30) break;
  }

  throw new Error('word/document.xml not found in DOCX');
}

function extractTextFromXml(xml: string): string {
  // Extract text from <w:t> elements (Word text elements)
  const textMatches = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [];
  const lines: string[] = [];

  for (const match of textMatches) {
    const content = match.replace(/<w:t[^>]*>/, '').replace('</w:t>', '');
    lines.push(content);
  }

  // Also extract from <w:p> (paragraphs) for better formatting
  const paraMatches = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  const paraText: string[] = [];
  for (const para of paraMatches) {
    const texts = para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [];
    const line = texts
      .map((t) => t.replace(/<w:t[^>]*>/, '').replace('</w:t>', ''))
      .join('');
    if (line.trim()) paraText.push(line);
  }

  return paraText.join('\n');
}

/**
 * Extract all {{placeholder}} patterns from DOCX text
 */
export function extractPlaceholdersFromDocx(filePath: string): string[] {
  const text = extractTextFromDocx(filePath);
  const matches = text.match(/\{\{([^}]+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '')))];
}

export function extractPlaceholdersFromText(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '')))];
}
