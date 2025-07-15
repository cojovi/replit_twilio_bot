#!/usr/bin/env python3
import subprocess
import sys
import os

# Set up environment
os.environ['PYTHONPATH'] = '.'

# Start FastAPI service
try:
    subprocess.run([sys.executable, '-m', 'uvicorn', 'fastapi_service:app', '--host', '0.0.0.0', '--port', '8001'])
except KeyboardInterrupt:
    print("FastAPI service stopped")