const STORAGE_KEY = "aitodo-fullcalendar-v2";

const state = {
  sessions: [],
  events: [],
  activeSessionId: null,
  selectedWindow: null,
  selectedEventId: null,
  drawerOpen: false,
  eventDrawerOpen: false,
  modalOpen: false,
  modalMode: "plan",
  pending: false,
  sttPending: false,
  mediaRecorder: null,
  recordingStream: null,
  recordedChunks: [],
  calendar: null,
};

const SESSION_COLORS = [
  { bg: "#0d9488", soft: "#e7faf7", border: "#9ee3da", text: "#0f766e" },
  { bg: "#2563eb", soft: "#e8f0ff", border: "#b7ccff", text: "#1d4ed8" },
  { bg: "#7c3aed", soft: "#f2ebff", border: "#d8c4ff", text: "#6d28d9" },
  { bg: "#ea580c", soft: "#fff0e6", border: "#ffcaa8", text: "#c2410c" },
  { bg: "#db2777", soft: "#ffe8f3", border: "#ffbfdc", text: "#be185d" },
  { bg: "#4f46e5", soft: "#ececff", border: "#c8c5ff", text: "#4338ca" },
];

const elements = {
  healthDot: document.getElementById("healthDot"),
  healthText: document.getElementById("healthText"),
  plansButton: document.getElementById("plansButton"),
  selectionBar: document.getElementById("selectionBar"),
  selectionLabel: document.getElementById("selectionLabel"),
  clearSelectionButton: document.getElementById("clearSelectionButton"),
  planSelectionButton: document.getElementById("planSelectionButton"),
  plansDrawer: document.getElementById("plansDrawer"),
  plansBackdrop: document.getElementById("plansBackdrop"),
  closePlansButton: document.getElementById("closePlansButton"),
  plansList: document.getElementById("plansList"),
  eventDrawer: document.getElementById("eventDrawer"),
  eventBackdrop: document.getElementById("eventBackdrop"),
  closeEventButton: document.getElementById("closeEventButton"),
  eventDetailsContent: document.getElementById("eventDetailsContent"),
  aiModal: document.getElementById("aiModal"),
  aiBackdrop: document.getElementById("aiBackdrop"),
  closeModalButton: document.getElementById("closeModalButton"),
  modalRangeLabel: document.getElementById("modalRangeLabel"),
  planModeButton: document.getElementById("planModeButton"),
  executeModeButton: document.getElementById("executeModeButton"),
  planModePanel: document.getElementById("planModePanel"),
  executeModePanel: document.getElementById("executeModePanel"),
  modalMessageList: document.getElementById("modalMessageList"),
  modalComposerForm: document.getElementById("modalComposerForm"),
  modalComposerInput: document.getElementById("modalComposerInput"),
  modalMicButton: document.getElementById("modalMicButton"),
  modalSendButton: document.getElementById("modalSendButton"),
  modalStatus: document.getElementById("modalStatus"),
  draftList: document.getElementById("draftList"),
  applyDraftButton: document.getElementById("applyDraftButton"),
  calendar: document.getElementById("calendar"),
};

function createId() {
  return crypto.randomUUID();
}

function getSessionColor(sessionId) {
  if (!sessionId) {
    return SESSION_COLORS[0];
  }

  let hash = 0;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash = ((hash << 5) - hash) + sessionId.charCodeAt(index);
    hash |= 0;
  }
  return SESSION_COLORS[Math.abs(hash) % SESSION_COLORS.length];
}

