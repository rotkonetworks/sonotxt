#!/usr/bin/env python3
"""
vibevoice tts inference service
uses VibeVoice-Realtime-0.5B streaming model with pre-computed voice presets
"""
import asyncio
import copy
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
voice_presets = {}  # voice_id -> path to .pt file

VOICES_DIR = os.getenv(
    "VIBEVOICE_VOICES_DIR",
    os.path.join(os.path.dirname(__file__), "..", "VibeVoice", "demo", "voices", "streaming_model"),
)
# fallback: check the source checkout
if not os.path.exists(VOICES_DIR):
    VOICES_DIR = os.path.expanduser("~/src/VibeVoice/demo/voices/streaming_model")


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    voice: Optional[str] = "en-Mike_man"
    speed: float = Field(1.0, ge=0.5, le=2.0)
    output_format: str = Field("wav", pattern="^(wav|ogg|mp3)$")
    max_length: int = Field(5400, ge=100, le=10800)


@app.on_event("startup")
async def load_model():
    """load vibevoice streaming model on startup"""
    global model, processor, device, voice_presets

    logger.info("loading vibevoice streaming model...")

    # detect gpu
    if torch.cuda.is_available():
        device = "cuda"
        device_name = torch.cuda.get_device_name(0)
        device_memory = torch.cuda.get_device_properties(0).total_memory / 1024**3
        logger.info(f"using device: {device_name} ({device_memory:.1f}GB vram)")
    else:
        device = "cpu"
        logger.warning("no gpu detected - inference will be slow!")

    # load voice presets
    if os.path.exists(VOICES_DIR):
        for f in os.listdir(VOICES_DIR):
            if f.endswith(".pt"):
                voice_id = f[:-3]  # strip .pt
                voice_presets[voice_id] = os.path.join(VOICES_DIR, f)
        # add short aliases: en-Mike_man -> Mike
        aliases = {}
        for vid in list(voice_presets.keys()):
            parts = vid.split("-", 1)
            if len(parts) == 2:
                name = parts[1].split("_")[0]
                aliases[name] = voice_presets[vid]
        voice_presets.update(aliases)
        logger.info(f"loaded {len([f for f in os.listdir(VOICES_DIR) if f.endswith('.pt')])} voice presets from {VOICES_DIR}")
    else:
        logger.warning(f"voices directory not found: {VOICES_DIR}")

    try:
        from vibevoice.modular.modeling_vibevoice_streaming_inference import (
            VibeVoiceStreamingForConditionalGenerationInference,
        )
        from vibevoice.processor.vibevoice_streaming_processor import VibeVoiceStreamingProcessor

        model_name = os.getenv("VIBEVOICE_MODEL", "microsoft/VibeVoice-Realtime-0.5B")
        logger.info(f"loading {model_name}...")

        processor = VibeVoiceStreamingProcessor.from_pretrained(model_name)

        if device == "cuda":
            load_dtype = torch.bfloat16
            attn_impl = "flash_attention_2"
        else:
            load_dtype = torch.float32
            attn_impl = "sdpa"

        try:
            model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                model_name,
                torch_dtype=load_dtype,
                device_map=device,
                attn_implementation=attn_impl,
            )
        except Exception:
            if attn_impl == "flash_attention_2":
                logger.warning("flash_attention_2 failed, falling back to sdpa")
                model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                    model_name,
                    torch_dtype=load_dtype,
                    device_map=device,
                    attn_implementation="sdpa",
                )
            else:
                raise

        model.eval()
        model.set_ddpm_inference_steps(num_steps=5)
        logger.info("model loaded successfully")

    except Exception as e:
        logger.error(f"failed to load model: {e}")
        raise


def resolve_voice(voice_id: str) -> str:
    """resolve voice id to .pt file path"""
    if voice_id in voice_presets:
        return voice_presets[voice_id]
    # try case-insensitive
    for k, v in voice_presets.items():
        if k.lower() == voice_id.lower():
            return v
    # default to Mike
    if "en-Mike_man" in voice_presets:
        return voice_presets["en-Mike_man"]
    if voice_presets:
        return next(iter(voice_presets.values()))
    raise HTTPException(status_code=400, detail="no voice presets available")


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest) -> dict:
    """synthesize speech from text"""
    if model is None:
        raise HTTPException(status_code=503, detail="model not loaded")

    try:
        voice_path = resolve_voice(req.voice or "en-Mike_man")
        logger.info(f"synthesizing {len(req.text)} chars with voice {req.voice} -> {os.path.basename(voice_path)}")

        audio_data, sample_rate = await asyncio.to_thread(
            _synthesize, req.text, voice_path, req.max_length
        )

        audio_bytes = encode_audio(audio_data, sample_rate, req.output_format)
        duration_seconds = len(audio_data) / sample_rate

        logger.info(f"synthesized {len(req.text)} chars -> {duration_seconds:.2f}s audio")

        return {
            "audio_base64": audio_bytes.hex(),
            "sample_rate": sample_rate,
            "duration_seconds": duration_seconds,
            "format": req.output_format,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"synthesis failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


def _synthesize(text: str, voice_path: str, max_length: int) -> tuple[np.ndarray, int]:
    """run vibevoice inference (blocking, called from thread)"""
    target_device = device if device != "cpu" else "cpu"

    # load voice preset kv cache
    all_prefilled = torch.load(voice_path, map_location=target_device, weights_only=False)

    # normalize quotes
    text = text.replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')

    # prepare inputs using cached prompt
    inputs = processor.process_input_with_cached_prompt(
        text=text,
        cached_prompt=all_prefilled,
        padding=True,
        return_tensors="pt",
        return_attention_mask=True,
    )

    for k, v in inputs.items():
        if torch.is_tensor(v):
            inputs[k] = v.to(target_device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=None,
            cfg_scale=1.5,
            tokenizer=processor.tokenizer,
            generation_config={"do_sample": False},
            verbose=False,
            all_prefilled_outputs=copy.deepcopy(all_prefilled),
        )

    # extract audio from model output - generate() returns VibeVoiceGenerationOutput
    # with speech_outputs containing already-decoded audio tensors per sample
    if outputs.speech_outputs is None or outputs.speech_outputs[0] is None:
        raise RuntimeError("model generated no audio")

    audio_tensor = outputs.speech_outputs[0]  # first sample in batch
    if isinstance(audio_tensor, torch.Tensor):
        audio_array = audio_tensor.cpu().float().numpy()
    else:
        audio_array = np.array(audio_tensor, dtype=np.float32)

    if audio_array.ndim > 1:
        audio_array = audio_array.squeeze()

    sample_rate = 24000  # vibevoice streaming default
    return audio_array.astype(np.float32), sample_rate


def encode_audio(audio: np.ndarray, sample_rate: int, fmt: str) -> bytes:
    """encode audio array to bytes"""
    buf = io.BytesIO()
    if fmt == "wav":
        sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    elif fmt == "ogg":
        sf.write(buf, audio, sample_rate, format="OGG", subtype="VORBIS")
    else:
        raise HTTPException(status_code=400, detail=f"unsupported format: {fmt}")
    return buf.getvalue()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "device": device or "unknown",
        "voices": list(voice_presets.keys()),
    }


@app.get("/")
async def root():
    return {
        "service": "vibevoice-tts",
        "status": "running",
        "endpoints": {
            "synthesize": "POST /synthesize",
            "health": "GET /health",
        },
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8200"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, log_level="info", access_log=True)
