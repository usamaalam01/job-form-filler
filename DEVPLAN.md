# DEVPLAN.md — Phase-by-Phase Development Plan
# Job Form Filler (Chrome Extension)

> **Status:** v1.0 · 2026-06-03
> Companion to SPEC.md. Each phase lists exact tasks, files to create/modify,
> interfaces to implement, and exit gates a coding assistant can verify.
> Complete tasks in order within a phase; phases are sequential.
> Reference IDs (F1.1, EC-22, D14 …) point to SPEC.md.

---

## Table of Contents

- [Phase 0 — Foundations](#phase-0--foundations)
- [Phase 1 — MVP: Generic Engine](#phase-1--mvp-generic-engine)
- [Phase 2 — LLM Layer](#phase-2--llm-layer)
- [Phase 3 — ATS Adapters & Robustness](#phase-3--ats-adapters--robustness)
- [Phase 4 — Polish & Productionisation](#phase-4--polish--productionisation)
- [Future (Parked)](#future-parked)

---

## Phase 0 — Foundations

**Goal:** a buildable, loadable extension skeleton with all wiring in place but
no product features. Every subsequent phase adds on top of this without
restructuring.

---

### P0-T1 · Project scaffold & build system

**What:** Initialise the monorepo with Vite + CRXJS and a working
`manifest.json`. The extension must load in Chrome without errors.

**Files to create:**
```
package.json
tsconfig.json           (strict, path aliases: @shared, @bg, @panel, @content)
vite.config.ts          (CRXJS plugin, multi-entry: background, content, panel, options)
manifest.json           (MV3: sidePanel, scripting, activeTab, storage)
src/
  background/
    index.ts            (service worker entry — empty, registers listeners)
  content/
    index.ts            (content script entry — empty)
  panel/
    index.html
    index.tsx           (React 18 root, renders <App />)
    App.tsx             (placeholder "Job Form Filler" panel)
  options/
    index.html
    index.tsx           (placeholder options page)
  shared/
    types.ts            (shared TS types — empty for now)
```

**Key `manifest.json` fields:**
```jsonc
{
  "manifest_version": 3,
  "name": "Job Form Filler",
  "version": "0.1.0",
  "action": {},
  "side_panel": { "default_path": "src/panel/index.html" },
  "background": { "service_worker": "src/background/index.ts", "type": "module" },
  "permissions": ["sidePanel", "scripting", "activeTab", "storage"],
  "host_permissions": []
}
```

**Exit gate:** `npm run dev` builds without errors; extension loads in Chrome;
clicking the icon opens the side panel showing "Job Form Filler".

---

### P0-T2 · Shared type definitions

**What:** Define all core TypeScript interfaces in `shared/types.ts`. Nothing
is implemented yet — types only. All other modules import from here.

**Types to define** (see SPEC.md Appendix B):
```ts
// Field detection
type FieldType = 'text' | 'textarea' | 'email' | 'tel' | 'url' | 'number'
               | 'date' | 'month' | 'select' | 'radio' | 'checkbox'
               | 'combobox' | 'file' | 'contenteditable' | 'unknown';

interface DetectedField { ... }   // fieldId, label, type, options, required, group, …
type MappingSource = 'rule' | 'profile' | 'qa' | 'llm' | 'blank';
type Confidence = 'high' | 'medium' | 'low';
interface MappingResult { ... }   // field, value, source, confidence, needsReview, include

// Profile schema
interface ProfileFrontmatter { profile_name: string; target_role?: string; updated: string; }
interface WorkEntry { title: string; company: string; start: string; end: string; ... }
interface EducationEntry { ... }
interface CertificationEntry { ... }
interface ParsedProfile { frontmatter: ProfileFrontmatter; personal: Record<string,string>;
  experience: WorkEntry[]; education: EducationEntry[]; certifications: CertificationEntry[];
  skills: Record<string,string[]>; preferences: Record<string,string>; raw: string; }

// Q&A bank
type QAType = 'text' | 'long-text' | 'boolean' | 'number' | 'select' | 'date';
interface QAEntry { question: string; type: QAType; tags: string[]; answer: string; }

// History
interface ApplicationRecord { id: string; url: string; url_normalized: string;
  company: string|null; role: string|null; profile_used: string;
  filled_at: string; status: 'filled'|'submitted-manually'|'abandoned';
  fields_filled: number; fields_flagged: number; }
interface HistoryFile { version: number; applications: ApplicationRecord[]; }

// Messages (background ↔ panel ↔ content)
type MessageType = 'DETECT_FIELDS' | 'FIELDS_DETECTED' | 'MAP_FIELDS'
                 | 'MAPPING_RESULT' | 'APPLY_VALUES' | 'APPLY_RESULT'
                 | 'LOAD_PROFILE' | 'SAVE_PROFILE' | 'HISTORY_ADD'
                 | 'DUPLICATE_CHECK' | 'ERROR';
interface Message<T = unknown> { type: MessageType; payload: T; }
```

**Exit gate:** `tsc --noEmit` passes with zero errors across all contexts.

---

### P0-T3 · FileStore abstraction

**What:** Implement `FileStore` — the single abstraction over the File System
Access API. All reads/writes in the entire codebase go through this module.
No product logic yet — pure I/O.

**File:** `src/panel/filestore.ts` (runs in panel context for permission grants;
background worker imports the same interface and operates on already-permitted handles)

```ts
interface FileStore {
  // Folder management
  requestFolder(): Promise<void>;          // shows picker, persists handle
  reconnectFolder(): Promise<boolean>;     // queryPermission → requestPermission if needed
  isFolderConnected(): Promise<boolean>;

  // Generic file ops
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;  // atomic (temp+rename)
  listFiles(dir: string): Promise<string[]>;
  deleteFile(path: string): Promise<void>;

  // Specific helpers (thin wrappers)
  readProfile(slug: string): Promise<string | null>;
  writeProfile(slug: string, content: string): Promise<void>;
  readQABank(): Promise<string | null>;
  writeQABank(content: string): Promise<void>;
  readHistory(): Promise<HistoryFile>;
  writeHistory(data: HistoryFile): Promise<void>;
  readSettings(): Promise<Record<string, unknown>>;
  writeSettings(data: Record<string, unknown>): Promise<void>;
}
```

**Implementation notes:**
- Store `FileSystemDirectoryHandle` in IndexedDB (`filestore-db`, object store
  `handles`, key `"data-folder"`).
- `writeFile` MUST be atomic: write to `${path}.tmp` then rename (overwrite) to
  `${path}`. If rename fails, delete the `.tmp` and throw.
- `writeFile` MUST re-read the current on-disk content immediately before writing
  (write-safety per SPEC §7.5.1). For `writeProfile`/`writeQABank`, the caller
  is responsible for passing the updated content (the store does not diff).
- On `reconnectFolder`: if Chrome requires user activation and the call site is
  the service worker, it MUST NOT call `requestPermission` — return `false`
  instead so the panel can prompt the user.
- Expose `FileStore` instance via a singleton in each context. Panel creates and
  owns it; background receives a `postMessage` when a folder is connected and
  caches a reference to the handle (permission already granted).

**Exit gate:** Unit tests (Vitest with `mock-fs` or an in-memory handle stub)
pass for: read missing file returns `null`; write + read roundtrip; atomic write
rolls back on simulated rename failure; `reconnectFolder` returns false when
handle is absent.

---

### P0-T4 · Settings & secret storage

**What:** Settings service that reads/writes `settings.json` (non-secret) and
`chrome.storage.local` (secrets). No UI yet.

**File:** `src/shared/settings.ts`

```ts
// Non-secret (settings.json in data folder)
interface AppSettings {
  version: number;
  defaultProfile: string | null;
  aiDrafting: boolean;
  confidenceThreshold: 'high' | 'medium';   // auto-include above this
  autoAddRepeatableBlocks: boolean;          // default: false
  dedupeWindow: number;                      // days, default: 365
  llmTimeoutMs: number;                      // default: 30000
  maxFieldBatchSize: number;                 // default: 30
  fallbackChain: string[];                   // ordered provider ids
  providers: ProviderConfig[];
  keyPersistenceMode: 'persisted' | 'session';
}

interface ProviderConfig {
  id: string;
  name: string;
  model: string;           // empty string = not configured
  baseUrl: string;         // provider-specific default; overridable for "custom"
}

// Secret (chrome.storage.local)
interface ProviderSecrets {
  [providerId: string]: string;   // providerId → apiKey
}

class SettingsService {
  load(): Promise<AppSettings>;
  save(s: AppSettings): Promise<void>;
  getApiKey(providerId: string): Promise<string | null>;
  setApiKey(providerId: string, key: string): Promise<void>;
  clearApiKey(providerId: string): Promise<void>;
  clearAllApiKeys(): Promise<void>;
}
```

**Defaults** (applied when `settings.json` is absent or a field is missing):
```ts
const DEFAULTS: AppSettings = {
  version: 1,
  defaultProfile: null,
  aiDrafting: true,
  confidenceThreshold: 'high',
  autoAddRepeatableBlocks: false,
  dedupeWindow: 365,
  llmTimeoutMs: 30000,
  maxFieldBatchSize: 30,
  fallbackChain: [],
  providers: [
    { id: 'openai',    name: 'OpenAI',    model: '', baseUrl: 'https://api.openai.com/v1' },
    { id: 'gemini',    name: 'Gemini',    model: '', baseUrl: 'https://generativelanguage.googleapis.com' },
    { id: 'anthropic', name: 'Anthropic', model: '', baseUrl: 'https://api.anthropic.com' },
    { id: 'custom',    name: 'Custom',    model: '', baseUrl: '' },
  ],
  keyPersistenceMode: 'persisted',
};
```

**Exit gate:** Unit tests: `load()` returns defaults when no file exists;
`save()` + `load()` roundtrips correctly; `getApiKey` returns stored key;
`clearAllApiKeys` wipes all keys from `chrome.storage.local` mock.

---

### P0-T5 · Message bus (background ↔ panel ↔ content)

**What:** Thin typed wrapper over `chrome.runtime.sendMessage` /
`chrome.tabs.sendMessage` so every cross-context call is type-safe and
handled consistently.

**File:** `src/shared/messaging.ts`

```ts
function sendToBackground<T, R>(msg: Message<T>): Promise<R>;
function sendToPanel<T>(tabId: number, msg: Message<T>): Promise<void>;
function sendToContent<T, R>(tabId: number, msg: Message<T>): Promise<R>;
function onMessage<T>(type: MessageType, handler: (payload: T, sender: chrome.runtime.MessageSender) => unknown): void;
```

All handlers return a value or `undefined`; the bus wraps responses in a
`{ ok: true, data }` / `{ ok: false, error }` envelope. Unhandled message
types log a warning but do not throw.

**Exit gate:** Unit test: `sendToBackground` round-trips through a mocked
`chrome.runtime.sendMessage`; error envelope propagates correctly.

---

### P0 Exit Gate

- `npm run build` produces a loadable MV3 extension with no TypeScript errors.
- All P0 unit tests pass.
- The extension loads in Chrome; side panel opens; options page opens.
- No product features exist yet — this is pure wiring.

---

## Phase 1 — MVP: Generic Engine

**Goal:** end-to-end fill of a plain HTML form using rules only (no LLM).
The full detect → map → review → apply → history cycle works.

---

### P1-T1 · Profile parser

**What:** Parse the profile markdown schema (SPEC §7.2) into `ParsedProfile`.

**File:** `src/shared/profile-parser.ts`

```ts
function parseProfile(markdown: string): ParsedProfile;
function profileToMarkdown(profile: ParsedProfile): string;  // round-trip serialiser
function validateProfile(profile: ParsedProfile): string[];  // returns list of warnings
```

**Rules:**
- YAML frontmatter parsed by a small bundled parser (e.g. `js-yaml` or hand-rolled
  for the small subset used).
- Section detection is **case-insensitive**; leading/trailing whitespace stripped.
- Unknown sections: preserve in `ParsedProfile.unknownSections` (key → raw text)
  so they survive a round-trip.
- Missing required sections produce a warning (not an error); empty sections are
  returned as empty arrays/objects.
- Date strings: validate against `YYYY-MM`, `YYYY-MM-DD`, `present`, `current`.
  Store as-is; formatting is the mapper's job.

**Exit gate:** Unit tests for: full valid profile; missing sections; unknown
sections preserved; malformed YAML frontmatter (lenient parse, not throw);
round-trip `parseProfile(profileToMarkdown(p))` equals original for clean input.

---

### P1-T2 · Q&A bank parser

**What:** Parse `qa-bank.md` into `QAEntry[]` and serialise back.

**File:** `src/shared/qa-parser.ts`

```ts
function parseQABank(markdown: string): QAEntry[];
function qaEntryToMarkdown(entry: QAEntry): string;
function appendQAEntry(bankMarkdown: string, entry: QAEntry): string; // appends safely
```

**Rules:**
- Each `## <question>` heading starts an entry.
- Fields (`type:`, `tags:`, `answer:`) parsed from the bullet list below it.
- `tags` is a comma-separated string split into `string[]`.
- Multi-line `answer` (YAML `|` block) supported.
- Malformed entries are skipped with a console warning; valid entries are returned.
- `appendQAEntry` appends to the end of the bank with a blank-line separator.
  It does NOT overwrite — safe to call after a re-read (SPEC §7.5.1).

**Exit gate:** Unit tests: parse all types; missing fields use defaults; malformed
entry skipped; append does not duplicate; round-trip stable.

---

### P1-T3 · History service

**What:** Read/write `history.json`, normalise URLs, check for duplicates.

**File:** `src/shared/history.ts`

```ts
class HistoryService {
  load(): Promise<HistoryFile>;
  add(record: Omit<ApplicationRecord, 'id'>): Promise<ApplicationRecord>;
  updateStatus(id: string, status: ApplicationRecord['status']): Promise<void>;
  checkDuplicate(url: string, company: string|null, role: string|null): Promise<ApplicationRecord | null>;
  list(): Promise<ApplicationRecord[]>;
  search(query: string): Promise<ApplicationRecord[]>;
}

function normalizeUrl(url: string): string;
```

**`normalizeUrl` rules:**
- Strip scheme (`https://`, `http://`).
- Strip `www.` prefix.
- Strip fragment (`#...`).
- Strip query string, EXCEPT for query params in a configurable
  `significantParams` allowlist (per-ATS, e.g. `jobId`, `requisitionId`).
- Strip trailing `/`.
- Lowercase.

**`checkDuplicate` logic:**
- Return existing record if `url_normalized` matches exactly, OR
- Return existing record if `company` AND `role` both match (case-insensitive)
  within `dedupeWindow` days.
- Return `null` if no duplicate found.

**Exit gate:** Unit tests for: normalizeUrl strips correctly; add + checkDuplicate
on exact URL match; add + checkDuplicate on company+role match within window;
no false positive outside window; search returns matching results.

---

### P1-T4 · Content script — field detection

**What:** Implement the DOM scanner that produces `DetectedField[]`.

**File:** `src/content/detector.ts`

```ts
function detectFields(root?: Document | ShadowRoot): DetectedField[];
function resolveLabel(el: HTMLElement): string;
function generateFieldId(el: HTMLElement, index: number): string;
```

**Detection algorithm:**
1. Query all: `input:not([type=hidden]):not([disabled])`, `textarea:not([disabled])`,
   `select:not([disabled])`, `[contenteditable=true]`, `[role=combobox]`,
   `[role=listbox]`, `input[type=file]`.
2. Skip elements where `offsetParent === null` AND `aria-hidden` (honeypot check).
3. For each element, run `resolveLabel` (priority order from SPEC §11.1).
4. Assign a stable `fieldId`: `f_${index}_${normalized-label-slug}`.
5. Detect grouping: walk up the DOM for a containing landmark or heading that
   looks like "Experience", "Education", "Work History" etc.; record as `group`.
6. Traverse **open** shadow roots recursively. Log closed roots as unfillable.
7. Detect iframes: for same-origin, recurse into `contentDocument`; for
   cross-origin, emit a single `DetectedField` of type `'unknown'` with label
   `"cross-origin-iframe"` so the panel can surface it.
8. Detect upload fields: `input[type=file]`; classify by nearby label keyword
   (resume/cv → `'resume'`; cover/letter → `'cover-letter'`; else `'other'`).
9. Detect multi-step: look for a `button` or `[role=button]` near the bottom of
   the form whose text matches `/next|continue|proceed/i`; record selector in
   `DetectedField` metadata (not part of the fillable list — informational only).

Maintain an in-memory `Map<string, HTMLElement>` (`fieldId → element`) for the
duration of the detect→apply cycle. Export `getFieldElement(fieldId)` to be
called at write time.

**Exit gate:** Unit tests against fixture HTML (Vitest + jsdom): detects all
input types; resolves label by each priority method; generates stable fieldIds;
skips hidden/honeypot; classifies file upload; traverses shadow root.

---

### P1-T5 · Rules mapper

**What:** Deterministic mapping of detected fields to profile values using
heuristics. No LLM.

**File:** `src/shared/mapper-rules.ts`

```ts
function applyRules(fields: DetectedField[], profile: ParsedProfile): MappingResult[];
```

**Synonym dictionary** (extend Appendix D from SPEC):
```ts
// Map from synonym set to profile path
const RULES: Array<{
  patterns: RegExp[];             // match against: label, name, id, autocomplete
  profilePath: string;            // e.g. "personal.fullName", "experience[0].company"
  formatter?: (raw: string, field: DetectedField) => string;
}> = [
  { patterns: [/^(full.?name|your.?name)$/i, /autocomplete:name/], profilePath: 'personal.fullName' },
  { patterns: [/^(first.?name|given.?name)$/i, /autocomplete:given-name/], profilePath: 'personal.firstName' },
  { patterns: [/^(last.?name|surname|family.?name)$/i, /autocomplete:family-name/], profilePath: 'personal.lastName' },
  { patterns: [/^e.?mail$/i, /autocomplete:email/], profilePath: 'personal.email' },
  { patterns: [/^(phone|mobile|tel)$/i, /autocomplete:tel/], profilePath: 'personal.phone' },
  { patterns: [/^(city|town)$/i, /autocomplete:address-level2/], profilePath: 'personal.city' },
  { patterns: [/^country$/i, /autocomplete:country-name/], profilePath: 'personal.country' },
  { patterns: [/linkedin/i], profilePath: 'personal.linkedin' },
  { patterns: [/github/i], profilePath: 'personal.github' },
  { patterns: [/portfolio|website|personal.?url/i], profilePath: 'personal.portfolio' },
  // … extend per Appendix D
];
```

**Logic:**
1. For each `DetectedField`, test all patterns against normalized label, `name`,
   `id`, and `autocomplete` token (prefix `autocomplete:` for autocomplete patterns).
2. First match wins → resolve `profilePath` against the `ParsedProfile` → get value.
3. Run `formatter` if defined (e.g. date reformat — see P1-T6).
4. Return `MappingResult` with `source: 'rule'`, `confidence: 'high'`.
5. Unmatched fields return `source: 'blank'`, `confidence: 'low'`, `needsReview: true`.

**Exit gate:** Unit tests: all synonym categories resolve correctly; unmatched
field produces blank result; confidence and source fields populated.

---

### P1-T6 · Value formatter

**What:** Transform stored profile values into the format a specific form field
expects.

**File:** `src/shared/value-formatter.ts`

```ts
function formatValue(raw: string, field: DetectedField): { value: string; note?: string };
function formatDate(raw: string, field: DetectedField): string;
function fuzzyMatchOption(raw: string, options: string[]): { match: string | null; confidence: Confidence };
```

**`formatDate` rules:**
- Input: `YYYY-MM` or `YYYY-MM-DD` or `present`/`current`.
- Detect target format from:
  - `field.type === 'month'` → `YYYY-MM`
  - `field.type === 'date'` → `YYYY-MM-DD` (use `01` for day if absent)
  - `placeholder` or `pattern` attr: e.g. `MM/YYYY` → reformat accordingly
  - `field.type === 'select'` with numeric options → try year only
- `present`/`current` → check for a sibling checkbox labelled "currently work here";
  if found, the checkbox fieldId is recorded and the date field is left blank.
  If not found, use today's date or leave blank + flag.

**`fuzzyMatchOption` rules:**
- Normalize both sides: lowercase, remove punctuation, collapse whitespace.
- Exact match after normalization → `high`.
- Check synonym table (e.g. `bachelor` ↔ `bsc` ↔ `undergraduate`) → `high`.
- Levenshtein distance ≤ 2 → `medium`.
- No match → `null`, `low`.

**Exit gate:** Unit tests for: each date format conversion; present/current
handling; fuzzy option matching with synonyms; no match returns null.

---

### P1-T7 · Content script — value writer

**What:** Write `MappingResult` values into the live DOM using the correct
event dispatch (SPEC §11.7).

**File:** `src/content/writer.ts`

```ts
interface WriteResult { fieldId: string; ok: boolean; note?: string; }
async function writeValues(results: MappingResult[]): Promise<WriteResult[]>;
function writeTextInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void;
function writeSelect(el: HTMLSelectElement, value: string): void;
function writeCheckbox(el: HTMLInputElement, value: boolean): void;
function writeRadioGroup(name: string, value: string, root: Document): void;
function writeCombobox(el: HTMLElement, value: string): Promise<void>;
```

**`writeTextInput` implementation:**
```ts
const nativeSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
)!.set!;
nativeSetter.call(el, value);
el.dispatchEvent(new Event('input',  { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

**`writeCombobox`:** simulate `focus` → set value via nativeSetter → dispatch
`input` → wait 150ms for dropdown → query options → click closest match. If no
option appears within 500ms, fall back to typing each character with `KeyboardEvent`.
Report failure if neither approach succeeds.

**Rules:**
- Skip `disabled` and `readonly` fields.
- Respect `maxlength`: truncate and set `note: 'truncated'`.
- For `required` fields left blank: do not write (leave as-is), set
  `note: 'required-unfilled'`.
- Re-fetch the element via `getFieldElement(fieldId)` at write time (EC-14):
  if gone, return `{ ok: false, note: 'element-gone' }`.
- Each `writeValues` call is **independent** per field — failure on one does not
  abort others.

**Exit gate:** E2E Playwright tests on `fixtures/plain-form.html` and
`fixtures/react-form.html`: values are retained after blur (React state
updates); `required` blank field is not written; `maxlength` truncation with
note; select fuzzy-match; radio selection.

---

### P1-T8 · Background orchestrator — Phase 1 slice

**What:** The background service worker handles messages for the Phase 1 flow.

**File:** `src/background/orchestrator.ts`

```ts
// Handles:
// DETECT_FIELDS  → injects content script into active tab, returns DetectedField[]
// MAP_FIELDS     → runs rules mapper, returns MappingResult[]
// APPLY_VALUES   → sends approved values to content script, returns WriteResult[]
// HISTORY_ADD    → writes record to history.json
// DUPLICATE_CHECK → checks history for the current URL
```

**Message flow:**
```
Panel clicks "Detect & Map"
  → panel sends DETECT_FIELDS to background
  → background calls scripting.executeScript to inject content/index.ts
  → content script runs detectFields(), sends FIELDS_DETECTED back
  → background loads profile from FileStore
  → background runs applyRules(fields, profile)
  → background sends MAPPING_RESULT to panel (tab-bound session)
  → background runs duplicate check, sends DUPLICATE_CHECK result

Panel clicks "Apply to page"
  → panel sends APPLY_VALUES with approved MappingResult[]
  → background sends to content script via sendToContent
  → content runs writeValues(), returns WriteResult[]
  → background sends APPLY_RESULT to panel
  → background writes history entry
```

**Session binding:** background stores `{ tabId, mappingResults, profileSlug }`
in a `Map<number, Session>` keyed by `tabId`. When panel sends APPLY_VALUES, it
includes the `tabId`. If the active tab differs from the stored `tabId`, return
an error: "Tab changed — please re-detect." (EC-29).

MV3 service worker can be terminated mid-operation (EC-22). Persist in-progress
session to `chrome.storage.local` (key `"session_${tabId}"`) before any async
op; restore on wake-up.

**Exit gate:** Integration test using fixture pages: full detect → map → apply
cycle completes; history entry written; duplicate warning returned on second
apply to same URL.

---

### P1-T9 · Side panel UI — Phase 1 slice

**What:** The React side panel UI for profile management and the fill/review
workflow.

**Files:**
```
src/panel/
  components/
    ProfileSelector.tsx      (dropdown: list profiles, "New", "Edit")
    ProfileEditor.tsx        (textarea for raw markdown edit + save)
    ProfileBuilder.tsx       (paste free text → structured preview — LLM wired in P2)
    ReviewTable.tsx          (the fill review table)
    ReviewRow.tsx            (single field row: label, value input, source badge, confidence, toggle)
    FlaggedItems.tsx         (list of blanks, uploads, low-confidence items)
    DuplicateWarning.tsx     (banner)
    HistoryView.tsx          (list + status update)
  store/
    panelStore.ts            (Zustand: current profile, session, history, settings)
  Panel.tsx                  (main layout: tabs or sections)
```

**Review table columns:**
| Column | Type | Notes |
|--------|------|-------|
| Field label | text | read-only |
| Group | text | read-only; row grouping header |
| Proposed value | editable input | pre-filled from MappingResult |
| Source | badge | rule / profile / qa / llm / blank |
| Confidence | badge | high (green) / medium (yellow) / low (red) |
| Required | icon | ⚠ if required |
| Include | toggle | default: true if high/medium; false if blank/low |

**In Phase 1:** `ProfileBuilder.tsx` shows the textarea but calls `parseProfile`
client-side only (no LLM structuring yet). The "Build from text" button is
disabled with a tooltip "Available in Phase 2". `ReviewTable` renders mapping
results from rules only.

**Exit gate:** Visual inspection + Playwright: profile list shows files from
disk; edit + save round-trips; review table renders all rows with correct
source/confidence badges; include toggle works; "Apply to page" button sends
APPLY_VALUES message; flagged items section shows upload fields and blanks.

---

### P1-T10 · Fixture forms for testing

**What:** Create the HTML fixture forms used by E2E tests throughout all phases.

**Files:**
```
fixtures/
  plain-form.html         (vanilla HTML form with all standard fields)
  react-form.html         (React 18 controlled form — built and inlined)
  split-date-form.html    (month + year as separate selects)
  combobox-form.html      (custom autocomplete/combobox widget)
  wizard-form.html        (multi-step: 3 pages, Next/Back buttons)
  repeatable-form.html    (experience sections with "Add another" button)
  upload-form.html        (resume + cover letter file inputs)
  captcha-form.html       (fake captcha placeholder)
  iframe-form.html        (form embedded in same-origin and cross-origin iframes)
  shadow-dom-form.html    (form fields inside a shadow root)
```

Each fixture exports a `window.__formSubmitted` flag that the test asserts
is `false` (never triggered by the tool — AC-5).

**Exit gate:** All fixture files open in Chrome without JS errors; submit
handler sets `window.__formSubmitted = true` (tested manually).

---

### P1 Exit Gate

All of the following pass:
- AC-1: ≥90% of standard fields on `plain-form.html` fill via rules alone.
- AC-2: `react-form.html` — written value retained after blur.
- AC-3: Unknown required field is blank + flagged; `window.__formSubmitted` unchanged.
- AC-5: Tool never sets `window.__formSubmitted = true` on any fixture.
- AC-6: Second detect on the same URL triggers duplicate warning.
- AC-7: Editing the profile `.md` in an external editor and re-running fill
        picks up the new content.
- History entry written to `history.json` after apply.
- Duplicate warning banner appears in the panel on second apply.

---

## Phase 2 — LLM Layer

**Goal:** Add the LLM provider layer with fallback, LLM field mapping, Q&A
bank + AI drafting, and the profile paste-to-structure feature.

---

### P2-T1 · LLM provider abstraction & adapters

**What:** Implement the `LLMProvider` interface and adapters for OpenAI,
Gemini, Anthropic, and Custom (OpenAI-compatible).

**Files:**
```
src/background/llm/
  types.ts          (LLMRequest, LLMResponse, LLMError)
  provider.ts       (LLMProvider interface)
  openai.ts         (OpenAI adapter)
  gemini.ts         (Gemini adapter)
  anthropic.ts      (Anthropic adapter)
  custom.ts         (OpenAI-compatible adapter — reuses openai.ts logic)
  fallback.ts       (FallbackChain orchestrator)
```

**`LLMProvider` interface:**
```ts
interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  responseSchema?: object;    // JSON schema for structured output
  maxTokens?: number;
  temperature?: number;       // default: 0.1
}
interface LLMResponse {
  content: string;            // raw text or JSON string
  tokensUsed?: number;
  providerId: string;
}
interface LLMError {
  type: 'network' | 'auth' | 'rate-limit' | 'server' | 'timeout'
       | 'safety' | 'invalid-output' | 'unknown';
  status?: number;
  message: string;
  retryable: boolean;
}

interface LLMProvider {
  id: string;
  name: string;
  complete(req: LLMRequest, apiKey: string): Promise<LLMResponse>;
}
```

**Adapter requirements:**
- Each adapter calls the provider's REST API via `fetch` (no SDK).
- Implement `responseFormat`/`response_format` structured-output hint where
  the provider supports it (OpenAI: `response_format: { type: 'json_object' }`;
  Anthropic: instruct in system prompt).
- Map provider HTTP error codes to `LLMError.type`.
- Timeout: abort the `fetch` after `llmTimeoutMs` ms using `AbortController`.
- **Gemini adapter** note: Gemini's API endpoint and request format differ from
  OpenAI; implement a dedicated adapter (not a clone of the OpenAI one).

**FallbackChain:**
```ts
class FallbackChain {
  constructor(private chain: string[], private settings: SettingsService) {}
  async complete(req: LLMRequest): Promise<LLMResponse>;
  // Tries providers in order. On any LLMError (retryable or not), logs and
  // tries next. Marks 401/403 providers unhealthy in SettingsService.
  // If all fail, throws a FallbackExhaustedError (caught by orchestrator → EH-1).
}
```

**Exit gate:** Unit tests (mocked `fetch`): each adapter serialises the request
correctly and deserialises the response; 429 → `retryable: true`; 401 →
`type: 'auth'`; timeout fires after configured ms; `FallbackChain` skips
failed provider and uses next; all-fail throws `FallbackExhaustedError`.

---

### P2-T2 · LLM field mapper

**What:** Take the unresolved fields from the rules pass and map them via the
LLM, returning structured `MappingResult[]`.

**File:** `src/background/mapper-llm.ts`

```ts
async function mapFieldsWithLLM(
  unresolvedFields: DetectedField[],
  profile: ParsedProfile,
  qaBank: QAEntry[],
  chain: FallbackChain,
  batchSize: number,
): Promise<MappingResult[]>;
```

**Prompt construction:**
- System prompt: instructs the LLM to map form fields to the provided profile
  data only; never invent values; return structured JSON.
- User prompt: compact profile context (only sections relevant to the fields in
  the batch — e.g. if batch is all experience fields, include only the experience
  section) + field list (label, type, options, group).
- Response schema: the contract from SPEC Appendix C.

**Batching:** group `unresolvedFields` into batches of at most
`maxFieldBatchSize`. Run batches sequentially (not in parallel) to avoid
hammering rate limits.

**Output validation:**
1. Parse LLM response as JSON.
2. Validate against the Appendix C schema (required fields present, enums valid).
3. If invalid: build a repair prompt ("The above response was invalid because X.
   Correct it and return only valid JSON.") and retry once.
4. If still invalid: return `blank`+flag for all fields in that batch.

**Context compaction rule:**
- Include `# Personal Information` for personal fields.
- Include `# Work Experience` (all entries) for experience/employment fields.
- Include `# Education` for education fields.
- Include `# Certifications` for cert/credential fields.
- Include `# Skills` for skill/technology fields.
- Include `# Preferences` for preference/availability fields.
- Never include the entire raw profile string.

**Exit gate:** Unit tests with mocked `FallbackChain`: valid response parsed
and merged into `MappingResult[]`; malformed response triggers repair retry;
second failure returns `blank`+flag; context compaction only includes relevant
sections.

---

### P2-T3 · Q&A bank matcher + AI drafting

**What:** For custom questions (non-resume fields), match against the Q&A bank
(rules then LLM semantic match); when no match, AI-draft an answer.

**File:** `src/background/qa-matcher.ts`

```ts
async function matchQuestion(
  field: DetectedField,
  qaBank: QAEntry[],
  profile: ParsedProfile,
  chain: FallbackChain,
  aiDrafting: boolean,
): Promise<MappingResult>;
```

**Step 1 — Rule match:**
- Normalise field label (lowercase, remove punctuation).
- Score each `QAEntry`: count tag overlaps + fuzzy text similarity between
  normalised field label and normalised question text.
- If best score ≥ threshold → return entry's answer as `source: 'qa'`, `confidence: 'high'`.

**Step 2 — LLM semantic match (if no rule match):**
- Send field label + top-3 Q&A entries (by score) to LLM:
  "Which of these saved answers best matches the form question? Return the index
  or 'none'."
- If LLM returns an index → `source: 'qa'`, `confidence: 'medium'`.
- If `'none'` and `aiDrafting === false` → `blank`+flag.

**Step 3 — AI draft (if `aiDrafting === true` and no bank match):**
- Prompt: "Draft a concise answer to this form question using only the
  following profile data. Do not invent facts."
- Include only the profile sections most relevant to the question.
- Return as `source: 'llm'`, `confidence: 'medium'`, `needsReview: true`.
- If the question requires a specific fact not in the profile (e.g. exact years
  of experience with a specific tool) → `blank`+flag with `note: 'fact-not-in-profile'`
  (F4.4).

**Exit gate:** Unit tests: rule match on exact tag; rule match on partial tag;
LLM semantic match path; draft path with mocked chain; fact-not-in-profile
returns blank; Q&A save-back appends correctly to bank via `appendQAEntry`.

---

### P2-T4 · Profile paste-to-structure (Panel UI)

**What:** Enable `ProfileBuilder.tsx` — paste raw text, LLM structures it into
the profile schema, show a diff preview, save.

**File additions:**
```
src/background/profile-builder.ts   (orchestrates LLM call for structuring)
src/panel/components/DiffPreview.tsx  (side-by-side or unified diff view)
```

**`structureProfileText` function:**
```ts
async function structureProfileText(
  rawText: string,
  existingProfile: string | null,
  targetRole: string,
  chain: FallbackChain,
): Promise<string>;   // returns a complete profile markdown string
```

Prompt: "Convert the following raw text into a structured profile in this exact
markdown schema. Preserve all facts exactly as stated; do not add or invent any
information." Include the schema from SPEC §7.2 as context.

The panel shows the result as an editable preview with a diff against the
existing on-disk profile (if any). User must confirm before `FileStore.writeProfile`
is called (SPEC §7.5.1 — full-rewrite safety).

**Exit gate:** Playwright test on fixture: paste a short resume text snippet;
mock LLM returns structured markdown; diff preview renders; confirm saves the
file; cancel discards.

---

### P2-T5 · Orchestrator — Phase 2 additions

**What:** Add LLM mapping and Q&A matching to the background orchestrator.

Update `src/background/orchestrator.ts`:

```
MAP_FIELDS handling (updated):
  1. Run applyRules() → resolvedResults + unresolvedFields
  2. If unresolvedFields.length > 0 and LLM configured:
       a. mapFieldsWithLLM() for non-Q&A fields
       b. matchQuestion() for detected custom-question fields
  3. Merge all results
  4. Return MappingResult[] to panel
  On FallbackExhaustedError: return rules-only results + error metadata (EH-1)
```

New message type: `SAVE_QA_ENTRY` — panel sends a new `QAEntry` to background;
background calls `appendQAEntry` then `FileStore.writeQABank`.

**Exit gate:** Integration test: configure mocked LLM; MAP_FIELDS returns LLM
results for unmapped fields; FallbackExhaustedError path returns rules-only
with error flag; SAVE_QA_ENTRY round-trips to qa-bank.md.

---

### P2-T6 · Provider test & health UI

**What:** "Test" button in settings that sends a minimal request to each
provider and reports latency / success / error.

**File:** `src/panel/components/ProviderHealthCard.tsx`

```ts
// Sends message TEST_PROVIDER to background
// Background sends a 1-token "reply with 'ok'" request to the provider
// Returns: { ok: boolean; latencyMs?: number; error?: string }
```

**Exit gate:** Playwright: clicking Test with a mocked provider shows
success/latency; bad key shows error message.

---

### P2 Exit Gate

- AC-4: Primary provider forced to fail → mapping completes via second provider;
  all fail → rules-only + toast shown.
- Q&A bank match works on a fixture form with custom questions.
- AI-drafted answer is flagged medium confidence with `needsReview: true`.
- Save-back to Q&A bank appends a new entry without overwriting existing entries.
- Profile paste-to-structure flow completes end-to-end.
- Provider Test button works for all four provider types.

---

## Phase 3 — ATS Adapters & Robustness

**Goal:** Reliable filling on Workday (the hardest case), then the remaining
known ATS platforms. Harden edge cases from SPEC §13.

---

### P3-T1 · Adapter interface

**What:** Define the adapter contract and wiring.

**File:** `src/content/adapters/adapter.ts`

```ts
interface ATSAdapter {
  id: string;
  name: string;
  /** Return true if this adapter applies to the current page */
  matches(location: Location, document: Document): boolean;
  /** Override field detection for this ATS */
  detectFields?(root: Document): DetectedField[];
  /** Override label resolution for a specific element */
  resolveLabel?(el: HTMLElement, generic: () => string): string;
  /** Called before writeValues to allow ATS-specific pre-fill setup */
  beforeWrite?(results: MappingResult[]): Promise<void>;
  /** Override value writing for specific field types */
  writeField?(fieldId: string, result: MappingResult, generic: () => Promise<WriteResult>): Promise<WriteResult>;
  /** Override repeatable-section expansion */
  addRepeatableBlock?(groupName: string, document: Document): Promise<boolean>;
}

function selectAdapter(location: Location, document: Document): ATSAdapter | null;
function getAdapterOrGeneric(): ATSAdapter;
```

Adapters are registered in an array; `selectAdapter` returns the first match.
Absence of a match → use the generic engine (all methods are optional overrides).

**Exit gate:** Unit test: `selectAdapter` returns correct adapter for each ATS
URL pattern; returns null for unknown URLs; generic engine is used when adapter
returns null.

---

### P3-T2 · Workday adapter

**What:** Workday-specific overrides for the most complex ATS.

**File:** `src/content/adapters/workday.ts`

**Key Workday-specific behaviours to handle:**
- URL pattern: `*.myworkdayjobs.com/*` or `workday.com/*/d/jobs/*`.
- Workday renders fields inside `[data-automation-id]` attributes — use these
  as stable `fieldId` keys instead of generated IDs.
- Date fields: Workday uses a custom date picker; the input is read-only; must
  interact with the calendar widget via keyboard (`Tab` to month/day/year parts,
  type value). Implement `writeField` override for date inputs.
- Dynamic field loading: fields load lazily as the user scrolls. After
  `detectFields`, wait for a `MutationObserver` to settle before returning.
- Multi-step: Workday steps are URL-segment-based; provide `getNextStepButton`
  helper.
- Experience/education grids: custom repeatable sections; `addRepeatableBlock`
  clicks the Workday-specific "Add" button and waits for the new row to appear.
- Known `data-automation-id` values: document in a comment block within the
  adapter.

**Exit gate:** Playwright test against a saved static DOM snapshot of a
Workday form: fields detected with correct labels; date field written via
keyboard simulation; "Add experience" adds a new row; all values survive blur.

---

### P3-T3 · Greenhouse, Lever, iCIMS, Taleo, Bayt adapters

One adapter per platform. Each is simpler than Workday. For each:

| Platform | URL pattern | Key quirks to handle |
|---|---|---|
| Greenhouse | `boards.greenhouse.io/*` | Custom dropdowns; standard layout |
| Lever | `jobs.lever.co/*` | React-based; custom comboboxes |
| iCIMS | `*.icims.com/*` | iframe-heavy; session-based form IDs |
| Taleo | `*.taleo.net/*` | Legacy layout; heavy JavaScript; split date selects |
| Bayt | `*.bayt.com/*` | Mix of static and React; English UI only |

For each adapter:
- `matches()` — URL pattern.
- `resolveLabel()` override if platform uses non-standard label patterns.
- `writeField()` override for any platform-specific widget.
- Smoke test against saved DOM snapshot.

**Files:** `src/content/adapters/{greenhouse,lever,icims,taleo,bayt}.ts`

**Exit gate per adapter:** DOM snapshot test passes; at minimum name, email,
phone, and one experience date field fill correctly.

---

### P3-T4 · Shadow DOM & iframe hardening

**What:** Make detection reliable for shadow DOM and same-origin iframes (EC-2, EC-3).

Update `src/content/detector.ts`:
- `detectFields` already recurses into open shadow roots. Verify and expand:
  - Handle nested shadow roots (shadow roots within shadow roots).
  - For each shadow-root field, prefix `fieldId` with `shadow_${depth}_` to
    avoid collisions.
- For same-origin iframes: after detecting the main document, also detect fields
  in each same-origin `<iframe>` (use `iframe.contentDocument`). Prefix
  `fieldId` with `iframe_${index}_`.
- For cross-origin iframes: emit a single `DetectedField` of type `'unknown'`
  with `label: 'cross-origin iframe — cannot fill'` and `needsReview: true`.

**Exit gate:** Playwright on `fixtures/shadow-dom-form.html` and
`fixtures/iframe-form.html`: fields inside open shadow root detected and filled;
cross-origin iframe emits unfillable flag.

---

### P3-T5 · Custom date pickers & combobox hardening

**What:** Improve `writeCombobox` and add a dedicated date-picker strategy.

Update `src/content/writer.ts`:
- **Date picker strategy:**
  1. Try setting `value` directly + native setter events.
  2. If the input is `readonly`, try clicking to open the picker and navigating
     with keyboard arrows + `Enter`.
  3. If the field has `data-automation-id` (Workday), use the Workday adapter's
     override.
  4. If all fail: return `{ ok: false, note: 'date-picker-unfillable' }` + flag.
- **Combobox timeout:** increase patience for slow option lists (configurable
  up to 1500ms total); add a MutationObserver-based wait instead of fixed timeout.

**Exit gate:** Playwright on `fixtures/combobox-form.html` and
`fixtures/split-date-form.html`: combobox selects correct option; split date
selects fill month and year correctly.

---

### P3-T6 · MV3 service worker resumability (EC-22)

**What:** Ensure in-progress operations survive service worker termination.

Update `src/background/orchestrator.ts`:
- Before each `await` that mutates external state, write `session_${tabId}` to
  `chrome.storage.local`.
- On service worker startup, check for orphaned sessions in `chrome.storage.local`.
  If found and the tab still exists, restore the session (panel can re-trigger
  APPLY_VALUES without re-detecting).
- All mutating operations (write history, write Q&A bank, write profile) are
  idempotent via a `requestId` (UUID generated at operation start, stored in
  session). Second call with the same `requestId` is a no-op.

**Exit gate:** Unit test: simulate SW termination mid-flow (delete the in-memory
session, reload background); panel re-sends APPLY_VALUES; operation completes
correctly; history entry not duplicated.

---

### P3-T7 · Repeatable sections (auto-add, off by default)

**What:** When `autoAddRepeatableBlocks` is `true` in settings, automatically
click "Add another" to create new blocks for excess profile entries.

Update `src/content/detector.ts` — expose detected "Add another" button
selector per group. Update `src/background/orchestrator.ts` to call
`addRepeatableBlock` (via content script) before writing experience/education
entries that exceed existing block count. Fall back to flagging if the click
fails.

**Exit gate:** Playwright on `fixtures/repeatable-form.html` with setting on:
3 experience entries in profile + 1 block on form → 2 "Add another" clicks →
3 blocks filled. Setting off: 1 block filled, 2 flagged.

---

### P3 Exit Gate

- Workday DOM snapshot test: ≥85% of fields on a representative Workday form
  fill correctly.
- Each other ATS adapter smoke test passes.
- Shadow DOM + same-origin iframe: detected and filled.
- Cross-origin iframe: flagged, not mis-filled.
- EC-22 resumability test passes.
- EC-29 tab-switch test passes.

---

## Phase 4 — Polish & Productionisation

**Goal:** Complete the settings UX, onboarding, history browser, debug
tooling, and the "delete all data" flow. Prepare for distribution.

---

### P4-T1 · First-run onboarding wizard

**What:** A multi-step onboarding flow shown on first launch.

**File:** `src/panel/components/Onboarding.tsx`

Steps:
1. **Welcome** — brief explanation of the tool (3 bullet points).
2. **Data folder** — "Pick folder" button; explains that all data stays local;
   button disabled until folder is picked.
3. **Create profile** — minimal inline form (profile name, target role) + option
   to paste resume text (triggers `ProfileBuilder` flow). Marked optional.
4. **LLM setup** — add a provider + test. Explains rules-only mode works without
   a key. Marked optional.
5. **Disclaimer** — user confirms they are responsible for accuracy of submitted
   data (SPEC §16).

Onboarding is shown when `settings.defaultProfile === null` AND no profiles
exist. Once completed (or skipped after step 2), a flag `onboardingComplete:
true` is written to settings.

**Exit gate:** Playwright: fresh install → onboarding shown; pick folder →
step 2 unlocked; skip LLM → onboarding completes; re-open → onboarding not
shown.

---

### P4-T2 · Settings UX

**What:** Complete settings page in the options page and as a panel tab.

**File:** `src/panel/components/Settings.tsx` (panel tab) +
`src/options/Settings.tsx` (options page — full layout)

Sections:
- **Data folder** — connected path, reconnect button.
- **Profiles** — list + rename/duplicate/delete (with confirm on delete).
- **LLM providers** — each provider: model input, API key input (masked), base URL,
  health indicator (untested / ok / error), Test button, remove button.
- **Fallback chain** — drag-to-reorder list of provider IDs.
- **Fill behaviour** — confidence threshold slider, auto-add repeatable blocks toggle.
- **Security** — key persistence mode toggle (persisted / session-only).
- **Data management** — "Delete all local data" (clears keys, history, settings;
  does NOT delete user profile/Q&A files — just the tool's records).
- **Debug** — toggle verbose logging; download debug log.

**Exit gate:** Playwright: add provider → appears in fallback chain; drag
reorder → order persisted; Delete all local data → clears history and keys;
session-only mode → key cleared on extension reload.

---

### P4-T3 · History browser

**What:** A searchable, filterable list of past applications.

**File:** `src/panel/components/HistoryView.tsx` (expand from Phase 1 stub)

Columns: date, company, role, profile used, status, fields filled/flagged.
Actions per row: change status (dropdown), open URL, delete entry.
Search: filter by company, role, or URL.
Sort: by date (default desc), company, status.

**Exit gate:** Playwright: 5 entries in history.json → all shown; search filters;
status change persists; delete removes entry.

---

### P4-T4 · Debug log & error reporting

**What:** In-memory ring buffer (last 500 entries) of all significant events,
downloadable as JSON.

**File:** `src/background/debug-log.ts`

```ts
type LogLevel = 'info' | 'warn' | 'error';
interface LogEntry { ts: string; level: LogLevel; context: string; message: string; data?: unknown; }
class DebugLog {
  log(level: LogLevel, context: string, message: string, data?: unknown): void;
  getEntries(): LogEntry[];
  download(): void;  // triggers JSON blob download
  clear(): void;
}
```

All background operations call `debugLog.log(...)`. Log is redacted: API keys
replaced with `[REDACTED]`; profile content truncated to 100 chars per field.

Panel "report details" button in error toasts triggers `debugLog.download()`.

**Exit gate:** Unit test: log truncates at 500 entries; key values are redacted;
download produces valid JSON.

---

### P4-T5 · `npm run build` production bundle

**What:** Production build with minification, source maps stripped, icons
bundled.

```
public/
  icon-16.png
  icon-32.png
  icon-48.png
  icon-128.png
```

`vite.config.ts` production mode: minify, no source maps in output,
`dist/` directory ready to load as unpacked extension.

**Exit gate:** `npm run build` produces `dist/` with no TypeScript or build
errors; `dist/` loads in Chrome as an unpacked extension; all Phase 1–3 manual
smoke tests pass on the production build.

---

### P4 Exit Gate

- Onboarding wizard completes on fresh install.
- Settings UX: all controls persist; delete-all-data works.
- History browser: search, filter, status update.
- Debug log: downloadable; keys redacted.
- Production build loads cleanly in Chrome.
- All AC-1 through AC-7 still pass on the production build.

---

## Future (Parked)

These items are intentionally deferred beyond v1. They are documented here for
context, not for implementation.

| Item | Blocked on / Notes |
|---|---|
| LinkedIn Easy Apply | ToS review required; high account-risk; needs separate ToS analysis before proceeding |
| Multilingual / RTL form support | Requires Arabic label matching and RTL text-input handling; Bayt Arabic UI |
| Edge / Firefox | Firefox lacks File System Access API — needs export/import fallback in FileStore |
| JD-aware tailoring | Would require reading the job description and sending to LLM — N3 in v1 |
| Cover-letter generation | Depends on JD tailoring being in scope |
| PDF/DOCX resume import | Profile input via file upload + parser (e.g. pdf.js, mammoth.js) |
| Chrome Web Store distribution | Requires policy review, privacy policy page, screenshots |
| Multi-device / cloud sync | Would require a backend or a sync provider integration |

---

*End of DEVPLAN.md v1.0*