function formatDateTime(dateLike) {
  return new Date(dateLike).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateOnly(dateLike) {
  return new Date(dateLike).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatSelectionLabel(selection) {
  if (!selection) {
    return "";
  }

  if (selection.allDay) {
    const inclusiveEnd = new Date(new Date(selection.end).getTime() - 86400000);
    return `${formatDateOnly(selection.start)} to ${formatDateOnly(inclusiveEnd)}`;
  }

  return `${formatDateTime(selection.start)} to ${formatDateTime(selection.end)}`;
}

function formatDurationMinutes(minutes) {
  const total = Math.max(0, Number(minutes) || 0);
  if (total < 60) {
    return `${total}m`;
  }
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toDateKey(dateLike) {
  const date = new Date(dateLike);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function timeToMinutes(timeString) {
  if (!timeString) {
    return null;
  }
  const [hours, minutes] = String(timeString).split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const safe = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
  const hours = String(Math.floor(safe / 60)).padStart(2, "0");
  const minutes = String(safe % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getDateKeysInRange(startDateLike, endDateLike, inclusive = true) {
  const keys = [];
  const start = new Date(startDateLike);
  const end = new Date(endDateLike);
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor < last || (inclusive && cursor.getTime() === last.getTime())) {
    keys.push(toDateKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

function buildTimedSegments(selection) {
  const start = new Date(selection.start);
  const end = new Date(selection.end);
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);
  const keys = getDateKeysInRange(start, end);

  return keys
    .map((dateKey, index) => {
      let startMinutes = 0;
      let endMinutes = 24 * 60;

      if (dateKey === startKey) {
        startMinutes = start.getHours() * 60 + start.getMinutes();
      }
      if (dateKey === endKey) {
        endMinutes = end.getHours() * 60 + end.getMinutes();
        if (endMinutes === 0 && index > 0) {
          endMinutes = 24 * 60;
        }
      }

      return { dateKey, startMinutes, endMinutes };
    })
    .filter((segment) => segment.endMinutes > segment.startMinutes);
}

function buildSelectionSegments(selection) {
  if (selection.allDay) {
    const endDate = new Date(new Date(selection.end).getTime() - 86400000);
    return getDateKeysInRange(selection.start, endDate).map((dateKey) => ({
      dateKey,
      startMinutes: 9 * 60,
      endMinutes: 18 * 60,
      availableMinutes: 9 * 60,
    }));
  }

  return buildTimedSegments(selection).map((segment) => ({
    ...segment,
    availableMinutes: segment.endMinutes - segment.startMinutes,
  }));
}

function scheduleAcrossSegments(tasks, segments, sessionId, color) {
  const events = [];
  const overflow = [];
  const cursorMap = Object.fromEntries(segments.map((segment) => [segment.dateKey, segment.startMinutes]));
  const blockMap = Object.fromEntries(segments.map((segment) => [segment.dateKey, []]));

  function overlaps(dateKey, startMinutes, endMinutes) {
    return blockMap[dateKey].some((block) => !(endMinutes <= block.startMinutes || startMinutes >= block.endMinutes));
  }

  function reserve(dateKey, startMinutes, endMinutes) {
    blockMap[dateKey].push({ startMinutes, endMinutes });
    blockMap[dateKey].sort((left, right) => left.startMinutes - right.startMinutes);
  }

  function nextFreeSlot(dateKey, durationMinutes) {
    const segment = segments.find((item) => item.dateKey === dateKey);
    if (!segment) {
      return null;
    }

    let candidate = segment.startMinutes;
    const blocks = blockMap[dateKey];
    for (const block of blocks) {
      if (candidate + durationMinutes <= block.startMinutes) {
        break;
      }
      candidate = Math.max(candidate, block.endMinutes);
    }

    return candidate + durationMinutes <= segment.endMinutes ? candidate : null;
  }

  tasks.forEach((task, index) => {
    const durationMinutes = Math.max(10, Math.min(240, Number(task.estimateMinutes) || 45));
    const preferredDate = task.targetDate && cursorMap[task.targetDate] !== undefined ? task.targetDate : null;
    const orderedSegments = preferredDate
      ? [
          segments.find((segment) => segment.dateKey === preferredDate),
          ...segments.filter((segment) => segment.dateKey !== preferredDate),
        ]
      : segments;

    let placed = false;
    for (const segment of orderedSegments) {
      if (!segment) {
        continue;
      }

      const hasExplicitStart = preferredDate === segment.dateKey && Number.isFinite(task.targetStartMinutes);
      let requestedStart = hasExplicitStart ? task.targetStartMinutes : cursorMap[segment.dateKey];
      let eventEndMinutes = requestedStart + durationMinutes;

      const explicitFits = hasExplicitStart
        && requestedStart >= segment.startMinutes
        && eventEndMinutes <= segment.endMinutes
        && !overlaps(segment.dateKey, requestedStart, eventEndMinutes);

      if (!explicitFits) {
        const fallbackStart = nextFreeSlot(segment.dateKey, durationMinutes);
        if (fallbackStart === null) {
          continue;
        }
        requestedStart = fallbackStart;
        eventEndMinutes = requestedStart + durationMinutes;
      }

      const start = new Date(`${segment.dateKey}T${minutesToTime(requestedStart)}:00`);
      const end = new Date(`${segment.dateKey}T${minutesToTime(eventEndMinutes)}:00`);
      events.push({
        id: createId(),
        title: task.text,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: false,
        editable: true,
        groupId: sessionId,
        backgroundColor: color.bg,
        borderColor: color.bg,
        textColor: "#ffffff",
        extendedProps: {
          notes: task.notes || "",
          priority: task.priority || "medium",
          estimateMinutes: durationMinutes,
          sessionId,
          aiGenerated: true,
          segmentIndex: index,
          targetDate: segment.dateKey,
          targetStartMinutes: requestedStart,
        },
      });
      reserve(segment.dateKey, requestedStart, eventEndMinutes);
      cursorMap[segment.dateKey] = Math.max(cursorMap[segment.dateKey], eventEndMinutes);
      placed = true;
      break;
    }

    if (!placed) {
      overflow.push(task);
    }
  });

  return { events, overflow };
}

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
}

function getSession(sessionId) {
  return state.sessions.find((session) => session.id === sessionId);
}

function getActiveSession() {
  return getSession(state.activeSessionId);
}

function resolveSessionIdForEvent(eventLike) {
  const directSessionId = eventLike?.extendedProps?.sessionId || eventLike?.groupId;
  if (directSessionId) {
    return directSessionId;
  }

  const eventId = eventLike?.id;
  if (!eventId) {
    return null;
  }

  const owner = state.sessions.find((session) => (session.eventIds || []).includes(eventId));
  return owner?.id || null;
}

function hydrateEventSessionLinks() {
  state.events = state.events.map((eventRecord) => {
    const sessionId = resolveSessionIdForEvent(eventRecord);
    if (!sessionId) {
      return eventRecord;
    }

    const color = getSessionColor(sessionId);
    return {
      ...eventRecord,
      groupId: eventRecord.groupId || sessionId,
      backgroundColor: eventRecord.backgroundColor || color.bg,
      borderColor: eventRecord.borderColor || color.bg,
      textColor: eventRecord.textColor || "#ffffff",
      extendedProps: {
        ...eventRecord.extendedProps,
        sessionId,
      },
    };
  });
}

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      sessions: state.sessions,
      events: state.events,
      activeSessionId: state.activeSessionId,
    }),
  );
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    state.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    state.events = Array.isArray(parsed.events) ? parsed.events : [];
    state.activeSessionId = parsed.activeSessionId || null;
  } catch {
    state.sessions = [];
    state.events = [];
    state.activeSessionId = null;
  }
}

function sortSessions() {
  state.sessions.sort((left, right) => right.updatedAt - left.updatedAt);
}

function renderHealth(ready, label) {
  elements.healthText.textContent = label;
  elements.healthDot.className = `status-dot ${ready ? "ready" : "error"}`;
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    renderHealth(Boolean(data.ready), data.ready ? "Connected" : "Offline");
  } catch {
    renderHealth(false, "Offline");
  }
}

