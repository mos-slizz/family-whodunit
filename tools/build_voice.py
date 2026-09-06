#!/usr/bin/env python3
"""Pre-record every Inspector line with Kokoro (neural TTS) into audio/<hash>.mp3 + audio/manifest.json.

Usage:  tools/setup_voice.sh   (once)   then   tools/.venv/bin/python tools/build_voice.py [--voice bm_george] [--force]
Only new/changed lines are synthesized; the hash of the text is the file name (FNV-1a, mirrored in js/audio.js).
"""
import json, os, re, sys, subprocess, argparse, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--engine', default='chatterbox', choices=['chatterbox', 'kokoro']); ap.add_argument('--voice', default='bm_george'); ap.add_argument('--exaggeration', type=float, default=0.8); ap.add_argument('--cfg', type=float, default=0.3); ap.add_argument('--only', default=''); ap.add_argument('--speed', type=float, default=1.0); ap.add_argument('--force', action='store_true'); ap.add_argument('--models', default=os.environ.get('FW_MODELS', os.path.join(ROOT, 'tools', 'models')))
args = ap.parse_args()

def fnv(text):
    h = 0x811c9dc5
    for b in text.strip().encode('utf-8'):
        h ^= b; h = (h * 0x01000193) & 0xffffffff
    return '%08x' % h

src = open(os.path.join(ROOT, 'js', 'data.js'), encoding='utf-8').read()
D = json.loads(src[src.index('=') + 1:].strip().rstrip(';'))
texts = []
texts += [c['name'] for c in D['characters']]
for k in ('places', 'colors', 'snacks'):
    for v in D[k]:
        texts.append(v['name']); texts += v['clues']
for c in D['cases']:
    texts += [c['title'], c['blurb']]
texts += D['finalWords']
for v in D['lines'].values():
    texts += v
texts += ['was in', 'wearing', 'and eating', 'Hello, detectives. Somebody in this room is guilty.']
texts += [t['name'] + '. ' + t['desc'] for t in D['twists']]
seen = set(); todo = []
for t in texts:
    t = t.strip()
    if not t or t in seen: continue
    seen.add(t); todo.append(t)
print(len(todo), 'unique lines')

outdir = os.path.join(ROOT, 'audio'); os.makedirs(outdir, exist_ok=True)
import soundfile as sf
if args.engine == 'kokoro':
    from kokoro_onnx import Kokoro
    from kokoro_onnx.config import EspeakConfig
    cfg = None
    brew_lib = '/opt/homebrew/lib/libespeak-ng.dylib'
    if os.path.exists(brew_lib):
        cfg = EspeakConfig(lib_path=brew_lib, data_path='/opt/homebrew/share/espeak-ng-data')
    k = Kokoro(os.path.join(args.models, 'kokoro-v1.0.onnx'), os.path.join(args.models, 'voices-v1.0.bin'), espeak_config=cfg)
    lang = 'en-gb' if args.voice.startswith('b') else 'en-us'
    def synth(text, path):
        samples, sr = k.create(text, voice=args.voice, speed=args.speed, lang=lang)
        sf.write(path, samples, sr)
else:
    import torch, torchaudio as ta
    from chatterbox.tts import ChatterboxTTS
    dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
    model = ChatterboxTTS.from_pretrained(device=dev)
    def synth(text, path):
        wav = model.generate(text, exaggeration=args.exaggeration, cfg_weight=args.cfg)
        ta.save(path, wav, model.sr)
all_hashes = set(fnv(t) for t in todo)
if args.only:
    todo = [t for t in todo if args.only.lower() in t.lower()]
built = []; n = 0
tmp = os.path.join(outdir, '_tmp.wav')
for t in todo:
    h = fnv(t); mp3 = os.path.join(outdir, h + '.mp3')
    if os.path.exists(mp3) and not args.force and not args.only:
        built.append(h); continue
    spoken = t.replace('Wi-Fi', 'wifi').replace('T-Rex', 'tee rex').replace('A.M.', 'A M')
    synth(spoken, tmp)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-ac', '1', '-ar', '24000', '-b:a', '64k', '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.06', mp3], check=True)
    built.append(h); n += 1
    if n % 20 == 0: print(n, 'synthesized…', flush=True)
if os.path.exists(tmp): os.remove(tmp)
# prune clips that no longer correspond to any line; manifest lists every clip on disk
for f in os.listdir(outdir):
    if f.endswith('.mp3') and f[:-4] not in all_hashes: os.remove(os.path.join(outdir, f))
keep = set(f[:-4] for f in os.listdir(outdir) if f.endswith('.mp3'))
json.dump({'ext': 'mp3', 'voice': args.engine + ':' + args.voice, 'clips': sorted(keep)}, open(os.path.join(outdir, 'manifest.json'), 'w'))
print('done:', n, 'new,', len(keep), 'total clips')
