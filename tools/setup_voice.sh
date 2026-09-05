#!/bin/bash
# One-time setup for re-recording the Inspector's voice (only needed if you edit the lines in js/data.js).
set -e
cd "$(dirname "$0")"
command -v brew >/dev/null || { echo "Homebrew is required (https://brew.sh)"; exit 1; }
brew list espeak-ng >/dev/null 2>&1 || brew install espeak-ng
command -v ffmpeg >/dev/null || brew install ffmpeg
PY=$(command -v python3.11 || command -v python3.12 || command -v python3.13 || command -v python3)
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q chatterbox-tts soundfile
mkdir -p models
[ -f models/kokoro-v1.0.onnx ] || curl -L -o models/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
[ -f models/voices-v1.0.bin ] || curl -L -o models/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
echo "Ready. Now run:  tools/.venv/bin/python tools/build_voice.py"
