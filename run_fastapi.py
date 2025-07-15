#!/usr/bin/env python3
import subprocess
import sys
import os

# Start the FastAPI service in the background
os.chdir(os.path.dirname(os.path.abspath(__file__)))
subprocess.run([sys.executable, "fastapi_service.py"], check=True)