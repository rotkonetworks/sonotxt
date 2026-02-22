#!/usr/bin/env python3
"""
vibevoice tts inference service
runs on bkk07 with gpu for fast inference
"""
import asyncio
import io
import logging
import os
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="VibeVoice TTS Service")

# global model instance (loaded on startup)
model = None
processor = None
device = None


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    voice: Optional[str] = "default"
    speed: float = Field(1.0, ge=0.5, le=2.0)
    output_format: str = Field("wav", pattern="^(wav|ogg|mp3)$")
    max_length: int = Field(5400, ge=100, le=10800)  # max tokens, ~90min at 7.5Hz


class SynthesizeResponse(BaseModel):
    audio_bytes: bytes
    sample_rate: int
    duration_seconds: float
    format: str


@app.on_event("startup")
async def load_model():
    """load vibevoice model on startup"""
    global model, processor, device

    logger.info("loading vibevoice model...")

    # check for gpu (works with both nvidia cuda and amd rocm)
    if torch.cuda.is_available():
        device = "cuda"
        device_name = torch.cuda.get_device_name(0)
        device_memory = torch.cuda.get_device_properties(0).total_memory / 1024**3
        logger.info(f"using device: {device_name} ({device_memory:.1f}GB vram)")
    else:
        device = "cpu"
        logger.warning("no gpu detected - inference will be slow!")

    try:
        # try to import vibevoice
        # note: actual vibevoice api may differ, this is placeholder
        from transformers import AutoModel, AutoProcessor

        model_name = os.getenv("VIBEVOICE_MODEL", "microsoft/VibeVoice-TTS-1.5B")

        logger.info(f"loading {model_name}...")
        processor = AutoProcessor.from_pretrained(model_name)
        model = AutoModel.from_pretrained(
            model_name,
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
            device_map=device
        )

        logger.info("model loaded successfully")

    except ImportError:
        logger.error("vibevoice not installed - using mock mode")
        # fallback to mock for development
        model = "mock"
    except Exception as e:
        logger.error(f"failed to load model: {e}")
        raise


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest) -> dict:
    """synthesize speech from text"""

    if model is None:
        raise HTTPException(status_code=503, detail="model not loaded")

    try:
        # mock implementation until vibevoice is properly integrated
        if model == "mock":
            logger.warning("using mock synthesis")
            audio_data, sample_rate = generate_mock_audio(req.text, req.speed)
        else:
            # actual vibevoice inference
            audio_data, sample_rate = await synthesize_vibevoice(
                req.text,
                req.voice,
                req.speed,
                req.max_length
            )

        # encode audio to requested format
        audio_bytes = encode_audio(audio_data, sample_rate, req.output_format)

        duration_seconds = len(audio_data) / sample_rate

        logger.info(f"synthesized {len(req.text)} chars -> {duration_seconds:.2f}s audio")

        return {
            "audio_base64": audio_bytes.hex(),  # send as hex for json
            "sample_rate": sample_rate,
            "duration_seconds": duration_seconds,
            "format": req.output_format
        }

    except Exception as e:
        logger.error(f"synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def synthesize_vibevoice(
    text: str,
    voice: str,
    speed: float,
    max_length: int
) -> tuple[np.ndarray, int]:
    """call vibevoice model for synthesis"""

    # prepare inputs
    inputs = processor(
        text=text,
        return_tensors="pt",
        max_length=max_length,
        truncation=True
    ).to(device)

    # run inference
    with torch.no_grad():
        # note: actual vibevoice api may differ
        outputs = model.generate(
            **inputs,
            speed=speed,
            # add voice/speaker parameters as needed
        )

    # extract audio
    audio_array = outputs.audio[0].cpu().numpy()
    sample_rate = model.config.sampling_rate

    return audio_array, sample_rate


def generate_mock_audio(text: str, speed: float) -> tuple[np.ndarray, int]:
    """generate mock audio for testing (sine wave)"""
    sample_rate = 24000
    duration = len(text) * 0.05 / speed  # ~50ms per char

    t = np.linspace(0, duration, int(sample_rate * duration))
    # simple sine wave
    audio = np.sin(2 * np.pi * 440 * t) * 0.3

    return audio.astype(np.float32), sample_rate


def encode_audio(audio: np.ndarray, sample_rate: int, format: str) -> bytes:
    """encode audio array to bytes in requested format"""

    buf = io.BytesIO()

    if format == "wav":
        sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    elif format == "ogg":
        sf.write(buf, audio, sample_rate, format="OGG", subtype="VORBIS")
    elif format == "mp3":
        # mp3 requires additional deps or ffmpeg
        raise HTTPException(status_code=501, detail="mp3 not yet implemented")
    else:
        raise HTTPException(status_code=400, detail=f"unsupported format: {format}")

    return buf.getvalue()


@app.get("/health")
async def health():
    """health check endpoint"""
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "device": device if device else "unknown"
    }


@app.get("/")
async def root():
    return {
        "service": "vibevoice-tts",
        "status": "running",
        "endpoints": {
            "synthesize": "POST /synthesize",
            "health": "GET /health"
        }
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8200"))
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        access_log=True
    )
