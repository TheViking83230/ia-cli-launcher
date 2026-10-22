# Voix « qualite » de JARVIS : serveur local Qwen3-TTS 0.6B (faster-qwen3-tts, carte graphique NVIDIA).
#
# Lance par l'application (src/main/qualityVoice.js) avec le Python du pack installe.
# Protocole, une ligne JSON par message :
#   entree  {"cmd": "speak", "id": 1, "text": "..."} | {"cmd": "stop"}
#   sortie  {"ready": true} | {"id": 1, "sr": 24000, "pcm": "<int16 base64>"} | {"id": 1, "done": true} | {"id": 1, "error": "..."}
# Le serveur s'arrete quand l'entree est fermee.
import base64
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


def send(message):
    with OUT_LOCK:
        OUT.write((json.dumps(message) + "\n").encode("utf-8"))


HERE = os.path.dirname(os.path.abspath(__file__))
REF_AUDIO = os.path.join(HERE, "reference.wav")
REF_TEXT = "Bonjour. Tous les systèmes sont opérationnels. Que puis-je faire pour vous aujourd'hui ?"
MODEL = os.environ.get("JARVIS_QUALITY_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base")

requests = queue.Queue()
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
    requests.put(None)


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
    print(f"voix qualite prete en {time.time() - start:.1f} s ({torch.cuda.get_device_name(0)})", flush=True)
    send({"ready": True})
    threading.Thread(target=read_input, daemon=True).start()
    while True:
        request = requests.get()
        if request is None:
            return
        cancel.clear()
        request_id = request.get("id")
        try:
            for audio, sr, _timing in model.generate_voice_clone_streaming(
                text=str(request.get("text", ""))[:2000], language="French", ref_audio=REF_AUDIO, ref_text=REF_TEXT, chunk_size=4
            ):
                if cancel.is_set():
                    break
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
