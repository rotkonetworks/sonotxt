# VibeVoice TTS Service

python inference service for microsoft vibevoice models.
runs on bkk07 with gpu for fast inference.

## setup

```bash
# build and run with docker
docker-compose up -d

# or run locally
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python server.py
```

## api

### POST /synthesize

```json
{
  "text": "hello world",
  "voice": "default",
  "speed": 1.0,
  "output_format": "wav"
}
```

response:
```json
{
  "audio_base64": "hex encoded audio data",
  "sample_rate": 24000,
  "duration_seconds": 1.5,
  "format": "wav"
}
```

### GET /health

health check endpoint.

## environment

- `PORT`: server port (default: 8200)
- `VIBEVOICE_MODEL`: huggingface model id (default: microsoft/VibeVoice-TTS-1.5B)
- `TRANSFORMERS_CACHE`: model cache directory

## deployment on bkk07

```bash
# on bkk07
cd /path/to/sonotxt/vibevoice-service
docker-compose up -d

# verify
curl http://localhost:8200/health
```

## integration with rust api

rust worker calls this service via HTTP when `engine=vibevoice` is specified.

config in rust: `VIBEVOICE_URL=http://bkk07.rotko.net:8200`
