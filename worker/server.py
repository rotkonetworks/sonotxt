#!/usr/bin/env python3
"""
sonotxt speech service
TTS: Qwen3-TTS-12Hz-1.7B-CustomVoice (9 speakers, 11 languages)
ASR: Qwen3-ASR-0.6B (52 languages)
"""
import asyncio
import base64
import io
import logging
import os
import tempfile
import time
from typing import Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Sonotxt Speech Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# global models
tts_model = None
asr_model = None

SPEAKERS = ["serena", "vivian", "uncle_fu", "ryan", "aiden", "ono_anna", "sohee", "eric", "dylan"]
LANGUAGES = ["auto", "chinese", "english", "german", "italian", "portuguese", "spanish", "japanese", "korean", "french", "russian"]


# ── request models ──────────────────────────────────────────────────

class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    speaker: str = Field("ryan", description="Speaker name")
    language: str = Field("auto", description="Language")
    output_format: str = Field("wav", pattern="^(wav|ogg)$")


# ── startup ─────────────────────────────────────────────────────────

@app.on_event("startup")
async def load_models():
    global tts_model, asr_model

    # load TTS
    logger.info("loading qwen3-tts model...")
    try:
        from qwen_tts import Qwen3TTSModel
        model_id = os.getenv("TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
        tts_model = Qwen3TTSModel.from_pretrained(model_id, device_map="cuda")
        logger.info(f"TTS loaded! VRAM: {torch.cuda.memory_allocated()/1e9:.2f} GB")
    except Exception as e:
        logger.error(f"failed to load TTS: {e}")
        raise

    # load ASR
    logger.info("loading qwen3-asr model...")
    try:
        from qwen_asr import Qwen3ASRModel
        asr_id = os.getenv("ASR_MODEL", "Qwen/Qwen3-ASR-0.6B")
        asr_model = Qwen3ASRModel.from_pretrained(
            asr_id,
            dtype=torch.bfloat16,
            device_map="cuda:0",
            max_new_tokens=512,
        )
        logger.info(f"ASR loaded! VRAM: {torch.cuda.memory_allocated()/1e9:.2f} GB")
    except Exception as e:
        logger.error(f"failed to load ASR: {e}")
        raise


# ── TTS ─────────────────────────────────────────────────────────────

def _synthesize(text: str, speaker: str, language: str) -> tuple[np.ndarray, int]:
    wavs, sr = tts_model.generate_custom_voice(
        text=text, speaker=speaker, language=language,
    )
    return wavs[0].astype(np.float32), sr


def encode_audio(audio: np.ndarray, sample_rate: int, fmt: str) -> bytes:
    buf = io.BytesIO()
    if fmt == "wav":
        sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    elif fmt == "ogg":
        sf.write(buf, audio, sample_rate, format="OGG", subtype="VORBIS")
    else:
        raise HTTPException(status_code=400, detail=f"unsupported format: {fmt}")
    return buf.getvalue()


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    """TTS: text → audio bytes"""
    if tts_model is None:
        raise HTTPException(status_code=503, detail="TTS not loaded")

    speaker = req.speaker.lower()
    if speaker not in SPEAKERS:
        raise HTTPException(status_code=400, detail=f"unknown speaker: {req.speaker}. available: {SPEAKERS}")

    language = req.language.lower()
    if language not in LANGUAGES:
        raise HTTPException(status_code=400, detail=f"unknown language: {req.language}. available: {LANGUAGES}")

    try:
        logger.info(f"TTS: {len(req.text)} chars, speaker={speaker}, lang={language}")
        t0 = time.time()
        audio_data, sample_rate = await asyncio.to_thread(_synthesize, req.text, speaker, language)
        dt = time.time() - t0
        duration = len(audio_data) / sample_rate
        logger.info(f"TTS done in {dt:.2f}s, audio={duration:.2f}s, RTF={dt/max(duration,0.01):.2f}x")

        audio_bytes = encode_audio(audio_data, sample_rate, req.output_format)
        content_type = "audio/wav" if req.output_format == "wav" else "audio/ogg"
        return Response(content=audio_bytes, media_type=content_type)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"TTS failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/synthesize_json")
