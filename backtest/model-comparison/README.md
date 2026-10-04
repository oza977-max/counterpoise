# Model comparison — 2026-10-04 (evidence for requirements round 18)

**Question:** how well do free models read a written use-case description into the facts the rules engine needs, and do the follow-up questions differ per case?

**Method:** all 31 descriptions in `backtest/cases.json` were run through the app's real extractor, question generator and engine (a throwaway harness — `harness.test.ts.txt` — in a scratch copy; no app code changed). Countries were taken from the case (the person ticks them on screen). Scored against each case's correct graph and the engine's expected verdict (`backtest/engine-verdicts.json`). Cloud models were called through the local Ollama app after `ollama signin`; because Ollama's cloud ignores the strict `format` setting the app uses, the scratch copy asked for the answer as a tool call with the field list in the prompt.

| | qwen3:4b (on this computer) | gemma4:cloud (Ollama, free tier) | gpt-oss:120b-cloud (Ollama, free tier) |
|---|---|---|---|
| Descriptions read successfully | 31/31 | 31/31 | 26/31 (5 server errors) |
| Verdict fully right (status and tier) | 6/31 | **21/31** | 16/26 |
| Verdict status right | 16/31 | **28/31** | 21/26 |
| Card details right (419 field checks) | 34% | **57%** | 54% (of 351) |
| Median time per case | 16 s | **2 s** | 5 s |
| Follow-up questions per case (median) | 9 | 14 | 11.5 |
| Average overlap of question sets between two cases | 0.42 | 0.78 | 0.61 |

**Findings**
1. The small local model is weak at interpretation; the free cloud `gemma4` is clearly better (21 vs 6 fully right verdicts) and faster.
2. Repetitive follow-up questions are NOT mainly a model problem: the app asks about every detail the description did not state word for word ("guessed fields" — 13.4 per case with gemma4). Descriptions rarely state where data is held, the kind of AI or its autonomy, so most cases get the same block of questions. A stronger model asked more, and more similar, questions.
3. The guided form (no AI) already sets every one of the 15 details the rules test; every question is required and "Not sure" takes the strictest reading.
4. Paid-only cloud models on the free account at the time: deepseek-v4.1-flash, glm-5.3, minimax-m3, kimi-k3. Retired: several older cloud models (Ollama retires cloud models periodically).

Raw results: the three `2026-10-04-*.json` files (one record per case: extracted details vs truth, questions asked, verdict vs expected).
