# Pitch notes (2–3 minutes)

## 1. Problem (20 s)
- In meetings we nod along to acronyms we don't know, let wrong claims slide, and forget who promised what.
- Searching or asking a chatbot mid-meeting means you stop listening, and you have to know what to ask.

## 2. Solution (20 s)
- **ProActive Assistant** listens with you and speaks up **only when it's worth it**: it explains jargon, flags claims that look wrong, suggests a sharp question, and captures decisions and action items as they happen.
- When the meeting ends, the notes are already written.

## 3. Live demo (75 s)
1. Press **Play demo** to start a scripted enterprise launch meeting with 4 speakers. Point out the live transcript and speaker labels from **Muse Voice Transcribe**.
2. "SOC 2 Type 2" and "p95" come up, and definition cards slide in. The STT hears "page 95"; **Muse Wonder** still explains p95 correctly.
3. A salesperson says GDPR fines max out at €1M. A **fact-check card** corrects it: €20M or 4% of global turnover.
4. Click the card's quote to jump to that moment in the transcript. Click **Tell me more** for a deeper explanation.
5. Decision and action-item cards appear ("Priya, GDPR summary by Thursday").
6. Click **End & summarize** to get the summary, decisions and an owner/due checklist, then **Export .md**.

_Backup:_ if the Wi-Fi is bad, toggle **Offline mode**. The same demo runs fully in the browser.

## 4. Technical highlights (30 s)
- Browser AudioWorklet resamples to 24 kHz PCM16 and streams it over one WebSocket to a Node server that holds the keys.
- Muse Voice Transcribe realtime: diarization, keyword biasing for jargon, auto-reconnect with audio replay, rotation before the 60-minute session cap.
- Muse Wonder with **strict JSON-schema structured output**. A trigger engine (word count, natural pause, min interval, stale-request abort) plus Zod validation, confidence filtering, de-duplication and quote anchoring keep the panel calm.
- Adapter pattern with mock providers: the whole app runs end-to-end without keys. No server-side storage.

## 5. Roadmap (15 s)
- Desktop app to capture system audio from any meeting app; Zoom/Meet bots.
- Personal knowledge base (RAG over your docs, CRM, wiki), so insights include *your* context.
- Multilingual meetings with live translation of insights (Muse already handles 25 languages and code-switching).
- Push action items to Jira, Linear or Asana, and follow-ups to email.
