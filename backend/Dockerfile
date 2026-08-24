# Nixpacks/Railpack both end up importing deepface's `opencv-python` (the
# Qt/X11-linked build) rather than the headless one, so the image has to
# actually carry the GUI shared libraries. A Dockerfile is the only way to
# guarantee they're installed, instead of guessing at builder behaviour.
FROM python:3.12-slim

# libxcb1/libGL/etc. are what cv2's binary links against. Without them the
# very first `import cv2` fails and the app never starts.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 \
      libglib2.0-0 \
      libxcb1 \
      libsm6 \
      libxext6 \
      libxrender1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# DeepFace caches its ~95 MB of model weights here. Without a mounted volume
# they are re-downloaded on every cold start.
ENV DEEPFACE_HOME=/app/.deepface

# Railway injects $PORT at runtime, so this has to go through a shell.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
