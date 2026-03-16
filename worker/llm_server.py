#!/usr/bin/env python3
"""sonotxt LLM chat service — Qwen3.5-4B-Instruct with 4-bit quantization"""
import json
import logging
import os
import re
import time

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = FastAPI(title="Sonotxt LLM")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

model = None
tokenizer = None

SYSTEM_PROMPT = (
    "You are a helpful voice assistant. Keep responses concise — "
    "2-3 short sentences max. No markdown, no bullet points, no special formatting. "
    "Speak naturally as if in conversation."
)


class ChatRequest(BaseModel):
    messages: list = Field(..., description="OpenAI-style messages")
    max_tokens: int = Field(512, ge=1, le=4096)
    temperature: float = Field(1.0, ge=0.0, le=2.0)
    top_p: float = Field(1.0, ge=0.0, le=1.0)


@app.on_event("startup")
async def load():
    global model, tokenizer
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    model_id = os.getenv("LLM_MODEL", "Qwen/Qwen3.5-4B")
    use_4bit = os.getenv("LLM_QUANTIZE", "1") == "1"
    logger.info(f"loading {model_id} (4-bit={use_4bit})...")
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    if use_4bit:
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_quant_type="nf4",
        )
        model = AutoModelForCausalLM.from_pretrained(
            model_id, quantization_config=bnb_config, device_map="cuda:0"
        )
    else:
        model = AutoModelForCausalLM.from_pretrained(
            model_id, torch_dtype=torch.bfloat16, device_map="cuda:0"
        )
    model.eval()
    # Free peak loading memory so speech service can fit
    import gc
    gc.collect()
    torch.cuda.empty_cache()
    logger.info(f"LLM loaded! VRAM: {torch.cuda.memory_allocated()/1e9:.2f} GB (reserved: {torch.cuda.memory_reserved()/1e9:.2f} GB)")


def split_sentences(text):
    """Split text into sentences on .!? followed by space or end."""
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


@app.post("/chat")
async def chat(req: ChatRequest):
    """Generate full response."""
    if model is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    try:
        has_system = any(m.get("role") == "system" for m in req.messages)
        msgs = req.messages if has_system else [{"role": "system", "content": SYSTEM_PROMPT}] + req.messages
        text = tokenizer.apply_chat_template(
            msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
        inputs = tokenizer(text, return_tensors="pt").to(model.device)
        t0 = time.time()
        with torch.no_grad():
            out = model.generate(
                **inputs,
                max_new_tokens=req.max_tokens,
                temperature=max(req.temperature, 0.01),
                top_p=req.top_p,
                top_k=20,
                do_sample=True,
            )
        dt = time.time() - t0
        new_tokens = out[0][inputs["input_ids"].shape[1] :]
        response = tokenizer.decode(new_tokens, skip_special_tokens=True)
        logger.info(f"chat: {len(req.messages)} msgs -> {len(new_tokens)} tok in {dt:.2f}s")
        return {
            "response": response,
            "tokens": len(new_tokens),
            "generation_seconds": round(dt, 2),
        }
    except Exception as e:
        import traceback

        logger.error(f"chat failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat_sentences")
async def chat_sentences(req: ChatRequest):
    """Generate response, return as list of sentences (for pipelined TTS)."""
    if model is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    try:
        has_system = any(m.get("role") == "system" for m in req.messages)
        msgs = req.messages if has_system else [{"role": "system", "content": SYSTEM_PROMPT}] + req.messages
        text = tokenizer.apply_chat_template(
            msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
        inputs = tokenizer(text, return_tensors="pt").to(model.device)

        t0 = time.time()
        with torch.no_grad():
            out = model.generate(
                **inputs,
                max_new_tokens=req.max_tokens,
                temperature=max(req.temperature, 0.01),
                top_p=req.top_p,
                top_k=20,
                do_sample=True,
            )
        dt = time.time() - t0
        new_tokens = out[0][inputs["input_ids"].shape[1] :]
        full_response = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
        sentences = split_sentences(full_response)
        logger.info(
            f"chat_sentences: {len(new_tokens)} tok -> {len(sentences)} sentences in {dt:.2f}s"
        )
        return {
            "sentences": sentences,
            "full_response": full_response,
            "tokens": len(new_tokens),
            "generation_seconds": round(dt, 2),
        }
    except Exception as e:
        import traceback

        logger.error(f"chat failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat_stream")
async def chat_stream(req: ChatRequest):
    """Stream sentences as they complete via SSE.

    Emits server-sent events:
      data: {"event":"sentence","text":"First sentence.","index":0}
      data: {"event":"sentence","text":"Second sentence.","index":1}
      data: {"event":"done","full_response":"...","tokens":42,"generation_seconds":1.5}

    The client can start TTS on each sentence immediately without
    waiting for the full response — cutting perceived latency in half.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="model not loaded")

    from transformers import TextIteratorStreamer
    import threading

    has_system = any(m.get("role") == "system" for m in req.messages)
    msgs = req.messages if has_system else [{"role": "system", "content": SYSTEM_PROMPT}] + req.messages
    text = tokenizer.apply_chat_template(
        msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False
    )
    inputs = tokenizer(text, return_tensors="pt").to(model.device)

    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

    gen_kwargs = dict(
        **inputs,
        max_new_tokens=req.max_tokens,
        temperature=max(req.temperature, 0.01),
        top_p=req.top_p,
        top_k=20,
        do_sample=True,
        streamer=streamer,
    )

    # Generate in a background thread (model.generate blocks)
    t0 = time.time()
    thread = threading.Thread(target=lambda: model.generate(**gen_kwargs))
    thread.start()

    async def event_stream():
        buffer = ""
        sentence_idx = 0
        total_tokens = 0

        for chunk in streamer:
            buffer += chunk
            total_tokens += 1

            # Check if we have a complete sentence
            while re.search(r"[.!?]\s", buffer):
                match = re.search(r"[.!?]\s", buffer)
                sentence = buffer[: match.end()].strip()
                buffer = buffer[match.end() :]
                if sentence:
                    yield f"data: {json.dumps({'event': 'sentence', 'text': sentence, 'index': sentence_idx})}\n\n"
                    sentence_idx += 1

        # Flush remaining buffer as final sentence
        if buffer.strip():
            yield f"data: {json.dumps({'event': 'sentence', 'text': buffer.strip(), 'index': sentence_idx})}\n\n"
            sentence_idx += 1

        thread.join()
        dt = time.time() - t0
        logger.info(f"chat_stream: {total_tokens} tok -> {sentence_idx} sentences in {dt:.2f}s")

        yield f"data: {json.dumps({'event': 'done', 'sentences': sentence_idx, 'tokens': total_tokens, 'generation_seconds': round(dt, 2)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "model": os.getenv("LLM_MODEL", "Qwen/Qwen3.5-4B"),
        "vram_gb": round(torch.cuda.memory_allocated() / 1e9, 2)
        if torch.cuda.is_available()
        else 0,
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8090"))
    uvicorn.run("llm_server:app", host="0.0.0.0", port=port, log_level="info")
