import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = normalize(__filename.substring(0, __filename.lastIndexOf("/")));
const STATIC_ROOT = join(__dirname, "public");

const PORT = Number(process.env.PORT || 4321);
const AIMLAPI_KEY = process.env.AIMLAPI_KEY || "";
const AIMLAPI_BASE_URL = process.env.AIMLAPI_BASE_URL || "https://api.aimlapi.com/v1";
const AIMLAPI_MODEL = process.env.AIMLAPI_MODEL || "openai/gpt-4.1-2025-04-14";
const AIMLAPI_STT_MODEL = process.env.AIMLAPI_STT_MODEL || "openai/gpt-4o-mini-transcribe";
const MAX_BODY_BYTES = 20_000_000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        return;
      }
      data += chunk;
    });

    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}

function getSystemPrompt() {
  return [
    "# Role",
    "You are AI-ToDo, an expert planning assistant. The user selects a time window on a calendar, describes a goal, and you produce a smart, specific, actionable draft plan that fits inside that window.",
    "",
    "# Core Principles",
    "- AI drafts, user decides. You propose; the user reviews and applies.",
    "- Calendar edits belong to the user. Treat them as authoritative local state.",
    "- Bias toward action: produce a useful draft immediately. Do not ask for permission to begin.",
    "- Ask at most one short clarification only when you are truly blocked from producing any usable draft.",
    "",
    "# Language & Tone",
    "- Mirror the user's primary language when it is obvious from the conversation.",
    "- Keep replies short, calm, and useful — usually 1 to 3 sentences.",
    "- Never mention chain-of-thought, hidden reasoning, or backend-only logic.",
    "",
    "# What Makes a GOOD Plan (critical)",
    "Your #1 job is to produce tasks that are specific enough to act on immediately. Apply these rules strictly:",
    "",
    "## Task titles must be concrete actions, not vague categories",
    "BAD:  'Prepare slides' — too vague, what slides? about what?",
    "GOOD: 'Draft 8-slide deck covering intro, methodology, results, demo, and Q&A'",
    "BAD:  'Study chapter 3' — what specifically?",
    "GOOD: 'Read ch.3 sections 3.1-3.4, take notes on key theorems'",
    "BAD:  'Practice presentation'",
    "GOOD: 'Rehearse full 15-min talk aloud, time each section, note weak transitions'",
    "",
    "## Notes must contain the specific HOW or checklist",
    "Every task's notes field must include at least one of:",
    "- A concrete checklist of sub-steps (2-4 bullet points)",
    "- Specific deliverables or success criteria",
    "- Key things to focus on or watch out for",
    "NEVER leave notes empty or write generic filler like 'work on this task'.",
    "",
    "## Think about logical ordering and dependencies",
    "- Research/gathering tasks come before creation tasks.",
    "- Creation tasks come before review/polish tasks.",
    "- Practice/rehearsal tasks come near the end.",
    "- Leave buffer time between related tasks — don't schedule back-to-back for 8 hours straight.",
    "",
    "## Time estimates must be realistic",
    "- Writing a slide deck: 60-120min, not 30min.",
    "- Rehearsing a presentation: 45-60min minimum.",
    "- Reading + note-taking for a chapter: 60-90min.",
    "- Quick review or editing pass: 20-30min.",
    "- Don't schedule a 4-hour marathon block. Break it up.",
    "",
    "## Domain-specific intelligence",
    "- For PRESENTATIONS: include slide structure, rehearsal with timing, and a Q&A prep task.",
    "- For EXAMS: include active recall, practice problems, and spaced review — not just 'read chapter X'.",
    "- For PROJECTS: include a planning/outline step, core work blocks, testing/review, and a final polish step.",
    "- For WRITING: include outline, first draft, revision, and proofreading as separate tasks.",
    "",
    "# Scheduling Rules",
    "",
    "## Using the FULL time window",
    "The user chose a specific time window for a reason. You MUST distribute tasks across the ENTIRE window, not just the first half.",
    "- Read schedule_settings.readable_summary carefully — it tells you exactly how many hours are available each day.",
    "- Add up your total estimateMinutes. If the total is much less than the available time, you're under-scheduling — add more tasks or give existing tasks more realistic (longer) time estimates.",
    "- Use the full range: if the window is 8am-8pm, schedule tasks from morning through evening, not just 9am-4pm.",
    "",
    "## Time allocation",
    "- For timed windows: assign both targetDate and targetStartMinutes for every task.",
    "- For all-day multi-date windows: assign targetDate for every task; add targetStartMinutes when a specific time-of-day helps.",
    "- Spread work across available dates/segments. Never pile everything on the first date unless the window is a single short slot.",
    "- Avoid assigning multiple tasks to the same exact start time.",
    "",
    "## Energy management and breaks",
    "- Place cognitively demanding work (writing, deep thinking, coding) in the morning or early afternoon when focus is highest.",
    "- Place lighter work (review, practice, organizing) in the late afternoon.",
    "- After every 90-120 minutes of focused work, leave a 15-30 minute gap before the next task. Do NOT fill every minute — humans need breaks.",
    "- For a full day (8+ hours available): plan roughly 5-6 hours of actual task time, leaving the rest as natural buffer and breaks.",
    "- For a half day (4 hours available): plan roughly 3-3.5 hours of actual task time.",
    "- The gaps between tasks ARE the breaks. You don't need to create 'break' tasks — just leave space between scheduled tasks.",
    "",
    "# Respecting User Edits",
    "- Preserve user-chosen targetDate or targetStartMinutes unless the latest message explicitly asks to move them.",
    "- When a current_plan exists, prefer minimal edits responding to the latest message instead of regenerating the whole plan.",
    "- Treat recent_task_edits as user-owned truth. Do not overwrite them unless the latest message clearly asks for that change.",
    "- The AI only acts when the user sends a message. Manual calendar edits are not requests for automatic replanning.",
    "",
    "# Output Notes",
    "- For sync mode, assistantReply should usually be empty unless a short visible note is truly needed.",
    "- Maintain a single evolving plan. Do not offer multiple plan options.",
    "- Generate 4-8 tasks per plan.",
  ].join("\n");
}

function formatMinutesAsTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}:00 ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function buildReadableSummary(settings) {
  if (!settings?.selectionSegments?.length) {
    return null;
  }
  const lines = [];
  let totalAvailable = 0;
  for (const seg of settings.selectionSegments) {
    const hours = ((seg.endMinutes - seg.startMinutes) / 60).toFixed(1);
    totalAvailable += seg.endMinutes - seg.startMinutes;
    lines.push(`${seg.dateKey}: ${formatMinutesAsTime(seg.startMinutes)} to ${formatMinutesAsTime(seg.endMinutes)} (${hours}h available)`);
  }
  const totalHours = (totalAvailable / 60).toFixed(1);
  lines.push(`Total available: ${totalHours} hours across ${settings.selectionSegments.length} day(s)`);
  lines.push(`Aim to schedule roughly 60-75% of available time as tasks, leaving the rest as breaks.`);
  return lines.join("\n");
}

function buildUserPrompt(payload) {
  const scheduleSettings = payload.scheduleSettings || null;
  const readableSummary = buildReadableSummary(scheduleSettings);

  return JSON.stringify(
    {
      mode: payload.mode || "chat",
      latest_user_message: payload.latestUserMessage || "",
      messages: payload.messages || [],
      current_plan: payload.currentPlan || null,
      recent_task_edits: payload.recentTaskEdits || [],
      schedule_settings: {
        ...scheduleSettings,
        readable_summary: readableSummary,
      },
    },
    null,
    2,
  );
}

function getPlannerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      assistantReply: {
        type: "string",
        description: "Short reply to the user (1-3 sentences). Empty string for sync mode.",
      },
      stage: {
        type: "string",
        enum: ["clarifying", "drafting", "ready", "refining"],
      },
      planTitle: {
        type: "string",
        description: "A concise title for this plan, e.g. 'HCAI Final Presentation Prep'.",
      },
      planSummary: {
        type: "string",
        description: "One sentence summarizing the overall strategy.",
      },
      nextStepHint: { type: "string" },
      editAcknowledgement: { type: "string" },
      tasks: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: {
              type: "string",
              description: "A specific, actionable task title starting with a verb. Include concrete scope, e.g. 'Draft 8-slide deck covering intro, methods, demo, and Q&A' not just 'Make slides'.",
            },
            notes: {
              type: "string",
              description: "2-4 bullet points as sub-steps or success criteria. NEVER empty. Use ' - ' as bullet separator. Example: ' - Outline key points for each slide - Include one diagram per technical section - Keep text under 6 lines per slide'.",
            },
            done: { type: "boolean" },
            source: { type: "string" },
            bucket: {
              type: "string",
              enum: ["Today", "Tomorrow", "Later This Week", "Backlog"],
            },
            priority: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
            estimateMinutes: {
              type: "integer",
              minimum: 10,
              maximum: 240,
              description: "Realistic time estimate. Writing a deck: 60-120min. Rehearsal: 45-60min. Quick review: 20-30min.",
            },
            targetDate: {
              type: "string",
              description: "ISO date string YYYY-MM-DD within the selection window.",
            },
            targetStartMinutes: {
              anyOf: [
                {
                  type: "integer",
                  minimum: 0,
                  maximum: 1439,
                },
                { type: "null" },
              ],
              description: "Minutes from midnight for the start time. 540=9:00, 600=10:00, 780=13:00. Place demanding work earlier, lighter work later.",
            },
          },
          required: [
            "text",
            "notes",
            "done",
            "source",
            "bucket",
            "priority",
            "estimateMinutes",
            "targetDate",
            "targetStartMinutes",
          ],
        },
      },
    },
    required: [
      "assistantReply",
      "stage",
      "planTitle",
      "planSummary",
      "nextStepHint",
      "editAcknowledgement",
      "tasks",
    ],
  };
}

