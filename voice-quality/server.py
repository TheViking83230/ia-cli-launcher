# Voix « qualite » de JARVIS : serveur local sur carte graphique NVIDIA.
#  - voix : Qwen3-TTS 0.6B (faster-qwen3-tts), audio envoye en flux ;
#  - dictee precise : Whisper large-v3-turbo (si installe avec le pack).
#
# Lance par l'application (src/main/qualityVoice.js) avec le Python du pack installe.
# Protocole, une ligne JSON par message :
#   entree  {"cmd": "speak", "id": 1, "text": "..."} | {"cmd": "stop"}
#           {"cmd": "transcribe", "id": 2, "wav": "<WAV 16 kHz base64>", "prompt": "..."}
#   sortie  {"ready": true, "asr": true} | {"id": 1, "sr": 24000, "pcm": "<int16 base64>"} | {"id": 1, "done": true}
#           {"id": 2, "text": "..."} | {"id": 1, "error": "..."}
# Le serveur s'arrete quand l'entree est fermee.
import base64
import io
import json
import os
import queue
import sys
import threading
import time

# Les bibliotheques ecrivent parfois sur la sortie standard : elle est reservee au protocole.
OUT = os.fdopen(os.dup(1), "wb", buffering=0)
os.dup2(2, 1)
sys.stdout = sys.stderr
# Lance avec -I (variables PYTHON* ignorees) : l'UTF-8 est impose ici.
sys.stdin.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
OUT_LOCK = threading.Lock()
# Un seul calcul a la fois sur la carte graphique (la voix rend la main entre
# deux morceaux : une dictee passe sans attendre la fin de la phrase).
GPU_LOCK = threading.Lock()


def send(message):
    with OUT_LOCK:
        OUT.write((json.dumps(message) + "\n").encode("utf-8"))


HERE = os.path.dirname(os.path.abspath(__file__))
REF_AUDIO = os.path.join(HERE, "reference.wav")
REF_TEXT = "Bonjour. Tous les systèmes sont opérationnels. Que puis-je faire pour vous aujourd'hui ?"
MODEL = os.environ.get("JARVIS_QUALITY_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base")
ASR_MODEL = os.environ.get("JARVIS_ASR_MODEL", "")

requests = queue.Queue()
asr_requests = queue.Queue()
cancel = threading.Event()


def read_input():
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except ValueError:
            continue
        if message.get("cmd") == "stop":
            cancel.set()
            while not requests.empty():
                dropped = requests.get_nowait()
                if dropped is not None:
                    send({"id": dropped.get("id"), "done": True})
        elif message.get("cmd") == "speak":
            requests.put(message)
        elif message.get("cmd") == "transcribe":
            asr_requests.put(message)
    requests.put(None)


def load_asr(torch):
    if not ASR_MODEL or not os.path.isdir(ASR_MODEL):
        return None
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

    import numpy as np

    processor = AutoProcessor.from_pretrained(ASR_MODEL)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(ASR_MODEL, dtype=torch.float16).to("cuda:0").eval()
    # Premier passage (1 s de silence) : la premiere vraie dictee est ensuite rapide.
    features = processor(np.zeros(16000, dtype=np.float32), sampling_rate=16000, return_tensors="pt").input_features
    with torch.inference_mode():
        model.generate(features.to("cuda:0", torch.float16), language="fr", task="transcribe")
    return processor, model


def asr_worker(torch, asr):
    import numpy as np
    import soundfile as sf

    processor, model = asr
    while True:
        request = asr_requests.get()
        request_id = request.get("id")
        try:
            samples, rate = sf.read(io.BytesIO(base64.b64decode(request.get("wav", ""))), dtype="float32")
            if samples.ndim > 1:
                samples = samples.mean(axis=1)
            if rate != 16000:
                raise ValueError(f"audio a {rate} Hz (16000 attendu)")
            features = processor(np.asarray(samples), sampling_rate=16000, return_tensors="pt").input_features
            options = {"language": "fr", "task": "transcribe"}
            prompt = str(request.get("prompt") or "").strip()
            with GPU_LOCK, torch.inference_mode():
                if prompt:
                    options["prompt_ids"] = processor.get_prompt_ids(prompt, return_tensors="pt").to("cuda:0")
                ids = model.generate(features.to("cuda:0", torch.float16), **options)
            text = processor.batch_decode(ids, skip_special_tokens=True)[0].strip()
            if prompt and text.startswith(prompt):
                text = text[len(prompt):].strip()
            send({"id": request_id, "text": text})
        except Exception as error:  # noqa: BLE001 - toute erreur est renvoyee a l'application
            send({"id": request_id, "error": str(error)[:500]})


def main():
    import numpy as np
    import torch
    from faster_qwen3_tts import FasterQwen3TTS

    if not torch.cuda.is_available():
        send({"fatal": "Carte graphique NVIDIA introuvable pour la voix qualité."})
        return
    start = time.time()
    model = FasterQwen3TTS.from_pretrained(MODEL)
    model.warmup(prefill_len=100)
    # Premiere phrase (non envoyee) : la vraie premiere reponse demarre ensuite en ~0,3 s.
    for _chunk in model.generate_voice_clone_streaming(
        text="Bonjour.", language="French", ref_audio=REF_AUDIO, ref_text=REF_TEXT, chunk_size=4
    ):
        pass
    asr = None
    try:
        asr = load_asr(torch)
    except Exception as error:  # noqa: BLE001 - la voix reste utilisable sans la dictee precise
        print(f"dictee precise indisponible : {error}", flush=True)
    # Rend a la carte la memoire des essais de demarrage (gardee en reserve sinon).
    torch.cuda.empty_cache()
    print(f"voix qualite prete en {time.time() - start:.1f} s ({torch.cuda.get_device_name(0)}, dictee {'oui' if asr else 'non'})", flush=True)
    if asr:
        threading.Thread(target=asr_worker, args=(torch, asr), daemon=True).start()
    send({"ready": True, "asr": bool(asr)})
    threading.Thread(target=read_input, daemon=True).start()
    while True:
        request = requests.get()
        if request is None:
            return
        cancel.clear()
        request_id = request.get("id")
        try:
            chunks = model.generate_voice_clone_streaming(
                text=str(request.get("text", ""))[:2000], language="French", ref_audio=REF_AUDIO, ref_text=REF_TEXT, chunk_size=4
            )
            while not cancel.is_set():
                with GPU_LOCK:
                    item = next(chunks, None)
                if item is None:
                    break
                audio, sr, _timing = item
                samples = np.clip(np.asarray(audio, dtype=np.float32).reshape(-1), -1, 1)
                pcm = (samples * 32767).astype("<i2").tobytes()
                send({"id": request_id, "sr": int(sr), "pcm": base64.b64encode(pcm).decode("ascii")})
            send({"id": request_id, "done": True})
        except Exception as error:  # noqa: BLE001 - toute erreur est renvoyee a l'application
            send({"id": request_id, "error": str(error)[:500]})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        send({"fatal": str(error)[:500]})
