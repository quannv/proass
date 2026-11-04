# Pitch notes (2–3 minutes)

## 1. Problem (20 s)
- In meetings we nod along to acronyms we don't know, let wrong claims slide, and forget who promised what.
- Searching or asking a chatbot mid-meeting means you stop listening, and you have to know what to ask.

## 2. Solution (20 s)
- **ProActive Assistant** listens with you and speaks up **only when it's worth it**: it explains jargon, flags claims that look wrong (checking live prices and news on the web when it matters), suggests a sharp question, and captures decisions and action items as they happen.
- When the meeting ends, the notes are already written.

## 3. Live demo (75 s)
1. Press **Play demo**: the Viettrans.info team plans how to fund machine translation for Vietnam's ethnic minority languages. Point out the live transcript from **Muse Voice Transcribe**: four speakers, each with an avatar, a name and a share-of-talk bar.
2. Quang says minorities are "only about two percent" of the population. A **fact-check card** corrects it: about 14.7%, 14 million people (2019 census).
3. "NLLB", "back translation", "BLEU and chrF" come up, and definition cards explain them.
4. Quang converts a $50,000 grant at "twenty thousand dong". The panel shows **Searching: …**, and a fact-check card arrives with today's exchange rate: live web search.
5. Click the card's quote to jump to that moment in the transcript. Click **Tell me more** for a deeper explanation.
6. Decision and action-item cards appear ("Quang: grant proposal by next Friday").
7. Click **End & summarize** to get the summary, decisions and an owner/due checklist, then **Export .md**.
8. _Optional:_ click "Speaker A" in a real meeting to rename them; new insights and the notes use the name.

_Backup:_ if the Wi-Fi is bad, toggle **Offline mode**. The same demo runs fully in the browser.

## 4. Technical highlights (30 s)
- Browser AudioWorklet resamples to 24 kHz PCM16 and streams it over one WebSocket to a Node server that holds the keys.
- Muse Voice Transcribe realtime: diarization, keyword biasing for jargon, auto-reconnect with audio replay, rotation before the 60-minute session cap.
- Muse Wonder with **strict JSON-schema structured output** plus a `web_search` function tool, answered by Muse's built-in search on the Responses API. It only searches for facts that change over time, so normal cards stay at ~3–7 s. A trigger engine (word count, natural pause, min interval, one call at a time) plus Zod validation, confidence filtering, de-duplication and quote anchoring keep the panel calm.
- Adapter pattern with mock providers: the whole app runs end-to-end without keys. No server-side storage.
- Deployed on AWS: ECS Fargate behind an HTTPS load balancer (keys in Secrets Manager, per-IP rate and concurrency limits) and the web app on Amplify.

## 5. Roadmap (15 s)
- Mobile app (iOS and Android) for in-person meetings: put your phone on the table and get insights there.
- Better accuracy in noisy rooms: noise suppression before transcription, and fine-tuning on noisy, accented and code-switched meeting audio.
- Desktop app to capture system audio from any meeting app; Zoom/Meet bots.
- Personal knowledge base (RAG over your docs, CRM, wiki), so insights include *your* context.
- Multilingual meetings with live translation of insights, including Vietnamese-English code-switching as transcription support improves.
- Push action items to Jira, Linear or Asana, and follow-ups to email.