function setDrawerOpen(isOpen) {
  state.drawerOpen = isOpen;
  elements.plansDrawer.classList.toggle("hidden", !isOpen);
  elements.plansDrawer.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("drawer-open", isOpen);
}

function setEventDrawerOpen(isOpen) {
  state.eventDrawerOpen = isOpen;
  elements.eventDrawer.classList.toggle("hidden", !isOpen);
  elements.eventDrawer.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("drawer-open", isOpen);
}

function setModalOpen(isOpen) {
  state.modalOpen = isOpen;
  elements.aiModal.classList.toggle("hidden", !isOpen);
  elements.aiModal.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("modal-open", isOpen);
}

function setModalMode(mode) {
  state.modalMode = mode;
  elements.planModeButton.classList.toggle("active", mode === "plan");
  elements.executeModeButton.classList.toggle("active", mode === "execute");
  elements.planModePanel.classList.toggle("hidden", mode !== "plan");
  elements.executeModePanel.classList.toggle("hidden", mode !== "execute");
}

function setModalStatus(message) {
  elements.modalStatus.textContent = message;
  elements.modalStatus.classList.toggle("hidden", !message);
}

function ensureSessionForSelection() {
  const existing = getActiveSession();
  if (
    existing &&
    state.selectedWindow &&
    existing.selection &&
    existing.selection.start === state.selectedWindow.start &&
    existing.selection.end === state.selectedWindow.end &&
    existing.selection.allDay === state.selectedWindow.allDay
  ) {
    return existing;
  }

  const session = {
    id: createId(),
    title: state.selectedWindow?.allDay ? "Plan selected dates" : "Plan selected time",
    selection: { ...state.selectedWindow },
    messages: [
      {
        role: "assistant",
        text: `Selected range: ${formatSelectionLabel(state.selectedWindow)}. Describe the larger task you want to fit here.`,
      },
    ],
    draftTasks: [],
    updatedAt: Date.now(),
    eventIds: [],
  };

  state.sessions.unshift(session);
  state.activeSessionId = session.id;
  sortSessions();
  persist();
  return session;
}

