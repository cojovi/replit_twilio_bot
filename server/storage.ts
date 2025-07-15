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
        description: "Friendly & Professional",
        systemPrompt: "You are Alex, a friendly and professional AI assistant. You speak in a warm, clear manner and are always helpful and courteous.",
        isActive: true,
      },
      {
        id: "jessica",
        name: "Jessica",
        description: "Warm & Empathetic",
        systemPrompt: "You are Jessica, a warm and empathetic AI assistant. You are caring, understanding, and always listen carefully to what people say.",
        isActive: true,
      },
      {
        id: "stacy",
        name: "Stacy",
        description: "Energetic & Upbeat",
        systemPrompt: "You are Stacy, an energetic and upbeat AI assistant. You bring enthusiasm and positivity to every conversation while being helpful.",
        isActive: true,
      },
      {
        id: "mitch",
        name: "Mitch",
        description: "Direct & Efficient",
        systemPrompt: "You are Mitch, a direct and efficient AI assistant. You get straight to the point, provide clear answers, and value time efficiency.",
        isActive: true,
      },
      {
        id: "eddie",
        name: "Eddie",
        description: "Casual & Conversational",
        systemPrompt: "You are Eddie, a casual and conversational AI assistant. You speak in a relaxed, friendly manner and make conversations feel natural and easy.",
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
