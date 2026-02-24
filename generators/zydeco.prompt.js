export const rewritePoemPrompt = ({ poem }) => {
	return `
You are a poem-rewriter. Rewrite the INPUT POEM into a new poem that is clear, grammatical, and readable while preserving its vivid, unusual vocabulary and emotional movement.

INTENT
- Reduce syntactic opacity caused by overly dense or contorted poetic form.
- Preserve striking, strange, and colorful word choices whenever possible.
- When necessary for clarity, you may adjust a word’s case, tense, number, or part of speech—but do not replace it unless clarity truly requires it.

GOAL
- Produce a poem that “says the same thing” as the input with similar length and intensity.
- Favor coherence first, color second, form third.
- The poem should feel more open and breathable, not explained or flattened.

RULES
- Output ONLY the poem text. No title. No commentary. No analysis.
- 8–24 lines total.
- Do NOT introduce new themes, symbols, or ideas.
- Prefer straightforward sentence construction over compressed or elliptical phrasing.
- Keep imaginative nouns, verbs, and adjectives even if they are unusual or surreal.
- You may:
  - normalize capitalization when it appears arbitrary
  - re-order phrases to improve readability
  - split or merge lines to follow punctuation and sentence sense
- You may NOT:
  - paraphrase into prose
  - explain meaning
  - remove strangeness solely to sound “safe” or generic
- Avoid meta language (e.g., “this poem,” “it suggests,” “the speaker”).

FORMAT
- Plain text poem only.
- Line breaks should follow sentence structure and punctuation; avoid decorative or purely rhythmic breaks.
- Output length should roughly match input length.

LINE BREAK GUIDANCE
- Do NOT split sentences across lines solely for visual or poetic effect.
- Line breaks must be justified by punctuation, clause boundaries, or a clear change in thought.
- Prefer complete sentences or complete clauses per line.
- Avoid dangling infinitives, stranded prepositions, or single-line fragments unless they carry independent meaning.


INPUT POEM:
<<<
${poem}
>>>
`;
};

const defaultStyle = `
   - must be modern, contemporary, and clean.
   - Avoid painterly kitsch, fantasy cliché, or Thomas Kinkade–style lighting
   - Prefer editorial illustration, neo-surrealism, cinematic lighting
   - Restrained color palette, subtle grain, crisp detail
   - Artistic license is encouraged; decorative excess is not
   - avoid AI-generated look and AI-slop
`.trim();

export const imagePoemPrompt = ({ poem, style = defaultStyle }) => `
Create a high-quality image from the poem provided below. Leave room at the bottom for me to annotate the image later.

CRUCIAL INSTRUCTION: leave the lower 1/5 of the image blank.  Only use the top 4/5 of the image!

CORE REQUIREMENTS:

1. IMPORTANT: Leave space near the BOTTOM 1/5 of the image for the poem text to be added later.  Do not include ANY text in this image!

2. Composition:
   - Strong focus on key subjects
   - Secondary symbolic elements that support the poem without overwhelming it
   - Intentional negative space and balanced framing


STYLE:
${style}

POEM:
${poem}
`;
