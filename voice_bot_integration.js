// Simple voice bot integration for testing
// This replaces the need for a separate FastAPI service

const express = require('express');
const twilio = require('twilio');

// Mock voice bot responses for testing
const VOICE_BOT_RESPONSES = {
  alex: "Hello, this is Alex from CMAC Roofing's Customer Care team. I'm following up on your recent request. How can I help you today?",
  jessica: "Hi! This is Jessica from CMAC Roofing. I'm calling about the recent hailstorm in your area. Have you had a chance to check your roof?",
  stacy: "Hello, I need to book a dental appointment. Is this the dentist?",
  "test-bot": "Hi! I'm a test AI assistant. How can I help you today?"
};

// Create TwiML response for voice calls
function createVoiceResponse(agent) {
  const message = VOICE_BOT_RESPONSES[agent] || VOICE_BOT_RESPONSES["test-bot"];
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${message}</Say>
  <Say voice="alice">This is a test implementation. In production, this would connect to OpenAI's Realtime API for full conversation capability.</Say>
</Response>`;
}

module.exports = {
  VOICE_BOT_RESPONSES,
  createVoiceResponse
};