function renderSelectionBar() {
  const hasSelection = Boolean(state.selectedWindow);
  elements.selectionBar.classList.toggle("hidden", !hasSelection);
  if (state.calendar) {
    requestAnimationFrame(() => state.calendar.updateSize());
  }
  if (!hasSelection) {
    return;
  }
  elements.selectionLabel.textContent = formatSelectionLabel(state.selectedWindow);
}

function syncCalendarEvents() {
  if (!state.calendar) {
    return;
  }

  state.calendar.batchRendering(() => {
    state.calendar.removeAllEvents();
    state.events.forEach((eventRecord) => {
      state.calendar.addEvent(eventRecord);
    });
  });
}

function renderEventDetails() {
  elements.eventDetailsContent.innerHTML = "";

  if (!state.selectedEventId) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent = "Select a calendar event to edit it.";
    elements.eventDetailsContent.appendChild(empty);
    return;
  }

  const eventRecord = state.events.find((item) => item.id === state.selectedEventId);
  if (!eventRecord) {
    state.selectedEventId = null;
    renderEventDetails();
    return;
  }

  const card = document.createElement("div");
  card.className = "event-card";
  const sessionColor = getSessionColor(resolveSessionIdForEvent(eventRecord));
  card.style.setProperty("--session-soft", sessionColor.soft);
  card.style.setProperty("--session-border", sessionColor.border);

  const label = document.createElement("div");
  label.className = "detail-label";
  label.textContent = eventRecord.allDay ? "All-day event" : "Scheduled event";

  const main = document.createElement("div");
  main.className = "detail-main";
  main.textContent = eventRecord.allDay
    ? `${eventRecord.title}\n${formatDateOnly(eventRecord.start)}`
    : `${eventRecord.title}\n${formatDateTime(eventRecord.start)} - ${formatDateTime(eventRecord.end)}`;

  card.appendChild(label);
  card.appendChild(main);
  elements.eventDetailsContent.appendChild(card);

  const form = document.createElement("div");
  form.className = "event-form";

  const titleLabel = document.createElement("label");
  titleLabel.textContent = "Title";
  const titleInput = document.createElement("input");
  titleInput.value = eventRecord.title;
  titleInput.addEventListener("input", (event) => {
    eventRecord.title = event.target.value;
    syncCalendarEvents();
    persist();
  });
  titleLabel.appendChild(titleInput);

  const notesLabel = document.createElement("label");
  notesLabel.textContent = "Notes";
  const notesInput = document.createElement("textarea");
  notesInput.value = eventRecord.extendedProps?.notes || "";
  notesInput.addEventListener("input", (event) => {
    eventRecord.extendedProps = {
      ...eventRecord.extendedProps,
      notes: event.target.value,
    };
    persist();
  });
  notesLabel.appendChild(notesInput);

  const priorityLabel = document.createElement("label");
  priorityLabel.textContent = "Priority";
  const prioritySelect = document.createElement("select");
  ["high", "medium", "low"].forEach((priority) => {
    const option = document.createElement("option");
    option.value = priority;
    option.textContent = priority;
    option.selected = (eventRecord.extendedProps?.priority || "medium") === priority;
    prioritySelect.appendChild(option);
  });
  prioritySelect.addEventListener("change", (event) => {
    eventRecord.extendedProps = {
      ...eventRecord.extendedProps,
      priority: event.target.value,
    };
    syncCalendarEvents();
    persist();
  });
  priorityLabel.appendChild(prioritySelect);

  const actions = document.createElement("div");
  actions.className = "event-actions";

  const sessionId = resolveSessionIdForEvent(eventRecord);
  if (sessionId) {
    const continueButton = document.createElement("button");
    continueButton.type = "button";
    continueButton.className = "primary-button";
    continueButton.textContent = "Continue in AI";
    continueButton.addEventListener("click", () => {
      setEventDrawerOpen(false);
      continueInSession(sessionId, { mode: "plan" });
    });
    actions.appendChild(continueButton);
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "subtle-button";
  deleteButton.textContent = "Delete event";
  deleteButton.addEventListener("click", () => {
    state.events = state.events.filter((item) => item.id !== eventRecord.id);
    state.sessions.forEach((session) => {
      session.eventIds = (session.eventIds || []).filter((id) => id !== eventRecord.id);
    });
    state.selectedEventId = null;
    syncCalendarEvents();
    persist();
    renderEventDetails();
    renderPlansDrawer();
  });
  actions.appendChild(deleteButton);

  form.appendChild(titleLabel);
  form.appendChild(notesLabel);
  form.appendChild(priorityLabel);
  form.appendChild(actions);
  elements.eventDetailsContent.appendChild(form);
}

