import type { FallbackChain } from './llm/fallback'

const PROFILE_SCHEMA = `---
profile_name: <Name>
target_role: <Target Role>
updated: <YYYY-MM-DD>
---

# Personal Information
- Full name:
- Email:
- Phone:
- Location:
- LinkedIn:
- GitHub:

# Professional Summary
<2-3 sentences>

# Work Experience
## <Title> — <Company>
- Location:
- Start: YYYY-MM
- End: YYYY-MM or present
- Employment type: Full-time
- Highlights:
  - <achievement>

# Education
## <Degree> — <Institution>
- Start: YYYY-MM
- End: YYYY-MM
- Grade:
- Field of study:

# Certifications
## <Cert Name>
- Issuer:
- Issued: YYYY-MM
- Expires: YYYY-MM

# Skills
- Languages:
- Frameworks:
- Cloud:
- Tools:

# Languages
- English: Professional

# Preferences
- Work authorization:
- Visa status / sponsorship needed:
- Notice period:
- Willing to relocate:
- Salary expectation: `

export async function structureProfileText(
  rawText: string,
  targetRole: string,
  chain: FallbackChain,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10)
  const res = await chain.complete({
    systemPrompt: `You convert raw resume/profile text into a structured markdown profile.
Rules:
- Use ONLY facts explicitly stated in the raw text. Never add, infer, or invent details.
- Follow the schema exactly. Use YYYY-MM for dates. Use "present" for current roles.
- If a field is not mentioned in the raw text, leave it blank (the dash and key, but empty value).
- Return ONLY the markdown. No preamble, no explanation, no code fences.`,
    userPrompt: `Target role: ${targetRole || 'Not specified'}
Today's date: ${today}

Schema to fill:
${PROFILE_SCHEMA}

Raw text to convert:
${rawText}

Return the completed profile markdown:`,
    maxTokens: 2048,
  })

  let md = res.content.trim()
  // Strip code fences if present
  md = md.replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '')
  return md
}
