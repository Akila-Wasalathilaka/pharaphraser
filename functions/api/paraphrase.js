export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { text, tone } = await request.json();

    // Validation
    if (!text || typeof text !== 'string' || text.length === 0 || text.length > 2000) {
      return new Response(JSON.stringify({ error: 'Invalid input: text must be a non-empty string under 2000 characters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (!['standard', 'simple', 'professional', 'academic'].includes(tone)) {
      return new Response(JSON.stringify({ error: 'Invalid tone: must be one of standard, simple, professional, academic' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Function to call Gemini API
    async function callGemini(prompt) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      return data.candidates[0].content.parts[0].text.trim();
    }

    // Stage 1: Generate 3 variations
    const stage1Prompt = `You are an expert editor. Rewrite the following text by deeply changing sentence structure and wording while preserving the original meaning. Do not add or remove information. Avoid clichés and repetitive phrasing. Generate 3 different variations.

Text: "${text}"

Output each variation on a new line, numbered 1., 2., 3.`;

    const variationsText = await callGemini(stage1Prompt);
    const lines = variationsText.split('\n').map(l => l.trim()).filter(l => l);
    const var1 = lines.find(l => l.startsWith('1.'))?.replace(/^1\.\s*/, '') || '';
    const var2 = lines.find(l => l.startsWith('2.'))?.replace(/^2\.\s*/, '') || '';
    const var3 = lines.find(l => l.startsWith('3.'))?.replace(/^3\.\s*/, '') || '';

    if (!var1 || !var2 || !var3) {
      throw new Error('Failed to generate variations');
    }

    // Select the best variation
    const selectPrompt = `Here are 3 paraphrased versions of the text "${text}":

1. ${var1}

2. ${var2}

3. ${var3}

Select the best one based on meaning preservation, naturalness, and readability. Output only the number (1, 2, or 3).`;

    const selectedNumStr = await callGemini(selectPrompt);
    const selectedNum = parseInt(selectedNumStr.trim());
    let selected;
    if (selectedNum === 1) selected = var1;
    else if (selectedNum === 2) selected = var2;
    else if (selectedNum === 3) selected = var3;
    else throw new Error('Invalid selection');

    // Stage 2: Natural Flow Refinement
    const stage2Prompt = `Improve the following rewritten text to sound more fluent, natural, and human-written. Vary sentence length and rhythm. Remove robotic or AI-like phrasing. Output ONLY the improved text.

Text: "${selected}"`;

    const stage2Output = await callGemini(stage2Prompt);

    // Stage 3: Tone Polishing
    const stage3Prompt = `Rewrite the following text in a ${tone} tone. Keep clarity, coherence, and meaning intact. Do not explain changes. Output ONLY the final paraphrased text.

Text: "${stage2Output}"`;

    const finalResult = await callGemini(stage3Prompt);

    return new Response(JSON.stringify({ result: finalResult }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}