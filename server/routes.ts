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

// Simulate external FastAPI server communication
async function callExternalFastAPI(endpoint: string, data?: any) {
  // In a real implementation, this would make HTTP requests to the FastAPI server
  // For now, we'll simulate the responses
  
  console.log(`Simulating call to FastAPI ${endpoint} with data:`, data);
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  if (endpoint.startsWith('/make-call/')) {
    // Simulate successful call initiation
    return {
      success: true,
      callSid: `CA${Math.random().toString(36).substr(2, 32)}`,
      status: 'initiated'
    };
  }
  
  return { success: true };
}

export async function registerRoutes(app: Express): Promise<Server> {
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
        // Call external FastAPI server
        const result = await callExternalFastAPI(`/make-call/${phoneNumber.replace(/\D/g, '')}?agent=${agent}`);
        
        if (result.success) {
          // Update call record with call SID
          await storage.updateCallRecord(callRecord.id, {
            callSid: result.callSid
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
          errorMessage: 'Connection error to FastAPI server',
          endTime: new Date(),
        });
        
        broadcast({
          type: 'call_status',
          status: 'failed',
          message: 'Connection error to FastAPI server'
        });
        
        currentCallRecord = null;
        res.status(500).json({ error: "Connection error to FastAPI server" });
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
