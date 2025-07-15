from fastapi import FastAPI
from fastapi.responses import JSONResponse
import uvicorn
import os

app = FastAPI()

@app.get("/")
async def root():
    return {"status": "running", "message": "FastAPI service is online"}

@app.get("/health")
async def health():
    return {"status": "online", "service": "FastAPI Voice Bot"}

@app.get("/make-call/{number}")
async def make_call(number: str, agent: str = "alex"):
    # This is a test endpoint - in production this would connect to Twilio/OpenAI
    return {
        "call_sid": f"test_call_{number}",
        "agent": agent,
        "status": "test_mode",
        "message": f"Test call initiated to {number} with agent {agent}"
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)