function renderPlansDrawer() {
  elements.plansList.innerHTML = "";
  if (!state.sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent = "No AI plans yet.";
    elements.plansList.appendChild(empty);
    return;
  }

  state.sessions.forEach((session) => {
    const card = document.createElement("div");
    card.className = "plan-card";
    const color = getSessionColor(session.id);
    card.style.setProperty("--session-soft", color.soft);
    card.style.setProperty("--session-border", color.border);

    const title = document.createElement("div");
    title.className = "plan-card-title";
    title.textContent = session.title;

    const label = document.createElement("div");
    label.className = "plan-card-label";
    label.textContent = formatSelectionLabel(session.selection);

    const preview = document.createElement("div");
    preview.className = "plan-card-preview";
    const lastUser = [...session.messages].reverse().find((message) => message.role === "user");
    preview.textContent = lastUser ? lastUser.text : "No prompt yet.";

    const actions = document.createElement("div");
    actions.className = "plan-card-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "primary-button";
    openButton.textContent = "Open";
    openButton.addEventListener("click", () => {
      state.selectedEventId = null;
      state.calendar.gotoDate(session.selection.start);
      setDrawerOpen(false);
      continueInSession(session.id, { mode: session.draftTasks?.length ? "execute" : "plan" });
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "subtle-button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      const eventIds = new Set(session.eventIds || []);
      state.events = state.events.filter((eventRecord) => !eventIds.has(eventRecord.id));
      state.sessions = state.sessions.filter((item) => item.id !== session.id);
      if (state.activeSessionId === session.id) {
        state.activeSessionId = null;
      }
      syncCalendarEvents();
      persist();
      renderPlansDrawer();
      renderEventDetails();
    });

    actions.appendChild(openButton);
    actions.appendChild(deleteButton);
    card.appendChild(title);
    card.appendChild(label);
    card.appendChild(preview);
    card.appendChild(actions);
    elements.plansList.appendChild(card);
  });
}

function renderModalMessages() {
  const session = getActiveSession();
  elements.modalMessageList.innerHTML = "";
  elements.modalRangeLabel.textContent = session ? formatSelectionLabel(session.selection) : "";

  if (!session) {
    return;
  }

  session.messages.forEach((message) => {
    const row = document.createElement("div");
    row.className = `modal-message ${message.role}`;

    const role = document.createElement("div");
    role.className = "modal-message-role";
    role.textContent = message.role === "assistant" ? "AI" : "You";

    const body = document.createElement("div");
    body.className = "modal-message-body";
    body.textContent = message.text;

    row.appendChild(role);
    row.appendChild(body);
    elements.modalMessageList.appendChild(row);
  });

  if (state.pending) {
    const typing = document.createElement("div");
    typing.className = "modal-message assistant";
    typing.innerHTML = '<div class="modal-message-role">AI</div><div class="modal-message-body">Thinking...</div>';
    elements.modalMessageList.appendChild(typing);
  }
}

