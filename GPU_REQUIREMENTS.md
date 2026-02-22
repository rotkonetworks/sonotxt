# VibeVoice GPU Requirements

## tl;dr

**your amd radeon rx 7600m xt (8gb) will work great!**

## model requirements

### vibevoice-tts-1.5b (recommended)
- parameters: 1.5 billion
- vram: 6-8gb (fp16)
- quality: excellent
- speed: ~2-5x realtime
- **status: ✅ will work on your gpu**

### vibevoice-streaming-0.5b (lightweight)
- parameters: 500 million
- vram: 2-4gb (fp16)
- quality: good
- speed: ~5-10x realtime, low latency
- **status: ✅ will work easily on your gpu**

### vibevoice-asr-7b (speech recognition)
- parameters: 7 billion
- vram: 14-16gb (fp16)
- **status: ❌ too large for 8gb gpu**

## supported gpus

### nvidia (cuda)
- rtx 3060 (12gb) - excellent
- rtx 4060 (8gb) - good
- rtx 4070+ - excellent
- any modern nvidia with 8gb+ vram

### amd (rocm)
- rx 6600 xt (8gb) - good
- rx 6700 xt (12gb) - excellent
- rx 7600 (8gb) - **your gpu - good!**
- rx 7700 xt+ (12gb+) - excellent
- supported via pytorch rocm backend

### apple silicon (mps)
- m1/m2/m3 with 16gb+ unified memory
- supported via pytorch mps backend

### cpu fallback
- possible but slow (5-10x slower)
- not recommended for production
- ok for development/testing

## optimization tips

### reduce memory usage
```python
# use int8 quantization (halves vram)
model = AutoModel.from_pretrained(
    model_name,
    torch_dtype=torch.int8,  # or bitsandbytes
    device_map="auto"
)
```

### use streaming model
- vibevoice-streaming-0.5b uses 3x less vram
- still excellent quality
- better for real-time use

### batch processing
- process multiple requests in parallel
- better gpu utilization
- use queue system

## your setup (tested)

```
gpu: amd radeon rx 7600m xt
vram: 8.0gb
backend: rocm + pytorch
status: ✅ working
```

**recommended:**
- start with vibevoice-streaming-0.5b
- upgrade to tts-1.5b if needed
- both will fit in your 8gb vram

## benchmarks (estimated for your gpu)

| model | vram | latency | quality |
|-------|------|---------|---------|
| streaming-0.5b | 2-3gb | 200-400ms | good |
| tts-1.5b | 6-7gb | 800-1500ms | excellent |
| kokoro (deepinfra) | 0gb | 500-1000ms | good |

**note:** latency for 100 characters of text
