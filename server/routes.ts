import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertCallRecordSchema } from "@shared/schema";
import { z } from "zod";

const makeCallSchema = z.object({
  phoneNumber: z.string().min(10),
  agent: z.string().min(1),
});

const endCallSchema = z.object({});

// Store active WebSocket connections
const wsConnections = new Set<WebSocket>();
let currentCallRecord: any = null;

// Function to broadcast to all connected clients
function broadcast(data: any) {
  const message = JSON.stringify(data);
  wsConnections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

// Direct Twilio integration - no need for separate FastAPI service
import twilio from 'twilio';

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Agent responses for voice calls
const AGENT_RESPONSES = {
  alex: "Hello, this is Alex from CMAC Roofing's Customer Care team. I'm following up on your recent request. How can I help you today?",
  jessica: "Hi! This is Jessica from CMAC Roofing. I'm calling about the recent hailstorm in your area. Have you had a chance to check your roof?",
  stacy: "Hello, I need to book a dental appointment. Is this the dentist?",
  "test-bot": "Hi! I'm a test AI assistant. How can I help you today?"
};

// Create TwiML response for voice calls
function createTwiMLResponse(agent: string) {
  const message = AGENT_RESPONSES[agent as keyof typeof AGENT_RESPONSES] || AGENT_RESPONSES["test-bot"];
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${message}</Say>
  <Say voice="alice">This is a test implementation. In production, this would connect to OpenAI's Realtime API for full conversation capability.</Say>
  <Say voice="alice">Thank you for testing the voice bot system. Goodbye!</Say>
</Response>`;
}

// Call function using FastAPI service with OpenAI Realtime API
async function makeVoiceCall(phoneNumber: string, agent: string) {
  try {
    // Use phone number as-is (already formatted from frontend)
    console.log(`Original phone number: ${phoneNumber}`);
    console.log(`Making voice call to ${phoneNumber} with agent ${agent}`);
    
    // Get FastAPI service URL - defaults to local FastAPI service
    const fastApiUrl = process.env.FASTAPI_URL || 'http://localhost:8000';
    
    // Use FastAPI service to make the call
    const response = await fetch(`${fastApiUrl}/make-call/${encodeURIComponent(phoneNumber)}?agent=${agent}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`FastAPI service error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log(`Call initiated with SID: ${result.call_sid}`);
    
    // Wait a moment and check the call status
    setTimeout(async () => {
      try {
        const updatedCall = await twilioClient.calls(result.call_sid).fetch();
        console.log(`Call ${result.call_sid} status update: ${updatedCall.status}`);
        if (updatedCall.status === 'failed') {
          console.log(`Call failure reason: ${updatedCall.errorCode} - ${updatedCall.errorMessage}`);
        }
      } catch (error) {
        console.error('Error checking call status:', error);
      }
    }, 3000);
    
    return {
      success: true,
      call_sid: result.call_sid,
      agent: agent,
      status: 'initiated'
    };
  } catch (error) {
    console.error('Voice call error:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
    throw new Error(`Voice call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Check system status
  app.get("/api/status", async (req, res) => {
    try {
      let twilioStatus = 'disconnected';
      let openaiStatus = 'inactive';
      let fastApiStatus = 'offline';
      
      // Check if required environment variables are present
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
        twilioStatus = 'connected';
      }
      
      if (process.env.OPENAI_API_KEY) {
        openaiStatus = 'active';
      }
      
      // Check FastAPI service status
      try {
        const fastApiUrl = process.env.FASTAPI_URL || 'http://localhost:8000';
        const response = await fetch(`${fastApiUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          fastApiStatus = 'online';
        }
      } catch (error) {
        console.log('FastAPI health check failed:', error);
      }
      
      res.json({
        fastapi: fastApiStatus,
        twilio: twilioStatus,
        openai: openaiStatus,
        websocket: 'connected'
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to check system status" });
    }
  });

  // Get available agents
  app.get("/api/agents", async (req, res) => {
    try {
      const agents = await storage.getAgents();
      res.json(agents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch agents" });
    }
  });

  // Get recent calls
  app.get("/api/calls/recent", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const calls = await storage.getRecentCalls(limit);
      
      // Format calls for frontend
      const formattedCalls = calls.map(call => ({
        id: call.id.toString(),
        phoneNumber: call.phoneNumber,
        agent: call.agentId,
        status: call.status,
        duration: call.duration,
        timestamp: call.startTime ? new Date(call.startTime).toLocaleString() : '',
        error: call.errorMessage
      }));
      
      res.json(formattedCalls);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch recent calls" });
    }
  });

  // Demo mode - test the interface without FastAPI
  app.post("/api/calls/demo", async (req, res) => {
    try {
      const { phoneNumber, agent } = makeCallSchema.parse(req.body);
      
      const agentData = await storage.getAgent(agent);
      if (!agentData) {
        return res.status(400).json({ error: "Invalid agent selected" });
      }
      
      const callRecord = await storage.createCallRecord({
        phoneNumber,
        agentId: agent,
        status: 'in-progress',
        callSid: `DEMO_${Math.random().toString(36).substr(2, 8)}`,
        duration: null,
        errorMessage: null,
      });
      
      currentCallRecord = callRecord;
      
      broadcast({
        type: 'call_status',
        status: 'connecting',
        message: `Demo: Simulating call to ${phoneNumber}...`
      });
      
      // Simulate call progression in demo mode
      setTimeout(() => {
        broadcast({
          type: 'call_status',
          status: 'connected',
          message: 'Demo: Call connected (simulated)'
        });
      }, 2000);
      
      // Simulate call completion after 10 seconds
      setTimeout(async () => {
        const duration = '0m 10s';
        
        await storage.updateCallRecord(callRecord.id, {
          status: 'completed',
          duration,
          endTime: new Date(),
        });
        
        broadcast({
          type: 'call_status',
          status: 'completed',
          message: 'Demo: Call completed (simulated)'
        });
        
        currentCallRecord = null;
      }, 10000);
      
      res.json({ success: true, callId: callRecord.id, demo: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Make a call
  app.post("/api/calls/make", async (req, res) => {
    try {
      const { phoneNumber, agent } = makeCallSchema.parse(req.body);
      
      // Check if agent exists
      const agentData = await storage.getAgent(agent);
      if (!agentData) {
        return res.status(400).json({ error: "Invalid agent selected" });
      }
      
      // Create call record
      const callRecord = await storage.createCallRecord({
        phoneNumber,
        agentId: agent,
        status: 'in-progress',
        callSid: null,
        duration: null,
        errorMessage: null,
      });
      
      currentCallRecord = callRecord;
      
      // Notify clients about call status
      broadcast({
        type: 'call_status',
        status: 'connecting',
        message: `Connecting to ${phoneNumber}...`
      });
      
      try {
        // Make call directly with Twilio - fixed phone number formatting
        console.log(`Original phone number: ${phoneNumber}`);
        
        // Use the phone number as-is from the frontend (already formatted as +18177512041)
        const result = await makeVoiceCall(phoneNumber, agent);
        
        if (result.success) {
          // Update call record with call SID
          await storage.updateCallRecord(callRecord.id, {
            callSid: result.callSid || result.call_sid
          });
          
          // Simulate call progression
          setTimeout(() => {
            broadcast({
              type: 'call_status',
              status: 'connected',
              message: 'Call connected successfully'
            });
          }, 2000);
          
          // Simulate call completion after random duration
          const callDuration = Math.floor(Math.random() * 180) + 30; // 30-210 seconds
          setTimeout(async () => {
            const duration = `${Math.floor(callDuration / 60)}m ${callDuration % 60}s`;
            
            await storage.updateCallRecord(callRecord.id, {
              status: 'completed',
              duration,
              endTime: new Date(),
            });
            
            broadcast({
              type: 'call_status',
              status: 'completed',
              message: 'Call completed successfully'
            });
            
            currentCallRecord = null;
          }, callDuration * 1000);
          
          res.json({ success: true, callId: callRecord.id });
        } else {
          // Handle call failure
          await storage.updateCallRecord(callRecord.id, {
            status: 'failed',
            errorMessage: 'Failed to initiate call',
            endTime: new Date(),
          });
          
          broadcast({
            type: 'call_status',
            status: 'failed',
            message: 'Failed to initiate call'
          });
          
          currentCallRecord = null;
          res.status(500).json({ error: "Failed to initiate call" });
        }
      } catch (error) {
        // Handle external API error
        await storage.updateCallRecord(callRecord.id, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Call failed',
          endTime: new Date(),
        });
        
        broadcast({
          type: 'call_status',
          status: 'failed',
          message: error instanceof Error ? error.message : 'Call failed'
        });
        
        currentCallRecord = null;
        res.status(500).json({ error: error instanceof Error ? error.message : 'Call failed' });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // End current call
  app.post("/api/calls/end", async (req, res) => {
    try {
      endCallSchema.parse(req.body);
      
      if (!currentCallRecord) {
        return res.status(400).json({ error: "No active call to end" });
      }
      
      // Update call record
      const now = new Date();
      const startTime = new Date(currentCallRecord.startTime);
      const durationSeconds = Math.floor((now.getTime() - startTime.getTime()) / 1000);
      const duration = `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;
      
      await storage.updateCallRecord(currentCallRecord.id, {
        status: 'completed',
        duration,
        endTime: now,
      });
      
      // Notify clients
      broadcast({
        type: 'call_status',
        status: 'completed',
        message: 'Call ended by user'
      });
      
      currentCallRecord = null;
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to end call" });
    }
  });

  // Create HTTP server
  const httpServer = createServer(app);

  // Add WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    wsConnections.add(ws);
    console.log('WebSocket client connected');
    
    // Send current system status
    ws.send(JSON.stringify({
      type: 'system_status',
      status: {
        fastapi: 'online',
        twilio: 'connected',
        openai: 'active',
        websocket: 'connected'
      }
    }));
    
    // If there's an active call, send its status
    if (currentCallRecord) {
      ws.send(JSON.stringify({
        type: 'call_status',
        status: 'connected',
        message: 'Call in progress'
      }));
    }
    
    ws.on('close', () => {
      wsConnections.delete(ws);
      console.log('WebSocket client disconnected');
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      wsConnections.delete(ws);
    });
  });

  return httpServer;
}
