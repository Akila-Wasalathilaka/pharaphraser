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
          "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=" +
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

    // ---------- STAGE 1: VARIATIONS ----------
    const variationsRaw = await callGemini(
      `
Rewrite the text below in THREE different ways.
Each rewrite must preserve meaning but change structure and wording deeply.
Output ONLY the three rewrites separated by |||.

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

    // ---------- STAGE 2: SELECT BEST ----------
    const selectionRaw = await callGemini(
      `
Choose the BEST rewrite based on clarity, naturalness, and meaning preservation.
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

    // ---------- STAGE 3: NATURAL REFINEMENT ----------
    selected = await callGemini(
      `
Improve the text to sound fluent, natural, and human-written.
Avoid AI patterns.
Output ONLY the rewritten text.

TEXT:
${selected}
`,
      "stage-3"
    );

    // ---------- STAGE 4: TONE POLISH ----------
    const final = await callGemini(
      `
Rewrite the text in a ${tone} tone.
Preserve meaning and clarity.
Output ONLY the final text.

TEXT:
${selected}
`,
      "stage-4"
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
