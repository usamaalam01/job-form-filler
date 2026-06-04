// ─── Field detection ────────────────────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'month'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'combobox'
  | 'file'
  | 'contenteditable'
  | 'unknown'

export interface DetectedField {
  /** Generated stable id; key across detect→apply cycle (SPEC §11.1). */
  fieldId: string
  /** Diagnostic only — may be ambiguous on dynamic pages. */
  selector?: string
  /** Best-resolved human label. */
  label: string
  name?: string
  id?: string
  autocomplete?: string
  type: FieldType
  /** Available options for select / radio / combobox. */
  options?: string[]
  required: boolean
  /** e.g. "experience#2" — which repeatable block this field belongs to. */
  group?: string
  maxLength?: number
  isUpload?: boolean
  uploadKind?: 'resume' | 'cover-letter' | 'other'
  /** fieldId of a sibling "currently work here" checkbox, if detected. */
  currentlyHereCheckboxId?: string
  /** Selector for the "Add another" button that creates a new block for this field's group. */
  addAnotherButtonSelector?: string
  /** Shadow root depth (0 = main document). Used to avoid fieldId collisions. */
  shadowDepth?: number
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

export type MappingSource = 'rule' | 'profile' | 'qa' | 'llm' | 'blank'
export type Confidence = 'high' | 'medium' | 'low'

export interface MappingResult {
  field: DetectedField
  value: string | boolean | number | null
  source: MappingSource
  confidence: Confidence
  /** True when the value needs user review before apply. */
  needsReview: boolean
  /** e.g. "truncated", "no matching option", "fact-not-in-profile". */
  note?: string
  /** User include/skip toggle — default: true when high/medium confidence. */
  include: boolean
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export interface ProfileFrontmatter {
  profile_name: string
  target_role?: string
  updated: string
}

export interface WorkEntry {
  title: string
  company: string
  location?: string
  start: string       // YYYY-MM or YYYY-MM-DD
  end: string         // YYYY-MM, YYYY-MM-DD, "present", or "current"
  employmentType?: string
  highlights: string[]
}

export interface EducationEntry {
  degree: string
  institution: string
  fieldOfStudy?: string
  start: string
  end: string
  grade?: string
}

export interface CertificationEntry {
  name: string
  issuer?: string
  issued?: string
  expires?: string
  credentialId?: string
  url?: string
}

export interface ProjectEntry {
  name: string
  url?: string
  summary?: string
}

export interface ParsedProfile {
  frontmatter: ProfileFrontmatter
  personal: Record<string, string>
  summary?: string
  experience: WorkEntry[]
  education: EducationEntry[]
  certifications: CertificationEntry[]
  skills: Record<string, string[]>
  languages: Record<string, string>
  projects: ProjectEntry[]
  preferences: Record<string, string>
  /** Unknown sections preserved verbatim so they survive round-trips. */
  unknownSections: Record<string, string>
  /** The original raw markdown string. */
  raw: string
}

// ─── Q&A bank ────────────────────────────────────────────────────────────────

export type QAType = 'text' | 'long-text' | 'boolean' | 'number' | 'select' | 'date'

export interface QAEntry {
  question: string
  type: QAType
  tags: string[]
  answer: string
}

// ─── Application history ─────────────────────────────────────────────────────

export interface ApplicationRecord {
  id: string
  url: string
  url_normalized: string
  company: string | null
  role: string | null
  profile_used: string
  filled_at: string   // ISO 8601
  status: 'filled' | 'submitted-manually' | 'abandoned'
  fields_filled: number
  fields_flagged: number
}

export interface HistoryFile {
  version: number
  applications: ApplicationRecord[]
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface ProviderConfig {
  id: string
  name: string
  /** Empty string = not configured. Never hard-code a model name. */
  model: string
  baseUrl: string
}

export interface AppSettings {
  version: number
  defaultProfile: string | null
  aiDrafting: boolean
  /** Auto-include values at or above this confidence; flag everything below. */
  confidenceThreshold: 'high' | 'medium'
  autoAddRepeatableBlocks: boolean
  /** Days within which a company+role match counts as a duplicate. */
  dedupeWindow: number
  llmTimeoutMs: number
  maxFieldBatchSize: number
  /** Ordered list of provider ids to try in sequence. */
  fallbackChain: string[]
  providers: ProviderConfig[]
  keyPersistenceMode: 'persisted' | 'session'
}

// ─── LLM provider layer ───────────────────────────────────────────────────────

export interface LLMRequest {
  systemPrompt: string
  userPrompt: string
  /** JSON schema hint for structured output. */
  responseSchema?: object
  maxTokens?: number
  /** Default: 0.1 (low for determinism). */
  temperature?: number
}

export interface LLMResponse {
  content: string
  tokensUsed?: number
  providerId: string
}

export type LLMErrorType =
  | 'network'
  | 'auth'
  | 'rate-limit'
  | 'server'
  | 'timeout'
  | 'safety'
  | 'invalid-output'
  | 'unknown'

export interface LLMError {
  type: LLMErrorType
  status?: number
  message: string
  retryable: boolean
}

// ─── LLM structured output (Appendix C) ─────────────────────────────────────

export interface LLMMappingResultItem {
  /** Matches DetectedField.fieldId. */
  fieldId: string
  value: string | null
  /** "rule" is never returned by LLM — only profile / qa / llm / blank. */
  source: Exclude<MappingSource, 'rule'>
  confidence: Confidence
  note: string | null
}

export interface LLMMappingResponse {
  results: LLMMappingResultItem[]
}

// ─── Messaging (background ↔ panel ↔ content) ────────────────────────────────

export type MessageType =
  | 'DETECT_FIELDS'
  | 'FIELDS_DETECTED'
  | 'MAP_FIELDS'
  | 'MAPPING_RESULT'
  | 'APPLY_VALUES'
  | 'APPLY_RESULT'
  | 'LOAD_PROFILE'
  | 'SAVE_PROFILE'
  | 'HISTORY_ADD'
  | 'HISTORY_UPDATE_STATUS'
  | 'DUPLICATE_CHECK'
  | 'DUPLICATE_RESULT'
  | 'SAVE_QA_ENTRY'
  | 'TEST_PROVIDER'
  | 'TEST_PROVIDER_RESULT'
  | 'GET_DEBUG_LOG'
  | 'ERROR'

export interface Message<T = unknown> {
  type: MessageType
  payload: T
  /** Correlates request→response for async round-trips. */
  requestId?: string
}

export interface MessageEnvelope<T = unknown> {
  ok: true
  data: T
  requestId?: string
}

export interface MessageError {
  ok: false
  error: string
  requestId?: string
}

export type MessageResponse<T = unknown> = MessageEnvelope<T> | MessageError

// ─── Write results (content script) ──────────────────────────────────────────

export interface WriteResult {
  fieldId: string
  ok: boolean
  note?: string
}

// ─── Fill session (background orchestrator) ───────────────────────────────────

export interface FillSession {
  tabId: number
  profileSlug: string
  detectedFields: DetectedField[]
  mappingResults: MappingResult[]
  /** UUID generated at session start — used for idempotent writes (EC-22). */
  requestId: string
  startedAt: string
}
