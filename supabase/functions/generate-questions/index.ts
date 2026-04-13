const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const SUPPORTED_TYPES = [
  "mcq",
  "true_false",
  "fill_blank",
  "short_answer",
  "essay",
];

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      content,
      imageDataUrl,
      questionTypes,
      difficulty,
      count,
      courseCode,
    } = await req.json();

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const normalizedTypes = Array.isArray(questionTypes)
      ? questionTypes.filter((t: string) => SUPPORTED_TYPES.includes(t))
      : [];

    if ((!content || !String(content).trim()) && !imageDataUrl) {
      return new Response(
        JSON.stringify({ error: "Provide pasted text content or an image" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (normalizedTypes.length === 0) {
      return new Response(
        JSON.stringify({ error: "Select at least one valid question type" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const totalCount = Math.max(1, Math.min(100, Number(count) || 10));
    const typesList = normalizedTypes.join(", ");

    const systemPrompt = `You are an expert exam question generator for a polytechnic CBT system.\nGenerate exactly ${totalCount} questions.\n\nSTRICT RULES:\n- Allowed question types ONLY: ${typesList}\n- NEVER output any type not in the allowed list above\n- Difficulty level: ${difficulty || "mixed"}\n- Course: ${courseCode || "General"}\n- For MCQ: exactly 4 options and one correct answer\n- For true_false: correct answer must be "True" or "False"\n- For fill_blank / short_answer / essay: provide expected answer\n- Distribute types as evenly as possible among: ${typesList}\n- Questions must be academically rigorous and unambiguous`;

    // Build Gemini request
    const parts: any[] = [];

    if (content && String(content).trim()) {
      parts.push({
        text: `Generate ${totalCount} questions from this content:\n\n${String(content).slice(0, 15000)}`,
      });
    }

    if (imageDataUrl) {
      // Extract base64 data and mime type from data URL
      const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          text: `Generate ${totalCount} questions from this material image.${content ? " Also use the provided text above." : ""}`,
        });
        parts.push({
          inline_data: {
            mime_type: match[1],
            data: match[2],
          },
        });
      } else {
        parts.push({
          text: `Generate ${totalCount} questions from this material.`,
        });
      }
    }

    // Use Gemini's function calling API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts }],
          tools: [
            {
              function_declarations: [
                {
                  name: "generate_questions",
                  description: `Generate exactly ${totalCount} exam questions from course content`,
                  parameters: {
                    type: "OBJECT",
                    properties: {
                      questions: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: {
                            type: { type: "STRING", enum: normalizedTypes },
                            text: { type: "STRING" },
                            options: {
                              type: "ARRAY",
                              items: { type: "STRING" },
                            },
                            correctAnswer: { type: "STRING" },
                            difficulty: {
                              type: "STRING",
                              enum: ["easy", "medium", "hard"],
                            },
                          },
                          required: [
                            "type",
                            "text",
                            "correctAnswer",
                            "difficulty",
                          ],
                        },
                      },
                    },
                    required: ["questions"],
                  },
                },
              ],
            },
          ],
          tool_config: {
            function_calling_config: {
              mode: "ANY",
              allowed_function_names: ["generate_questions"],
            },
          },
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({
            error: "Rate limit exceeded. Please try again in a moment.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();

    // Parse Gemini function call response
    const candidate = data.candidates?.[0];
    const functionCall = candidate?.content?.parts?.find(
      (p: any) => p.functionCall,
    );

    if (!functionCall?.functionCall?.args) {
      // Try to find text response and parse it
      throw new Error("AI did not return structured output");
    }

    let questions: any[] = [];
    try {
      const args = functionCall.functionCall.args;
      questions = Array.isArray(args.questions) ? args.questions : [];
    } catch {
      throw new Error("Failed to parse AI response");
    }

    const sanitized = questions
      .filter((q) => q && normalizedTypes.includes(q.type))
      .slice(0, totalCount)
      .map((q) => ({
        type: q.type,
        text: String(q.text || "").trim(),
        options: Array.isArray(q.options)
          ? q.options.map((o: any) => String(o))
          : undefined,
        correctAnswer: String(q.correctAnswer || "").trim(),
        difficulty: ["easy", "medium", "hard"].includes(q.difficulty)
          ? q.difficulty
          : "medium",
      }))
      .filter((q) => q.text.length > 0 && q.correctAnswer.length > 0);

    return new Response(
      JSON.stringify({
        questions: sanitized,
        filteredOutCount: Math.max(0, questions.length - sanitized.length),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-questions error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
