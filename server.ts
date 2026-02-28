import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { v4 as uuidv4 } from 'uuid';

// Check if text is translatable (has letters)
function isTranslatable(text: string): boolean {
  if (!text || !text.trim()) return false;
  return /\p{L}/u.test(text);
}

// Helper to determine file type
function getFileType(filename: string): 'docx' | 'xlsx' | 'odt' | 'txt' | 'md' | 'unknown' {
  const ext = path.extname(filename).toLowerCase();
  if (['.docx', '.docm', '.dotx', '.dotm'].includes(ext)) return 'docx';
  if (['.xlsx', '.xlsm', '.xltx', '.xltm'].includes(ext)) return 'xlsx';
  if (['.odt'].includes(ext)) return 'odt';
  if (ext === '.txt') return 'txt';
  if (ext === '.md') return 'md';
  return 'unknown';
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  // Ensure uploads directory exists
  if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
  }
  
  // Periodic cleanup of orphaned files (older than 1 hour)
  setInterval(() => {
    try {
      const uploadDir = 'uploads';
      if (!fs.existsSync(uploadDir)) return;
      const files = fs.readdirSync(uploadDir);
      const now = Date.now();
      files.forEach(file => {
        if (file === '.gitkeep') return;
        const filePath = path.join(uploadDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 3600000) { // 1 hour
          fs.unlinkSync(filePath);
          console.log(`Cleaned up orphaned file: ${file}`);
        }
      });
    } catch (e) {
      console.error("Cleanup interval error:", e);
    }
  }, 3600000);

  const upload = multer({ dest: 'uploads/' });

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Request Logger
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // Health Check Endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 1. Extract Text Endpoint
  app.post('/api/extract', upload.single('file'), (req, res) => {
    if (!req.file) {
      console.error('Extract error: No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`Extracting file: ${req.file.originalname} (${req.file.size} bytes)`);

    const fileId = uuidv4();
    const fileType = getFileType(req.file.originalname);
    
    if (fileType === 'unknown') {
        return res.status(400).json({ error: 'Unsupported file type.' });
    }

    const tempPath = path.join('uploads', `${fileId}_original${path.extname(req.file.originalname)}`);
    
    try {
      // Move uploaded file to a stable temp name
      fs.renameSync(req.file.path, tempPath);

      const segments: string[] = [];

      if (fileType === 'docx') {
          const zip = new AdmZip(tempPath);
          const zipEntries = zip.getEntries();
          const entry = zipEntries.find(e => e.entryName === 'word/document.xml');
          
          if (!entry) throw new Error('Invalid .docx file (missing word/document.xml)');

          const xmlContent = entry.getData().toString('utf8');
          const doc = new DOMParser().parseFromString(xmlContent, 'text/xml');
          const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
          
          paragraphs.forEach(p => {
            const runs = Array.from(p.getElementsByTagName('w:r'));
            const nodes: Element[] = [];
            runs.forEach(r => {
                const ts = Array.from(r.getElementsByTagName('w:t'));
                ts.forEach(t => nodes.push(t));
            });
            
            if (nodes.length === 0) return;
            
            const fullText = nodes.map(n => n.textContent || '').join('');
            if (isTranslatable(fullText)) {
                segments.push(fullText);
            }
          });
      } else if (fileType === 'odt') {
          const zip = new AdmZip(tempPath);
          const zipEntries = zip.getEntries();
          const entry = zipEntries.find(e => e.entryName === 'content.xml');
          
          if (!entry) throw new Error('Invalid .odt file (missing content.xml)');

          const xmlContent = entry.getData().toString('utf8');
          const doc = new DOMParser().parseFromString(xmlContent, 'text/xml');
          // ODT text is in text:p, text:h, etc.
          const paragraphs = Array.from(doc.getElementsByTagName('text:p'));
          const headers = Array.from(doc.getElementsByTagName('text:h'));
          const allNodes = [...paragraphs, ...headers];

          allNodes.forEach(node => {
              const textContent = node.textContent || '';
              if (isTranslatable(textContent)) {
                  segments.push(textContent);
              }
          });
      } else if (fileType === 'xlsx') {
          const zip = new AdmZip(tempPath);
          const zipEntries = zip.getEntries();
          const entry = zipEntries.find(e => e.entryName === 'xl/sharedStrings.xml');
          
          if (entry) {
              const xmlContent = entry.getData().toString('utf8');
              const doc = new DOMParser().parseFromString(xmlContent, 'text/xml');
              const siNodes = Array.from(doc.getElementsByTagName('si'));
              
              siNodes.forEach(si => {
                  const tNodes = Array.from(si.getElementsByTagName('t'));
                  const fullText = tNodes.map(n => n.textContent || '').join('');
                  if (isTranslatable(fullText)) {
                      segments.push(fullText);
                  } else {
                      // Push empty placeholder to maintain index alignment
                      segments.push(''); 
                  }
              });
          } else {
              // No shared strings? Might be inline strings or empty.
              // For now, we only support sharedStrings as it's the standard for text.
              console.warn('No sharedStrings.xml found in xlsx');
          }
      } else {
          // Handle TXT/MD
          const content = fs.readFileSync(tempPath, 'utf8');
          const lines = content.split(/\r?\n/);
          lines.forEach(line => {
              if (isTranslatable(line)) {
                  segments.push(line);
              }
          });
      }

      res.json({ fileId, segments, fileType });

    } catch (error: any) {
      console.error('Extraction error:', error);
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      res.status(500).json({ error: error.message });
    }
  });

  // 2. Compile Document Endpoint
  app.post('/api/compile', async (req, res) => {
    const { fileId, translations, fileType } = req.body;

    if (!fileId || !translations || !Array.isArray(translations)) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    // Find the original file
    const uploadDir = 'uploads';
    const files = fs.readdirSync(uploadDir);
    const originalFile = files.find(f => f.startsWith(`${fileId}_original`));
    
    if (!originalFile) {
      return res.status(404).json({ error: 'Session expired or file not found' });
    }

    const inputPath = path.join(uploadDir, originalFile);
    const ext = path.extname(originalFile);
    const outputPath = path.join(uploadDir, `${fileId}_translated${ext}`);

    try {
      if (fileType === 'docx') {
          const zip = new AdmZip(inputPath);
          const zipEntries = zip.getEntries();
          const entry = zipEntries.find(e => e.entryName === 'word/document.xml');
          
          if (entry) {
            const xmlContent = entry.getData().toString('utf8');
            const doc = new DOMParser().parseFromString(xmlContent, 'text/xml');
            const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
            
            let translationIndex = 0;

            paragraphs.forEach(p => {
              // Layout Logic (KeepNext)
              let pPr = p.getElementsByTagName('w:pPr')[0];
              
              let isHeading = false;
              if (pPr) {
                  const pStyle = pPr.getElementsByTagName('w:pStyle')[0];
                  if (pStyle) {
                      const val = pStyle.getAttribute('w:val');
                      if (val && (val.toLowerCase().includes('heading') || val.match(/^[1-9]$/) || val.toLowerCase().includes('заголовок'))) { 
                          isHeading = true;
                      }
                  }
                  const outlineLvl = pPr.getElementsByTagName('w:outlineLvl')[0];
                  if (outlineLvl) {
                      isHeading = true;
                  }
              }

              if (isHeading) {
                  if (!pPr) {
                      pPr = doc.createElement('w:pPr');
                      p.insertBefore(pPr, p.firstChild);
                  }
                  
                  let keepNext = pPr.getElementsByTagName('w:keepNext')[0];
                  if (!keepNext) {
                      keepNext = doc.createElement('w:keepNext');
                      // OOXML Schema requires w:keepNext to be near the top of w:pPr, right after w:pStyle
                      const pStyle = pPr.getElementsByTagName('w:pStyle')[0];
                      if (pStyle && pStyle.nextSibling) {
                          pPr.insertBefore(keepNext, pStyle.nextSibling);
                      } else {
                          pPr.insertBefore(keepNext, pPr.firstChild);
                      }
                  }
                  
                  let keepLines = pPr.getElementsByTagName('w:keepLines')[0];
                  if (!keepLines) {
                      keepLines = doc.createElement('w:keepLines');
                      // Insert keepLines right after keepNext
                      if (keepNext && keepNext.nextSibling) {
                          pPr.insertBefore(keepLines, keepNext.nextSibling);
                      } else {
                          pPr.appendChild(keepLines);
                      }
                  }
              }

              const runs = Array.from(p.getElementsByTagName('w:r'));
              const nodes: Element[] = [];
              runs.forEach(r => {
                  const ts = Array.from(r.getElementsByTagName('w:t'));
                  ts.forEach(t => nodes.push(t));
              });
              
              if (nodes.length > 0) {
                  const fullText = nodes.map(n => n.textContent || '').join('');
                  if (isTranslatable(fullText)) {
                     if (translationIndex < translations.length) {
                        const translatedText = translations[translationIndex];
                        if (nodes.length > 0) {
                            nodes[0].textContent = translatedText;
                            for (let i = 1; i < nodes.length; i++) {
                                nodes[i].textContent = '';
                            }
                        }
                        translationIndex++;
                     }
                  }
              }
            });

            // Layout Logic (CantSplit Tables)
            const tables = Array.from(doc.getElementsByTagName('w:tbl'));
            tables.forEach(tbl => {
                const rows = Array.from(tbl.getElementsByTagName('w:tr'));
                rows.forEach(row => {
                    let trPr = row.getElementsByTagName('w:trPr')[0];
                    if (!trPr) {
                        trPr = doc.createElement('w:trPr');
                        if (row.firstChild) row.insertBefore(trPr, row.firstChild);
                        else row.appendChild(trPr);
                    }
                    let cantSplit = trPr.getElementsByTagName('w:cantSplit')[0];
                    if (!cantSplit) {
                        cantSplit = doc.createElement('w:cantSplit');
                        trPr.appendChild(cantSplit);
                    }
                });
            });

            const newXml = new XMLSerializer().serializeToString(doc);
            zip.updateFile('word/document.xml', Buffer.from(newXml, 'utf8'));
          }
          zip.writeZip(outputPath);

      } else if (fileType === 'odt') {
          const zip = new AdmZip(inputPath);
          const zipEntries = zip.getEntries();
          const entry = zipEntries.find(e => e.entryName === 'content.xml');
          
          if (entry) {
              const xmlContent = entry.getData().toString('utf8');
              const doc = new DOMParser().parseFromString(xmlContent, 'text/xml');
              const paragraphs = Array.from(doc.getElementsByTagName('text:p'));
              const headers = Array.from(doc.getElementsByTagName('text:h'));
              const allNodes = [...paragraphs, ...headers];
              
              let translationIndex = 0;
              
              allNodes.forEach(node => {
                  const textContent = node.textContent || '';
                  if (isTranslatable(textContent)) {
                      if (translationIndex < translations.length) {
                          node.textContent = translations[translationIndex];
                          translationIndex++;
                      }
                  }
              });
              
              const newXml = new XMLSerializer().serializeToString(doc);
              zip.updateFile('content.xml', Buffer.from(newXml, 'utf8'));
          }
          zip.writeZip(outputPath);

      } else if (fileType === 'xlsx') {
          const zip = new AdmZip(inputPath);
          const zipEntries = zip.getEntries();
          const entry = zipEntries.find(e => e.entryName === 'xl/sharedStrings.xml');
          
          if (entry) {
              const xmlContent = entry.getData().toString('utf8');
              const doc = new DOMParser().parseFromString(xmlContent, 'text/xml');
              const siNodes = Array.from(doc.getElementsByTagName('si'));
              
              let translationIndex = 0;
              
              siNodes.forEach(si => {
                  const tNodes = Array.from(si.getElementsByTagName('t'));
                  const fullText = tNodes.map(n => n.textContent || '').join('');
                  
                  if (isTranslatable(fullText)) {
                      if (translationIndex < translations.length) {
                          const translatedText = translations[translationIndex];
                          // Excel shared strings are simple <t>Text</t> usually
                          if (tNodes.length > 0) {
                              tNodes[0].textContent = translatedText;
                              // Clear others if split
                              for (let i = 1; i < tNodes.length; i++) {
                                  tNodes[i].textContent = '';
                              }
                          }
                          translationIndex++;
                      }
                  } else {
                      // Skip non-translatable (we pushed empty string in extract)
                      translationIndex++;
                  }
              });
              
              const newXml = new XMLSerializer().serializeToString(doc);
              zip.updateFile('xl/sharedStrings.xml', Buffer.from(newXml, 'utf8'));
          }
          zip.writeZip(outputPath);

      } else {
          // Handle TXT/MD
          const content = fs.readFileSync(inputPath, 'utf8');
          const lines = content.split(/\r?\n/);
          let translationIndex = 0;
          
          const translatedLines = lines.map(line => {
              if (isTranslatable(line)) {
                  if (translationIndex < translations.length) {
                      return translations[translationIndex++];
                  }
              }
              return line;
          });
          
          fs.writeFileSync(outputPath, translatedLines.join('\n'), 'utf8');
      }

      res.download(outputPath, `translated_document${ext}`, (err) => {
        if (err) console.error('Error sending file:', err);
        try {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (e) { console.error('Cleanup error:', e); }
      });

    } catch (error: any) {
      console.error('Compilation error:', error);
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (e) { console.error('Cleanup error during catch:', e); }
      
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  });

  // 404 Handler for API routes (prevents HTML fallback)
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled Server Error:', err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
