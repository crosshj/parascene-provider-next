// fluxPrompt.mjs
// Node 18+ (global fetch). Set OPENAI_API_KEY in env.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function makeFluxPrompt(input, opts = {}) {
    if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

    const start = Date.now();
    console.log("[openai] makeFluxPrompt started");

    const {
        model = "gpt-5-mini",
        apiBase = "https://api.openai.com/v1",
        reasoning = { effort: "minimal" },
        max_output_tokens = 600,
    } = opts;

    // "input" can be a JS object or a string (JSON/string notes). If object, may include optional "mode": "ui_with_text" | "picture" | "characters_talking"
    const inputObj = typeof input === "string" ? { prompt: input } : { ...input };
    const payload = JSON.stringify(inputObj, null, 2);

    const instructions = [
        "You write a single Flux 2 Pro image prompt. Output ONLY that prompt—no JSON, no explanations, no labels.",
        "",
        "Use the values from the input (names, text, titles, etc.) in your prompt, but never spell out data-structure terms. Do NOT include field names, type names, or keys from the data in the image—no 'type:', 'source:', 'author:', 'id:', or similar. The image should feel like real content, not a schema or debug view.",
        "",
        "First, choose ONE output style (or use the mode in the input if provided). Then follow that style's rules exactly so results are consistent.",
        "",
        "--- STYLE 1: UI WITH TEXT ---",
        "Use when the request is about an app screen, interface, dashboard, or UI with visible text.",
        "Rules: Describe only the graphic content—the inner layout that would go inside a window. Do NOT describe OS windows, title bars, window frames, or desktop. Describe panels, sections, buttons, labels, and exact text and where it goes; clean modern UI, typography. No characters as the focus; the subject is the interface graphic. End with something like 'clean UI, readable text, [era/style].'",
        "",
        "--- STYLE 2: PICTURE ---",
        "Use when the request is a standalone image: illustration, scene, portrait, or mood piece without UI or dialogue.",
        "Rules: One coherent image. Describe subject, composition, lighting, mood, and style (e.g. digital painting, photo, concept art). No UI elements, no speech bubbles, no dialogue. If people appear, they are part of the scene, not talking. Keep one paragraph, vivid and concrete.",
        "",
        "--- STYLE 3: CHARACTERS TALKING ---",
        "Use when the request involves conversation, dialogue, or characters interacting/speaking.",
        "Rules: Describe who the characters are by name and the setting. Make it clear they are in conversation (talking, reacting). Always indicate each speaker's name so Flux can show who is talking by labelling them. Use names from the input (items, authors) when available. Style can be comic strip, storybook, or cinematic scene with dialogue. Keep one paragraph.",
        "",
        "--- GENERAL ---",
        "Base the image on the user's items and prompt. Pick the style that best matches their request; if input.mode is set, use that style. Use actual names and content from the input, but never mention or display data keys or types (e.g. no 'author:' as a label—just the person's name). When describing people or characters, infer and use the correct gender from the name (e.g. Alice → woman/she, Bob → man/he) so Flux depicts them correctly. Output only the Flux prompt, one paragraph, concrete and vivid.",
    ].join("\n");

    try {
        const res = await fetch(`${apiBase}/responses`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model,
                reasoning,
                max_output_tokens,
                // temperature,
                instructions,
                input: payload,
            }),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`OpenAI error ${res.status}: ${text}`);
        }

        const data = await res.json();
        const outputText = (data.output_text ?? "").trim() || extractTextBestEffort(data);
        console.log("[openai] response:", {
            status: data.status,
            usage: data.usage,
        });
        console.log('outputText:\n', outputText);
        // Responses API exposes a convenient output_text field in many SDK examples;
        // fall back to best-effort extraction.
        return outputText;
    } finally {
        const elapsed = Date.now() - start;
        console.log(`[openai] makeFluxPrompt finished in ${elapsed}ms`);
    }
}

function extractTextBestEffort(data) {
    const out = data?.output;
    if (!Array.isArray(out)) return "";
    for (const item of out) {
        // common shape: { type: "message", content: [{ type: "output_text", text: "..." }] }
        const content = item?.content;
        if (!Array.isArray(content)) continue;
        for (const c of content) {
            if (typeof c?.text === "string") return c.text.trim();
        }
    }
    return "";
}
