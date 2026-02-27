/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Upload, FileText, Check, AlertCircle, Download, Loader2, Zap, Shield, Layers, Globe, Languages } from 'lucide-react';
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
    features: {
      structure: { title: "Structure Preservation", desc: "Maintains original layout, tables, and styles perfectly." },
      secure: { title: "Secure Processing", desc: "Files are processed in memory and deleted immediately." },
      smart: { title: "Smart Fragmentation", desc: "Intelligently handles run fragmentation for coherent translation." }
    }
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
    features: {
      structure: { title: "Сохранение структуры", desc: "Полностью сохраняет оригинальную верстку, таблицы и стили." },
      secure: { title: "Безопасная обработка", desc: "Файлы обрабатываются в памяти и удаляются сразу после завершения." },
      smart: { title: "Умная фрагментация", desc: "Интеллектуально обрабатывает фрагментацию текста для связного перевода." }
    }
  }
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

  // Check server health on mount
  React.useEffect(() => {
    fetch('/api/health')
      .then(res => {
        if (!res.ok) console.warn('Server health check failed:', res.status);
        else console.log('Server health check passed');
      })
      .catch(err => console.error('Server health check error:', err));
  }, []);

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
          
          const parsed = JSON.parse(jsonStr);
          return { 
              glossary: JSON.stringify(parsed.glossary || {}), 
              translatedName: parsed.translatedFilename || filename 
          };
      } catch (e) {
          console.warn("Glossary/Filename generation failed:", e);
          return { glossary: "", translatedName: filename };
      }
  };

  const translateBatch = async (texts: string[], targetLang: string, ai: GoogleGenAI, glossaryJson: string): Promise<string[]> => {
    if (texts.length === 0) return [];
    
    // Use smaller chunks with Index-Keyed JSON to prevent alignment shifts
    const CHUNK_SIZE = 15; 
    const chunks = [];
    for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
      chunks.push(texts.slice(i, i + CHUNK_SIZE));
    }

    const translatedChunks = new Array(chunks.length);
    let completedChunks = 0;

    // Process in parallel batches of 3
    const CONCURRENCY = 3;
    
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const batch = chunks.slice(i, i + CONCURRENCY);
        const promises = batch.map(async (chunk, batchIndex) => {
            const globalIndex = i + batchIndex;
            try {
                let glossaryInstruction = "";
                if (glossaryJson && glossaryJson.length > 2) {
                    glossaryInstruction = `
                    IMPORTANT: Use the following glossary for proper names to ensure consistency. 
                    If a name from this list appears, use the provided translation EXACTLY.
                    Glossary: ${glossaryJson}
                    `;
                }

                // Create an indexed object: { "0": "text1", "1": "text2" }
                const indexedChunk: Record<string, string> = {};
                chunk.forEach((text, idx) => {
                    indexedChunk[idx.toString()] = text;
                });

                const prompt = `You are a professional translator. Translate the values in the following JSON object into ${targetLang}.
                
                CRITICAL RULES:
                1. Return ONLY a JSON object.
                2. The keys MUST be exactly the same as the input keys ("0", "1", etc.). DO NOT change keys.
                3. The values should be the translated text.
                4. Preserve original formatting (spaces, capitalization, punctuation).
                5. If a segment is a number, code, or symbol, return it exactly as is.
                ${glossaryInstruction}
                
                Input JSON:
                ${JSON.stringify(indexedChunk)}`;
                
                const response = await ai.models.generateContent({
                  model: "gemini-3-flash-preview",
                  contents: prompt,
                  config: {
                      responseMimeType: "application/json",
                      responseSchema: {
                          type: Type.OBJECT,
                          properties: {
                              // We can't define dynamic properties easily in schema, so we use simpler object type
                              // or just rely on JSON mode without strict schema for dynamic keys if needed,
                              // but Type.OBJECT usually works well for free-form JSON.
                          }
                      }
                  }
                });
                
                const jsonStr = response.text;
                if (!jsonStr) {
                  translatedChunks[globalIndex] = chunk; // Fallback
                  return;
                }
                
                const parsed = JSON.parse(jsonStr) as Record<string, string>;
                
                // Reconstruct array ensuring order and existence
                const resultChunk = chunk.map((originalText, idx) => {
                    const key = idx.toString();
                    if (parsed[key] !== undefined) {
                        return parsed[key];
                    }
                    // If key missing, fallback to original
                    return originalText;
                });

                translatedChunks[globalIndex] = resultChunk;

            } catch (e) {
                console.error(`Batch translation error (Chunk ${globalIndex+1}):`, e);
                translatedChunks[globalIndex] = chunk; // Fallback
            } finally {
                completedChunks++;
                setProgress(Math.round((completedChunks / chunks.length) * 100));
            }
        });

        await Promise.all(promises);
    }
    
    return translatedChunks.flat();
  };

  const processFile = async () => {
    if (!file) return;

    if (!apiKey) {
      setErrorMsg(appLang === 'ru' ? 'Пожалуйста, введите API ключ' : 'Please enter an API Key');
      setStatus('error');
      return;
    }
    
    const ai = new GoogleGenAI({ apiKey });

    setStatus('extracting');
    const formData = new FormData();
    formData.append('file', file);

    try {
      // 1. Extract Text
      const extractRes = await fetch('/api/extract', {
        method: 'POST',
        body: formData,
      });

      const extractContentType = extractRes.headers.get("content-type");
      if (!extractContentType || extractContentType.indexOf("application/json") === -1) {
          const text = await extractRes.text();
          console.error("Server returned non-JSON response:", text);
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
      const compileRes = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, translations: translatedSegments, fileType }),
      });

      const compileContentType = compileRes.headers.get("content-type");
      if (!compileContentType || compileContentType.indexOf("application/json") === -1 && compileContentType.indexOf("application/vnd.openxmlformats") === -1 && compileContentType.indexOf("text/plain") === -1 && compileContentType.indexOf("text/markdown") === -1) {
          const text = await compileRes.text();
          console.error("Server returned non-JSON response:", text);
          throw new Error(`Server error (${compileRes.status}): Received HTML instead of JSON/File. Check server logs.`);
      }

      if (!compileRes.ok) {
        const err = await compileRes.json();
        throw new Error(err.error || 'Compilation failed');
      }

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
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 mb-4">
            {t.heroTitle}
          </h2>
          <p className="text-lg text-zinc-600 max-w-2xl mx-auto">
            {t.heroDesc}
          </p>
        </div>

        {/* API Key Input */}
        <div className="mb-8 max-w-md mx-auto">
            <label className="block text-sm font-medium text-zinc-700 mb-2 text-left">
                AI API Key
            </label>
            <div className="relative">
                <input 
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={appLang === 'ru' ? "Вставьте ваш ключ здесь..." : "Paste your API key here..."}
                    className="w-full pl-4 pr-4 py-2 bg-white border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
            </div>
            <p className="text-xs text-zinc-500 mt-2 text-left">
                {appLang === 'ru' ? (
                    <>Получить бесплатный ключ можно здесь: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">AI Studio</a></>
                ) : (
                    <>Get a free key here: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">AI Studio</a></>
                )}
            </p>
        </div>

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

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
          <Feature 
            icon={<Layers className="w-5 h-5 text-indigo-600" />}
            title={t.features.structure.title}
            desc={t.features.structure.desc}
          />
          <Feature 
            icon={<Shield className="w-5 h-5 text-emerald-600" />}
            title={t.features.secure.title}
            desc={t.features.secure.desc}
          />
          <Feature 
            icon={<Zap className="w-5 h-5 text-amber-600" />}
            title={t.features.smart.title}
            desc={t.features.smart.desc}
          />
        </div>
      </main>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="p-6 bg-white rounded-xl border border-zinc-200 shadow-sm">
      <div className="w-10 h-10 bg-zinc-50 rounded-lg flex items-center justify-center mb-4 border border-zinc-100">
        {icon}
      </div>
      <h3 className="font-semibold text-zinc-900 mb-2">{title}</h3>
      <p className="text-sm text-zinc-600 leading-relaxed">{desc}</p>
    </div>
  );
}
