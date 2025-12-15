export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const text = body.text;
    const tone = body.tone || "standard";

    if (!text || typeof text !== "string" || text.length > 2000) {
      return json({ error: "Invalid input text" }, 400);
    }

    const allowedTones = ["standard", "simple", "professional", "academic"];
    if (!allowedTones.includes(tone)) {
      return json({ error: "Invalid tone" }, 400);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: "Missing Gemini API key" }, 500);
    }

    async function callGemini(prompt) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));

      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    // -------- STAGE 1: Generate variations --------
    const variationsRaw = await callGemini(`
Rewrite the text below in THREE different ways.
Each rewrite must preserve meaning but change structure and wording deeply.
Output ONLY the three rewrites separated by |||.

TEXT:
${text}
`);

    const variations = variationsRaw
      .split("|||")
      .map(v => v.trim())
      .filter(Boolean);

    if (variations.length < 3) {
      throw new Error("Variation generation failed");
    }

    // -------- STAGE 2: Select best --------
    const selectionRaw = await callGemini(`
Choose the BEST rewrite based on clarity, naturalness, and meaning preservation.
Reply ONLY with the number 1, 2, or 3.

1. ${variations[0]}
2. ${variations[1]}
3. ${variations[2]}
`);

    const index = ["1", "2", "3"].includes(selectionRaw.trim())
      ? Number(selectionRaw.trim()) - 1
      : 0;

    let selected = variations[index];

    // -------- STAGE 3: Natural refinement --------
    selected = await callGemini(`
Improve the text to sound fluent, human, and natural.
Avoid AI patterns.
Output ONLY the rewritten text.

TEXT:
${selected}
`);

    // -------- STAGE 4: Tone polish --------
    const final = await callGemini(`
Rewrite the text in a ${tone} tone.
Preserve meaning and clarity.
Output ONLY the final text.

TEXT:
${selected}
`);

    return json({ result: final });

  } catch (err) {
    console.error("Paraphrase error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
