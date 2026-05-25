export type PlannotatorContentType = 'plan' | 'diff' | 'message' | 'file';

export interface PlannotatorAnnotation {
  id: string;
  lineNumber?: number;
  text: string;
  createdAt: number;
}

export interface PlannotatorSuggestion {
  id: string;
  originalText: string;
  replacementText: string;
  lineNumber?: number;
}

export interface PlannotatorSession {
  id: string;
  title: string;
  contentType: PlannotatorContentType;
  content: string;
  sourceMessageId?: string;
  sourcePath?: string;
  annotations: PlannotatorAnnotation[];
  suggestions: PlannotatorSuggestion[];
}
