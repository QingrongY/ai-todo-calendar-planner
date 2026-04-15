# AI-ToDo Calendar Planner

Calendar-first AI planning prototype for the HCAI course project.

## What it does

- Uses a real calendar as the main interaction surface
- Lets the user select a date or time range
- Opens an AI planning dialog for that selected window
- Breaks a larger goal into smaller draft tasks with AIMLAPI
- Applies accepted draft tasks back onto the calendar as editable events
- Supports speech-to-text input through AIMLAPI STT

## Run locally

1. Export your AIMLAPI key:

```bash
export AIMLAPI_KEY="your_key_here"
```

2. Start the local server:

```bash
npm start
```

3. Open:

```text
http://localhost:4321
```

## Tech

- Vanilla JavaScript
- Node.js local server
- FullCalendar
- AIMLAPI Chat Completions
- AIMLAPI Speech-to-Text

## Notes

- The repository does not include any API keys or private course files.
- FullCalendar is loaded from CDN in the browser.
