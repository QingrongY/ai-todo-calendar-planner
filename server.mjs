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
const AIMLAPI_MODEL = process.env.AIMLAPI_MODEL || "openai/gpt-4.1-nano-2025-04-14";
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

function buildUserPrompt(payload) {
  return [
    "The app uses a calendar as the primary surface. The user selects a time window, then asks AI to break a larger goal into tasks that fit inside it.",
    "Users want a real draft plan, not repeated permission-seeking questions.",
    "The calendar and task edits belong to the user. Treat them as authoritative local state.",
    "Infer intent from conversation, task edits, and schedule settings.",
    "",
    JSON.stringify(
      {
        mode: payload.mode || "chat",
        latest_user_message: payload.latestUserMessage || "",
        messages: payload.messages || [],
        current_plan: payload.currentPlan || null,
        recent_task_edits: payload.recentTaskEdits || [],
        schedule_settings: payload.scheduleSettings || null,
      },
      null,
      2,
    ),
    "",
    "Behavior requirements:",
    "1. Mirror the user's primary language when it is obvious from the conversation.",
    "2. Keep assistant replies short, calm, and useful. Usually 1 to 3 sentences.",
    "3. Default to producing a useful draft plan immediately. Do not ask for permission to begin.",
    "4. Ask at most one short clarification question only if you are truly blocked from producing a usable draft.",
    "5. Maintain a single evolving task plan instead of multiple plan options.",
    "6. Break real goals into 4 to 8 smaller tasks whenever possible.",
    "7. For study or exam planning, include coverage, active recall, practice, and review instead of vague generic tasks.",
    "8. Every task must have a priority, estimateMinutes, and a reasonable bucket.",
    "9. If schedule_settings.selectionWindow exists, make the plan fit that selected window as closely as possible.",
    "10. If schedule_settings.selectionSegments exists, use those segments as the primary placement boundary and distribute tasks across them intelligently.",
    "11. You must decide the date allocation for tasks yourself. Do not leave all tasks on the first date unless there is a clear reason.",
    "12. If the selection spans multiple dates or multiple usable segments, spread the work across those dates instead of concentrating everything into the first slot.",
    "13. Avoid assigning multiple tasks to the same exact start time unless overlap is truly intended.",
    "14. If the selected window is timed, assign targetDate and targetStartMinutes for each task so the frontend can place them directly from your judgment.",
    "15. If the selected window is all-day across multiple dates, assign targetDate for every task within that range and set targetStartMinutes when a specific time-of-day helps the schedule.",
    "16. If a task already has a chosen targetDate or targetStartMinutes from the user, preserve it unless the latest user message explicitly asks to move it.",
    "17. When a current plan already exists, prefer minimal edits that respond to the latest user message instead of regenerating the whole plan.",
    "18. Treat recent_task_edits as user-owned truth. Do not overwrite them unless the latest user message clearly asks for that change.",
    "19. The AI only acts when the user sends a message. Manual calendar edits are not requests for automatic replanning.",
    "20. For sync mode, assistantReply should usually be an empty string unless a short visible note is truly needed.",
    "21. Do not mention chain-of-thought, hidden reasoning, or backend-only logic.",
  ].join("\n");
}

function getPlannerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      assistantReply: { type: "string" },
      stage: {
        type: "string",
        enum: ["clarifying", "drafting", "ready", "refining"],
      },
      planTitle: { type: "string" },
      planSummary: { type: "string" },
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
            text: { type: "string" },
            notes: { type: "string" },
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
            },
            targetDate: { type: "string" },
            targetStartMinutes: {
              anyOf: [
                {
                  type: "integer",
                  minimum: 0,
                  maximum: 1439,
                },
                { type: "null" },
              ],
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
      temperature: 0.3,
      max_tokens: 1200,
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
          content:
            "You are AI-ToDo, a voice-first planning assistant that turns messy goals into editable, calendar-aware task plans.",
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
