# VibeVoice Setup Guide

## quick status

✅ **gpu ready:** amd radeon rx 7600m xt (8gb vram)
✅ **pytorch:** installed with rocm support
✅ **transformers:** installed
⏳ **vibevoice model:** needs download (network issues)
✅ **mock server:** working for testing

## install real vibevoice model

### option 1: from github (recommended)

```bash
cd /steam/rotko/sonotxt/vibevoice-service
source venv/bin/activate

# install vibevoice package
pip install 'vibevoice[streamingtts] @ git+https://github.com/microsoft/VibeVoice.git'

# models will auto-download on first use
```

### option 2: manual model download

```bash
# download model files to cache
python3 << 'EOF'
from huggingface_hub import snapshot_download

# download streaming model (smaller, faster)
snapshot_download(
    "microsoft/VibeVoice-Realtime-0.5B",
    cache_dir="/tmp/vibevoice-cache"
)

# or download full tts model (better quality)
snapshot_download(
    "microsoft/VibeVoice-1.5B",
    cache_dir="/tmp/vibevoice-cache"
)
EOF
```

### option 3: use demo server

```bash
# clone repo when network is stable
git clone https://github.com/microsoft/VibeVoice.git
cd VibeVoice

# install
pip install -e .[streamingtts]

# run demo
python demo/vibevoice_realtime_demo.py \
    --model_path microsoft/VibeVoice-Realtime-0.5B
```

## test with mock server (current)

```bash
# mock server is currently running
curl http://localhost:8200/health

# test synthesis
curl -X POST http://localhost:8200/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "hello world", "speed": 1.0}' | jq .
```

## rust integration (ready)

rust backend is configured and ready:

```bash
# .env already has
VIBEVOICE_URL=http://localhost:8200

# test via rust
cd /steam/rotko/sonotxt/rust
./target/release/sonotxt

# or use python test
cd /steam/rotko/sonotxt
python3 test_vibevoice_integration.py
```

## network issues?

if git clone fails, try:

```bash
# shallow clone
git clone --depth 1 https://github.com/microsoft/VibeVoice.git

# or download specific files
wget https://github.com/microsoft/VibeVoice/archive/refs/heads/main.zip
```

## model comparison

| model | vram | speed | quality | status |
|-------|------|-------|---------|--------|
| mock | 0gb | instant | silent | ✅ running |
| realtime-0.5b | 2-3gb | 200-400ms | good | ⏳ needs download |
| tts-1.5b | 6-7gb | 800-1500ms | excellent | ⏳ needs download |

## next steps

1. **wait for stable network** to download model
2. **or use mock** for rust integration testing
3. **deploy to bkk07** once model is working locally

your gpu (rx 7600m xt 8gb) will work great with both models!
