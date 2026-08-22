import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import dotenv from 'dotenv';

dotenv.config();

const mediaFolder = process.env.MEDIA_FOLDER || './downloads/media';

if (!fs.existsSync(mediaFolder)) {
  fs.mkdirSync(mediaFolder, { recursive: true });
}

export async function processMediaMessage({ buffer, mimetype, filename = '', messageType }) {
  const timestamp = Date.now();
  const cleanFilename = filename ? filename.replace(/[^a-zA-Z0-9_.-]/g, '_') : `${messageType}_${timestamp}`;
  const ext = path.extname(cleanFilename) || getExtensionFromMime(mimetype);
  const finalFilename = `${timestamp}_${path.basename(cleanFilename, ext)}${ext}`;
  const filePath = path.join(mediaFolder, finalFilename);

  // Write buffer to local storage
  await fs.promises.writeFile(filePath, buffer);

  let extractedText = '';

  try {
    if (mimetype.includes('pdf')) {
      const pdfData = await pdfParse(buffer);
      extractedText = pdfData.text ? pdfData.text.trim() : '';
    } else if (mimetype.includes('wordprocessingml') || mimetype.includes('docx') || ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value ? result.value.trim() : '';
    } else if (mimetype.startsWith('text/') || mimetype.includes('json') || mimetype.includes('csv')) {
      extractedText = buffer.toString('utf-8').trim();
    }
  } catch (err) {
    console.error(`Error extracting text from ${cleanFilename}:`, err.message);
    extractedText = `[Text Extraction Error: ${err.message}]`;
  }

  return {
    filePath,
    filename: finalFilename,
    mimetype,
    extractedText,
    buffer, // Keep buffer for direct LLM multimodal passing if needed
    base64: buffer.toString('base64')
  };
}

function getExtensionFromMime(mimetype) {
  if (mimetype.includes('jpeg') || mimetype.includes('jpg')) return '.jpg';
  if (mimetype.includes('png')) return '.png';
  if (mimetype.includes('webp')) return '.webp';
  if (mimetype.includes('pdf')) return '.pdf';
  if (mimetype.includes('word')) return '.docx';
  if (mimetype.includes('audio/mp4') || mimetype.includes('m4a')) return '.m4a';
  if (mimetype.includes('ogg') || mimetype.includes('opus')) return '.ogg';
  if (mimetype.includes('mp4')) return '.mp4';
  return '.bin';
}
