# SPEC.md — Job Form Filler (Chrome Extension)

> **Status:** Draft v0.2 — source of truth for implementation (validated pass).
> **Owner:** <owner-email>
> **Last updated:** 2026-06-03
>
> This document is the single source of truth. Any coding assistant or
> developer should be able to build the product from this file alone. When a
> behaviour is ambiguous, prefer the rule written here; if this file is silent,
> raise it with the spec owner before coding (§20 lists the resolved defaults).

---

## Table of Contents

1. [Overview & Problem Statement](#1-overview--problem-statement)
2. [Goals and Non-Goals](#2-goals-and-non-goals)
3. [Primary User & Usage Context](#3-primary-user--usage-context)
4. [Key Decisions (Locked)](#4-key-decisions-locked)
5. [High-Level Architecture](#5-high-level-architecture)
6. [Technology Stack](#6-technology-stack)
7. [Data Model & Knowledge Base](#7-data-model--knowledge-base)
8. [Functional Requirements](#8-functional-requirements)
9. [User Flows (Happy Path)](#9-user-flows-happy-path)
10. [Data Flow](#10-data-flow)
11. [Field Detection & Mapping Strategy](#11-field-detection--mapping-strategy)
12. [LLM Provider Layer](#12-llm-provider-layer)
13. [Edge Cases](#13-edge-cases)
14. [Error Handling](#14-error-handling)
15. [Security & Privacy](#15-security--privacy)
16. [Legal / Terms-of-Service Considerations](#16-legal--terms-of-service-considerations)
17. [Permissions (Manifest V3)](#17-permissions-manifest-v3)
18. [Settings Reference](#18-settings-reference)
19. [Testing & Acceptance Criteria](#19-testing--acceptance-criteria)
20. [Resolved Decisions & Defaults](#20-resolved-decisions--defaults)
21. [Phased Roadmap](#21-phased-roadmap)
22. [Glossary](#22-glossary)
23. [Appendices](#23-appendices)

---

## 1. Overview & Problem Statement

### 1.1 Problem
The user applies to jobs across LinkedIn and (increasingly) other platforms such
as Bayt. Saved jobs are applied to one by one. Two paths exist:

- **"Easy Apply"** style flows — quick, a few questions, low friction.
- **"Apply"** style flows — redirect to the employer's own site / Applicant
  Tracking System (ATS). These present **long, repetitive forms**: work
  experience with start/end dates, education with dates and scores,
  certifications, skills, and assorted custom questions. Even when a resume is
  uploaded and auto-parsed, the result is incomplete and must be corrected by
  hand. This is slow and tedious, and repeats for every application.

### 1.2 Solution
A **Chrome browser extension** that, on demand, reads the application form on the
currently open page and fills it using a **locally stored markdown knowledge
base** describing the user (the "profile"). Filling is **hybrid**: deterministic
rules handle obvious fields; a configurable **LLM** handles ambiguous fields and
drafts answers to custom questions. The user always **reviews before submitting** —
the extension never submits on the user's behalf.

### 1.3 Value
- Eliminate repetitive manual entry of experience/education/cert data.
- One maintained profile, reused across unlimited forms.
- Multiple tailored profiles for different target roles.
- A local application history to avoid duplicate applications.

---

## 2. Goals and Non-Goals

### 2.1 Goals (In Scope)
- G1. Fill **generic external ATS / company career forms** (primary value).
- G2. Provide **tailored adapters** for well-known ATS platforms (Workday,
  Greenhouse, Lever, iCIMS, Taleo) for higher reliability.
- G3. Support **Bayt.com** application forms (its **English** UI in v1; Arabic/RTL
  content is a future enhancement per N6).
- G4. Maintain a **markdown knowledge base** on disk via the File System Access
  API, editable both inside the extension and in any external text editor.
- G5. Support **multiple named profiles** (e.g. "ML Engineer", "Data Analyst")
  with per-application selection.
- G6. **Hybrid field mapping**: rules first, LLM fallback.
- G7. **Q&A bank + AI drafting** for custom questions (salary, work
  authorization, notice period, relocation, etc.).
- G8. **Review-before-submit** workflow surfaced in a **side panel** UI.
- G9. **Detect file-upload fields and flag them** for the user to attach manually.
- G10. **Configurable, multi-provider LLM layer** (OpenAI, Gemini, Anthropic/
  Claude, …) with an **ordered fallback chain of up to N providers** (default 3).
- G11. **Local application history** (company, role, URL, date, status) with
  **duplicate-application warnings**.

### 2.2 Non-Goals (Explicitly Out of Scope for v1)
- N1. **LinkedIn Easy Apply automation.** Deliberately excluded: LinkedIn's Terms
  of Service restrict automated interaction and the account risk is high. Parked
  as a possible future module (see §16, §21).
- N2. **Resume PDF/DOCX parsing.** Profile is built by pasting text (AI-structured)
  or direct markdown editing — not by uploading a resume file to be parsed.
- N3. **Job-description-aware tailoring.** Answers are generated from the user's
  profile + Q&A bank only; the page's job description is **not** read or sent to
  the LLM in v1.
- N4. **Automatic submission / mass auto-apply.** The user always reviews and
  clicks submit. No bulk, unattended applying.
- N5. **File uploads performed by the tool.** Upload fields are detected and
  flagged; the user attaches files manually.
- N6. **Non-English form content.** v1 assumes English forms. (Multilingual label
  matching and answers are a future enhancement; see §21.)
- N7. **Non-Chrome browsers** (Edge/Firefox/Safari). Chrome only for v1. Edge is a
  low-cost future add (same engine); Firefox would require a storage fallback
  because it lacks the File System Access API.
- N8. **Mobile.** Desktop Chrome only.
- N9. **Cloud sync / multi-device.** All data is local to the machine.
- N10. **Cover letters — no generation or storage.** Out of scope for v1: the tool
  neither generates cover letters nor stores cover-letter text. The user manages
  and attaches cover letters manually, outside the tool. (Parked for a future
  version; see §21.)

---

## 3. Primary User & Usage Context

- Single primary user (the document owner). No multi-tenant or account system.
- Technically comfortable enough to install an unpacked/dev extension, obtain LLM
  API keys, and edit markdown.
- Works on desktop Chrome, already authenticated to the job sites in their normal
  browser session. The extension operates **on the page the user is already
  viewing** — it does not log in or navigate on the user's behalf.
- Region relevance: Middle East / Pakistan job market (hence Bayt), but v1 form
  content is English.

---

## 4. Key Decisions (Locked)

These were agreed during specification and are considered settled unless the user
revisits them.

| # | Decision area | Choice |
|---|---|---|
| D1 | Host form factor | **Chrome browser extension** (Manifest V3) |
| D2 | Field mapping | **Hybrid**: deterministic rules first, **LLM fallback** |
| D3 | Submission control | **Fill → user reviews → user submits.** Tool never submits |
| D4 | AI processing location | **Configurable per provider**; cloud APIs (user keys) |
| D5 | LLM providers | **Provider-agnostic** layer: OpenAI, Gemini, Anthropic, … |
| D6 | LLM fallback | **Ordered fallback chain**, default 3 providers, supports N |
| D7 | Profile input methods | **Paste-text → AI structures it** + **direct markdown edit** |
| D8 | Custom questions | **Q&A bank + AI drafting** (review, optionally save back) |
| D9 | File uploads | **Detect & flag**; user attaches manually |
| D10 | Knowledge base storage | **Real `.md` files on disk via File System Access API** |
| D11 | Browser target | **Chrome only** (v1) |
| D12 | Site scope | **Generic ATS forms + known-ATS adapters + Bayt** |
| D13 | Trigger & review UI | **Extension icon → side panel** |
| D14 | Tech stack | **TypeScript + React + Vite + CRXJS** |
| D15 | JD tailoring | **No** — answers from profile/Q&A bank only |
| D16 | Application tracking | **Yes** — local history + duplicate warning |
| D17 | Profiles | **Multiple named profiles** |
| D18 | Languages | **English only** (v1) |
| D19 | First ATS adapter | **Workday** first, then Greenhouse/Lever/iCIMS/Taleo/Bayt |
| D20 | Q&A bank scope | **Shared** across all profiles (single `qa-bank.md`) |
| D21 | Cover letters | **Not stored or generated** in v1 (handled manually, outside the tool) |
| D22 | LLM model config | **One model per provider**, used for both field mapping and answer drafting |
| D23 | Autofill threshold | Auto-include **high**-confidence values; **flag** medium/low for review (configurable) |

---

## 5. High-Level Architecture

Chrome MV3 extension composed of cooperating contexts plus an on-disk data folder.

```
┌──────────────────────────────────────────────────────────────────────┐
│                              CHROME                                    │
│                                                                        │
│  ┌───────────────┐   messages    ┌──────────────────────────────────┐ │
│  │  Side Panel    │◀────────────▶│  Background Service Worker        │ │
│  │  (React UI)    │              │  - orchestration / state machine  │ │
│  │  - Profile mgr │              │  - LLM provider layer + fallback  │ │
│  │  - Fill review │              │  - File System Access (data I/O)  │ │
│  │  - Settings    │              │  - application history / dedupe   │ │
│  └───────┬───────┘              └──────────────┬───────────────────┘ │
│          │                                      │ scripting.executeScript│
│          │                                      ▼                      │
│          │                       ┌──────────────────────────────────┐ │
│          │                       │  Content Script (per active tab)  │ │
│          │                       │  - DOM field detection            │ │
│          │                       │  - value writing + event dispatch │ │
│          │                       │  - upload-field flagging          │ │
│          │                       │  - ATS adapter hooks              │ │
│          │                       └──────────────┬───────────────────┘ │
│          │                                      ▼                      │
│          │                            [ Job application web page ]     │
│  ┌───────▼────────┐                                                    │
│  │ Options page    │  (advanced settings, provider keys, profiles dir) │
│  └────────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────┘
                              │  File System Access API
                              ▼
        ┌─────────────────────────────────────────────────┐
        │  User-chosen data folder (on local disk)          │
        │  /profiles/*.md   /qa-bank.md   /history.json     │
        │  /settings.json   (see §7)                        │
        └─────────────────────────────────────────────────┘
```

### 5.1 Component responsibilities

- **Side Panel (React):** all user-facing UI — profile management, the fill/review
  table, Q&A review, settings, history. Opened by clicking the extension icon.
- **Background Service Worker:** the orchestrator. Owns the fill state machine,
  the LLM provider layer + fallback, history/dedupe, and file I/O on
  already-permitted handles (folder picks and permission prompts happen in the
  side panel — see §5.2). The only context that holds API keys at runtime. (MV3
  service workers are ephemeral — see §13 EC-22.)
- **Content Script:** injected into the active tab on user action. Detects fields,
  writes values, dispatches the right DOM events, flags upload fields, and hosts
  ATS-specific adapters. Holds **no secrets** and makes **no network calls**.
- **Options Page:** advanced configuration (provider keys, fallback order,
  data-folder selection, defaults).

### 5.2 Why this shape
- **File System Access permission must originate in the side panel.** Picking the
  folder (`showDirectoryPicker`) and granting/re-granting permission
  (`requestPermission`) require **user activation**, which a service worker does
  not have. Therefore the **side panel** (a document context) owns the folder pick
  and any permission re-grant. An MV3 service worker *can* read/write an
  **already-permitted** handle retrieved from IndexedDB, but cannot raise a
  permission prompt.
- **Recommended division of labour (to avoid worker limitations):** centralize the
  actual file reads/writes in the **side panel** and message results to the
  background worker, OR have the worker operate only on a handle whose permission
  is already `granted` (falling back to a side-panel re-grant prompt otherwise).
  The `FileStore` abstraction (§7.5) hides which context performs I/O.
- Keeping the content script free of secrets and network access limits the blast
  radius if a job page is hostile.

---

## 6. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | **TypeScript** (strict) | Shared types across all contexts |
| UI | **React 18** | Side panel + options page |
| Build | **Vite + CRXJS plugin** | MV3 bundling, HMR for extension dev |
| Manifest | **Manifest V3** | Service worker, `sidePanel`, `scripting` |
| State (UI) | React state + lightweight store (e.g. Zustand) | Keep deps minimal |
| Styling | CSS Modules or Tailwind (impl. choice) | Side panel is narrow; design for it |
| Markdown parse | `unified`/`remark` or a small custom parser | For profile & Q&A parsing |
| Storage (data) | **File System Access API** | Markdown + JSON in chosen folder |
| Storage (handles/config cache) | `chrome.storage.local` + IndexedDB | Persist dir handle + non-secret config |
| LLM SDKs | Provider REST APIs via `fetch` | Avoid heavy SDKs; thin adapters |
| Testing | Vitest (unit) + Playwright (e2e on fixture pages) | See §19 |
| Lint/format | ESLint + Prettier | |

**Rationale for D14:** React + Vite + CRXJS is the most assistant-friendly and
well-trodden MV3 stack, with strong typing and a good developer loop. The side
panel is a non-trivial UI (review table, editable fields), which justifies a
component framework over vanilla.

---

## 7. Data Model & Knowledge Base

All persistent user data lives as files in a **single user-chosen folder** on
disk (the "data folder"), accessed via the File System Access API.

### 7.1 Folder layout

```
<data-folder>/
├── profiles/
│   ├── ml-engineer.md
│   ├── data-analyst.md
│   └── ...                # one markdown file per named profile
├── qa-bank.md             # reusable answers to custom questions
├── history.json           # application history (see §7.4)
└── settings.json          # non-secret app settings (see §7.6)
```

> **Secrets are NOT stored in the data folder.** LLM API keys live in
> `chrome.storage.local` (see §15.3), never in the plaintext markdown/JSON folder
> the user might sync or share.

### 7.2 Profile markdown schema

A profile is human-readable markdown with YAML frontmatter and well-known section
headings. The parser is tolerant: unknown sections are preserved and ignored;
missing sections are treated as empty. The headings below are the contract the
field-mapper relies on.

```markdown
---
profile_name: ML Engineer
target_role: Machine Learning Engineer
updated: 2026-06-03
---

# Personal Information
- Full name: <your-full-name>
- Email: <your-email>
- Phone: +92-3xx-xxxxxxx
- Location: City, Country
- Nationality: ...
- LinkedIn: https://linkedin.com/in/...
- GitHub: https://github.com/...
- Portfolio: https://...

# Professional Summary
One or two short paragraphs.

# Work Experience
## Senior ML Engineer — Acme Corp
- Location: City, Country
- Start: 2022-03
- End: present            # "present"/"current" => currently employed
- Employment type: Full-time
- Highlights:
  - Did X, improving Y by Z%.
  - ...

## ML Engineer — Beta Inc
- Location: ...
- Start: 2019-07
- End: 2022-02
- Highlights:
  - ...

# Education
## BSc Computer Science — Example University
- Start: 2015-09
- End: 2019-06
- Grade: 3.7/4.0          # store as written; mapper reformats per field
- Field of study: Computer Science

# Certifications
## AWS Certified Machine Learning – Specialty
- Issuer: Amazon Web Services
- Issued: 2023-05
- Expires: 2026-05
- Credential ID: ABC123
- URL: https://...

# Skills
- Languages: Python, SQL, TypeScript
- ML: PyTorch, scikit-learn, ...
- Cloud: AWS, GCP
- Tools: Docker, Git, ...

# Languages
- English: Professional
- Urdu: Native

# Projects            # optional
## Project Name
- URL: ...
- Summary: ...

# Preferences         # standard recurring facts (also usable by Q&A drafting)
- Work authorization: ...
- Visa status / sponsorship needed: ...
- Notice period: 1 month
- Willing to relocate: Yes
- Preferred locations: ...
- Salary expectation: ...
- Earliest start date: ...
```

**Date convention:** store as `YYYY-MM` (or `YYYY-MM-DD` when day matters), or the
literal `present`/`current` for ongoing roles. The mapper reformats to whatever the
target field expects (see §11.4).

### 7.3 Q&A bank schema (`qa-bank.md`)

Reusable answers to questions that are not plain profile fields. Markdown for
human editability; parsed into a list of entries. The Q&A bank is a **single file
shared across all profiles** (D20) — answers like work authorization, visa, and
notice period rarely differ by target role.

```markdown
# Q&A Bank

## Are you legally authorized to work in <country>?
- type: boolean
- tags: work-authorization, eligibility
- answer: Yes

## Do you now or in the future require visa sponsorship?
- type: boolean
- tags: visa, sponsorship
- answer: No

## What is your expected salary?
- type: text
- tags: salary, compensation
- answer: Negotiable / market rate for the role

## Why do you want to work here?
- type: long-text
- tags: motivation
- answer: |
  A reusable, profile-grounded paragraph...
```

Entry fields:
- **question** (the `##` heading) — the canonical phrasing.
- **type** — `text | long-text | boolean | number | select | date`.
- **tags** — keywords used for fuzzy/semantic matching to on-page questions.
- **answer** — the stored answer (for `select`, may list acceptable option
  synonyms).

Matching an on-page question to a bank entry uses (a) tag/keyword overlap and
fuzzy text match in the rules layer, then (b) LLM semantic match as fallback
(see §11.3). When no match exists and AI drafting is enabled, the LLM drafts an
answer **from the profile + bank only**; the user may **save the drafted answer
back** to the bank (writes a new `##` entry).

### 7.4 Application history schema (`history.json`)

```jsonc
{
  "version": 1,
  "applications": [
    {
      "id": "uuid",
      "url": "https://jobs.example.com/apply/12345",
      "url_normalized": "jobs.example.com/apply/12345",  // for dedupe (see §11.6)
      "company": "Example Corp",          // best-effort, may be null
      "role": "ML Engineer",              // best-effort, may be null
      "profile_used": "ml-engineer",
      "filled_at": "2026-06-03T10:15:00Z",
      "status": "filled",                 // filled | submitted-manually | abandoned
      "fields_filled": 23,
      "fields_flagged": 4
    }
  ]
}
```

`status` is best-effort: the tool knows when it filled a form; it cannot reliably
know the user clicked the site's submit button, so `submitted-manually` is set
only if the user marks it in the side panel.

### 7.5 Persisting File System Access

- On first run the user picks the data folder (a user gesture in the side panel).
- The returned `FileSystemDirectoryHandle` is stored in **IndexedDB** (handles are
  structured-cloneable; `chrome.storage` cannot store them).
- On later sessions the handle is retrieved, and the extension calls
  `queryPermission`. If permission is not `granted`, `requestPermission` MUST be
  called **from the side panel** (it needs user activation — §5.2); the panel
  shows a "Reconnect data folder" prompt.
- All reads/writes go through a small `FileStore` abstraction so the rest of the
  code is storage-agnostic (eases a future Firefox/export fallback) and so the
  caller need not know which context (panel vs worker) performs the I/O.

### 7.5.1 Write safety (avoid clobbering external edits)
Because the user may edit files in an external editor at any time (D7), the tool
MUST NOT blindly overwrite with a stale in-memory copy. On every write:
- **Re-read** the target file immediately before writing.
- For **append-style** changes (e.g. Q&A save-back), append to the freshly read
  content rather than rewriting from a cached copy.
- For **full-rewrite** changes (e.g. saving a structured profile from F1.3), show
  the diff/preview against the current on-disk content and require confirmation
  before overwriting; if the on-disk file changed since it was loaded, surface
  that to the user instead of silently clobbering.
- Writes SHOULD be atomic where possible (write to a temp file in the same folder,
  then rename) to avoid leaving a half-written file on failure.

### 7.5.2 Data file versioning
`history.json` and `settings.json` carry a `version` field. On load, if the
on-disk `version` is older than the app's current schema, the tool MUST run a
forward migration (and back up the original file as `*.bak`) before use; an
unknown/newer version is treated read-only with a warning rather than corrupted.

### 7.6 Settings schema (`settings.json`)
Non-secret settings (see §18 for the full reference). Secrets (API keys) are
stored separately in `chrome.storage.local`.

---

## 8. Functional Requirements

Each requirement has an ID. "MUST/SHOULD/MAY" per RFC-2119.

### F1 — Knowledge base management
- F1.1 The user MUST be able to select/create the on-disk data folder.
- F1.2 The user MUST be able to **create, rename, duplicate, and delete** named
  profiles (each a `.md` file under `/profiles`). Filenames are sanitized slugs of
  the profile name (the canonical name lives in frontmatter `profile_name`);
  slug collisions are de-duplicated (e.g. `-2` suffix). Delete MUST confirm.
- F1.3 The user MUST be able to **paste free text** (resume text, cert details,
  notes) and have the LLM **structure it into the profile markdown schema**
  (§7.2), shown as a diff/preview before saving.
- F1.4 The user MUST be able to **edit profile markdown directly** in the side
  panel, and externally in any editor (changes picked up on next read).
- F1.5 The tool MUST validate that a profile parses against the schema and warn on
  malformed sections without destroying user content.
- F1.6 The user MUST be able to **select the active profile** per application from
  the side panel.
- F1.7 The user MUST be able to view/edit the **Q&A bank** in the side panel.

### F2 — Field detection
- F2.1 On user trigger, the content script MUST scan the **active tab** for fillable
  fields: `<input>` (all relevant types), `<textarea>`, `<select>`, radio/checkbox
  groups, `contenteditable`, and common **custom widgets** (combobox/autocomplete,
  React-Select, date pickers).
- F2.2 For each field it MUST capture: a stable selector, visible **label** (via
  `<label>`, `aria-label`, `aria-labelledby`, placeholder, nearby text), `name`/
  `id`/`autocomplete` attributes, type, options (for selects/radios), `required`,
  and grouping (e.g. which "Experience #2" block it belongs to).
- F2.3 It MUST detect **repeatable sections** (e.g. "Add another experience") and
  the control that adds them (best-effort; see §11.5).
- F2.4 It MUST detect **file-upload fields** and classify them (resume / cover
  letter / other) by nearby labels.
- F2.5 It MUST detect **multi-step / wizard** forms (e.g. Workday) and the
  next/continue control where feasible (best-effort).

### F3 — Hybrid field mapping
- F3.1 The mapper MUST first apply **deterministic rules** (label/attribute/
  autocomplete heuristics) to map common fields (name, email, phone, location,
  links, simple dates).
- F3.2 Unmatched or low-confidence fields MUST be sent to the **LLM** with the
  field metadata + relevant profile context for mapping (see §11.3, §12).
- F3.3 Each mapping result MUST carry a **source** (`rule | profile | qa | llm |
  blank`) and a **confidence** flag (`high | medium | low`).
- F3.4 The mapper MUST **never fabricate** factual data not present in the profile/
  Q&A bank. If a value is unknown, it returns `blank` and flags the field. (LLM
  may only rephrase/format existing facts and draft answers to open-ended
  questions grounded in profile content.)
- F3.5 Values MUST be reformatted to match the target field's expected format
  (date formats, split month/year selects, option synonyms — see §11.4).

### F4 — Custom question handling
- F4.1 For non-resume questions, the tool MUST first try to match a **Q&A bank**
  entry (rules then LLM semantic match).
- F4.2 On no match, if AI drafting is enabled, it MUST **draft an answer** grounded
  in the profile + bank, flagged `medium`/`low` confidence for review.
- F4.3 The user MUST be able to **edit** any drafted/matched answer and optionally
  **save it back** to the Q&A bank.
- F4.4 The tool MUST NOT answer a custom question with invented facts (e.g. a
  specific years-of-experience number not derivable from the profile); such cases
  are flagged for the user.

### F5 — Fill & review (side panel)
- F5.1 After mapping, the side panel MUST show a **review table**: field label,
  proposed value (editable), source, confidence, required flag, and an include/
  skip toggle.
- F5.2 Fields MUST be grouped to mirror the form (Personal, Experience #1, …).
- F5.3 The user MUST be able to edit any value before applying.
- F5.4 An **"Apply to page"** action MUST write the approved values into the live
  form using the correct event dispatch (see §11.7), reporting per-field success/
  failure.
- F5.5 The panel MUST clearly list **flagged items** the user must handle manually
  (blanks, low-confidence, upload fields, captcha — see §13/§14).
- F5.6 The tool MUST NOT click the site's submit button. It MAY offer a
  **"Mark as submitted"** control that updates history (F7).
- F5.7 The user MUST be able to **re-run** mapping (e.g. after navigating to the
  next wizard step).

### F6 — File-upload flagging
- F6.1 Detected upload fields MUST be surfaced as flagged items with their detected
  purpose (resume/cover letter/other).
- F6.2 The tool MUST NOT attempt to set file inputs programmatically. It MAY display
  a reminder of which file the user intends to use (a configurable note/path
  string only — no automated attachment).

### F7 — Application history & dedupe
- F7.1 On apply, the tool MUST record an entry in `history.json` (§7.4).
- F7.2 Before/at fill time, the tool MUST check for a likely **duplicate**
  (normalized URL match, or company+role match) and **warn** the user.
- F7.3 The user MUST be able to browse/search history and update an entry's status
  (e.g. mark submitted, abandoned).

### F8 — LLM provider configuration & fallback
- F8.1 The user MUST be able to configure **multiple providers** (OpenAI, Gemini,
  Anthropic, plus an OpenAI-compatible "custom" endpoint) with per-provider API
  key, model name, and base URL.
- F8.2 The user MUST be able to define an **ordered fallback chain** (default up to
  3; supports N).
- F8.3 On a provider failure (network, auth, rate-limit, timeout, server error,
  safety refusal), the tool MUST transparently try the **next** provider in order.
- F8.4 If **all** providers fail, the rules-only results MUST still be shown, with
  LLM-dependent fields flagged (see §14).
- F8.5 The user SHOULD be able to **test** each provider's connectivity from
  settings.

### F9 — Settings & onboarding
- F9.1 First-run onboarding MUST guide: pick data folder → create first profile →
  (optionally) add an LLM provider. The LLM step is **optional**: rules-only
  filling (Phase 1) works with no provider; a provider is required only for LLM
  mapping/drafting (Phase 2+). Onboarding should make this clear, not block on it.
- F9.2 Settings MUST cover providers/keys, fallback order, default profile, AI
  drafting on/off, autofill confidence threshold, and data-folder reconnection.

---

## 9. User Flows (Happy Path)

### 9.1 Onboarding / training
1. User installs the extension and clicks the icon → side panel opens.
2. Onboarding prompts: **pick data folder** (File System Access grant).
3. User creates a profile, e.g. "ML Engineer".
4. User **pastes resume text + cert details** into the "Build profile from text"
   box → LLM structures it → preview/diff → **Save** writes `ml-engineer.md`.
5. User opens **Settings**, adds an LLM provider (key + model) and optionally a
   2nd/3rd as fallback; clicks **Test**.
6. (Optional) User seeds the **Q&A bank** with common answers.

### 9.2 Apply to a generic external form
1. User navigates (in their normal session) to a job's external application page.
2. User clicks the extension icon → side panel opens; selects the **active
   profile**.
3. User clicks **Detect & Map**.
4. Content script detects fields → background runs hybrid mapping (rules + LLM
   fallback) → side panel shows the **review table** grouped by form section,
   plus a **flagged items** list (blanks, low-confidence, upload fields).
5. **Duplicate check** runs: if this URL/role looks already-applied, a warning
   banner appears.
6. User reviews/edits values, toggles any to skip, fixes flagged items.
7. User clicks **Apply to page** → values are written into the live form; per-field
   results reported.
8. User visually verifies the page, **attaches files manually**, completes any
   captcha, and **clicks the site's own submit**.
9. (Optional) User clicks **Mark as submitted** → history updated.

### 9.3 Apply to a multi-step ATS (e.g. Workday)
- Same as 9.2, but the form spans steps. After applying step 1 and clicking the
  site's "Next", the user clicks **Detect & Map** again for the new step. ATS
  adapters (where present) improve detection and value writing for that platform.

### 9.4 Update profile later
- User opens the profile in the side panel (or external editor), adds a new cert/
  skill (paste-and-structure or direct edit), saves. Next fill uses the update.

---

## 10. Data Flow

```
[Job page DOM]
   │  (1) content script: detect fields → DetectedField[]
   ▼
[Background worker]
   │  (2) load active profile + qa-bank from disk (FileStore)
   │  (3) rules mapper → resolved + unresolved fields
   │  (4) build LLM request for unresolved fields
   │        context = field metadata + relevant profile snippets + qa-bank
   │        (NO job description; NO secrets in content script)
   │  (5) LLM provider layer (ordered fallback) → mappings/drafts
   │  (6) merge → MappingResult[] with source+confidence
   ▼
[Side panel]
   │  (7) render review table + flagged items + dedupe warning
   │  (8) user edits/approves
   ▼
[Background → content script]
   │  (9) write approved values, dispatch DOM events, report results
   ▼
[Background]
   │  (10) append history entry; optional save-back to qa-bank
   ▼
[Disk] history.json / qa-bank.md updated
```

**What is sent to the LLM (D4/D15/§15):** only field labels/metadata and the
**relevant** profile/Q&A snippets needed to map them — never the page's job
description, never API keys, never the entire disk folder. Sent over HTTPS to the
provider the user configured.

---

## 11. Field Detection & Mapping Strategy

### 11.1 Detection
- Walk the DOM for fillable elements (F2.1). Skip hidden/disabled/`type=hidden`
  fields and honeypots (off-screen/`aria-hidden` traps).
- **Field identity:** each detected field gets a generated stable `fieldId`. The
  content script keeps an in-memory map `fieldId → live element` for the duration
  of a detect→apply cycle, and the serialized `DetectedField` sent to the
  background uses `fieldId` (not a CSS selector) as its key. Apply-to-page resolves
  values back to elements via this map (re-querying at write time per EC-14). A CSS
  `selector` is also recorded but only for diagnostics, since selectors can be
  ambiguous/unstable on dynamic pages.
- Resolve labels in priority order: associated `<label for>` → wrapping `<label>`
  → `aria-labelledby` → `aria-label` → preceding text node/heading → `placeholder`
  → `name`/`id` (de-camelCased) as last resort.
- Record `autocomplete` tokens (e.g. `given-name`, `email`, `tel`) — high-signal
  for rules.

### 11.2 Rules layer (deterministic, runs first)
- Match on `autocomplete` tokens, then normalized label/`name`/`id` against a
  dictionary of synonyms:
  - name → full/first/last/middle; email; phone; address/city/country/postal;
    LinkedIn/GitHub/portfolio URL; current title/company; years of experience
    (only if derivable); simple single dates.
- Output: high-confidence mappings; everything else passes to the LLM layer.

### 11.3 LLM layer (fallback)
- Input: array of unresolved fields (label, type, options, group) + a compact
  profile context + relevant Q&A entries.
- Task: return, per field, a value drawn **only** from provided context, the
  chosen source, and a confidence; or `blank` if unknown. For custom questions
  with no bank match, draft an answer grounded in context (if AI drafting on).
- Output is **structured JSON** (schema in Appendix C) validated before use;
  invalid output triggers one repair retry, then falls back to `blank`+flag.

### 11.4 Value formatting
- **Dates:** detect the field's expected format from `type=month`/`date`,
  placeholder/pattern (e.g. `MM/YYYY`), or adjacent split selects (month + year).
  Reformat the stored `YYYY-MM` accordingly. `present`/`current` maps to a
  "currently work here" checkbox when one exists, else to a sensible end value.
- **Selects/radios:** fuzzy-match the stored value to the closest available option
  text (with synonym table, e.g. "Bachelor's" ↔ "BSc" ↔ "Undergraduate");
  if no confident match, flag.
- **Numbers/booleans:** coerce from Q&A bank types.

### 11.5 Repeatable sections
- For experience/education lists, attempt to fill existing blocks in profile order.
- If there are fewer blocks than profile entries, the tool MAY click the detected
  "Add another" control to create more (best-effort, behind a setting). If adding
  blocks is unreliable on a given site, it fills what exists and **flags the
  remainder** for manual entry rather than risking a broken DOM.

### 11.6 Duplicate detection (history)
- Normalize URL: strip scheme, `www.`, query/fragment (configurable allowlist of
  significant query params per known ATS), trailing slash.
- Duplicate if normalized URL matches an existing entry, OR (company AND role)
  match within a recent window. Warn, don't block.

### 11.7 Writing values into live forms (critical)
Modern forms (React/Vue/Angular) ignore naïve `element.value = x`. The content
script MUST:
- For text inputs/textareas: set the value via the **native setter**
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`) then
  dispatch `input` and `change` events (bubbling), plus `focus`/`blur` where the
  framework relies on them.
- For `<select>`: set value/selectedIndex and dispatch `change`.
- For checkboxes/radios: set `checked` and dispatch `click`/`change` as needed.
- For **custom comboboxes/autocompletes**: simulate `focus` → type → wait for the
  option list → select the matching option via click/keyboard. This is inherently
  fragile; failures are reported per-field, not silently dropped.
- Respect `maxlength`, required, and disabled states. Never write to disabled/
  readonly fields.

### 11.8 ATS adapters
- An adapter interface lets platform-specific modules override detection,
  label-resolution, repeatable-section handling, and value-writing for Workday,
  Greenhouse, Lever, iCIMS, Taleo, and Bayt. Adapters are selected by URL/DOM
  fingerprint. Absence of an adapter falls back to the generic engine.

---

## 12. LLM Provider Layer

### 12.1 Abstraction
A single `LLMProvider` interface with thin per-provider adapters:

```ts
interface LLMProvider {
  id: string;                  // "openai" | "gemini" | "anthropic" | "custom"
  name: string;
  complete(req: LLMRequest): Promise<LLMResponse>; // JSON-structured output
}
```

- Adapters call provider REST endpoints via `fetch`; no heavy SDKs.
- Each adapter normalizes to a common request (system + user prompt, JSON schema/
  response-format hint, temperature low for determinism) and response (text/JSON,
  token usage, error classification).
- A **"custom" OpenAI-compatible** provider covers self-hosted/other gateways
  (and a future local model via an OpenAI-compatible server) without new code.
- **One model per provider (D22).** Each provider is configured with a single
  model used for **both** field mapping and answer drafting. Default temperature is
  **low** (deterministic mapping); configurable per provider. No separate
  mapping/drafting model fields in v1.

### 12.2 Fallback chain
- Config: ordered list of `providerId`s, default length 3, supports N. Each
  provider's model/key/baseUrl come from its own config (§18) — the chain holds
  only the order, not duplicated model fields.
- Execution: try provider[0]; on **any** failure move to provider[1], etc. Failure
  classes (all advance to the next provider):
  - **Retryable:** network error, 429 rate-limit, 5xx, timeout (per-call, e.g.
    30s), safety refusal, invalid/unparseable output after one repair attempt.
  - **Config error (401/403 invalid key):** also advance to the next provider, and
    additionally **surface** the bad-key state in Settings so the user can fix it
    (consistent with EH-3).
- If all fail → return rules-only result; flag LLM-dependent fields; show a clear
  error toast (§14, EH-1).
- All attempts/outcomes logged to an in-memory/debug log (no PII beyond what was
  already in the request; redact keys).

### 12.3 Cost & token control
- Batch unresolved fields into as few calls as practical.
- Send **compact** profile context (only relevant sections), not the whole file.
- Expose token/usage estimates in the debug log; respect a configurable max field
  batch size.

---

## 13. Edge Cases

| ID | Edge case | Expected handling |
|---|---|---|
| EC-1 | No fillable fields detected | Inform user "no form fields found"; offer re-scan |
| EC-2 | Form inside an **iframe** (cross-origin) | Detect iframe; if same-origin, traverse; if cross-origin, inform user it can't be filled and why |
| EC-3 | **Shadow DOM** components | Traverse open shadow roots; closed roots → flag as unfillable |
| EC-4 | Multi-step wizard | Fill current step; prompt user to advance and re-run (§9.3) |
| EC-5 | Repeatable sections with fewer blocks than entries | Fill existing; optionally add blocks; otherwise flag remainder (§11.5) |
| EC-6 | Custom date pickers (calendar widgets) | Try typing into the input; if it only accepts picker interaction, attempt picker, else flag |
| EC-7 | Split date selects (separate month/year) | Map each sub-field via §11.4 |
| EC-8 | Select option not present for stored value | Fuzzy-match; if none, leave blank + flag with the available options listed |
| EC-9 | Field value exceeds `maxlength` | Truncate to limit, flag that it was truncated |
| EC-10 | Required field with no profile data | Leave blank, flag prominently as required-unfilled |
| EC-11 | Question asking a fact not in profile (e.g. exact years with tool X) | Do **not** fabricate; flag for user (F4.4) |
| EC-12 | Duplicate application | Warn before/at fill (F7.2); user may proceed |
| EC-13 | Page **navigates/reloads** mid-flow | Detect via content-script lifecycle; invalidate stale mappings; prompt re-scan |
| EC-14 | DOM mutates after detection (lazy fields) | Re-query at write time; if a target is gone, report per-field failure |
| EC-15 | **Captcha / reCAPTCHA / hCaptcha** present | Detect; never attempt to solve/bypass; flag for manual completion |
| EC-16 | **Login wall / session expired** on the page | Detect typical patterns; inform user to log in; do not handle credentials |
| EC-17 | Anti-bot / rate-limit page | Stop; inform user; do nothing evasive (§16) |
| EC-18 | Honeypot/hidden trap fields | Skip; never fill hidden/off-screen decoys |
| EC-19 | File System Access permission **revoked** between sessions | Prompt "Reconnect data folder" (§7.5) |
| EC-20 | Profile markdown malformed/partially edited | Parse leniently; warn; never overwrite/lose user content |
| EC-21 | Two profiles or many certs/experiences (large profile) | Send only relevant compact context to LLM (§12.3) |
| EC-22 | **MV3 service worker terminated** mid-operation | Make operations resumable/idempotent; persist in-flight state to `chrome.storage`/IndexedDB; the side panel can re-trigger |
| EC-23 | Very long form → many LLM fields | Batch + show progress; allow partial review before all done |
| EC-24 | RTL/Arabic content (out of v1 scope) | Detect non-English; inform user it's unsupported in v1 rather than mis-filling |
| EC-25 | Numeric/locale formats (e.g. phone/postal) | Pass through as stored; flag if field pattern rejects it |
| EC-26 | Side panel closed mid-review | Preserve mapping state so reopening restores it (within session) |
| EC-27 | Multiple forms on one page | Detect the most likely application form (most fields / nearest submit); let user switch target if ambiguous |
| EC-28 | User edits profile externally during a session | Re-read from disk at fill time so latest content is used (§7.5.1) |
| EC-29 | User switches browser tabs while the side panel is open | Bind a mapping session to its originating tab id; if the active tab differs at apply time, warn and require re-detect rather than writing to the wrong page |
| EC-30 | External edit changed the file between load and save | Detect via re-read before write; surface the conflict instead of clobbering (§7.5.1) |

---

## 14. Error Handling

| ID | Condition | Behaviour | User feedback |
|---|---|---|---|
| EH-1 | All LLM providers fail | Return rules-only mappings; flag LLM-dependent fields | Toast: "AI unavailable — filled basics only; N fields need you." + retry button |
| EH-2 | Single provider fails (retryable) | Silently fall to next in chain | Debug log entry only |
| EH-3 | Invalid/expired API key (401/403) | Mark provider unhealthy; try next | Settings shows provider error; non-blocking toast |
| EH-4 | LLM returns malformed JSON | One repair retry; then `blank`+flag those fields | Affected fields flagged "couldn't map" |
| EH-5 | Content script injection blocked (e.g. chrome:// or store pages) | Abort with explanation | "Can't run on this page." |
| EH-6 | File read/write failure | Abort the write op; keep prior data intact | "Couldn't save — folder access lost?" + reconnect |
| EH-7 | Data folder not selected/connected | Block features needing it; prompt setup | Onboarding/reconnect prompt |
| EH-8 | Field write fails (element gone/disabled) | Report per-field failure; continue others | Per-field ✗ in review table |
| EH-9 | Network offline | Skip LLM (EH-1 path); rules still run | "Offline — basics only." |
| EH-10 | Rate-limited across all providers | EH-1 path; suggest retry later | "Rate-limited — try again shortly." |
| EH-11 | Per-call LLM timeout (e.g. 30s) | Treat as retryable failure (EH-2/EH-1) | Progress indicator times out gracefully |
| EH-12 | Profile parse error | Lenient parse; warn; proceed with what parsed | "Profile has issues in section X." |
| EH-13 | Unexpected/uncaught error | Fail safe: never auto-submit, never corrupt files; log | Generic error toast + "report details" (local log) |

**Global safety invariants:**
- The tool MUST NEVER click a site's submit button (D3).
- The tool MUST NEVER write fabricated factual data (F3.4/F4.4).
- The tool MUST NEVER attempt captcha/anti-bot evasion (EC-15/EC-17/§16).
- The tool MUST NEVER overwrite user files destructively on error (EH-6/EH-12).

---

## 15. Security & Privacy

- **15.1 Local-first.** All profile, Q&A, and history data stays on the user's
  disk. No cloud sync, no telemetry, no analytics, no external service other than
  the user-configured LLM provider(s).
- **15.2 Minimal LLM exposure.** Only field metadata + relevant profile/Q&A
  snippets are sent to the LLM, over HTTPS, to the provider the user chose. The
  job description is **not** sent (D15). Users should understand that PII in those
  snippets transits to their chosen provider; this is disclosed in onboarding.
- **15.3 Secret storage.** API keys live in `chrome.storage.local` (sandboxed to
  the extension), **never** in the plaintext data folder and never in the content
  script. Keys are only used in the background worker. Provide a "clear keys"
  action. Document the residual risk that `chrome.storage.local` is not encrypted
  at rest; offer an optional "session-only key" mode (keys held in memory, not
  persisted) for higher-security users.
- **15.4 Content-script isolation.** The content script holds no secrets and makes
  no network requests; it only reads/writes the DOM on user action.
- **15.5 Least privilege.** Use `activeTab` + on-demand `scripting.executeScript`
  triggered by user action for generic sites; request `host_permissions` only for
  the specific known-ATS domains that ship adapters (§17). No broad `<all_urls>`
  content-script auto-injection.
- **15.6 No credential handling.** The tool never reads, stores, or types login
  credentials; it relies on the user's existing browser session.
- **15.7 Data portability/erasure.** Because data is plain files, the user can
  back up, move, or delete it freely. Provide an in-app "delete all local data"
  that also clears keys and history.

---

## 16. Legal / Terms-of-Service Considerations

- **Assistive, not autonomous.** The tool fills the form the user is already
  viewing and stops; the user reviews and submits. It does not crawl, scrape at
  scale, mass-apply, navigate sites autonomously, or evade anti-automation
  measures.
- **LinkedIn excluded (N1).** LinkedIn's ToS restrict automated interaction; Easy
  Apply automation is intentionally out of scope to protect the user's account.
- **Respect site terms.** Known-ATS adapters operate within normal user
  interaction patterns. The tool must never bypass captchas/anti-bot systems
  (EC-15/EC-17).
- **Accuracy is the user's responsibility.** The user reviews every value before
  submitting; the tool never fabricates facts. Include a short disclaimer in
  onboarding that the user is responsible for the truthfulness of submitted data.

---

## 17. Permissions (Manifest V3)

| Permission | Why |
|---|---|
| `sidePanel` | Primary UI / review surface (D13) |
| `scripting` | Inject the content script on user action (generic sites) |
| `activeTab` | Access the current tab on user gesture without broad host perms |
| `storage` | Persist non-secret config + API keys (`chrome.storage.local`) + dir-handle bookkeeping |
| `host_permissions` (scoped) | Only for known-ATS adapter domains (Workday/Greenhouse/Lever/iCIMS/Taleo/Bayt) where a persistent content script improves reliability |

- The **File System Access API** needs **no manifest permission** but requires a
  user gesture; the directory handle is persisted in IndexedDB with re-grant on
  demand (§7.5).
- **Avoid** `<all_urls>` auto-injection; prefer on-demand injection for the long
  tail of generic career sites.

---

## 18. Settings Reference

`settings.json` (non-secret) + `chrome.storage.local` (secrets) cover:

- **Data folder:** connected handle status; reconnect action.
- **Profiles:** list; default/active profile.
- **LLM providers:** array of `{ id, name, model, baseUrl }` — **one model per
  provider, used for both mapping and drafting** (D22) (+ key stored in
  `chrome.storage.local`, keyed by provider id).
- **Fallback chain:** ordered list of provider ids (default ≤3, supports N).
- **AI drafting:** on/off (F4.2).
- **Autofill behaviour:** confidence threshold for auto-including vs flagging —
  **default: auto-include `high`, flag `medium`/`low`** (D23); whether to auto-add
  repeatable blocks (§11.5, **default off**).
- **Dedupe:** sensitivity window; significant-query-param allowlist (§11.6).
- **Key persistence mode:** persisted vs session-only (§15.3).
- **Per-call LLM timeout** and **max field batch size** (§12.3).

---

## 19. Testing & Acceptance Criteria

### 19.1 Unit (Vitest)
- Profile parser: valid, partial, malformed inputs (lenient, non-destructive).
- Q&A parser and matcher (tags/fuzzy).
- Rules mapper: synonym/autocomplete coverage.
- Value formatters: date reformats, split selects, option fuzzy-match, maxlength.
- LLM response validation + repair-retry.
- Fallback chain: each error class routes correctly; all-fail → rules-only.
- URL normalization / dedupe.

### 19.2 Integration / E2E (Playwright on local fixture pages)
- A suite of **fixture HTML forms** mimicking: a plain form, a React controlled
  form, split-date form, custom combobox, multi-step wizard, repeatable sections,
  file-upload field, captcha placeholder, iframe form, shadow-DOM form.
- Assert correct detection, value writing **with proper event dispatch** (React
  state actually updates), flagging behaviour, and that **submit is never
  clicked**.
- Adapter smoke tests against saved DOM snapshots of each known ATS (no live
  network; avoids ToS issues in CI).

### 19.3 Key acceptance criteria (samples)
- AC-1: Given a populated profile and a plain form, ≥90% of standard fields
  (name/email/phone/links/title/company) fill correctly via **rules alone**.
- AC-2: A React controlled input retains the written value after blur (event
  dispatch verified).
- AC-3: An unknown required field is left blank and **flagged**, never fabricated.
- AC-4: With the primary provider forced to fail, mapping completes via the next
  provider; with all failing, rules-only results still render with flags.
- AC-5: The tool never triggers the fixture form's submit handler.
- AC-6: Re-running on a duplicate URL shows the duplicate warning.
- AC-7: Editing the profile `.md` externally is reflected on the next fill.

---

## 20. Resolved Decisions & Defaults

All previously open questions are resolved. No blocking decisions remain for
implementation. The items below are settled defaults (override later via settings
where noted). They are listed for traceability.

- **R1.** API keys persisted in `chrome.storage.local`, with an opt-in
  **session-only** mode for higher security (§15.3).
- **R2.** Q&A bank is a **single file shared across all profiles** (D20, §7.3).
- **R3.** "Preferences" (salary, notice, relocation, work auth) live in the
  profile **and** seed Q&A answers; the Q&A bank holds the canonical question
  phrasings used to match on-page questions (§7.2, §7.3).
- **R4.** Fallback chain default length **3**; UI allows adding more (D6, §12.2).
- **R5.** Repeatable-section auto-adding is **off by default** (flag the
  remainder); user can enable it in settings (§11.5, §18).
- **R6.** The **custom / OpenAI-compatible provider** is the path for any future
  local model; no separate local-LLM runtime is built in v1 (§12.1).
- **R7.** Application `status` is **mostly user-marked**, since the tool cannot
  reliably detect the site's own submit click (§7.4, F5.6).
- **R8.** First ATS adapter is **Workday**, then Greenhouse/Lever/iCIMS/Taleo/Bayt
  (D19, §21).
- **R9.** **One model per provider**, used for both mapping and drafting; default
  low temperature; configurable (D22, §12.1, §18). No opinionated default model
  name is hard-coded — the user sets the model string per provider; the tool ships
  with empty/placeholder values and a "Test" action.
- **R10.** Cover letters are **not stored or generated** in v1 (D21, N10).
- **R11.** Autofill threshold default: **auto-include `high`-confidence** values,
  **flag `medium`/`low`** for review; threshold is configurable (D23, §18).

### Notes for the implementer (non-blocking)
- Provider model strings change over time; ship them empty with inline help
  rather than hard-coding model names that may be retired.
- The Workday adapter is the canonical hard case — design the generic engine's
  detection/value-writing interfaces so the adapter only *overrides*, not
  *replaces*, core logic.

---

## 21. Phased Roadmap

**Phase 0 — Foundations**
- Extension skeleton (MV3, side panel, background, content script), TS types,
  build/dev loop (Vite/CRXJS), File System Access `FileStore`, settings + secret
  storage.

**Phase 1 — MVP (generic engine, single happy path)**
- Profile create/edit + paste-to-structure; multiple profiles.
- Field detection + **rules mapper**; review table; apply-to-page with correct
  event dispatch; upload-field flagging; **no LLM yet** (rules-only).
- Application history + dedupe.
- *Exit criteria:* AC-1, AC-2, AC-3, AC-5, AC-6, AC-7 pass on fixtures.

**Phase 2 — LLM layer**
- Provider abstraction + 3 providers (OpenAI, Gemini, Anthropic) + custom; ordered
  fallback; LLM mapping fallback; Q&A bank + AI drafting; structured-output
  validation.
- *Exit criteria:* AC-4 passes; flagged/edited/save-back flows work.

**Phase 3 — ATS adapters & robustness**
- Adapter interface + **first adapter: Workday** (D19), then Greenhouse/Lever/
  iCIMS/Taleo/Bayt; multi-step wizard re-scan; custom date pickers/comboboxes;
  shadow DOM; resumability for MV3 worker termination.

**Phase 4 — Polish**
- Onboarding flow, settings UX, history browser, provider test/health, debug log,
  "delete all local data".

**Future (post-v1, parked):**
- LinkedIn Easy Apply module (with ToS review), multilingual/RTL support, Edge/
  Firefox (with storage fallback), JD-aware tailoring + cover-letter generation,
  PDF/DOCX import.

---

## 22. Glossary

- **ATS** — Applicant Tracking System (Workday, Greenhouse, Lever, iCIMS, Taleo …).
- **Profile** — a named markdown file describing the user, used to fill forms.
- **Q&A bank** — reusable answers to recurring non-resume questions.
- **Rules layer** — deterministic field mapping by label/attribute heuristics.
- **LLM fallback** — AI mapping/drafting for fields rules can't resolve.
- **Fallback chain** — ordered list of LLM providers tried in turn on failure.
- **Adapter** — platform-specific module overriding generic detection/writing.
- **Flagged item** — a field the tool intentionally leaves for the user (blank,
  low-confidence, upload, captcha, unknown fact).

---

## 23. Appendices

### Appendix A — Example minimal profile
See the schema in §7.2; a real profile follows that exact heading structure.

### Appendix B — Internal types (illustrative)

```ts
type FieldType =
  | 'text' | 'textarea' | 'email' | 'tel' | 'url' | 'number'
  | 'date' | 'month' | 'select' | 'radio' | 'checkbox'
  | 'combobox' | 'file' | 'contenteditable' | 'unknown';

interface DetectedField {
  fieldId: string;           // generated stable id; key across detect→apply (§11.1)
  selector?: string;         // diagnostic only; may be ambiguous on dynamic pages
  label: string;             // best-resolved human label
  name?: string; id?: string; autocomplete?: string;
  type: FieldType;
  options?: string[];        // for select/radio/combobox
  required: boolean;
  group?: string;            // e.g. "experience#2"
  maxLength?: number;
  isUpload?: boolean;
  uploadKind?: 'resume' | 'cover-letter' | 'other';
}

type MappingSource = 'rule' | 'profile' | 'qa' | 'llm' | 'blank';
type Confidence = 'high' | 'medium' | 'low';

interface MappingResult {
  field: DetectedField;
  value: string | boolean | number | null;
  source: MappingSource;
  confidence: Confidence;
  needsReview: boolean;
  note?: string;             // e.g. "truncated", "no matching option"
  include: boolean;          // user toggle (default = !needsReview)
}
```

### Appendix C — LLM structured-output contract (illustrative)

```jsonc
// Request (per batch): fields[] + compact profileContext + qaEntries[]
// Response (validated):
{
  "results": [
    {
      "fieldId": "f_17",            // matches DetectedField.fieldId (§11.1)
      "value": "03/2022",
      "source": "profile",          // profile | qa | llm | blank (never "rule")
      "confidence": "high",         // high | medium | low
      "note": null
    }
  ]
}
```
Rules: values must derive only from provided context; unknown → `value:null`,
`source:"blank"`. Invalid JSON → one repair retry → blank+flag.

### Appendix D — Rules synonym dictionary (seed list)
Name/first/last/middle; email; phone/mobile; address/street/city/state/
country/zip/postal; LinkedIn/GitHub/portfolio/website; current title/position/
role; current/most-recent company/employer; start/from date; end/to date;
graduation date; GPA/grade/score/marks; degree/qualification; field/major;
institution/university/school; certification/credential; skills; languages;
years of experience; notice period; salary/expected compensation; work
authorization/eligibility; visa/sponsorship; relocation; availability/start date.
*(Extended during implementation; LLM covers the long tail.)*

---

*End of SPEC.md v0.2.*
