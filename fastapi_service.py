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
PORT           = int(os.getenv("PORT", 8000))

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
    return {"status": "running", "agents": list(PROMPTS.keys())}

@app.get("/health")
async def health_check():
    return {"status": "online", "agents": list(PROMPTS.keys())}

# ── DIAL ENDPOINT ───────────────────────────────────────────────────────────
@app.get("/make-call/{number}")
async def make_call(number: str, request: Request, agent: str = "alex"):
    if agent not in PROMPTS:
        return JSONResponse({"error": f"unknown agent {agent}"}, status_code=400)

    # Use OpenAI Realtime API with Media Streams - PROPER IMPLEMENTATION
    # Force use a working ngrok URL - will be dynamically detected
    import requests
    import time
    
    # Try to get live ngrok URL
    ngrok_url = None
    for _ in range(3):
        try:
            tunnels = requests.get("http://localhost:4040/api/tunnels", timeout=2).json()
            if tunnels.get("tunnels") and len(tunnels["tunnels"]) > 0:
                ngrok_url = tunnels["tunnels"][0]["public_url"]
                break
        except:
            time.sleep(1)
    
    # Fallback to environment or default
    if not ngrok_url:
        ngrok_url = os.getenv("FASTAPI_URL", "https://cmac.ngrok.app")
    
    ws_url = ngrok_url.replace("https://", "wss://").replace("http://", "ws://")
    
    print(f"🔥 USING OPENAI REALTIME API: {ws_url}/media-stream?agent={agent}")
    
    # Create TwiML that connects to our WebSocket for OpenAI Realtime API
    twiml = VoiceResponse()
    connect = twiml.connect()
    stream = connect.stream(url=f"{ws_url}/media-stream?agent={agent}")
    
    call = twilio.calls.create(
        to=number,
        from_=TWILIO_NUMBER,
        twiml=str(twiml)
    )
    
    return {"call_sid": call.sid, "agent": agent}

# ── HELPER: BUILD WS URL FOR TWIML ───────────────────────────────────────────
def ws_url(req: Request, path: str, params: dict):
    # Use ngrok URL for WebSocket connections
    base = os.getenv("FASTAPI_URL", "https://cmac.ngrok.app")
    proto = "wss" if base.startswith("https") else "ws"
    host = base.replace("https://", "").replace("http://", "")
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{proto}://{host}{path}?{qs}"

# ── OPENAI REALTIME API WEBSOCKET HANDLER ──────────────────────────────────
@app.websocket("/media-stream")
async def media(ws: WebSocket):
    """Handle Twilio Media Stream with OpenAI Realtime API"""
    await ws.accept()
    
    agent = ws.query_params.get("agent", "alex")
    prompt = PROMPTS.get(agent, PROMPTS["alex"])
    
    print(f"Media stream connected for agent: {agent}")
    
    # OpenAI Realtime API WebSocket
    import asyncio
    import websockets
    import json
    import base64
    
    openai_ws = None
    stream_sid = None
    call_sid = None
    
    try:
        # Connect to OpenAI Realtime API
        openai_ws = await websockets.connect(
            "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
            extra_headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "OpenAI-Beta": "realtime=v1"
            }
        )
        
        print("Connected to OpenAI Realtime API")
        
        # Configure OpenAI session with agent personality
        session_config = {
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "instructions": prompt,
                "voice": "alloy",
                "input_audio_format": "g711_ulaw",
                "output_audio_format": "g711_ulaw",
                "input_audio_transcription": {
                    "model": "whisper-1"
                },
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 500
                },
                "tools": [],
                "tool_choice": "auto",
                "temperature": 0.8,
                "max_response_output_tokens": 4096
            }
        }
        
        await openai_ws.send(json.dumps(session_config))
        print("OpenAI session configured")
        
        # Task to handle messages from Twilio -> OpenAI
        async def twilio_to_oai():
            async for message in ws.iter_text():
                try:
                    data = json.loads(message)
                    
                    if data["event"] == "start":
                        stream_sid = data["start"]["streamSid"]
                        call_sid = data["start"]["callSid"]
                        print(f"Stream started - SID: {stream_sid}")
                        
                    elif data["event"] == "media":
                        # Forward audio to OpenAI
                        audio_append = {
                            "type": "input_audio_buffer.append",
                            "audio": data["media"]["payload"]
                        }
                        await openai_ws.send(json.dumps(audio_append))
                        
                    elif data["event"] == "stop":
                        print("Stream stopped")
                        break
                        
                except json.JSONDecodeError:
                    print("Invalid JSON from Twilio")
                except Exception as e:
                    print(f"Error processing Twilio message: {e}")
        
        # Task to handle messages from OpenAI -> Twilio
        async def oai_to_twilio():
            async for message in openai_ws:
                try:
                    response = json.loads(message)
                    
                    if response["type"] == "response.audio.delta":
                        # Send audio back to Twilio
                        audio_delta = {
                            "event": "media",
                            "streamSid": stream_sid,
                            "media": {
                                "payload": response["delta"]
                            }
                        }
                        await ws.send_text(json.dumps(audio_delta))
                        
                    elif response["type"] == "response.audio.done":
                        print("Audio response completed")
                        
                    elif response["type"] == "conversation.item.input_audio_transcription.completed":
                        transcript = response["transcript"]
                        print(f"User said: {transcript}")
                        
                    elif response["type"] == "response.done":
                        print("Response completed")
                        
                except json.JSONDecodeError:
                    print("Invalid JSON from OpenAI")
                except Exception as e:
                    print(f"Error processing OpenAI message: {e}")
        
        # Run both tasks concurrently
        await asyncio.gather(
            twilio_to_oai(),
            oai_to_twilio()
        )
        
    except Exception as e:
        print(f"Error in media stream: {e}")
    finally:
        if openai_ws:
            await openai_ws.close()
        await ws.close()

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

    # Connect to OpenAI WebSocket
    async with websockets.connect(OPENAI_WS, extra_headers=hdrs) as oai:
        # Initialize OpenAI session
        await oai.send(json.dumps({
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
        }))

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

                    elif data["event"] == "media":
                        # Forward audio payload to OpenAI
                        await oai.send(json.dumps({
                            "type": "input_audio_buffer.append",
                            "audio": data["media"]["payload"]
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
                async for raw in oai:
                    if stream_sid:
                        msg = json.loads(raw)
                        
                        if msg.get("type") == "response.audio.delta":
                            # Send audio data to Twilio
                            await ws.send_json({
                                "event": "media",
                                "streamSid": stream_sid,
                                "media": {"payload": msg["delta"]}
                            })
                            
                        elif msg.get("type") == "input_audio_buffer.speech_started":
                            # Clear Twilio buffer when user starts speaking
                            await ws.send_json({
                                "event": "clear",
                                "streamSid": stream_sid
                            })
                            
                        elif msg.get("type") == "conversation.item.input_audio_transcription.completed":
                            transcript = msg.get("transcript", "")
                            print(f"User said: {transcript}")
                            
                        elif msg.get("type") == "response.audio_transcript.delta":
                            transcript = msg.get("delta", "")
                            print(f"AI said: {transcript}")
                            
            except websockets.exceptions.ConnectionClosed as e:
                print(f"OpenAI WebSocket connection closed: {e}")
            except Exception as e:
                print(f"Error in oai_to_twilio: {e}")

        await asyncio.gather(twilio_to_oai(), oai_to_twilio())

# ── RECORDING CALLBACK (STUB) ────────────────────────────────────────────────
@app.post("/recording-status-callback")
async def rec_cb():
    return {"ok": True}

# ── ENTRYPOINT ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)