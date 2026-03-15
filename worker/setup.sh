#!/bin/bash
# sonotxt worker setup — deploy TTS + ASR + LLM on a fresh vast.ai GPU instance
# Usage: ssh into instance, then: curl -sL <url>/setup.sh | bash
# Or: rsync this dir and run: bash setup.sh
#
# Required env vars (set before running or pass as args):
#   HF_TOKEN       - huggingface token (for gated models)
#
# What gets deployed:
#   Port 8080: sonotxt speech service (TTS + ASR)
#     - Qwen3-TTS-12Hz-1.7B-CustomVoice (~8.4GB VRAM)
#     - Qwen3-ASR-0.6B (~1.6GB VRAM)
#   Port 8090: LLM chat service
#     - Qwen3.5-4B, 4-bit quantized (~2.5GB VRAM)
#   Total: ~12.5GB VRAM (fits on 16GB GPUs like RTX 5070 Ti)
#
set -euo pipefail

echo "=== sonotxt worker setup ==="
echo "GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo 'none')"

# ── 1. system deps ──────────────────────────────────────────────────
echo ">>> installing system deps..."
apt-get update -qq && apt-get install -y -qq sox libsox-dev libsndfile1 > /dev/null 2>&1 || true

# ── 2. HuggingFace auth ────────────────────────────────────────────
if [ -n "${HF_TOKEN:-}" ]; then
    echo ">>> setting up HF auth..."
    mkdir -p ~/.cache/huggingface
    echo "$HF_TOKEN" > ~/.cache/huggingface/token
    python3 -c "from huggingface_hub import login; login(token='$HF_TOKEN')" 2>/dev/null
fi

# ── 3. speech service deps (TTS + ASR) ─────────────────────────────
echo ">>> installing speech service deps..."
pip install -q fastapi uvicorn soundfile numpy qwen-asr 2>&1 | tail -3
# qwen-asr pulls transformers 4.57.6 which works with qwen-tts
pip install -q qwen-tts 2>&1 | tail -3
# pin transformers to version that works with both
pip install -q transformers==4.57.6 2>&1 | tail -1

# ── 4. LLM deps (separate venv for transformers 5.x + bitsandbytes) ──
echo ">>> setting up LLM environment..."
python3 -m venv /opt/llm-venv --system-site-packages 2>/dev/null || python3 -m venv /opt/llm-venv
/opt/llm-venv/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cu128 2>&1 | tail -1 || true
/opt/llm-venv/bin/pip install -q "transformers @ git+https://github.com/huggingface/transformers.git@main" fastapi uvicorn bitsandbytes accelerate 2>&1 | tail -3

# ── 5. pre-download models ─────────────────────────────────────────
echo ">>> pre-downloading models (this may take a few minutes)..."
python3 -c "
from qwen_tts import Qwen3TTSModel
Qwen3TTSModel.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', device_map='cpu')
print('TTS model cached')
" 2>&1 | tail -1

python3 -c "
from qwen_asr import Qwen3ASRModel
import torch
Qwen3ASRModel.from_pretrained('Qwen/Qwen3-ASR-0.6B', dtype=torch.float32, device_map='cpu', max_new_tokens=256)
print('ASR model cached')
" 2>&1 | tail -1

/opt/llm-venv/bin/python3 -c "
from transformers import AutoModelForCausalLM, AutoTokenizer
AutoModelForCausalLM.from_pretrained('Qwen/Qwen3.5-4B', device_map='cpu')
AutoTokenizer.from_pretrained('Qwen/Qwen3.5-4B')
print('LLM model cached')
" 2>&1 | tail -1

# ── 6. write server files ──────────────────────────────────────────
mkdir -p /opt/sonotxt

# speech server is in server.py (should be rsynced alongside this script)
if [ -f "$(dirname "$0")/server.py" ]; then
    cp "$(dirname "$0")/server.py" /opt/sonotxt/speech_server.py
    echo ">>> copied speech_server.py"
fi

# LLM server
if [ -f "$(dirname "$0")/llm_server.py" ]; then
    cp "$(dirname "$0")/llm_server.py" /opt/sonotxt/llm_server.py
    echo ">>> copied llm_server.py"
fi

echo ">>> server files written"

# ── 7. write start/stop scripts ──────────────────────────────────
cat > /opt/sonotxt/start.sh << 'STARTEOF'
#!/bin/bash
# start all sonotxt services
set -euo pipefail

echo "=== starting sonotxt services ==="

# speech service (TTS + ASR) on port 8080
echo ">>> starting speech service on :8080..."
cd /opt/sonotxt
nohup python3 speech_server.py > /tmp/speech_server.log 2>&1 &
SPEECH_PID=$!
echo "speech PID=$SPEECH_PID"

# LLM service on port 8090 (separate venv for transformers 5.x)
echo ">>> starting LLM service on :8090..."
nohup /opt/llm-venv/bin/python3 llm_server.py > /tmp/llm_server.log 2>&1 &
LLM_PID=$!
echo "LLM PID=$LLM_PID"

# wait for both to be ready
echo ">>> waiting for services to load models..."
for i in $(seq 1 120); do
    SPEECH_OK=$(curl -sf http://localhost:8080/health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('tts_loaded',False))" 2>/dev/null || echo "False")
    LLM_OK=$(curl -sf http://localhost:8090/health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('model_loaded',False))" 2>/dev/null || echo "False")
    if [ "$SPEECH_OK" = "True" ] && [ "$LLM_OK" = "True" ]; then
        echo ">>> all services ready!"
        break
    fi
    sleep 2
done

# show status
echo ""
echo "=== sonotxt worker status ==="
curl -s http://localhost:8080/health | python3 -m json.tool 2>/dev/null || echo "speech: NOT READY"
curl -s http://localhost:8090/health | python3 -m json.tool 2>/dev/null || echo "llm: NOT READY"
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null

echo ""
echo "speech: http://localhost:8080  (TTS + ASR)"
echo "llm:    http://localhost:8090  (Qwen3.5-4B 4-bit)"
STARTEOF
chmod +x /opt/sonotxt/start.sh

cat > /opt/sonotxt/stop.sh << 'STOPEOF'
#!/bin/bash
echo "stopping sonotxt services..."
kill $(lsof -ti:8080) 2>/dev/null || true
kill $(lsof -ti:8090) 2>/dev/null || true
echo "done"
STOPEOF
chmod +x /opt/sonotxt/stop.sh

echo ""
echo "=== setup complete ==="
echo "to start:  /opt/sonotxt/start.sh"
echo "to stop:   /opt/sonotxt/stop.sh"
echo "logs:      /tmp/speech_server.log  /tmp/llm_server.log"
