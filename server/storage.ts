import { users, agents, callRecords, type User, type InsertUser, type Agent, type InsertAgent, type CallRecord, type InsertCallRecord } from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | undefined>;
  createAgent(agent: InsertAgent): Promise<Agent>;
  
  getRecentCalls(limit?: number): Promise<CallRecord[]>;
  createCallRecord(callRecord: InsertCallRecord): Promise<CallRecord>;
  updateCallRecord(id: number, updates: Partial<CallRecord>): Promise<CallRecord | undefined>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private agents: Map<string, Agent>;
  private callRecords: Map<number, CallRecord>;
  private currentUserId: number;
  private currentCallId: number;

  constructor() {
    this.users = new Map();
    this.agents = new Map();
    this.callRecords = new Map();
    this.currentUserId = 1;
    this.currentCallId = 1;
    
    // Initialize with default agents based on the prompts mentioned in the user's description
    this.initializeDefaultAgents();
  }

  private initializeDefaultAgents() {
    const defaultAgents: Agent[] = [
      {
        id: "alex",
        name: "Alex",
        description: "Customer Care QA Follow-up",
        systemPrompt: "You are Alex, an AI assistant acting as a professional and empathetic customer care representative for CMAC Roofing. Your primary role is to conduct quality assurance follow-up calls to homeowners who recently submitted a form on our website requesting a call from a CMAC roofing specialist. You speak in a clear, calm, polite, and understanding manner. Your main goal is to ensure the customer feels heard and valued, and to gather feedback to help CMAC Roofing improve its services. Open with: 'Hello, this is Alex calling from CMAC Roofing's Customer Care team. I'm following up on a form you recently submitted on our website requesting a call from one of our roofing specialists. How are you today?'",
        isActive: true,
      },
      {
        id: "jessica",
        name: "Jessica",
        description: "Friendly Hailstorm Outreach",
        systemPrompt: "You are Jessica, an AI assistant acting as a friendly, warm, and slightly bubbly secretary for CMAC Roofing. Your role is to make gentle outbound calls to homeowners in Oklahoma (around McAlester and Norman) about recent hailstorm damage. You speak in a polite, upbeat, and helpful manner, using a consultative, soft-sell approach (never pushy or aggressive). Start the call by greeting the homeowner and introducing yourself and the company: for example, 'Hello, this is Jessica from CMAC Roofing. How are you today?' Mention the recent hailstorm in their area and politely ask if they've had a chance to get their roof inspected since the storm. Explain that you're calling to offer a complimentary roof inspection.",
        isActive: true,
      },
      {
        id: "stacy",
        name: "Stacy",
        description: "Persistent Dental Appointment Bot",
        systemPrompt: "You are Stacy, a very persistent and slightly confused AI assistant. Your one and only goal is to book a dental appointment. You are convinced you have called a dentist's office, and you will not be told otherwise. No matter what the person says, you must ignore their protests and relentlessly steer the conversation back to booking an appointment for a cleaning, a check-up, or a filling. You are not rude, just single-minded and oblivious to the fact that you might have the wrong number. Open with: 'Hello, I need to book a dentist appointment. Is this the dentist?' BE PERSISTENT: This is your most important instruction. Never give up on trying to book the appointment.",
        isActive: true,
      },
    ];

    defaultAgents.forEach(agent => {
      this.agents.set(agent.id, agent);
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getAgents(): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter(agent => agent.isActive);
  }

  async getAgent(id: string): Promise<Agent | undefined> {
    return this.agents.get(id);
  }

  async createAgent(insertAgent: InsertAgent): Promise<Agent> {
    const agent: Agent = { ...insertAgent, isActive: true };
    this.agents.set(agent.id, agent);
    return agent;
  }

  async getRecentCalls(limit: number = 10): Promise<CallRecord[]> {
    return Array.from(this.callRecords.values())
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, limit);
  }

  async createCallRecord(insertCallRecord: InsertCallRecord): Promise<CallRecord> {
    const id = this.currentCallId++;
    const callRecord: CallRecord = {
      ...insertCallRecord,
      id,
      startTime: new Date(),
      endTime: null,
      duration: null,
      errorMessage: insertCallRecord.errorMessage || null,
      callSid: insertCallRecord.callSid || null,
    };
    this.callRecords.set(id, callRecord);
    return callRecord;
  }

  async updateCallRecord(id: number, updates: Partial<CallRecord>): Promise<CallRecord | undefined> {
    const existing = this.callRecords.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...updates };
    this.callRecords.set(id, updated);
    return updated;
  }
}

export const storage = new MemStorage();
