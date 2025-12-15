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

    // ---------- STAGE 1: DEEP HUMANIZATION ----------
    const variationsRaw = await callGemini(
      `
You are a skilled human writer rewriting content to sound completely natural and undetectable.

Create THREE completely different versions of the text below. For each version:
- Use varied sentence lengths (mix short punchy sentences with longer flowing ones)
- Start sentences differently (avoid repetitive patterns)
- Use natural transitions and connectors humans use ("though", "however", "actually", "in fact")
- Mix sentence structures (simple, compound, complex)
- Use active voice predominantly but occasionally passive where natural
- Include subtle informal touches if appropriate (contractions, natural phrasing)
- Avoid overly formal or robotic patterns
- Change word order and paragraph flow significantly
- Use synonyms that humans would naturally choose, not thesaurus replacements

Output ONLY the three rewrites separated by |||. No explanations.

ORIGINAL TEXT:
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

    // ---------- STAGE 3: ANTI-AI-DETECTION REFINEMENT ----------
    selected = await callGemini(
      `
You are refining this text to be completely undetectable by AI detection tools.

Apply these human writing characteristics:
1. Vary sentence rhythm - mix 5-word sentences with 20+ word sentences
2. Use natural human connectors ("and", "but", "though", "while", "since")
3. Break up any repetitive patterns in sentence structure
4. Use contractions naturally where appropriate (don't, it's, we're)
5. Add slight stylistic variation (not every sentence should follow subject-verb-object)
6. Use more specific, concrete language over generic terms
7. Avoid these AI tells:
   - Starting multiple sentences the same way
   - Overuse of formal vocabulary
   - Perfectly balanced sentence lengths
   - Lists with identical grammatical structure
   - Overuse of adverbs (particularly, significantly, notably)
8. Write like you're explaining to a friend, not writing an essay

Output ONLY the refined text. No explanations.

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

    // ---------- STAGE 5: PERPLEXITY & BURSTINESS OPTIMIZATION ----------
    final = await callGemini(
      `
AI detectors measure "perplexity" (word predictability) and "burstiness" (sentence length variation).
Humans have HIGH burstiness (varied sentences) and HIGHER perplexity (less predictable word choices).

Rewrite this to maximize both:

PERPLEXITY (make word choices less predictable):
- Replace obvious next-word choices with natural alternatives
- Use less common but appropriate synonyms occasionally
- Vary your vocabulary - don't repeat the same descriptive words
- Choose unexpected but fitting transitions

BURSTINESS (create dramatic sentence length variation):
- Make some sentences very short. Like this.
- Then create longer, more flowing sentences that weave together multiple ideas with natural connectors and build a complete thought before ending.
- Follow with medium-length sentences for balance.
- Mix it up constantly - avoid any pattern.

Target: 30-50% variation in sentence length, with at least 2 sentences under 8 words and 2 over 20 words.

Keep all meaning and the ${tone} tone. Output ONLY the final text.

TEXT:
${final}
`,
      "stage-5"
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