async def synthesize_json(req: SynthesizeRequest) -> dict:
    """TTS: text → base64 audio JSON"""
    if tts_model is None:
        raise HTTPException(status_code=503, detail="TTS not loaded")

    speaker = req.speaker.lower()
    if speaker not in SPEAKERS:
        raise HTTPException(status_code=400, detail=f"unknown speaker: {req.speaker}. available: {SPEAKERS}")

    try:
        t0 = time.time()
        audio_data, sample_rate = await asyncio.to_thread(_synthesize, req.text, speaker, req.language.lower())
        dt = time.time() - t0
        duration = len(audio_data) / sample_rate
        audio_bytes = encode_audio(audio_data, sample_rate, req.output_format)

        return {
            "audio_base64": base64.b64encode(audio_bytes).decode("ascii"),
            "sample_rate": sample_rate,
            "duration_seconds": round(duration, 2),
            "generation_seconds": round(dt, 2),
            "format": req.output_format,
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"TTS failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ── ASR ─────────────────────────────────────────────────────────────

def _transcribe(audio_path: str, language: Optional[str]) -> dict:
    results = asr_model.transcribe(audio=audio_path, language=language)
    r = results[0]
    return {"language": r.language, "text": r.text}


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None),
):
    """ASR: audio file → text"""
    if asr_model is None:
        raise HTTPException(status_code=503, detail="ASR not loaded")

    try:
        # save upload to temp file (qwen-asr needs a file path)
        suffix = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            content = await audio.read()
            tmp.write(content)
            tmp_path = tmp.name

        logger.info(f"ASR: {len(content)/1024:.1f}KB, lang={language}")
        t0 = time.time()
        result = await asyncio.to_thread(_transcribe, tmp_path, language)
        dt = time.time() - t0
        logger.info(f"ASR done in {dt:.2f}s: [{result['language']}] {result['text'][:80]}")

        os.unlink(tmp_path)
        return {**result, "processing_seconds": round(dt, 2)}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"ASR failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


class TranscribeBase64Request(BaseModel):
    audio_base64: str
    language: Optional[str] = None


@app.post("/transcribe_base64")
async def transcribe_base64(req: TranscribeBase64Request):
    """ASR: base64 audio → text (for browser/JS clients)"""
    if asr_model is None:
        raise HTTPException(status_code=503, detail="ASR not loaded")

    try:
        audio_bytes = base64.b64decode(req.audio_base64)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        logger.info(f"ASR(b64): {len(audio_bytes)/1024:.1f}KB, lang={req.language}")
        t0 = time.time()
        result = await asyncio.to_thread(_transcribe, tmp_path, req.language)
        dt = time.time() - t0
        logger.info(f"ASR done in {dt:.2f}s: [{result['language']}] {result['text'][:80]}")

        os.unlink(tmp_path)
        return {**result, "processing_seconds": round(dt, 2)}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"ASR failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ── health ──────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "tts_loaded": tts_model is not None,
        "asr_loaded": asr_model is not None,
        "speakers": SPEAKERS,
        "languages": LANGUAGES,
        "vram_gb": round(torch.cuda.memory_allocated() / 1e9, 2) if torch.cuda.is_available() else 0,
    }


@app.get("/")
async def root():
    return {
        "service": "sonotxt-speech",
        "models": {
            "tts": "Qwen3-TTS-12Hz-1.7B-CustomVoice",
            "asr": "Qwen3-ASR-0.6B",
        },
        "endpoints": {
            "synthesize": "POST /synthesize (text → audio bytes)",
            "synthesize_json": "POST /synthesize_json (text → base64 JSON)",
            "transcribe": "POST /transcribe (audio file upload → text)",
            "transcribe_base64": "POST /transcribe_base64 (base64 audio → text)",
            "health": "GET /health",
        },
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
