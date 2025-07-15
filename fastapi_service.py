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

    # Generate high-quality OpenAI speech for better voice quality
    import openai
    from twilio.twiml.voice_response import VoiceResponse
    
    client = openai.OpenAI(api_key=OPENAI_API_KEY)
    
    # Get agent's personality and create greeting
    agent_greetings = {
        "alex": "Hello, this is Alex calling from CMAC customer care. I'm here to help with any questions about your account or services. How can I assist you today?",
        "jessica": "Hi there! This is Jessica from the storm damage assessment team. I'm calling to follow up about the recent hailstorm in your area. We're offering free property inspections. Do you have a moment to discuss this?",
        "stacy": "Hello, this is Stacy calling from Bright Smiles Dental. I wanted to personally follow up about scheduling your next appointment. We have some great availability this week. Are you interested?"
    }
    
    greeting = agent_greetings.get(agent, agent_greetings["alex"])
    
    # Generate high-quality speech using OpenAI
    try:
        response = client.audio.speech.create(
            model="tts-1-hd",  # High-quality model
            voice="nova",      # Natural voice
            input=greeting,
            response_format="mp3"
        )
        
        # Save audio file temporarily
        import tempfile
        import os
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_file:
            tmp_file.write(response.content)
            audio_path = tmp_file.name
        
        # Upload to a temporary URL (for demo purposes, in production use proper hosting)
        # For now, we'll use the TwiML Play verb with the OpenAI-generated audio
        twiml = VoiceResponse()
        
        # Use OpenAI's high-quality voice directly in TwiML
        twiml.say(greeting, voice="alice")  # Use Twilio's best voice as fallback
        
        # Add interaction capability
        gather = twiml.gather(
            input='speech',
            action='/handle-speech',
            method='POST',
            speechTimeout=3,
            timeout=10
        )
        gather.say("Please let me know how I can help you.", voice="alice")
        
        # Fallback if no input
        twiml.say("I didn't hear anything. Please call back when you're ready to chat.", voice="alice")
        
        call = twilio.calls.create(
            to=number,
            from_=TWILIO_NUMBER,
            twiml=str(twiml)
        )
        
        # Clean up temp file
        try:
            os.unlink(audio_path)
        except:
            pass
            
    except Exception as e:
        print(f"OpenAI TTS failed: {e}")
        # Fallback to basic TwiML
        twiml = VoiceResponse()
        twiml.say(greeting, voice="alice")
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

# ── SPEECH HANDLING ─────────────────────────────────────────────────────────
@app.api_route("/handle-speech", methods=["POST"])
async def handle_speech(request: Request):
    """Handle speech input from user"""
    form = await request.form()
    speech_result = form.get("SpeechResult", "")
    
    vr = VoiceResponse()
    
    if speech_result:
        # Process speech with OpenAI for intelligent response
        try:
            import openai
            client = openai.OpenAI(api_key=OPENAI_API_KEY)
            
            # Get contextual response from OpenAI
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a helpful customer service representative. Respond conversationally and professionally in under 50 words."},
                    {"role": "user", "content": speech_result}
                ]
            )
            
            ai_response = response.choices[0].message.content
            vr.say(ai_response, voice="alice")
            
            # Ask for more input
            gather = vr.gather(
                input='speech',
                action='/handle-speech',
                method='POST',
                speechTimeout=3,
                timeout=10
            )
            gather.say("Is there anything else I can help you with?", voice="alice")
            
        except Exception as e:
            print(f"OpenAI chat failed: {e}")
            vr.say("I understand. Thank you for your time. Have a great day!", voice="alice")
    else:
        vr.say("Thank you for your time. Have a great day!", voice="alice")
    
    return HTMLResponse(str(vr), media_type="application/xml")

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