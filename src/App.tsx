/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { 
  BookOpen, 
  Upload, 
  MessageSquare, 
  GraduationCap, 
  Send, 
  Clock, 
  AlertCircle,
  HelpCircle,
  ChevronRight,
  RefreshCcw,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  File,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  History,
  FolderOpen
} from 'lucide-react';
import { cn } from './lib/utils';
import { askExaminer, extractTextFromImage } from './lib/gemini';
import { ExamStage, Message } from './types';
import ReactMarkdown from 'react-markdown';
import * as pdfjs from 'pdfjs-dist';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

export default function App() {
  const [stage, setStage] = useState<ExamStage>('IDLE');
  const [material, setMaterial] = useState<string>('');
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [questions, setQuestions] = useState<string[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState('');
  const [examLang, setExamLang] = useState('cs-CZ');
  const [duration, setDuration] = useState(15);
  const [timeLeft, setTimeLeft] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  
  // Auth & History State
  const [localSubjects, setLocalSubjects] = useState<any[]>([]);
  const [localHistory, setLocalHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stages = [
    { id: 'IDLE', label: 'Podklady', icon: FileText },
    { id: 'CHOOSE_QUESTION', label: 'Téma', icon: GraduationCap },
    { id: 'EXAM', label: 'Zkouška', icon: Mic },
    { id: 'EVALUATION', label: 'Výsledek', icon: CheckCircle2 }
  ];

  const currentStageIndex = stage === 'IDLE' || stage === 'SETUP' ? 0 : 
                           stage === 'CHOOSE_QUESTION' ? 1 : 
                           (stage === 'MONOLOGUE' || stage === 'FOLLOW_UP') ? 2 : 3;

  useEffect(() => {
    const savedLocal = localStorage.getItem('maturita_ai_local_subjects');
    if (savedLocal) {
      try {
        setLocalSubjects(JSON.parse(savedLocal));
      } catch (e) {
        console.error('Failed to parse local subjects');
      }
    }

    const savedLocalHistory = localStorage.getItem('maturita_ai_local_history');
    if (savedLocalHistory) {
      try {
        setLocalHistory(JSON.parse(savedLocalHistory));
      } catch (e) {
        console.error('Failed to parse local history');
      }
    }
  }, []);

  useEffect(() => {
    if (stage === 'EVALUATION') {
      saveExamResult();
    }
  }, [stage]);

  const saveExamResult = async () => {
    if (isSaving) return;
    setIsSaving(true);
    
    // Prepare history item
    const newHistoryItem = {
      id: Date.now().toString(),
      subjectName: subject,
      question: selectedQuestion,
      material: material.slice(0, 1000),
      duration,
      messages: messages.slice(-10),
      createdAt: new Date().toISOString(),
      isLocal: true
    };

    // Save to local storage
    const updatedLocalHistory = [newHistoryItem, ...localHistory].slice(0, 20);
    setLocalHistory(updatedLocalHistory);
    localStorage.setItem('maturita_ai_local_history', JSON.stringify(updatedLocalHistory));
    
    setIsSaving(false);
  };

  useEffect(() => {
    let interval: any;
    if (stage === 'MONOLOGUE' || stage === 'FOLLOW_UP') {
      interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 0) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [stage]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    
    // Validate file types (only PDF and Word)
    const allowedExtensions = ['.pdf', '.doc', '.docx'];
    const invalidFiles = fileList.filter(file => {
      const name = file.name.toLowerCase();
      return !allowedExtensions.some(ext => name.endsWith(ext));
    });

    if (invalidFiles.length > 0) {
      alert(`Následující soubory nejsou v podporovaném formátu (povoleny jsou pouze PDF a Word): \n${invalidFiles.map(f => f.name).join(', ')}`);
      return;
    }

    setFileNames(fileList.map(f => f.name));
    setIsProcessingFile(true);

    try {
      const extractedTexts = await Promise.all(fileList.map(async (file) => {
        let text = '';
        
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n';
          }
          text = fullText;
        } else if (file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          text = result.value;
        }
        return text;
      }));

      const combinedText = extractedTexts.filter(t => t).join('\n\n---\n\n');

      if (!combinedText) {
        alert('Nepodařilo se extrahovat text ze zvolených souborů. Zkuste prosím jiný formát nebo menší soubory.');
        return;
      }

      setMaterial(combinedText);
      
      // Always default to Czech for Maturita apps
      setExamLang('cs-CZ');
      
      // Try to parse questions from the text
      const lines = combinedText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
      const detected = lines.filter(l => /^\d+[\.\)]|Otázka|Téma/i.test(l));
      
      setQuestions(detected.length > 0 ? detected : lines.slice(0, 20));
      setStage('SETUP');
    } catch (err: any) {
      console.error('File process error:', err);
      const errorMessage = err?.message || String(err);
      
      if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('429')) {
        alert('Chyba: Byl překročen limit požadavků na AI (Quota exceeded). Zkuste to prosím za chvíli.');
      } else if (errorMessage.toLowerCase().includes('api_key')) {
        alert('Chyba: Problém s API klíčem. Zkontrolujte prosím nastavení prostředí.');
      } else {
        alert(`Při zpracování souboru došlo k chybě: ${errorMessage}`);
      }
    } finally {
      setIsProcessingFile(false);
    }
  };

  const startSetup = () => {
    // Save to local storage if not logged in or just as a cache
    const newLocalSubject = {
      id: Date.now().toString(),
      name: subject,
      material: material,
      questions: questions,
      createdAt: new Date().toISOString()
    };
    
    const updatedLocal = [newLocalSubject, ...localSubjects.filter(s => s.name !== subject)].slice(0, 5);
    setLocalSubjects(updatedLocal);
    localStorage.setItem('maturita_ai_local_subjects', JSON.stringify(updatedLocal));

    setStage('CHOOSE_QUESTION');
  };

  const selectQuestion = (q: string) => {
    setSelectedQuestion(q);
    setStage('MONOLOGUE');
    setTimeLeft(duration * 60);
    
    const welcomeText = `Vylosovali jste si otázku: **${q}**. \n\nNyní máte slovo k vašemu monologu. V průběhu se vás budu 3x doptávat na doplňující souvislosti. Poté přejdeme k doplňujícím otázkám.`;

    setMessages([{ 
      role: 'teacher', 
      content: welcomeText
    }]);
    speak(welcomeText);
  };

  const drawRandom = () => {
    if (questions.length === 0) return;
    const random = questions[Math.floor(Math.random() * questions.length)];
    selectQuestion(random);
  };

  const sendMessage = async (contentOverride?: string, langOverride?: string) => {
    const finalInput = contentOverride || input;
    if (!finalInput.trim() || isTyping) return;

    const finalLang = langOverride || examLang;
    const newMessages: Message[] = [...messages, { role: 'student', content: finalInput }];
    setMessages(newMessages);
    if (!contentOverride) setInput('');
    setIsTyping(true);

    try {
      const history = newMessages.map(m => ({
        role: (m.role === 'teacher' ? 'model' : 'user') as "model" | "user",
        parts: [{ text: m.content }]
      }));

      const context = `ZKOUŠENÉ TÉMA: ${selectedQuestion}\n\nCELÝ MATERIÁL:\n${material}`;
      const response = await askExaminer(context, history, finalLang);
      const teacherMessage = { role: 'teacher', content: response || '...' } as const;
      
      const updatedMessages = [...newMessages, teacherMessage];
      setMessages(updatedMessages);
      speak(teacherMessage.content);

      if (response?.includes('📋 Celkové hodnocení')) {
        setStage('EVALUATION');
      } else if (stage === 'MONOLOGUE' && (finalInput.toLowerCase().includes('vše') || finalInput.toLowerCase().includes('hotovo'))) {
        setStage('FOLLOW_UP');
      }
    } catch (err: any) {
      console.error(err);
      setMessages([...newMessages, { role: 'teacher', content: 'Omlouvám se, došlo k chybě při spojení s AI profesorem. Zkontrolujte prosím připojení nebo API klíč.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  const finishMonologue = async () => {
    if (stage !== 'MONOLOGUE') return;
    
    setIsTyping(true);
    const finishContent = 'TO JE VŠE. Nyní mi položte 3 doplňující otázky z mých materiálů a 3 doplňující otázky nad rámec mých materiálů.';

    const finishMessage: Message = { role: 'student', content: finishContent };
    const newMessages = [...messages, finishMessage];
    setMessages(newMessages);
    setInput('');

    try {
      const history = newMessages.map(m => ({
        role: (m.role === 'teacher' ? 'model' : 'user') as "model" | "user",
        parts: [{ text: m.content }]
      }));

      const context = `ZKOUŠENÉ TÉMA: ${selectedQuestion}\n\nCELÝ MATERIÁL:\n${material}`;
      const response = await askExaminer(context, history, examLang);
      const teacherMessage = { role: 'teacher', content: response || '...' } as const;
      
      setMessages([...newMessages, teacherMessage]);
      speak(teacherMessage.content);
      setStage('FOLLOW_UP');
    } catch (err: any) {
      console.error(err);
      setMessages([...newMessages, { role: 'teacher', content: 'Omlouvám se, došlo k chybě při přechodu na doplňující otázky.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  const speak = (text: string) => {
    if (!isVoiceEnabled) return;
    
    window.speechSynthesis.cancel();
    
    // Clean markdown and formatting
    let cleanText = text.replace(/[*_#`]/g, '').replace(/\[.*\]/g, '');
    
    // Fix Czech speech synthesis issues (e.g., 3x -> třikrát)
    cleanText = cleanText.replace(/(\d+)\s*x\b/gi, (match, p1) => {
      const num = parseInt(p1);
      const map: Record<number, string> = {
        1: 'jednou',
        2: 'dvakrát',
        3: 'třikrát',
        4: 'čtyřikrát',
        5: 'pětkrát',
        6: 'šestkrát',
        7: 'sedmkrát',
        8: 'osmkrát',
        9: 'devětkrát',
        10: 'desetkrát'
      };
      return map[num] || `${p1}krát`;
    });

    // Expand common abbreviations for better reading
    const abbreviations: Record<string, string> = {
      'např.': 'například',
      'atd.': 'a tak dále',
      'tzv.': 'takzvaný',
      'tj.': 'to jest',
      'cca': 'přibližně'
    };

    Object.entries(abbreviations).forEach(([abbr, full]) => {
      const regex = new RegExp(abbr.replace('.', '\\.'), 'gi');
      cleanText = cleanText.replace(regex, full);
    });

    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Force Czech voice unless it's clear the whole sentence is in a different language
    // and the exam language was explicitly set to that language.
    utterance.lang = examLang;

    utterance.onstart = () => setIsAiSpeaking(true);
    utterance.onend = () => {
      setIsAiSpeaking(false);
      if (isVoiceEnabled && !isListening) {
        startListening();
      }
    };
    
    window.speechSynthesis.speak(utterance);
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    // Use exam language for recognition
    recognition.lang = examLang;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const reset = () => {
    window.speechSynthesis.cancel();
    setIsAiSpeaking(false);
    setStage('IDLE');
    setMaterial('');
    setFileNames([]);
    setSubject('');
    setQuestions([]);
    setSelectedQuestion('');
    setMessages([]);
  };

  const deleteLocalSubject = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = localSubjects.filter(s => s.id !== id);
    setLocalSubjects(updated);
    localStorage.setItem('maturita_ai_local_subjects', JSON.stringify(updated));
  };

  const loadLocalSubject = (s: any) => {
    setSubject(s.name);
    setMaterial(s.material);
    setQuestions(s.questions || []);
    setStage('SETUP');
  };

  return (
    <div className="min-h-screen transition-colors duration-500 bg-[#FDFCFB] text-slate-900 font-sans selection:bg-slate-200">
      {/* Navigation */}
      <header className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-100 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div 
            onClick={reset}
            className="flex items-center gap-2 font-serif font-bold text-slate-900 text-xl tracking-tight cursor-pointer hover:opacity-80 transition-opacity"
          >
            <GraduationCap className="w-6 h-6 text-slate-700" />
            <span>maturita<span className="text-slate-400">.ai</span></span>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-2">
              {stages.map((s, idx) => (
                <React.Fragment key={s.id}>
                  <div className={cn(
                    "flex items-center gap-2 transition-all",
                    idx <= currentStageIndex ? "text-slate-900" : "text-slate-300"
                  )}>
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border",
                      idx < currentStageIndex ? "bg-emerald-500 border-emerald-500 text-white" :
                      idx === currentStageIndex ? "bg-white border-slate-900 text-slate-900 shadow-sm" :
                      "bg-white border-slate-100 text-slate-300"
                    )}>
                      {idx < currentStageIndex ? <CheckCircle2 className="w-3 h-3" /> : idx + 1}
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider">{s.label}</span>
                  </div>
                  {idx < stages.length - 1 && (
                    <div className={cn(
                      "w-4 h-px",
                      idx < currentStageIndex ? "bg-emerald-500" : "bg-slate-100"
                    )} />
                  )}
                </React.Fragment>
              ))}
            </div>

            {(stage === 'MONOLOGUE' || stage === 'FOLLOW_UP') && (
            <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-full border border-slate-100">
              <div className={cn(
                "w-2 h-2 rounded-full animate-pulse",
                timeLeft < 60 ? "bg-red-500" : "bg-emerald-500"
              )} />
              <span className={cn(
                "font-mono text-sm font-bold tracking-wider",
                timeLeft < 60 ? "text-red-600" : "text-slate-600"
              )}>
                {formatTime(timeLeft)}
              </span>
            </div>
          )}

            {/* Options */}
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center transition-all border",
                  isVoiceEnabled ? "bg-emerald-50 border-emerald-200 text-emerald-600 shadow-sm" : "bg-white border-slate-100 text-slate-300"
                )}
                title={isVoiceEnabled ? "Profesor mluví (vypnout)" : "Profesor nemluví (zapnout)"}
              >
                {isVoiceEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </button>

              <AnimatePresence>
                {isAiSpeaking && (
                  <motion.button 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={() => {
                      window.speechSynthesis.cancel();
                      setIsAiSpeaking(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-xl hover:bg-red-100 transition-all text-xs font-bold uppercase tracking-wider"
                  >
                    <VolumeX className="w-4 h-4" /> STOP
                  </motion.button>
                )}
              </AnimatePresence>
              
              <button 
                onClick={() => setShowInfo(true)}
                className="hidden lg:flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-all text-xs font-bold uppercase tracking-wider"
              >
                <HelpCircle className="w-4 h-4" /> Jak webka funguje?
              </button>

              <button 
                onClick={() => setShowHistory(true)}
                className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-all text-xs font-bold uppercase tracking-wider"
              >
                <History className="w-4 h-4" /> Historie
              </button>

            {stage !== 'IDLE' && (
              <button 
                onClick={reset}
                className="text-xs font-semibold text-slate-400 hover:text-slate-900 flex items-center gap-1 transition-colors uppercase tracking-widest"
              >
                <RefreshCcw className="w-3 h-3" /> Nová zkouška
              </button>
            )}
          </div>
        </div>
      </div>
    </header>

      <main className="pt-24 pb-12 px-6 max-w-5xl mx-auto min-h-screen">
        <AnimatePresence mode="wait">
          {stage === 'IDLE' && (
            <motion.div 
              key="idle"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center text-center py-12"
            >
              <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mb-8 shadow-sm border border-slate-100">
                <BookOpen className="w-10 h-10 text-slate-600" />
              </div>
              <h1 className="text-4xl md:text-5xl font-serif font-medium mb-4 text-slate-900 tracking-tight leading-tight">
                Vaše ústní maturita nanečisto
              </h1>
              <div className="flex flex-col items-center gap-6 mb-12">
                <p className="text-lg text-slate-500 max-w-xl mx-auto leading-relaxed italic">
                  Nahrajte své studijní podklady s vypracovanými otázkami. Následně si jednu vyberete nebo vylosujete a začne ostrá zkouška.
                </p>
                <div className="flex flex-wrap justify-center gap-4">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-2xl border border-slate-100 shadow-sm text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    <Mic className="w-4 h-4 text-emerald-500" /> Odpovídání hlasem
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-2xl border border-slate-100 shadow-sm text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    <Volume2 className="w-4 h-4 text-emerald-500" /> Profesor bude mluvit
                  </div>
                </div>
              </div>

              <label className="group relative cursor-pointer w-full max-w-xl">
                <div className={cn(
                  "bg-white border-2 border-dashed border-slate-200 p-8 md:p-12 rounded-3xl group-hover:border-slate-400 group-hover:bg-slate-50 transition-all duration-300",
                  isProcessingFile && "opacity-50 pointer-events-none"
                )}>
                  <div className="flex flex-col items-center">
                    {isProcessingFile ? (
                      <div className="flex flex-col items-center">
                        <RefreshCcw className="w-8 h-8 text-slate-400 animate-spin mb-4" />
                        <span className="text-slate-600 font-medium font-serif italic text-lg text-center">Zpracovávám podklady...</span>
                        <span className="text-slate-400 text-xs mt-2">U fotek to může trvat pár sekund</span>
                      </div>
                    ) : (
                      <>
                        <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                          <Upload className="w-6 h-6 text-slate-400 group-hover:text-slate-600" />
                        </div>
                        <span className="text-slate-600 font-medium font-serif italic text-lg text-center">Nahrát podklady (Word nebo PDF)</span>
                        <div className="flex flex-wrap justify-center gap-3 mt-3 opacity-60">
                          <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider"><FileText className="w-3 h-3" /> Word (.doc, .docx)</div>
                          <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider"><File className="w-3 h-3" /> PDF dokumenty</div>
                        </div>
                        <span className="text-slate-400 text-[10px] mt-4 uppercase tracking-widest font-sans font-bold text-center px-4">Podporujeme pouze formáty Word a PDF</span>
                        <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100 text-slate-500 text-[10px] italic max-w-xs text-center">
                          <strong>Důležité pro Apple zařízení:</strong> Poznámky (Notes), Pages nebo Numbers prosím nejdříve <strong>exportujte jako PDF</strong>.
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <input type="file" multiple accept=".pdf,.doc,.docx" className="sr-only" onChange={handleFileUpload} disabled={isProcessingFile} />
              </label>

              {localSubjects.length > 0 && (
                <div className="w-full max-w-xl mt-12 text-left">
                  <div className="flex items-center gap-2 mb-4">
                    <History className="w-4 h-4 text-slate-400" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Naposledy nahrané podklady</h3>
                  </div>
                  <div className="grid gap-3">
                    {localSubjects.map(s => (
                      <div 
                        key={s.id}
                        onClick={() => loadLocalSubject(s)}
                        className="p-4 bg-white border border-slate-100 rounded-2xl flex items-center justify-between hover:border-slate-300 transition-all cursor-pointer group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
                            <BookOpen className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="block text-sm font-medium text-slate-700">{s.name}</span>
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">Místně uloženo</span>
                          </div>
                        </div>
                        <button 
                          onClick={(e) => deleteLocalSubject(e, s.id)}
                          className="p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <RefreshCcw className="w-3 h-3 rotate-45" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {stage === 'SETUP' && (
            <motion.div 
              key="setup"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md mx-auto"
            >
              <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
                <h2 className="text-2xl font-serif font-medium mb-6">Příprava zkoušení</h2>
                <div className="space-y-6">
                  <div className="flex items-center gap-3 p-4 bg-emerald-50 text-emerald-700 rounded-2xl text-sm mb-4 border border-emerald-100">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span>{fileNames.length > 1 ? `Úspěšně nahráno ${fileNames.length} souborů.` : `Podklady úspěšně nahrány.`}</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Předmět / Maturitní okruh</label>
                    <input 
                      type="text" 
                      placeholder="Např. Český jazyk a literatura"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all bg-slate-50/50"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>

                  <button 
                    disabled={!subject}
                    onClick={startSetup}
                    className="w-full bg-slate-900 text-white py-4 rounded-xl font-semibold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg flex items-center justify-center gap-2"
                  >
                    Pokračovat k výběru otázky <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {stage === 'CHOOSE_QUESTION' && (
            <motion.div 
              key="choose"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-4xl mx-auto py-8"
            >
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-12 gap-6">
                <div className="text-left">
                  <h2 className="text-3xl font-serif font-medium mb-2 text-slate-900">Losování otázky</h2>
                  <p className="text-slate-500 italic">Vyberte si konkrétní téma, nebo nechte osud rozhodnout.</p>
                </div>
                
                <div className="flex flex-col items-end gap-2 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Délka zkoušky</span>
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button 
                      onClick={() => setDuration(10)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                        duration === 10 ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                      )}
                    >
                      10 MIN
                    </button>
                    <button 
                      onClick={() => setDuration(15)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                        duration === 15 ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                      )}
                    >
                      15 MIN
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-[1fr_300px] gap-8">
                <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6">Seznam nalezených otázek</h3>
                  <div className="grid gap-3 overflow-y-auto max-h-[50vh] pr-2">
                    {questions.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => selectQuestion(q)}
                        className="text-left p-4 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-slate-50 transition-all group flex items-center justify-between"
                      >
                        <span className="text-sm text-slate-700 group-hover:text-slate-900 leading-snug">{q}</span>
                        <ChevronRight className="w-4 h-4 text-slate-200 group-hover:text-slate-400" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <button 
                    onClick={drawRandom}
                    className="w-full bg-emerald-600 text-white p-8 rounded-3xl font-bold hover:bg-emerald-500 transition-all shadow-lg flex flex-col items-center justify-center gap-4 group"
                  >
                    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      <RefreshCcw className="w-8 h-8" />
                    </div>
                    <div className="text-center">
                      <span className="block text-xl">Vylosovat náhodně</span>
                      <span className="text-[10px] opacity-70 uppercase tracking-widest">Jako u maturity</span>
                    </div>
                  </button>

                  <div className="p-6 bg-slate-100 rounded-3xl border border-slate-200">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Jak to proběhne?</h4>
                    <ul className="text-xs text-slate-500 space-y-2 leading-relaxed">
                      <li>&bull; 1. Váš monolog k tématu</li>
                      <li>&bull; 2. 2 otázky z vašich podkladů</li>
                      <li>&bull; 3. 5 doplňujících otázek k tématu</li>
                    </ul>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {(stage === 'MONOLOGUE' || stage === 'FOLLOW_UP' || stage === 'EVALUATION') && (
            <motion.div 
              key="exam"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid lg:grid-cols-[300px_1fr] gap-8 items-start"
            >
              {/* Sidebar Info */}
              <aside className="space-y-6 lg:sticky lg:top-24">
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-4">Průběh zkoušky</h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        stage === 'MONOLOGUE' ? "bg-amber-400 animate-pulse ring-4 ring-amber-50" : "bg-emerald-500"
                      )} />
                      <span className={cn("text-sm", stage === 'MONOLOGUE' ? "font-bold text-slate-900" : "text-slate-400")}>Fáze 1: Monolog</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        stage === 'FOLLOW_UP' ? "bg-amber-400 animate-pulse ring-4 ring-amber-50" : (stage === 'EVALUATION' ? "bg-emerald-500" : "bg-slate-200")
                      )} />
                      <span className={cn("text-sm", stage === 'FOLLOW_UP' ? "font-bold text-slate-900" : "text-slate-400")}>Fáze 2: Doplňující dotazy</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        stage === 'EVALUATION' ? "bg-emerald-500" : "bg-slate-200"
                      )} />
                      <span className={cn("text-sm", stage === 'EVALUATION' ? "font-bold text-slate-900" : "text-slate-400")}>Fáze 3: Hodnocení</span>
                    </div>
                    <div className="pt-2 mt-2 border-t border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <span className="text-sm font-bold text-slate-900">
                          Jazyk: Čeština 🇨🇿
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900 text-white p-7 rounded-3xl shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-white/10 transition-all" />
                  <div className="flex items-center gap-2 mb-4">
                    <MessageSquare className="w-4 h-4 text-slate-500" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Vybrané téma</span>
                  </div>
                  <div className="text-xl font-serif leading-tight">{selectedQuestion}</div>
                  <div className="mt-4 text-[10px] text-slate-400 uppercase font-bold tracking-widest leading-loose">
                    {subject}
                  </div>
                </div>
              </aside>

              {/* Chat Interface */}
              <div className={cn(
                "flex flex-col bg-white rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden",
                stage === 'EVALUATION' ? "h-auto" : "h-[75vh]"
              )}>
                <div 
                  ref={scrollRef}
                  className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth"
                >
                  {messages.map((m, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "flex flex-col max-w-[90%]",
                        m.role === 'student' ? "ml-auto items-end text-right" : "mr-auto items-start"
                      )}
                    >
                      <div className={cn(
                        "px-7 py-5 rounded-3xl text-[15px] leading-relaxed",
                        m.role === 'student' 
                          ? "bg-slate-100 text-slate-800 rounded-br-none" 
                          : "bg-white border border-slate-100 shadow-sm text-slate-900 font-serif italic text-lg rounded-bl-none"
                      )}>
                        <div className={cn("prose prose-slate max-w-none", m.role === 'teacher' ? "prose-p:leading-[1.8]" : "")}>
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      </div>
                      <span className="text-[10px] uppercase font-bold text-slate-300 mt-3 tracking-[0.2em]">
                        {m.role === 'teacher' ? 'Zkušební komise' : 'Vylosovaný student'}
                      </span>
                    </motion.div>
                  ))}
                  {isTyping && (
                    <div className="flex items-center gap-3 text-slate-400 italic text-sm animate-pulse font-serif pl-2">
                       <div className="flex gap-1.5">
                        <div className="w-1.5 h-1.5 bg-slate-200 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 bg-slate-200 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 bg-slate-200 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span>Zkoušející si dělá poznámky k vaší odpovědi...</span>
                    </div>
                  )}
                </div>

                {stage !== 'EVALUATION' && (
                  <div className="p-6 bg-slate-50/50 border-t border-slate-100">
                    <div className="relative flex items-center shadow-sm">
                      <textarea 
                        ref={textareaRef}
                        rows={stage === 'MONOLOGUE' ? 4 : 1}
                        placeholder={stage === 'MONOLOGUE' ? "Sem vložte nebo napište svůj maturitní monolog..." : "Vaše odpověď zkoušejícímu..."}
                        className="w-full bg-white border border-slate-200 rounded-2xl px-6 py-5 text-base focus:outline-none focus:ring-1 focus:ring-slate-300 transition-all pr-16 resize-none"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && stage !== 'MONOLOGUE') {
                            e.preventDefault();
                            sendMessage();
                          }
                        }}
                      />
                      <div className="absolute right-4 bottom-4 flex items-center gap-3">
                        {(isListening || isAiSpeaking) && (
                          <div className="flex items-center gap-1 px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
                            <div className={cn("w-1 h-3 bg-emerald-400 rounded-full", (isListening || isAiSpeaking) && "animate-bounce")} style={{ animationDelay: '0ms' }} />
                            <div className={cn("w-1 h-5 bg-emerald-500 rounded-full", (isListening || isAiSpeaking) && "animate-bounce")} style={{ animationDelay: '150ms' }} />
                            <div className={cn("w-1 h-3 bg-emerald-400 rounded-full", (isListening || isAiSpeaking) && "animate-bounce")} style={{ animationDelay: '300ms' }} />
                            <span className="text-[10px] font-bold text-emerald-600 ml-1 uppercase tracking-wider">
                              {isAiSpeaking ? 'AI mluví' : 'Poslouchám'}
                            </span>
                          </div>
                        )}
                        <button 
                          onClick={() => {
                            textareaRef.current?.focus();
                            textareaRef.current?.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className="bg-white border border-slate-100 text-slate-400 hover:text-slate-600 p-3 rounded-2xl transition-all shadow-md flex items-center gap-2 group"
                          title="Psát textem"
                        >
                          <MessageSquare className="w-5 h-5" />
                          <span className="hidden group-hover:inline text-[10px] font-bold uppercase tracking-wider pr-1">Psát textem</span>
                        </button>
                        <button 
                          onClick={() => isListening ? recognitionRef.current?.stop() : startListening()}
                          className={cn(
                            "p-3 rounded-2xl transition-all shadow-md",
                            isListening ? "bg-red-500 text-white animate-pulse" : "bg-white border border-slate-100 text-slate-400 hover:text-slate-600"
                          )}
                          title={isListening ? "Zastavit nahrávání" : "Mluvit místo psaní"}
                        >
                          {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                        </button>
                        <button 
                          id="send-message-button"
                          onClick={() => sendMessage()}
                          disabled={!input.trim() || isTyping}
                          className="p-3 bg-slate-900 text-white rounded-2xl hover:bg-slate-800 transition-all disabled:opacity-30 shadow-md"
                        >
                          <Send className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {stage === 'MONOLOGUE' && (
                      <button 
                        onClick={finishMonologue}
                        disabled={isTyping}
                        className="mt-4 w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-500 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-200"
                      >
                        <CheckCircle2 className="w-5 h-5" /> To je vše, chci doplňující otázky
                      </button>
                    )}

                    <div className="flex flex-wrap items-center gap-3 mt-4 px-2">
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Pokud jste s monologem skončili, klikněte na tlačítko "To je vše".
                        </div>
                        
                        <div className="flex gap-2 ml-auto">
                          <button 
                            onClick={() => {
                              setExamLang('cs-CZ');
                              sendMessage('Mluvte prosím česky.', 'cs-CZ');
                            }}
                            className="text-[9px] font-bold uppercase tracking-wider bg-white border border-slate-100 px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:border-slate-300 transition-all"
                          >
                            🇨🇿 Mluvit česky
                          </button>
                          <button 
                            onClick={() => {
                              sendMessage('Prosím, zopakujte poslední otázku.', examLang);
                            }}
                            className="text-[9px] font-bold uppercase tracking-wider bg-white border border-slate-100 px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:border-slate-300 transition-all"
                          >
                            <RefreshCcw className="w-2.5 h-2.5 inline mr-1" /> Zopakovat dotaz
                          </button>
                        </div>
                    </div>
                  </div>
                )}

                {stage === 'EVALUATION' && (
                  <div className="p-10 bg-slate-900 flex flex-col sm:flex-row items-center justify-center gap-4 border-t border-slate-800">
                    <button 
                      onClick={reset}
                      className="inline-flex items-center gap-2 bg-white text-slate-900 px-10 py-4 rounded-xl font-bold hover:bg-slate-100 transition-all shadow-2xl"
                    >
                      <RefreshCcw className="w-4 h-4" /> Nová zkouška
                    </button>
                    <button 
                      onClick={() => {
                        const transcript = messages.map(m => `${m.role === 'teacher' ? 'Zkoušející' : 'Student'}: ${m.content}`).join('\n\n---\n\n');
                        const blob = new Blob([`PROTOKOL O MATURITNÍ ZKOUŠCE - MATURITA.AI\nDatum: ${new Date().toLocaleDateString('cs-CZ')}\n\n${transcript}`], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `maturita-ai-protokol-${new Date().toISOString().split('T')[0]}.txt`;
                        a.click();
                      }}
                      className="inline-flex items-center gap-2 bg-slate-800 text-white border border-slate-700 px-10 py-4 rounded-xl font-bold hover:bg-slate-700 transition-all"
                    >
                      <FileText className="w-4 h-4" /> Stáhnout protokol
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Info Modal */}
      <AnimatePresence>
        {showInfo && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center px-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowInfo(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-200">
                    <HelpCircle className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-serif font-medium text-slate-900">Jak webka funguje?</h2>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-0.5">Průvodce tvou maturitou nanečisto</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowInfo(false)}
                  className="p-2 hover:bg-white rounded-full transition-colors text-slate-400"
                >
                  <RefreshCcw className="w-5 h-5 rotate-45" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-10">
                <section>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px]">1</span>
                    Nahrání podkladů
                  </h3>
                  <p className="text-slate-600 leading-relaxed font-serif italic mb-4">
                    Vše začíná tvými materiály. Nahraj své vypracované maturitní otázky ve formátu <strong>Word (.docx)</strong> nebo <strong>PDF</strong>.
                  </p>
                  <div className="p-4 bg-slate-50 rounded-2xl text-xs text-slate-500 border border-slate-100">
                    <strong>Tip:</strong> Pokud máš zápisky v aplikacích jako Pages, Numbers nebo Poznámky, nejdříve je exportuj do PDF, aby je AI mohla správně přečíst.
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px]">2</span>
                    Losování tématu
                  </h3>
                  <p className="text-slate-600 leading-relaxed font-serif italic">
                    Jakmile jsou podklady v systému, vybereš si předmět. Poté si můžeš téma buď přímo zvolit ze seznamu, který AI v tvých materiálech našla, nebo můžeš využít <strong>tlačítko pro náhodné vylosování</strong> – přesně jako u reálné zkoušky.
                  </p>
                </section>

                <section>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px]">3</span>
                    Samotná zkouška
                  </h3>
                  <div className="space-y-4 text-slate-600 leading-relaxed font-serif italic">
                    <p>Zkouška se dělí na dvě hlavní části:</p>
                    <ul className="space-y-3 pl-4 border-l-2 border-slate-100">
                      <li><strong>1. Monolog:</strong> Máš prostor souvisle mluvit k tématu. AI tě poslouchá a neustále vyhodnocuje tvé znalosti.</li>
                      <li><strong>2. Doplňující dotazy:</strong> AI učitel ti položí otázky vycházející z tvých podkladů, ale i dotazy na širší souvislosti nad rámec tvého textu.</li>
                    </ul>
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px]">4</span>
                    Hlas a mluvení
                  </h3>
                  <p className="text-slate-600 leading-relaxed font-serif italic mb-4">
                    Pro maximální autentičnost můžeš využít <strong>hlasové ovládání</strong>. Pokud si v menu zapneš ikonu reproduktoru, AI na tebe bude mluvit. Ty můžeš odpovídat buď psaním, nebo kliknutím na mikrofon a mluvením.
                  </p>
                  <div className="p-4 bg-emerald-50 rounded-2xl text-xs text-emerald-700 border border-emerald-100">
                    <strong>Nová funkce:</strong> Pokud AI mluví příliš dlouho, můžeš ji kdykoliv zastavit červeným tlačítkem STOP v hlavičce a začít mluvit ty.
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px]">5</span>
                    Hodnocení a výsledky
                  </h3>
                  <p className="text-slate-600 leading-relaxed font-serif italic">
                    Na závěr ti AI vypracuje podrobný <strong>protokol o zkoušce</strong>. Dozvíš se, co jsi řekl správně, kde byly mezery a jakou známku bys pravděpodobně dostal. Protokol si můžeš stáhnout nebo ho najdeš v historii svých pokusů.
                  </p>
                </section>
              </div>

              <div className="p-8 bg-slate-50 border-t border-slate-100">
                <button 
                  onClick={() => setShowInfo(false)}
                  className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-lg"
                >
                  Jasně, jdu na to!
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {showHistory && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-200">
                    <History className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-serif font-medium text-slate-900">Moje historie</h2>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-0.5">Přehled vašich zkoušek</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowHistory(false)}
                  className="p-2 hover:bg-white rounded-full transition-colors text-slate-400"
                >
                  <RefreshCcw className="w-5 h-5 rotate-45" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {localHistory.length > 0 ? (
                  <div className="grid gap-4">
                    {localHistory.map((h) => {
                      const date = h.createdAt?.toDate ? h.createdAt.toDate() : new Date(h.createdAt);
                      return (
                        <div key={h.id} className="p-5 bg-white border border-slate-100 rounded-2xl hover:border-slate-300 transition-all group">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="px-2 py-0.5 bg-slate-100 text-[9px] font-bold text-slate-500 rounded uppercase tracking-wider">{h.subjectName}</span>
                                <span className="text-[10px] text-slate-300 font-mono">{date.toLocaleDateString('cs-CZ')}</span>
                                <span className="text-[8px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded uppercase font-bold tracking-tighter shadow-sm">Místní</span>
                              </div>
                              <h4 className="font-serif font-medium text-slate-800 group-hover:text-slate-900 transition-colors">{h.question}</h4>
                            </div>
                            <button 
                              onClick={async () => {
                                try {
                                  const transcript = h.messages.map((m: any) => `${m.role === 'teacher' ? 'Zkoušející' : 'Student'}: ${m.content}`).join('\n\n---\n\n');
                                  const blob = new Blob([`PROTOKOL O MATURITNÍ ZKOUŠCE - MATURITA.AI\nDatum: ${date.toLocaleDateString('cs-CZ')}\nPředmět: ${h.subjectName}\nTéma: ${h.question}\n\n${transcript}`], { type: 'text/plain' });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `maturita-ai-h-protokol-${date.toISOString().split('T')[0]}.txt`;
                                  a.click();
                                } catch (err) {
                                  console.error('Download error:', err);
                                }
                              }}
                              className="shrink-0 flex items-center gap-2 px-4 py-2 border border-slate-100 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-900 hover:border-slate-900 transition-all opacity-0 group-hover:opacity-100"
                            >
                              <FileText className="w-4 h-4" /> Protokol
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <History className="w-12 h-12 text-slate-100 mb-4" />
                    <p className="text-slate-400 italic">Zatím zde nemáte žádné záznamy.<br />Dokončete svou první zkoušku pro uložení do historie.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="py-16 border-t border-slate-100 mt-12 bg-white/30">
        <div className="max-w-5xl mx-auto px-6 flex flex-col items-center justify-center gap-3">
          <div className="opacity-40 text-[11px] font-bold text-slate-900 uppercase tracking-[0.3em] flex items-center gap-2">
            <span>&copy; {new Date().getFullYear()} maturita.ai by Kateřina Pekárková</span>
          </div>
          <div className="opacity-20 text-[9px] font-bold text-slate-900 uppercase tracking-[0.2em]">
            webka maturita.ai
          </div>
        </div>
      </footer>
    </div>
  );
}
