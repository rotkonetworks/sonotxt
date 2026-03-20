#!/usr/bin/env python3
"""E2E latency benchmark — run on the GPU machine itself (localhost).
Tests both sequential and pipelined (concurrent TTS) approaches."""
import requests, time, base64, json, asyncio, aiohttp

url = "http://localhost"

print("=== E2E benchmark (localhost, no network) ===\n")

# Generate test audio first
r = requests.post(f"{url}:8080/synthesize", json={"text": "The weather is nice today.", "speaker": "ryan", "language": "english"})
wav = r.content
b64 = base64.b64encode(wav).decode()

# --- Batch pipeline (sequential) ---
print("--- BATCH (sequential) ---")
t0 = time.time()
r = requests.post(f"{url}:8080/transcribe_base64", json={"audio_base64": b64})
transcript = r.json()["text"]
t_asr = time.time() - t0

t1 = time.time()
r = requests.post(f"{url}:8090/chat_sentences", json={"messages": [{"role": "user", "content": transcript}]})
llm = r.json()
t_llm = time.time() - t1

t2 = time.time()
for s in llm["sentences"]:
    requests.post(f"{url}:8080/synthesize", json={"text": s, "speaker": "ryan", "language": "english"})
t_tts = time.time() - t2
total = time.time() - t0

print(f"ASR: {t_asr:.2f}s  LLM: {t_llm:.2f}s  TTS: {t_tts:.2f}s ({len(llm['sentences'])} sentences)")
print(f"TOTAL: {total:.2f}s  first audio at: {total:.2f}s\n")

# --- Streaming + sequential TTS ---
print("--- STREAM (sequential TTS) ---")
t0 = time.time()
r = requests.post(f"{url}:8080/transcribe_base64", json={"audio_base64": b64})
transcript = r.json()["text"]

r = requests.post(f"{url}:8090/chat_stream",
    json={"messages": [{"role": "user", "content": transcript}]}, stream=True)
first_audio = None
for line in r.iter_lines():
    if not line: continue
    line = line.decode()
    if not line.startswith("data: "): continue
    event = json.loads(line[6:])
    if event.get("event") == "sentence":
        requests.post(f"{url}:8080/synthesize",
            json={"text": event["text"], "speaker": "ryan", "language": "english"})
        if first_audio is None:
            first_audio = time.time() - t0
total = time.time() - t0
print(f"TOTAL: {total:.2f}s  first audio at: {first_audio:.2f}s\n")

# --- Streaming + pipelined TTS (async, overlapped) ---
print("--- STREAM + PIPELINED TTS (concurrent) ---")

async def pipeline():
    t0 = time.time()

    # ASR
    async with aiohttp.ClientSession() as session:
        async with session.post(f"{url}:8080/transcribe_base64",
            json={"audio_base64": b64}) as r:
            transcript = (await r.json())["text"]
    t_asr = time.time() - t0
    print(f"  ASR: {t_asr:.2f}s")

    # LLM stream → fire TTS concurrently as sentences arrive
    first_audio = None
    tts_tasks = []

    async def tts_sentence(text, idx):
        nonlocal first_audio
        st = time.time()
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{url}:8080/synthesize",
                json={"text": text, "speaker": "ryan", "language": "english"}) as r:
                data = await r.read()
        tt = time.time() - st
        if first_audio is None:
            first_audio = time.time() - t0
        print(f'  [{idx}] TTS {tt:.2f}s  "{text[:50]}"')
        return data

    async with aiohttp.ClientSession() as session:
        async with session.post(f"{url}:8090/chat_stream",
            json={"messages": [{"role": "user", "content": transcript}]}) as r:
            idx = 0
            async for line in r.content:
                line = line.decode().strip()
                if not line.startswith("data: "): continue
                event = json.loads(line[6:])
                if event.get("event") == "sentence":
                    idx += 1
                    # Fire TTS concurrently — don't await, just schedule
                    task = asyncio.create_task(tts_sentence(event["text"], idx))
                    tts_tasks.append(task)
                elif event.get("event") == "done":
                    tok = event.get("tokens", 0)
                    gen = event.get("generation_seconds", 0)
                    print(f"  LLM: {tok} tok in {gen}s")

    # Wait for all TTS to finish
    if tts_tasks:
        await asyncio.gather(*tts_tasks)

    total = time.time() - t0
    print(f"\nPIPELINED TOTAL: {total:.2f}s")
    if first_audio:
        print(f"TIME TO FIRST AUDIO: {first_audio:.2f}s")

asyncio.run(pipeline())
