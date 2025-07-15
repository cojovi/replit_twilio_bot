#!/usr/bin/env python3
"""
Start script for the FastAPI service with OpenAI Realtime API integration.
This service handles the WebSocket bridge between Twilio Media Streams and OpenAI.
"""

import subprocess
import sys
import os

def main():
    # Change to the directory containing the FastAPI service
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    try:
        # Start the FastAPI service
        print("Starting FastAPI service with OpenAI Realtime API integration...")
        print("This will enable natural, conversational AI instead of robotic TwiML responses")
        
        subprocess.run([sys.executable, "fastapi_service.py"], check=True)
    except KeyboardInterrupt:
        print("\nFastAPI service stopped by user")
    except subprocess.CalledProcessError as e:
        print(f"Error starting FastAPI service: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()