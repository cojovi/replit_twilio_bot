import os, json, asyncio, websockets
from urllib.parse import parse_qs

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketDisconnect
from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse, Connect
from dotenv import load_dotenv

from prompts import PROMPTS

# ── ENV ──────────────────────────────────────────────────────────────────────
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
TWILIO_SID     = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_TOKEN   = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_NUMBER  = os.getenv("TWILIO_PHONE_NUMBER")
PORT           = int(os.getenv("PORT", 5050))

for name, val in {
    "OPENAI_API_KEY": OPENAI_API_KEY,
    "TWILIO_ACCOUNT_SID": TWILIO_SID,
    "TWILIO_AUTH_TOKEN": TWILIO_TOKEN,
    "TWILIO_PHONE_NUMBER": TWILIO_NUMBER,
}.items():
    if not val:
        raise RuntimeError(f"Missing {name} in .env")

twilio = Client(TWILIO_SID, TWILIO_TOKEN)

# ── FASTAPI ──────────────────────────────────────────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all for now, lock down in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── HEALTH CHECK ────────────────────────────────────────────────────────────
@app.get("/")
async def health():
    return {"status": "running", "agents": list(PROMPTS)}

# ── DIAL ENDPOINT ───────────────────────────────────────────────────────────
@app.get("/make-call/{number}")
async def make_call(number: str, request: Request, agent: str = "alex"):
    if agent not in PROMPTS:
        return JSONResponse({"error": f"unknown agent {agent}"}, status_code=400)

    base = str(request.base_url).rstrip("/")
    call = twilio.calls.create(
        to=number,
        from_=TWILIO_NUMBER,
        url=f"{base}/outbound-call-handler?agent={agent}",
        record=True,
        recording_status_callback=f"{base}/recording-status-callback",
    )
    return {"call_sid": call.sid, "agent": agent}

# ── HELPER: BUILD WS URL FOR TWIML ───────────────────────────────────────────
def ws_url(req: Request, path: str, params: dict):
    proto = "wss" if req.url.scheme == "https" else "ws"
    host  = req.url.hostname
    port  = f":{req.url.port}" if req.url.port not in (80, 443, None) else ""
    qs    = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{proto}://{host}{port}{path}?{qs}"

# ── TWIML HANDLERS ───────────────────────────────────────────────────────────
@app.api_route("/outbound-call-handler", methods=["GET", "POST"])
async def outbound_handler(request: Request, agent: str = "alex"):
    vr = VoiceResponse()
    vr.connect().stream(url=ws_url(request, "/media-stream",
                                     {"agent": agent, "scenario": "outbound"}))
    return HTMLResponse(str(vr), media_type="application/xml")

@app.api_route("/inbound-call-handler", methods=["GET", "POST"])
async def inbound_handler(request: Request):
    vr = VoiceResponse()
    vr.connect().stream(url=ws_url(request, "/media-stream",
                                     {"agent": "alex", "scenario": "inbound"}))
    return HTMLResponse(str(vr), media_type="application/xml")

# ── MEDIA-STREAM BRIDGE ──────────────────────────────────────────────────────
# Fixed OpenAI WebSocket endpoint
OPENAI_WS = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01"
VOICE = "shimmer" # Or another supported voice like nova, echo, fable, onyx

@app.websocket("/media-stream")
async def media(ws: WebSocket):
    await ws.accept()
    qs         = dict(parse_qs(ws.url.query))
    agent      = qs.get("agent", ["alex"])[0]
    prompt     = PROMPTS.get(agent, PROMPTS["alex"])
    stream_sid = None

    hdrs = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1"
    }

    try:
        # Connect to OpenAI WebSocket with correct endpoint and headers
        async with websockets.connect(OPENAI_WS, additional_headers=hdrs) as oai:
            print(f"Connected to OpenAI Realtime API for agent: {agent}")
            
            # Initialize OpenAI session with correct format
            session_config = {
                "type": "session.update",
                "session": {
                    "modalities": ["text", "audio"],
                    "instructions": prompt,
                    "voice": VOICE,
                    "input_audio_format": "g711_ulaw",
                    "output_audio_format": "g711_ulaw",
                    "input_audio_transcription": {
                        "model": "whisper-1"
                    },
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 200
                    }
                }
            }
            
            await oai.send(json.dumps(session_config))
            print("OpenAI session initialized")

            # ── TASK: Twilio → OpenAI ────────────────────────────────────────────
            async def twilio_to_oai():
                nonlocal stream_sid
                try:
                    while True:
                        msg = await ws.receive_text()
                        data = json.loads(msg)

                        if data["event"] == "start":
                            stream_sid = data["start"]["streamSid"]
                            print(f"Twilio media stream started: {stream_sid}")
                            # Send conversation start to OpenAI
                            await oai.send(json.dumps({
                                "type": "conversation.item.create",
                                "item": {
                                    "type": "message",
                                    "role": "user",
                                    "content": [{"type": "input_audio", "audio": ""}]
                                }
                            }))

                        elif data["event"] == "media":
                            # Forward audio payload to OpenAI
                            audio_data = data["media"]["payload"]
                            await oai.send(json.dumps({
                                "type": "input_audio_buffer.append",
                                "audio": audio_data
                            }))

                        elif data["event"] == "stop":
                            print("Twilio media stream stopped.")
                            break
                except WebSocketDisconnect:
                    print("Twilio WebSocket disconnected.")
                except Exception as e:
                    print(f"Error in twilio_to_oai: {e}")

            # ── TASK: OpenAI → Twilio ───────────────────────────────────────────
            async def oai_to_twilio():
                try:
                    async for raw_msg in oai:
                        if stream_sid:
                            try:
                                msg = json.loads(raw_msg)
                                msg_type = msg.get("type")
                                
                                if msg_type == "response.audio.delta":
                                    # Send audio data to Twilio
                                    audio_data = msg.get("delta", "")
                                    if audio_data:
                                        await ws.send_json({
                                            "event": "media",
                                            "streamSid": stream_sid,
                                            "media": {"payload": audio_data}
                                        })
                                        
                                elif msg_type == "response.audio.done":
                                    print("OpenAI audio response completed")
                                    
                                elif msg_type == "error":
                                    print(f"OpenAI error: {msg}")
                                    
                            except json.JSONDecodeError:
                                print(f"Failed to parse OpenAI message: {raw_msg}")
                                
                except websockets.exceptions.ConnectionClosed as e:
                    print(f"OpenAI WebSocket connection closed: {e}")
                except Exception as e:
                    print(f"Error in oai_to_twilio: {e}")

            await asyncio.gather(twilio_to_oai(), oai_to_twilio())
            
    except websockets.exceptions.InvalidStatus as e:
        print(f"OpenAI WebSocket connection failed: {e}")
        print("This usually means:")
        print("1. Your OpenAI API key doesn't have access to the Realtime API")
        print("2. You need to request access to the Realtime API from OpenAI")
        print("3. Your API key is invalid or expired")
        await ws.close()
    except Exception as e:
        print(f"Unexpected error in media stream: {e}")
        await ws.close()

# ── RECORDING CALLBACK (STUB) ────────────────────────────────────────────────
@app.post("/recording-status-callback")
async def rec_cb():
    return {"ok": True}

# ── ENTRYPOINT ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)