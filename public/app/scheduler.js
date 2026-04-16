export function createId() {
  return crypto.randomUUID();
}

export function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function toDateKey(dateLike) {
  const date = new Date(dateLike);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function minutesToTime(totalMinutes) {
  const safe = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
  const hours = String(Math.floor(safe / 60)).padStart(2, "0");
  const minutes = String(safe % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function getDateKeysInRange(startDateLike, endDateLike, inclusive = true) {
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

export function buildTimedSegments(selection) {
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

export function buildSelectionSegments(selection) {
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

export function scheduleAcrossSegments(tasks, segments, sessionId, color) {
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
