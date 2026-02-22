FROM python:3.11-slim

WORKDIR /app

# install system deps
RUN apt-get update && apt-get install -y \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# copy requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# copy server
COPY server.py .

# expose port
EXPOSE 8200

# run server
CMD ["python", "server.py"]
