/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Theme = 'academic' | 'tech' | 'luxury';

export type ExamStage = 'IDLE' | 'SETUP' | 'CHOOSE_QUESTION' | 'MONOLOGUE' | 'FOLLOW_UP' | 'EVALUATION';

export interface Message {
  role: 'teacher' | 'student';
  content: string;
}

export interface ExamSession {
  subject: string;
  durationMinutes: number;
  startTime?: number;
  materialText: string;
  messages: Message[];
}

export interface Evaluation {
  subject: string;
  question: string;
  excellent: string[];
  inaccurate: string[];
  recommendations: string[];
  grade: number;
  finalTip: string;
}
