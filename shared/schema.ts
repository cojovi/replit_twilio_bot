import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const callRecords = pgTable("call_records", {
  id: serial("id").primaryKey(),
  phoneNumber: text("phone_number").notNull(),
  agentId: text("agent_id").notNull(),
  status: text("status", { enum: ['completed', 'failed', 'in-progress'] }).notNull(),
  duration: text("duration"),
  startTime: timestamp("start_time").defaultNow().notNull(),
  endTime: timestamp("end_time"),
  errorMessage: text("error_message"),
  callSid: text("call_sid"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertAgentSchema = createInsertSchema(agents).omit({
  isActive: true,
});

export const insertCallRecordSchema = createInsertSchema(callRecords).omit({
  id: true,
  startTime: true,
  endTime: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

export type InsertCallRecord = z.infer<typeof insertCallRecordSchema>;
export type CallRecord = typeof callRecords.$inferSelect;
