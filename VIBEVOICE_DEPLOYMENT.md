# VibeVoice TTS Deployment Guide

deployment guide for integrating microsoft vibevoice into sonotxt.

## architecture

```
┌─────────────────┐         ┌──────────────────┐
│ rust api        │─────────│ postgres         │
│ (www.rotko.net) │         └──────────────────┘
│  - job queue    │
│  - billing      │         ┌──────────────────┐
│  - storage      │─────────│ minio/ipfs       │
└────────┬────────┘         └──────────────────┘
         │
         │ http calls
         │
    ┌────┴─────┬──────────────────────────┐
    │          │                          │
    v          v                          v
┌─────────┐ ┌────────────────┐  ┌──────────────────┐
│ kokoro  │ │ vibevoice      │  │ vibevoice        │
│ api     │ │ tts-1.5b       │  │ streaming-0.5b   │
│deepinfra│ │ (bkk07 gpu)    │  │ (bkk07 gpu)      │
└─────────┘ └────────────────┘  └──────────────────┘
```

## 1. deploy vibevoice service on bkk07

### prerequisites

- nvidia gpu with cuda support
- docker with nvidia runtime
- 16gb+ vram for tts-1.5b model

### deployment steps

```bash
# ssh to bkk07
ssh root@bkk07.rotko.net

# clone repo
cd /srv
git clone https://github.com/hitchhooker/sonotxt.git
cd sonotxt/vibevoice-service

# build and run
docker-compose up -d

# verify
curl http://localhost:8200/health
```

### configuration

edit `docker-compose.yml` to change:
- port (default 8200)
- model (default microsoft/VibeVoice-TTS-1.5B)
- gpu allocation

## 2. configure rust api

### environment variables

add to rust api environment (systemd service or .env):

```bash
VIBEVOICE_URL=http://bkk07.rotko.net:8200
```

### database migration

```bash
# on www.rotko.net
cd /srv/sonotxt/api
psql $DATABASE_URL < rust/migrations/011_add_engine_column.sql
```

### restart api

```bash
sudo systemctl restart sonotxt-api
```

## 3. api usage

### request with vibevoice

```bash
curl -X POST https://api.sonotxt.com/api/tts \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "hello world",
    "voice": "af_bella",
    "engine": "vibevoice"
  }'
```

### engine options

- `kokoro` - default, deepinfra hosted, fast, good quality
- `vibevoice` - self-hosted, slower, higher quality, up to 90min audio
- `vibevoice-streaming` - self-hosted, real-time, low latency

### pricing

- kokoro: $0.0016 per 1000 chars (via deepinfra)
- vibevoice: self-hosted, no per-request cost, requires gpu server
- free tier: kokoro only (3 min/day)

## 4. monitoring

### check vibevoice service

```bash
# on bkk07
docker logs vibevoice-service-vibevoice-1 -f

# check gpu usage
nvidia-smi
```

### check rust worker logs

```bash
# on www.rotko.net
sudo journalctl -u sonotxt-api -f
```

## 5. troubleshooting

### vibevoice service not responding

```bash
# restart service
docker-compose restart

# check logs
docker logs vibevoice-service-vibevoice-1 --tail 100
```

### gpu out of memory

reduce batch size or use smaller model:
- use `microsoft/VibeVoice-Streaming-0.5B` instead
- edit docker-compose.yml to change VIBEVOICE_MODEL

### rust api can't connect

```bash
# verify vibevoice is accessible
curl http://bkk07.rotko.net:8200/health

# check firewall
sudo ufw status

# verify VIBEVOICE_URL env var
systemctl show sonotxt-api | grep VIBEVOICE_URL
```

## 6. performance tuning

### gpu optimization

- use fp16 for faster inference (already enabled for cuda)
- increase gpu memory allocation if available
- use streaming model for real-time applications

### networking

- use internal network between www.rotko.net and bkk07
- consider adding http/2 for better throughput
- add load balancer if deploying multiple vibevoice instances

## 7. future improvements

- [ ] add vibevoice voice cloning support
- [ ] implement request queuing for vibevoice
- [ ] add caching for frequently requested text
- [ ] support multi-speaker synthesis
- [ ] add asr (automatic speech recognition) backend