function renderDraftList() {
  const session = getActiveSession();
  elements.draftList.innerHTML = "";
  elements.applyDraftButton.disabled = !session || !session.draftTasks || !session.draftTasks.length;

  if (!session || !session.draftTasks?.length) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent = "Send a prompt in Plan Mode to get an AI draft.";
    elements.draftList.appendChild(empty);
    return;
  }

  session.draftTasks.forEach((task) => {
    const card = document.createElement("div");
    card.className = "draft-card";

    const title = document.createElement("div");
    title.className = "draft-card-title";
    title.textContent = task.text;

    const notes = document.createElement("div");
    notes.className = "draft-card-notes";
    notes.textContent = task.notes || "No notes";

    const meta = document.createElement("div");
    meta.className = "draft-card-meta";
    const duration = document.createElement("div");
    duration.className = "draft-chip";
    duration.textContent = formatDurationMinutes(task.estimateMinutes);
    const priority = document.createElement("div");
    priority.className = "draft-chip";
    priority.textContent = (task.priority || "medium").toUpperCase();
    meta.appendChild(duration);
    meta.appendChild(priority);

    card.appendChild(title);
    card.appendChild(notes);
    card.appendChild(meta);
    elements.draftList.appendChild(card);
  });
}

function renderCalendarEventContent(arg) {
  const sessionColor = getSessionColor(resolveSessionIdForEvent(arg.event));
  const wrapper = document.createElement("div");
  wrapper.className = `fc-custom-event priority-${arg.event.extendedProps.priority || "medium"}`;
  wrapper.style.setProperty("--session-bg", sessionColor.bg);
  wrapper.style.setProperty("--session-soft", sessionColor.soft);
  wrapper.style.setProperty("--session-border", sessionColor.border);
  wrapper.style.setProperty("--session-text", sessionColor.text);
  const titleNode = document.createElement("div");
  titleNode.className = "fc-custom-event-title";
  titleNode.textContent = arg.event.title || "Untitled";
  wrapper.appendChild(titleNode);
  return { domNodes: [wrapper] };
}

function buildTaskPayloadFromSession(session) {
  return state.events
    .filter((eventRecord) => eventRecord.extendedProps?.sessionId === session.id)
    .map((eventRecord) => ({
      text: eventRecord.title,
      notes: eventRecord.extendedProps?.notes || "",
      done: false,
      source: "calendar",
      bucket: "Backlog",
      priority: eventRecord.extendedProps?.priority || "medium",
      estimateMinutes: eventRecord.extendedProps?.estimateMinutes || 45,
      targetDate: toDateKey(eventRecord.start),
      targetStartMinutes: eventRecord.allDay ? null : new Date(eventRecord.start).getHours() * 60 + new Date(eventRecord.start).getMinutes(),
    }));
}

function buildChatPayload(session, latestUserMessage) {
  return {
    mode: "chat",
    latestUserMessage,
    messages: session.messages.map((message) => ({
      role: message.role,
      content: message.text,
    })),
    currentPlan: {
      stage: "drafting",
      title: session.title,
      summary: "",
      nextStep: "",
      tasks: buildTaskPayloadFromSession(session),
    },
    recentTaskEdits: [],
    scheduleSettings: {
      selectionWindow: session.selection,
      selectionSegments: buildSelectionSegments(session.selection),
    },
  };
}

function createTimedEventsFromTasks(tasks, session) {
  const color = getSessionColor(session.id);
  const segments = buildTimedSegments(session.selection);
  return scheduleAcrossSegments(tasks, segments, session.id, color);
}

function createAllDayEventsFromTasks(tasks, session) {
  const color = getSessionColor(session.id);
  const dayKeys = getDateKeysInRange(session.selection.start, new Date(new Date(session.selection.end).getTime() - 86400000));
  const segments = dayKeys.map((dateKey) => ({
    dateKey,
    startMinutes: 9 * 60,
    endMinutes: 18 * 60,
  }));
  return scheduleAcrossSegments(tasks, segments, session.id, color);
}

function applyDraftToCalendar() {
  const session = getActiveSession();
  if (!session || !session.draftTasks?.length) {
    return;
  }

  const previousIds = new Set(session.eventIds || []);
  state.events = state.events.filter((eventRecord) => !previousIds.has(eventRecord.id));

  const result = session.selection.allDay
    ? createAllDayEventsFromTasks(session.draftTasks, session)
    : createTimedEventsFromTasks(session.draftTasks, session);

  session.eventIds = result.events.map((eventRecord) => eventRecord.id);
  state.events.push(...result.events);
  syncCalendarEvents();
  persist();
  renderPlansDrawer();
  setModalOpen(false);

  if (result.events[0]) {
    state.selectedEventId = result.events[0].id;
    state.selectedWindow = null;
    renderSelectionBar();
    renderEventDetails();
    setEventDrawerOpen(true);
  }
}

