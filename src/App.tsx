/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Upload, FileText, Check, AlertCircle, Download, Loader2, Zap, Globe, Languages, Settings } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import './types'; // Import global types

const LANGUAGES = [
  'Arabic', 'Chinese', 'Dutch', 'English', 'French', 'German', 'Hindi', 'Italian', 
  'Japanese', 'Kazakh', 'Korean', 'Polish', 'Portuguese', 'Russian', 'Spanish', 
  'Turkish', 'Ukrainian', 'Uzbek', 'Vietnamese'
];

const UI_STRINGS = {
  en: {
    title: "DocxTranslator SaaS",
    subtitle: "v1.3.0 Client-Side AI",
    heroTitle: "Translate Documents while Preserving Formatting",
    heroDesc: "Upload your document. Our engine isolates markup, translates content (Client-Side), and reconstructs the document.",
    dragDrop: "Drag & drop your file here",
    browse: "or click to browse from your computer",
    selectFile: "Select File",
    processing: "Processing document...",
    extracting: "Extracting text...",
    translating: "Translating...",
    compiling: "Reconstructing document...",
    complete: "Translation Complete!",
    download: "Download Translated File",
    translateAnother: "Translate Another",
    run: "Run Translation",
    cancel: "Cancel",
    error: "Error",
    targetLang: "Target Language",
    appLang: "Interface Language",
    settings: "Settings",
    apiKeyLabel: "API Key",
    apiKeyPlaceholder: "Paste your API key here...",
    apiKeyLink: "Get a free key here: ",
    supportedFormats: "Supported formats: .docx, .xlsx, .odt, .txt, .md"
  },
  ru: {
    title: "DocxTranslator SaaS",
    subtitle: "v1.3.0 Client-Side",
    heroTitle: "Перевод документов с сохранением форматирования",
    heroDesc: "Загрузите ваш документ. Наш движок изолирует разметку, переводит контент (на клиенте) и пересобирает документ.",
    dragDrop: "Перетащите файл сюда",
    browse: "или нажмите для выбора",
    selectFile: "Выбрать файл",
    processing: "Обработка документа...",
    extracting: "Извлечение текста...",
    translating: "Перевод...",
    compiling: "Сборка документа...",
    complete: "Перевод завершен!",
    download: "Скачать переведенный файл",
    translateAnother: "Перевести другой",
    run: "Запустить перевод",
    cancel: "Отмена",
    error: "Ошибка",
    targetLang: "Язык перевода",
    appLang: "Язык интерфейса",
    settings: "Настройки",
    apiKeyLabel: "API Ключ",
    apiKeyPlaceholder: "Вставьте ваш ключ здесь...",
    apiKeyLink: "Получить бесплатный ключ можно здесь: ",
    supportedFormats: "Поддерживаемые форматы: .docx, .xlsx, .odt, .txt, .md"
  }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 8): Promise<Response> => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const res = await fetch(url, options);
            
            if (res.status === 413) {
                return res; // Do not retry on Payload Too Large
            }
            
            const contentType = res.headers.get("content-type");
            
            if (contentType && contentType.includes("text/html")) {
                const text = await res.clone().text();
                const lowerText = text.toLowerCase();
                if (lowerText.includes("<html") || lowerText.includes("<!doctype html>")) {
                    console.warn(`[Attempt ${i+1}/${maxRetries}] Received HTML from ${url}. Server might be cold-starting. Retrying in 5s...`);
                    await delay(5000);
                    continue;
                }
            }
            return res;
        } catch (err) {
            console.warn(`[Attempt ${i+1}/${maxRetries}] Fetch error for ${url}:`, err);
            if (i === maxRetries - 1) throw err;
            await delay(5000);
        }
    }
    return fetch(url, options);
};

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'extracting' | 'translating' | 'compiling' | 'completed' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [targetLang, setTargetLang] = useState('English');
  const [appLang, setAppLang] = useState<'en' | 'ru'>('ru');
  const [progress, setProgress] = useState(0);
  // Initialize with localStorage or env var
  const [apiKey, setApiKey] = useState(() => {
      return localStorage.getItem('DOCX_TRANSLATOR_API_KEY') || import.meta.env.VITE_GEMINI_API_KEY || '';
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(!localStorage.getItem('DOCX_TRANSLATOR_API_KEY') && !import.meta.env.VITE_GEMINI_API_KEY);
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = UI_STRINGS[appLang];

  // Persist API Key changes
  React.useEffect(() => {
      if (apiKey) {
          localStorage.setItem('DOCX_TRANSLATOR_API_KEY', apiKey);
      }
  }, [apiKey]);

  const [translatedFilename, setTranslatedFilename] = useState('');

  // Keep server alive during long processes
  React.useEffect(() => {
    let intervalId: NodeJS.Timeout;
    
    if (status === 'extracting' || status === 'translating' || status === 'compiling') {
        // Ping every 30 seconds to prevent container from sleeping
        intervalId = setInterval(() => {
            fetch('/api/health')
              .then(res => {
                if (!res.ok) console.warn('Keep-alive failed:', res.status);
              })
              .catch(err => console.warn('Keep-alive error:', err));
        }, 30000);
    }
    
    return () => {
        if (intervalId) clearInterval(intervalId);
    };
  }, [status]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    const validExts = ['.docx', '.docm', '.dotx', '.dotm', '.txt', '.md', '.odt', '.xlsx', '.xlsm', '.xltx', '.xltm'];
    const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase();
    
    if (!validExts.includes(ext)) {
      setErrorMsg(appLang === 'ru' ? 'Пожалуйста, загрузите файл .docx, .xlsx, .odt, .txt или .md' : 'Please upload a .docx, .xlsx, .odt, .txt, or .md file');
      setStatus('error');
      return;
    }
    setFile(selectedFile);
    setStatus('idle');
    setErrorMsg('');
    setDownloadUrl('');
    setTranslatedFilename('');
    setProgress(0);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const parseJSONResponse = (text: string) => {
    try {
        // Remove markdown code blocks if present (e.g., ```json ... ```)
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        console.error("Failed to parse JSON:", text);
        throw e;
    }
  };

  const generateGlossaryAndTranslateFilename = async (segments: string[], filename: string, targetLang: string, ai: GoogleGenAI): Promise<{glossary: string, translatedName: string}> => {
      // Take first 20 and last 20 segments to find names (preamble and signatures)
      const sample = [...segments.slice(0, 20), ...segments.slice(-20)];
      const uniqueSample = Array.from(new Set(sample)).join('\n');
      
      const prompt = `Analyze the following text sample and filename.
      1. Identify proper names (people, companies, organizations) that appear in the text.
      2. Translate the filename "${filename}" into ${targetLang} (keep the file extension).
      
      Provide a JSON object with two keys:
      - "glossary": object where keys are original names and values are translations.
      - "translatedFilename": string, the translated filename.
      
      Text Sample:
      ${uniqueSample}`;

      try {
          const response = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: prompt,
              config: { responseMimeType: "application/json" }
          });
          
          const jsonStr = response.text;
          if (!jsonStr) return { glossary: "", translatedName: filename };
          
          const parsed = parseJSONResponse(jsonStr);
          return { 
              glossary: JSON.stringify(parsed.glossary || {}), 
              translatedName: parsed.translatedFilename || filename 
          };
      } catch (e) {
          console.warn("Glossary/Filename generation failed:", e);
          return { glossary: "", translatedName: filename };
      }
  };

  const cleanText = (text: string) => {
    if (!text) return text;
    
    // Preserve leading/trailing whitespace (indentation)
    const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match) return text;
    const [_, leading, content, trailing] = match;
    
    let processed = content;
    
    // 1. Remove spaces before punctuation ( "word ." -> "word." )
    processed = processed.replace(/[ \t]+([.,!?:;])/g, '$1');
    
    // 2. Remove double spaces ( "word  word" -> "word word" )
    processed = processed.replace(/[ \t]{2,}/g, ' ');
    
    // 3. Add space after punctuation if missing ( "word,word" -> "word, word" )
    // Look for punctuation followed by a letter (to avoid 3.14 or 1,000)
    // Using \p{L} requires 'u' flag
    processed = processed.replace(/([.,!?:;])(?=\p{L})/gu, '$1 ');
    
    return leading + processed + trailing;
  };

  const translateBatch = async (texts: string[], targetLang: string, ai: GoogleGenAI, glossaryJson: string): Promise<string[]> => {
    if (texts.length === 0) return [];
    
    // Increased chunk size for faster processing, using ID-based alignment for safety
    const CHUNK_SIZE = 50;
    const chunks = [];
    for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
      chunks.push(texts.slice(i, i + CHUNK_SIZE));
    }

    const translatedChunks = [];
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        // Update progress
        setProgress(Math.round((i / chunks.length) * 100));

        let retries = 0;
        const MAX_RETRIES = 5; // Increased retries for rate limits
        let success = false;

        while (!success && retries < MAX_RETRIES) {
            try {
                // Add a small delay between requests to be nice to the API
                if (i > 0 && retries === 0) await delay(500);

                let glossaryInstruction = "";
                if (glossaryJson && glossaryJson.length > 2) {
                    glossaryInstruction = `
                    IMPORTANT: Use the following glossary for proper names to ensure consistency. 
                    If a name from this list appears, use the provided translation EXACTLY.
                    Glossary: ${glossaryJson}
                    `;
                }

                const chunkArr = chunk.map((text, idx) => ({ id: idx, text }));

                const prompt = `You are a professional translator. Translate the following array of objects into ${targetLang}.
                
                Rules:
                1. Return ONLY a JSON array of objects.
                2. Each object MUST have an "id" (number) and "text" (string) property.
                3. The "id" MUST match the input object's "id".
                4. The "text" MUST be the translation of the input object's "text".
                5. Preserve the original meaning, tone, and formatting (like spaces at start/end).
                6. If a segment is just a number or symbol, return it as is.
                ${glossaryInstruction}
                
                Input:
                ${JSON.stringify(chunkArr)}`;
                
                const response = await ai.models.generateContent({
                  model: "gemini-3-flash-preview",
                  contents: prompt,
                  config: {
                      responseMimeType: "application/json",
                      responseSchema: {
                          type: Type.ARRAY,
                          items: { 
                              type: Type.OBJECT,
                              properties: {
                                  id: { type: Type.INTEGER },
                                  text: { type: Type.STRING }
                              },
                              required: ["id", "text"]
                          }
                      }
                  }
                });
                
                const jsonStr = response.text;
                if (!jsonStr) {
                  throw new Error("Empty response from AI");
                }
                
                const parsed = parseJSONResponse(jsonStr) as {id: number, text: string}[];
                
                // Reconstruct the array based on IDs to ensure perfect alignment
                const translatedStrings = new Array(chunk.length);
                for (let j = 0; j < chunk.length; j++) {
                    const item = parsed.find(p => p.id === j);
                    translatedStrings[j] = item ? item.text : chunk[j];
                }
                
                // Apply text cleaning (remove double spaces, fix punctuation)
                const cleaned = translatedStrings.map(cleanText);
                translatedChunks.push(cleaned);
                success = true;

            } catch (e: any) {
                console.error(`Batch translation error (Chunk ${i+1}, Attempt ${retries+1}):`, e);
                
                // Check for rate limit error (429)
                const isRateLimit = e.message?.includes('429') || e.status === 429 || JSON.stringify(e).includes('RESOURCE_EXHAUSTED');
                
                if (isRateLimit) {
                    retries++;
                    const waitTime = Math.pow(2, retries) * 2000; // Exponential backoff: 4s, 8s, 16s...
                    console.warn(`Rate limit hit. Waiting ${waitTime}ms before retry...`);
                    await delay(waitTime);
                } else {
                    // Non-rate-limit error: break and use fallback
                    break;
                }
            }
        }

        if (!success) {
            console.warn(`Failed to translate chunk ${i+1} after retries. Using original text.`);
            translatedChunks.push(chunk); // Final Fallback
        }
    }
    
    return translatedChunks.flat();
  };

  const processFile = async () => {
    if (!file) return;

    if (!apiKey) {
      setIsSettingsOpen(true);
      setErrorMsg(appLang === 'ru' ? 'Пожалуйста, укажите API ключ в настройках' : 'Please provide an API Key in settings');
      setStatus('error');
      return;
    }
    
    const ai = new GoogleGenAI({ apiKey });

    setStatus('extracting');
    const formData = new FormData();
    formData.append('file', file);

    try {
      // 1. Extract Text
      const extractRes = await fetchWithRetry('/api/extract', {
        method: 'POST',
        body: formData,
      });

      const extractContentType = extractRes.headers.get("content-type");
      if (!extractContentType || extractContentType.indexOf("application/json") === -1) {
          const text = await extractRes.text();
          console.error("Server returned non-JSON response:", text);
          if (extractRes.status === 413) {
              throw new Error(`Файл слишком большой для загрузки (ошибка 413). Пожалуйста, уменьшите размер файла.`);
          }
          const lowerText = text.toLowerCase();
          if (lowerText.includes("<!doctype html>") || lowerText.includes("<html") || lowerText.includes("<body")) {
              throw new Error(`Сетевая ошибка: Сервер недоступен или перезагружается. Пожалуйста, подождите пару секунд и попробуйте снова.`);
          }
          throw new Error(`Server error (${extractRes.status}): Received HTML instead of JSON. Check server logs.`);
      }

      if (!extractRes.ok) {
        const err = await extractRes.json();
        throw new Error(err.error || 'Extraction failed');
      }

      const { fileId, segments, fileType } = await extractRes.json();

      // 1.5 Generate Glossary & Translate Filename
      let glossary = "";
      let newFilename = file.name;
      
      if (segments.length > 0) {
          // setStatus('analyzing'); 
          const analysis = await generateGlossaryAndTranslateFilename(segments, file.name, targetLang, ai);
          glossary = analysis.glossary;
          newFilename = analysis.translatedName;
          setTranslatedFilename(newFilename);
          console.log("Generated Glossary:", glossary);
          console.log("Translated Filename:", newFilename);
      }

      // 2. Translate Text
      setStatus('translating');
      const translatedSegments = await translateBatch(segments, targetLang, ai, glossary);

      // 3. Compile Document
      setStatus('compiling');
      const compileRes = await fetchWithRetry('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, translations: translatedSegments, fileType }),
      });

      const compileContentType = compileRes.headers.get("content-type");
      
      // If it's a JSON error response
      if (compileContentType && compileContentType.includes("application/json")) {
          const err = await compileRes.json();
          if (!compileRes.ok) {
              throw new Error(err.error || 'Compilation failed');
          }
      } else if (!compileRes.ok) {
          // Non-JSON error response (e.g. 502 Bad Gateway HTML)
          const text = await compileRes.text();
          console.error("Server returned non-JSON error:", text);
          if (compileRes.status === 413) {
              throw new Error(`Результат перевода слишком большой (ошибка 413).`);
          }
          const lowerText = text.toLowerCase();
          if (lowerText.includes("<!doctype html>") || lowerText.includes("<html") || lowerText.includes("<body")) {
              throw new Error(`Сетевая ошибка: Сервер недоступен или перезагружается. Пожалуйста, попробуйте снова.`);
          }
          throw new Error(`Server error (${compileRes.status}): Received HTML instead of JSON/File. Check server logs.`);
      }

      // If we got here and it's OK, it's the file download
      const blob = await compileRes.blob();
      const url = window.URL.createObjectURL(blob);
      setDownloadUrl(url);
      setStatus('completed');
      setProgress(100);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to process file. Please try again.');
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans transition-colors">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">{t.title}</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-zinc-600 bg-zinc-100 px-3 py-1.5 rounded-md">
               <Globe className="w-4 h-4" />
               <select 
                 value={appLang} 
                 onChange={(e) => setAppLang(e.target.value as 'en' | 'ru')}
                 className="bg-transparent border-none outline-none cursor-pointer font-medium"
               >
                 <option value="en">English</option>
                 <option value="ru">Русский</option>
               </select>
            </div>
            <button 
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`p-2 rounded-md transition-colors ${isSettingsOpen ? 'bg-indigo-100 text-indigo-600' : 'text-zinc-500 hover:bg-zinc-100'}`}
              title={t.settings}
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 mb-3">
            {t.heroTitle}
          </h2>
          <p className="text-zinc-500 max-w-xl mx-auto">
            {t.heroDesc}
          </p>
        </div>

        {/* API Key Input (Collapsible) */}
        {isSettingsOpen && (
          <div className="mb-8 max-w-md mx-auto bg-white p-6 rounded-xl border border-zinc-200 shadow-sm animate-in fade-in slide-in-from-top-4">
              <label className="block text-sm font-medium text-zinc-700 mb-2 text-left">
                  {t.apiKeyLabel}
              </label>
              <div className="relative">
                  <input 
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={t.apiKeyPlaceholder}
                      className="w-full pl-4 pr-4 py-2 bg-zinc-50 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  />
              </div>
              <p className="text-xs text-zinc-500 mt-3 text-left">
                  {t.apiKeyLink} <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline font-medium">AI Studio</a>
              </p>
          </div>
        )}

        {/* Upload Area */}
        <div 
          className={`
            relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all duration-200
            ${status === 'error' ? 'border-rose-300 bg-rose-50' : 
              isDragging ? 'border-indigo-500 bg-indigo-50 scale-[1.02] shadow-lg' :
              file ? 'border-indigo-300 bg-indigo-50/50' : 'border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50'}
          `}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileChange} 
            accept=".docx,.docm,.dotx,.dotm,.txt,.md,.odt,.xlsx,.xlsm,.xltx,.xltm" 
            className="hidden" 
          />
          
          {['uploading', 'extracting', 'translating', 'compiling'].includes(status) ? (
            <div className="flex flex-col items-center animate-pulse">
              <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
              <p className="text-lg font-medium text-indigo-900">
                {status === 'extracting' ? t.extracting : 
                 status === 'translating' ? `${t.translating} (${progress}%)` : 
                 status === 'compiling' ? t.compiling : t.processing}
              </p>
              {status === 'translating' && (
                <div className="w-64 h-2 bg-indigo-100 rounded-full mt-4 overflow-hidden">
                    <div 
                        className="h-full bg-indigo-600 transition-all duration-300" 
                        style={{ width: `${progress}%` }}
                    />
                </div>
              )}
            </div>
          ) : status === 'completed' ? (
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-xl font-semibold text-zinc-900 mb-2">{t.complete}</h3>
              
              <div className="flex flex-col sm:flex-row gap-4 mt-6">
                <a 
                  href={downloadUrl} 
                  download={translatedFilename || `translated_${file?.name || 'document.docx'}`}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-sm hover:shadow-md"
                >
                  <Download className="w-4 h-4" />
                  {t.download}
                </a>
                <button 
                  onClick={() => {
                    setFile(null);
                    setStatus('idle');
                    setDownloadUrl('');
                  }}
                  className="px-6 py-3 bg-white text-zinc-700 border border-zinc-200 rounded-xl font-medium hover:bg-zinc-50 transition-colors"
                >
                  {t.translateAnother}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              {file ? (
                <>
                  <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8 text-indigo-600" />
                  </div>
                  <h3 className="text-lg font-medium text-zinc-900 mb-1">{file.name}</h3>
                  <p className="text-sm text-zinc-500 mb-6">{(file.size / 1024).toFixed(1)} KB</p>
                  
                  {/* Language Selector */}
                  <div className="mb-6 w-full max-w-xs">
                    <label className="block text-sm font-medium text-zinc-700 mb-2 text-left">
                      {t.targetLang}
                    </label>
                    <div className="relative">
                      <Languages className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <select 
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none appearance-none"
                      >
                        {LANGUAGES.map(lang => (
                          <option key={lang} value={lang}>{lang}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button 
                      onClick={processFile}
                      className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                      <Zap className="w-4 h-4" />
                      {t.run}
                    </button>
                    <button 
                      onClick={() => setFile(null)}
                      className="px-6 py-2.5 text-zinc-600 hover:text-zinc-900 font-medium"
                    >
                      {t.cancel}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-4 cursor-pointer hover:bg-zinc-200 transition-colors" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-8 h-8 text-zinc-400" />
                  </div>
                  <h3 className="text-lg font-medium text-zinc-900 mb-2">
                    {t.dragDrop}
                  </h3>
                  <p className="text-zinc-500 mb-6">{t.browse}</p>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="px-5 py-2 bg-white border border-zinc-300 text-zinc-700 rounded-lg font-medium hover:bg-zinc-50 transition-colors shadow-sm"
                  >
                    {t.selectFile}
                  </button>
                  <p className="text-xs text-zinc-400 mt-4">
                    {appLang === 'ru' ? 'Поддерживаемые форматы: .docx, .xlsx, .odt, .txt, .md' : 'Supported formats: .docx, .xlsx, .odt, .txt, .md'}
                  </p>
                </>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="mt-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-rose-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p>{errorMsg}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
