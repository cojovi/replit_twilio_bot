#!/usr/bin/env python3
"""
Simple script to start the FastAPI service properly.
"""
import subprocess
import sys
import os

def main():
    try:
        # Set environment variables
        os.environ['PYTHONPATH'] = os.getcwd()
        
        # Start the FastAPI service
        cmd = [sys.executable, '-m', 'uvicorn', 'fastapi_service:app', '--host', '0.0.0.0', '--port', '8000']
        
        print("Starting FastAPI service...")
        print(f"Command: {' '.join(cmd)}")
        
        # Start the process
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        
        # Wait a bit and check if it's running
        try:
            stdout, stderr = process.communicate(timeout=10)
            print(f"stdout: {stdout}")
            print(f"stderr: {stderr}")
        except subprocess.TimeoutExpired:
            print("Service started successfully (timeout reached)")
            process.kill()
            stdout, stderr = process.communicate()
            print(f"stdout: {stdout}")
            print(f"stderr: {stderr}")
        
    except Exception as e:
        print(f"Error starting service: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(main())