async function sendAiMessage(rawText) {
  const session = getActiveSession();
  const text = rawText.trim();
  if (!session || !text || state.pending || state.sttPending) {
    return;
  }

  session.messages.push({ role: "user", text });
  session.updatedAt = Date.now();
  state.pending = true;
  setModalStatus("Thinking...");
  renderModalMessages();
  persist();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildChatPayload(session, text)),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "AI planning failed.");
    }

    if (data.assistantReply?.trim()) {
      session.messages.push({ role: "assistant", text: data.assistantReply.trim() });
    }
    session.draftTasks = data.tasks || [];
    session.updatedAt = Date.now();

    elements.modalComposerInput.value = "";
    autoResizeTextarea(elements.modalComposerInput);
    setModalMode("execute");
    renderModalMessages();
    renderDraftList();
    renderPlansDrawer();
    setModalStatus("");
    persist();
  } catch (error) {
    setModalStatus(error.message);
  } finally {
    state.pending = false;
    renderModalMessages();
  }
}

function openActiveSessionModal() {
  const session = getActiveSession();
  if (!session) {
    return;
  }

  renderModalMessages();
  renderDraftList();
  autoResizeTextarea(elements.modalComposerInput);
  setModalMode(session.draftTasks?.length ? "execute" : "plan");
  setModalOpen(true);
}

function continueInSession(sessionId, options = {}) {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  state.activeSessionId = session.id;
  state.selectedWindow = { ...session.selection };
  if (state.calendar) {
    state.calendar.gotoDate(session.selection.start);
  }
  renderSelectionBar();
  renderPlansDrawer();
  openActiveSessionModal();

  if (options.mode) {
    setModalMode(options.mode);
  }

  persist();
}

function openPlannerForSelection() {
  if (!state.selectedWindow) {
    return;
  }
  ensureSessionForSelection();
  renderPlansDrawer();
  openActiveSessionModal();
}

function updateEventRecord(event) {
  const index = state.events.findIndex((item) => item.id === event.id);
  if (index < 0) {
    return;
  }
  const existing = state.events[index];
  state.events[index] = {
    ...existing,
    id: event.id,
    title: event.title,
    start: event.start?.toISOString(),
    end: event.end?.toISOString(),
    allDay: event.allDay,
    extendedProps: {
      ...existing.extendedProps,
      ...event.extendedProps,
    },
  };
  persist();
  renderEventDetails();
}

function initializeCalendar() {
  state.calendar = new FullCalendar.Calendar(elements.calendar, {
    initialView: "timeGridWeek",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay",
    },
    selectable: true,
    selectMirror: true,
    unselectAuto: false,
    unselectCancel: "#selectionBar, #aiModal",
    editable: true,
    eventResizableFromStart: true,
    eventDurationEditable: true,
    eventStartEditable: true,
    nowIndicator: true,
    firstDay: 1,
    height: "100%",
    expandRows: true,
    handleWindowResize: true,
    windowResizeDelay: 50,
    slotDuration: "01:00:00",
    slotLabelInterval: "01:00:00",
    eventMinHeight: 18,
    scrollTime: "08:00:00",
    scrollTimeReset: false,
    slotMinTime: "06:00:00",
    slotMaxTime: "23:00:00",
    events: state.events,
    eventContent: renderCalendarEventContent,
    select: (info) => {
      state.selectedWindow = {
        start: info.startStr,
        end: info.endStr,
        allDay: info.allDay,
      };
      state.selectedEventId = null;
      renderSelectionBar();
      renderEventDetails();
      setEventDrawerOpen(false);
    },
    unselect: () => {
      state.selectedWindow = null;
      renderSelectionBar();
    },
    eventClick: (info) => {
      info.jsEvent.preventDefault();
      const sessionId = resolveSessionIdForEvent(info.event);
      if (sessionId) {
        state.selectedEventId = info.event.id;
        setEventDrawerOpen(false);
        continueInSession(sessionId, { mode: "plan" });
        return;
      }
      state.selectedEventId = info.event.id;
      state.selectedWindow = null;
      renderSelectionBar();
      renderEventDetails();
      setEventDrawerOpen(true);
    },
    eventChange: ({ event }) => {
      updateEventRecord(event);
    },
  });

  state.calendar.render();
  syncCalendarEvents();
}

function getPreferredAudioMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  for (const candidate of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(candidate)) {
      return candidate;
    }
  }
  return "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function transcribeRecording(blob) {
  state.sttPending = true;
  elements.modalMicButton.disabled = true;
  setModalStatus("Transcribing...");

  try {
    const mimeType = blob.type || "audio/webm";
    const base64 = await blobToBase64(blob);
    const response = await fetch("/api/stt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64: base64,
        mimeType,
        filename: `recording.${mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm"}`,
        languageHint: navigator.language,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Speech-to-text failed.");
    }

    const prefix = elements.modalComposerInput.value.trim();
    elements.modalComposerInput.value = prefix ? `${prefix} ${data.text}` : data.text;
    autoResizeTextarea(elements.modalComposerInput);
    setModalStatus("");
  } catch (error) {
    setModalStatus(error.message);
  } finally {
    state.sttPending = false;
    elements.modalMicButton.disabled = false;
  }
}

function cleanupRecording() {
  if (state.recordingStream) {
    state.recordingStream.getTracks().forEach((track) => track.stop());
  }
  state.recordingStream = null;
  state.mediaRecorder = null;
  state.recordedChunks = [];
  elements.modalMicButton.textContent = "Mic";
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || state.sttPending) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getPreferredAudioMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    state.recordingStream = stream;
    state.mediaRecorder = recorder;
    state.recordedChunks = [];
    elements.modalMicButton.textContent = "Stop";
    setModalStatus("Recording...");

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    });

    recorder.addEventListener("stop", async () => {
      const chunks = [...state.recordedChunks];
      cleanupRecording();
      if (!chunks.length) {
        setModalStatus("");
        return;
      }
      await transcribeRecording(new Blob(chunks, { type: mimeType || "audio/webm" }));
    });

    recorder.start();
  } catch (error) {
    setModalStatus(`Microphone unavailable: ${error.message}`);
    cleanupRecording();
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") {
    return;
  }
  state.mediaRecorder.stop();
}

elements.plansButton.addEventListener("click", () => setDrawerOpen(true));
elements.plansBackdrop.addEventListener("click", () => setDrawerOpen(false));
elements.closePlansButton.addEventListener("click", () => setDrawerOpen(false));

elements.eventBackdrop.addEventListener("click", () => setEventDrawerOpen(false));
elements.closeEventButton.addEventListener("click", () => setEventDrawerOpen(false));

elements.clearSelectionButton.addEventListener("click", () => {
  state.selectedWindow = null;
  state.calendar.unselect();
  renderSelectionBar();
});

elements.clearSelectionButton.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});

elements.planSelectionButton.addEventListener("click", openPlannerForSelection);
elements.planSelectionButton.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});

elements.aiBackdrop.addEventListener("click", () => setModalOpen(false));
elements.closeModalButton.addEventListener("click", () => setModalOpen(false));
elements.planModeButton.addEventListener("click", () => setModalMode("plan"));
elements.executeModeButton.addEventListener("click", () => setModalMode("execute"));
elements.applyDraftButton.addEventListener("click", applyDraftToCalendar);

elements.modalComposerInput.addEventListener("input", () => {
  autoResizeTextarea(elements.modalComposerInput);
});

elements.modalComposerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendAiMessage(elements.modalComposerInput.value);
});

elements.modalMicButton.addEventListener("click", () => {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    stopRecording();
    return;
  }
  startRecording();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.modalOpen) {
      setModalOpen(false);
    }
    if (state.eventDrawerOpen) {
      setEventDrawerOpen(false);
    }
    if (state.drawerOpen) {
      setDrawerOpen(false);
    }
  }
});

window.addEventListener("resize", () => {
  if (state.calendar) {
    state.calendar.updateSize();
  }
});

loadState();
sortSessions();
hydrateEventSessionLinks();
loadHealth();
renderSelectionBar();
renderEventDetails();
renderPlansDrawer();
initializeCalendar();
