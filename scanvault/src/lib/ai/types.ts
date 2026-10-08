import type { ChatMessage, ScanMode } from '../../types';

export interface DocContext {
  name: string;
  mode: ScanMode;
  /** extracted text per page */
  pages: string[];
  analysis?: string;
  /** first page as a JPEG data URL — used by vision-capable engines */
  image?: string;
}

export interface ImageStats {
  width: number;
  height: number;
  colors: string[];
  brightness: number; // 0..1
  sharpness: number; // laplacian variance
}

export interface AiEngine {
  id: 'local' | 'claude';
  label: string;
  answer(ctx: DocContext, history: ChatMessage[], question: string): Promise<string>;
  summarize(ctx: DocContext): Promise<string>;
  analyzeObject(imageDataUrl: string, stats: ImageStats, ocrText: string): Promise<string>;
  /** optional: better title/keywords for the file-name suggester */
  suggestTitle?(text: string, mode: ScanMode): Promise<{ title: string; keywords: string[]; docType: string } | null>;
}
