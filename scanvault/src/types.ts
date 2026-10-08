export type ScanMode = 'document' | 'image' | 'id-single' | 'id-double' | 'object';

export const SCAN_MODES: Record<
  ScanMode,
  { label: string; description: string; icon: string; pages: { label: string; hint: string }[] | null; aspect: number | null }
> = {
  document: {
    label: 'Document',
    description: 'Letters, invoices, contracts, receipts — multi-page PDF with OCR',
    icon: '📄',
    pages: null, // unlimited
    aspect: 1 / 1.414, // A4 portrait
  },
  image: {
    label: 'Image',
    description: 'Photos, whiteboards, notes — saved as an image',
    icon: '🖼️',
    pages: null,
    aspect: null,
  },
  'id-single': {
    label: 'ID card · 1 page',
    description: 'Front and back combined on a single page',
    icon: '🪪',
    pages: [
      { label: 'Front', hint: 'Fit the FRONT of the card inside the frame' },
      { label: 'Back', hint: 'Now flip it — fit the BACK inside the frame' },
    ],
    aspect: 1.586, // ISO/IEC 7810 ID-1
  },
  'id-double': {
    label: 'ID card · 2 pages',
    description: 'Front and back on separate pages',
    icon: '🪪',
    pages: [
      { label: 'Front', hint: 'Fit the FRONT of the card inside the frame' },
      { label: 'Back', hint: 'Now flip it — fit the BACK inside the frame' },
    ],
    aspect: 1.586,
  },
  object: {
    label: 'Object analysis',
    description: 'Snap any object and get an AI analysis of it',
    icon: '🔍',
    pages: [{ label: 'Object', hint: 'Center the object and keep it in focus' }],
    aspect: null,
  },
};

export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  bbox: Bbox;
  confidence: number;
}

export interface OcrPage {
  text: string;
  words: OcrWord[];
  /** pixel size of the image the boxes refer to */
  width: number;
  height: number;
  source: 'ocr' | 'pdf-text';
}

export interface PageImage {
  dataUrl: string; // image/jpeg
  width: number;
  height: number;
}

export interface SavedLocation {
  provider: CloudProviderId;
  folder: string;
  fileName: string;
  fileId?: string;
  webUrl?: string;
  encrypted: boolean;
  at: number;
}

/** Small record used by the library list and search. Stored encrypted. */
export interface DocMeta {
  id: string;
  name: string;
  mode: ScanMode;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  thumbnail: string;
  keywords: string[];
  /** full extracted text (capped) so the library can search inside documents */
  searchText: string;
  savedTo: SavedLocation[];
  deleted?: boolean;
}

/** Heavy part of a document. Stored encrypted. */
export interface DocContent {
  pages: PageImage[];
  ocr: OcrPage[];
  /** set for object-analysis scans */
  analysis?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** which engine produced it */
  engine?: 'local' | 'claude';
}

export interface ChatState {
  messages: ChatMessage[];
  summary?: { content: string; at: number; engine: 'local' | 'claude' };
  updatedAt: number;
}

export type CloudProviderId = 'gdrive' | 'onedrive' | 'device';
