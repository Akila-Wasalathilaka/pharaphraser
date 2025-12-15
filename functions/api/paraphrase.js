export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const text = body.text;
    const tone = body.tone || "standard";

    // ---------- INPUT VALIDATION ----------
    if (!text || typeof text !== "string" || text.length > 2000) {
      return json({ error: "Invalid input text" }, 400);
    }

    const allowedTones = ["standard", "simple", "professional", "academic"];
    if (!allowedTones.includes(tone)) {
      return json({ error: "Invalid tone" }, 400);
    }

    if (!env.GEMINI_API_KEY) {
      return json(
        { error: "GEMINI_API_KEY is missing in environment variables" },
        500
      );
    }

    // ---------- GEMINI CALL WITH FULL ERROR HANDLING ----------
    async function callGemini(prompt, stage = "unknown") {
      let res, data;

      try {
        res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
            env.GEMINI_API_KEY,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          }
        );
      } catch (networkErr) {
        console.error(`[Gemini ${stage}] Network error`, networkErr);
        throw new Error("Failed to reach Gemini API (network error)");
      }

      try {
        data = await res.json();
      } catch {
        console.error(`[Gemini ${stage}] Invalid JSON response`);
        throw new Error("Gemini returned invalid JSON");
      }

      if (!res.ok) {
        console.error(`[Gemini ${stage}] API error`, {
          status: res.status,
          body: data
        });

        if (res.status === 401 || res.status === 403) {
          throw new Error("Gemini API key is invalid or unauthorized");
        }

        if (res.status === 429) {
          throw new Error("Gemini rate limit exceeded");
        }

        throw new Error(`Gemini API error (${res.status})`);
      }

      const output =
        data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!output) {
        console.error(`[Gemini ${stage}] Empty response`, data);
        throw new Error("Gemini returned empty content");
      }

      return output;
    }

    // ---------- STAGE 1: AGGRESSIVE REWRITE ----------
    const variationsRaw = await callGemini(
      `
REWRITE this text to be completely undetectable by AI detectors. Think like a real human writer.

CREATE THREE VERSIONS using these strict rules:

1. SENTENCE VARIETY (critical):
   - At least 2 very short sentences (3-7 words)
   - At least 2 long sentences (20+ words)
   - NO patterns - random mix of lengths
   - Start sentences in completely different ways

2. HUMAN PATTERNS:
   - Use casual connectors: "And", "But", "So" to start sentences sometimes
   - Add natural fillers: "actually", "basically", "really", "just"
   - Use contractions freely: don't, can't, it's, we're, I'm
   - Occasionally use incomplete thoughts that get completed

3. BREAK AI PATTERNS:
   - NEVER use: "furthermore", "moreover", "additionally", "consequently" 
   - AVOID: "significant", "utilize", "demonstrate", "implement"
   - NO bullet-point-like structures
   - NO parallel sentence structures (every sentence should be structurally different)

4. WORD CHOICES:
   - Use simpler, everyday words
   - Choose unexpected but natural synonyms
   - Vary how you express ideas (don't repeat patterns)

5. FLOW:
   - Write like you're talking to someone
   - Some ideas flow naturally into the next, some don't
   - Not every transition needs to be perfect

OUTPUT: Three complete rewrites separated by |||. NO explanations.

TEXT:
${text}
`,
      "stage-1"
    );

    const variations = variationsRaw
      .split("|||")
      .map(v => v.trim())
      .filter(Boolean);

    if (variations.length < 3) {
      throw new Error("Gemini failed to generate 3 variations");
    }

    // ---------- STAGE 2: SELECT MOST HUMAN ----------
    const selectionRaw = await callGemini(
      `
You're an expert at detecting natural human writing vs AI patterns.

Which rewrite sounds MOST like authentic human writing?
Consider:
- Natural flow and rhythm
- Varied sentence structure
- Absence of AI patterns (overly formal, repetitive structures)
- Human-like word choices
- Natural transitions

Reply ONLY with the number 1, 2, or 3.

1. ${variations[0]}
2. ${variations[1]}
3. ${variations[2]}
`,
      "stage-2"
    );

    const choice = selectionRaw.trim();
    const index = ["1", "2", "3"].includes(choice)
      ? Number(choice) - 1
      : 0;

    let selected = variations[index];

    // ---------- STAGE 3: PATTERN DESTROYER ----------
    selected = await callGemini(
      `
AI DETECTORS look for patterns. Your job: DESTROY all patterns.

APPLY THESE FIXES:

1. SENTENCE LENGTH CHAOS:
   - Current text probably has similar-length sentences (AI habit)
   - FIX: Make some 4-5 words. Others 25+ words. Random mix.
   - Count the words - force variety

2. SENTENCE STARTERS:
   - Check: Do sentences start similarly? (The, It, This, etc.)
   - FIX: Start with different parts of speech - verbs, adverbs, conjunctions
   - Use "And", "But", "So" sometimes (humans do this, AI avoids it)

3. VOCABULARY DOWNGRADE:
   - Replace fancy AI words with normal ones:
   - "utilize" → "use"
   - "demonstrate" → "show" 
   - "significant" → "big" or "major"
   - "implement" → "do" or "put in place"
   - "furthermore" → "also" or "and"

4. ADD HUMAN QUIRKS:
   - Use contractions everywhere natural
   - Add emphasis words: "really", "actually", "pretty", "quite"
   - Occasional casual phrasing
   - Not every sentence needs perfect transitions

5. RHYTHM BREAKING:
   - AI loves: statement, statement, statement
   - Humans use: short punch. Long explanation that flows. Medium followup.
   - Mix it completely randomly

6. REMOVE:
   - All adverbs ending in -ly if possible
   - Perfect parallel structures  
   - Overly formal tone
   - Academic-sounding phrases

Write like a human blogs or talks, not like AI writes essays.

OUTPUT: Refined text only.

TEXT:
${selected}
`,
      "stage-3"
    );

    // ---------- STAGE 4: TONE + FINAL HUMANIZATION ----------
    let final = await callGemini(
      `
Apply a ${tone} tone while keeping the text authentically human.

Final polish checklist:
- Ensure natural, conversational flow
- Remove any remaining robotic patterns
- Vary sentence openings
- Mix sentence complexity (some simple, some complex)
- Use natural human phrasing for the ${tone} tone
- Keep it genuine - humans aren't perfect writers
- Avoid AI red flags: overly formal language, repetitive structures, excessive politeness

If tone is "simple": Use everyday words, short sentences, clear and direct
If tone is "professional": Confident and clear, but still conversational 
If tone is "academic": Formal but not robotic, use discipline-appropriate language
If tone is "standard": Natural middle ground, like a good blog post

Output ONLY the final polished text.

TEXT:
${selected}
`,
      "stage-4"
    );

    // ---------- STAGE 5: FINAL HUMANIZATION PASS ----------
    final = await callGemini(
      `
FINAL CHECK: Make this text 100% undetectable.

AI DETECTION KILLER TECHNIQUES:

1. EXTREME SENTENCE VARIATION:
   - Shortest sentence: 3-5 words MAX
   - Longest sentence: 25-35 words
   - Create UNPREDICTABLE pattern: short, long, medium, short, very long, medium, etc.
   - No two consecutive sentences should be similar length

2. WORD UNPREDICTABILITY:
   - Where AI would say "important" → say "key" or "crucial" or "big deal"
   - Where AI would say "however" → say "but" or "though" or just start new sentence
   - Use everyday words, not formal ones
   - Occasionally use colloquial expressions if appropriate

3. STRUCTURE CHAOS:
   - Mix simple sentences with complex ones randomly
   - Some sentences with commas and clauses, others without
   - Vary how you connect ideas (sometimes with connectors, sometimes just new sentences)
   - Break expected patterns

4. HUMAN TOUCHES:
   - Contractions in at least 30% of opportunities
   - Start at least one sentence with "And", "But", or "So"
   - Use personal pronouns naturally (we, you, I if appropriate)
   - Add subtle emphasis: "really", "actually", "definitely"

5. TONE CHECK (${tone}):
   - Simple: Talk like a friend explaining something
   - Professional: Confident but conversational, not corporate
   - Academic: Scholarly but not robotic or overly formal
   - Standard: Natural blog-post style

6. FINAL SCAN:
   - Count words in each sentence - are they varied enough?
   - Read aloud - does it sound like a human or AI?
   - Any repeated sentence patterns? BREAK THEM.

OUTPUT: The final humanized text.

TEXT:
${final}
`,
      "stage-5"
    );

    // ---------- STAGE 6: AI DETECTOR BYPASS ----------
    final = await callGemini(
      `
This is the FINAL PASS. Your ONLY job: make this pass AI detection at 0-20% AI likelihood.

AI DETECTORS SPECIFICALLY FLAG THESE - ELIMINATE THEM ALL:

❌ BANNED WORDS (replace with natural alternatives):
- Additionally, Furthermore, Moreover, Consequently → use "Also", "And", "Plus", "So"
- Utilize, Leverage → use "use"
- Demonstrates, Showcases → use "shows"
- Significant, Substantial → use "big", "major", "important"
- Implement, Execute → use "do", "make", "put in place"
- Facilitate → use "help", "make easier"
- Enhance → use "improve", "make better"
- Comprehensive → use "complete", "full"
- Robust → use "strong", "solid"
- Ensure → use "make sure"

❌ AI SENTENCE PATTERNS (rewrite these):
- "It is important to note that..." → just state the fact
- "This allows for..." → use "This lets..."
- "In order to..." → use "To..."
- "Due to the fact that..." → use "Because..."
- "For the purpose of..." → use "To..."

✅ DO THIS:
1. Replace at least 3 formal words with casual equivalents
2. Add 2+ contractions (don't, can't, it's, won't)
3. Start at least 1 sentence with: And, But, or So
4. Make shortest sentence 5 words or less
5. Make longest sentence 25+ words
6. Use simple, direct language
7. Break any repetitive rhythm

✅ HUMAN WRITING SIGNS:
- Varied punctuation (mix periods, commas, occasional dashes)
- Natural flow, not robotic precision
- Some sentences that dive straight into the point
- Conversational tone (like explaining to a colleague)

Keep the ${tone} tone and all original meaning.

OUTPUT: The final undetectable text ONLY.

TEXT:
${final}
`,
      "stage-6"
    );

    return json({ result: final });

  } catch (err) {
    console.error("❌ Paraphrase pipeline failed:", err.message);

    // Send readable error to frontend (for debugging)
    return json(
      {
        error: "Paraphrasing failed",
        details: err.message
      },
      500
    );
  }
}

// ---------- HELPER ----------
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