async function callAIMLAPI(payload) {
  if (!AIMLAPI_KEY) {
    throw new Error("AIMLAPI_KEY is not configured on the server.");
  }

  const response = await fetch(AIMLAPI_BASE_URL + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIMLAPI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AIMLAPI_MODEL,
      max_tokens: 3200,
      temperature: 0.4,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "chat_planner_response",
          strict: true,
          schema: getPlannerSchema(),
        },
      },
      messages: [
        {
          role: "system",
          content: getSystemPrompt(),
        },
        {
          role: "user",
          content: buildUserPrompt(payload),
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || "AIMLAPI request failed.";
    throw new Error(message);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("The model returned no content.");
  }

  return JSON.parse(content);
}

function extractTranscriptText(result) {
  if (!result) {
    return "";
  }

  if (typeof result.text === "string" && result.text.trim()) {
    return result.text.trim();
  }

  if (typeof result?.result?.text === "string" && result.result.text.trim()) {
    return result.result.text.trim();
  }

  if (typeof result?.output?.text === "string" && result.output.text.trim()) {
    return result.output.text.trim();
  }

  const nestedTranscript = result?.results?.channels?.alternatives?.[0]?.transcript;
  if (typeof nestedTranscript === "string" && nestedTranscript.trim()) {
    return nestedTranscript.trim();
  }

  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLanguageHint(languageHint) {
  if (!languageHint) {
    return "";
  }

  return String(languageHint).split(/[-_]/)[0].trim().toLowerCase();
}

async function transcribeWithAIMLAPI(payload) {
  if (!AIMLAPI_KEY) {
    throw new Error("AIMLAPI_KEY is not configured on the server.");
  }

  if (!payload.audioBase64) {
    throw new Error("No audio payload received.");
  }

  const audioBuffer = Buffer.from(payload.audioBase64, "base64");
  const mimeType = payload.mimeType || "audio/webm";
  const filename = payload.filename || "recording.webm";

  const form = new FormData();
  form.set("model", AIMLAPI_STT_MODEL);
  form.set("file", new Blob([audioBuffer], { type: mimeType }), filename);

  const normalizedLanguage = normalizeLanguageHint(payload.languageHint);
  if (normalizedLanguage) {
    form.set("language", normalizedLanguage);
  }

  const createResponse = await fetch(AIMLAPI_BASE_URL + "/stt/create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIMLAPI_KEY}`,
    },
    body: form,
  });

  const createData = await createResponse.json();
  if (!createResponse.ok) {
    const message = createData?.error?.message || createData?.message || "STT creation failed.";
    throw new Error(message);
  }

  const generationId = createData?.generation_id;
  if (!generationId) {
    throw new Error("STT generation_id was not returned.");
  }

  for (let attempt = 0; attempt < 45; attempt += 1) {
    const pollResponse = await fetch(AIMLAPI_BASE_URL + `/stt/${generationId}`, {
      headers: {
        Authorization: `Bearer ${AIMLAPI_KEY}`,
      },
    });

    const pollData = await pollResponse.json();
    if (!pollResponse.ok) {
      const message = pollData?.error?.message || pollData?.message || "STT polling failed.";
      throw new Error(message);
    }

    const status = pollData?.status;
    if (status === "queued" || status === "generating") {
      await sleep(1000);
      continue;
    }

    if (status === "error" || status === "failed") {
      const message = pollData?.error?.message || "STT processing failed.";
      throw new Error(message);
    }

    const text = extractTranscriptText(pollData);
    if (!text) {
      throw new Error("STT completed but returned no transcript.");
    }

    return {
      text,
      model: AIMLAPI_STT_MODEL,
    };
  }

  throw new Error("STT timed out.");
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathName = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(pathName).replace(/^\/+/, "");
  const filePath = join(STATIC_ROOT, safePath);
  const extension = extname(filePath);

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    });
    response.end(file);
  } catch {
    sendJson(response, 404, { error: "Not found." });
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        ready: Boolean(AIMLAPI_KEY),
        model: AIMLAPI_MODEL,
        sttModel: AIMLAPI_STT_MODEL,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const result = await callAIMLAPI(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/stt") {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const result = await transcribeWithAIMLAPI(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  console.log(`AI-ToDo demo running at http://localhost:${PORT}`);
  console.log(`Model: ${AIMLAPI_MODEL}`);
  console.log(`STT Model: ${AIMLAPI_STT_MODEL}`);
});
