# Twilio Voice Bot Control Interface

## Overview

This repository contains a full-stack web application for managing a Twilio voice bot that connects callers to different AI agents via OpenAI's Realtime API. The system provides a web interface for initiating calls, monitoring system status, and managing different AI agent personalities.

## User Preferences

```
Preferred communication style: Simple, everyday language.
```

## System Architecture

The application follows a modern full-stack architecture with clear separation between frontend and backend:

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for fast development and optimized builds
- **UI Framework**: Shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and Twilio brand colors
- **State Management**: TanStack React Query for server state management
- **Routing**: Wouter for lightweight client-side routing

### Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Database Provider**: Neon Database (@neondatabase/serverless)
- **WebSocket**: Built-in WebSocket server for real-time communication
- **API Design**: RESTful endpoints with simulated FastAPI integration

## Key Components

### Data Models
The system manages three primary entities:
1. **Users**: Basic authentication and user management
2. **Agents**: AI personality configurations with system prompts
3. **Call Records**: Historical data about voice calls including status, duration, and error tracking

### Main Interface (`voice-control.tsx`)
A comprehensive dashboard featuring:
- Phone number input with formatting
- Agent selection dropdown
- Real-time call status monitoring
- System health indicators (FastAPI, Twilio, OpenAI, WebSocket)
- Call history with detailed records
- Visual status indicators using badges and icons

### WebSocket Integration
Real-time bidirectional communication for:
- Live call status updates
- System health monitoring
- Broadcasting events to all connected clients

### Storage Layer
Dual implementation approach:
- In-memory storage for development/testing
- Database storage using Drizzle ORM with PostgreSQL schema

## Data Flow

1. **Call Initiation**: User selects agent and enters phone number
2. **External Integration**: System communicates with simulated FastAPI server
3. **Real-time Updates**: WebSocket broadcasts call status changes
4. **State Management**: React Query handles caching and synchronization
5. **Database Persistence**: Call records stored with comprehensive metadata

## External Dependencies

### Primary Integrations
- **Twilio**: Voice calling and media streaming (simulated in current implementation)
- **OpenAI Realtime API**: AI agent conversations (referenced but not directly integrated)
- **FastAPI Server**: External voice bot controller (simulated with placeholder endpoints)

### UI Dependencies
- **Radix UI**: Accessible component primitives
- **Lucide React**: Consistent icon system
- **Tailwind CSS**: Utility-first styling

### Development Tools
- **TypeScript**: Type safety across the stack
- **Drizzle Kit**: Database migrations and schema management
- **ESBuild**: Production bundling for server code

## Deployment Strategy

### Development Mode
- Vite dev server for frontend with HMR
- Express server with tsx runtime for backend
- Automatic database schema synchronization

### Production Build
- Vite builds optimized client bundle to `dist/public`
- ESBuild creates server bundle in `dist/`
- Single Node.js process serves both static files and API

### Environment Configuration
Required environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)
- OpenAI API key (OPENAI_API_KEY)

### Database Strategy
- Drizzle ORM with PostgreSQL dialect
- Migration files in `./migrations` directory
- Schema defined in `shared/schema.ts` for type sharing
- Development uses `db:push` for rapid iteration

The architecture prioritizes type safety, real-time capabilities, and seamless integration with external voice services while maintaining a clean separation of concerns and scalable deployment options.

## Recent Updates

### July 15, 2025 - Voice Calling System Working
- ✅ **CALLS NOW WORKING**: Fixed critical phone number formatting issue
- Resolved double-formatting bug that was adding extra "1" (+118179042227 → +18177512041)
- Implemented direct Twilio integration in Express server (no external FastAPI needed)
- Confirmed successful call initiation with proper TwiML responses
- Phone numbers properly formatted and calls ringing successfully
- System Status: **FULLY OPERATIONAL**

### 🔖 **CHECKPOINT - July 15, 2025, 10:45 PM**
**WORKING STATE BOOKMARKED**
- Calls successfully initiated and ringing phones ✅
- Multiple successful call SIDs generated (CA03601360fe1efa8a6909dcb218fe0a58, CA2f4bceaf303b646993543b5320a9995a)
- Phone number formatting: +18177512041 (correct) ✅
- Twilio integration: Direct Express server implementation ✅
- Dashboard: Fully functional with real-time status ✅
- Agent selection: Working (Alex, Jessica, Stacy) ✅
- Call history: Tracking and displaying properly ✅

**Current Implementation:**
- Uses TwiML with simple `Say` commands for voice responses
- Direct Twilio API calls from Express server
- No external FastAPI service required
- Ready for further enhancements while maintaining this working foundation

### July 15, 2025 - OpenAI Realtime API Integration
- 🚀 **UPGRADED TO REAL AI CONVERSATIONS**: Implemented FastAPI service with OpenAI Realtime API
- Added WebSocket bridge between Twilio Media Streams and OpenAI
- Real agent personalities: Alex (CMAC customer care), Jessica (hailstorm outreach), Stacy (persistent dental)
- Natural voice interactions with proper turn-taking and conversation flow
- FastAPI service running on port 8000 with full OpenAI integration
- System now waits for user input instead of immediately talking

## Usage Instructions

### To use with your existing FastAPI service:
1. **Start your FastAPI service locally:**
   ```bash
   cd cmac_caller
   python cmac_multi.py
   ```
   (This runs on port 5050)

2. **Expose your service with ngrok (required for Twilio webhooks):**
   ```bash
   ngrok http 5050
   ```
   This creates a public URL like `https://abc123.ngrok.app`

3. **Update your Twilio webhook URLs** in your Twilio Console to point to your ngrok URL
   
4. **The dashboard will automatically connect** and show "FastAPI Server: Online"

5. **You can then make real calls** through the interface

### Connection Architecture:
- **Dashboard → FastAPI**: Direct connection via ngrok URL (configurable)
- **Twilio → FastAPI**: Public connection via ngrok URL for webhooks  
- Dashboard now connects to your ngrok URL: `https://cmac.ngrok.app`

### If your ngrok URL is different:
Set the environment variable `FASTAPI_URL` to your actual ngrok URL

### Test Mode (without FastAPI):
- Dashboard works in demonstration mode when FastAPI is offline
- Shows connection status and interface functionality  
- Try the "Demo Mode" button to see call simulation

## Usage Instructions

### To use with your existing FastAPI service:
1. **Start your FastAPI service locally:**
   ```bash
   cd cmac_caller
   python cmac_multi.py
   ```
   (This runs on port 5050)

2. **Expose your service with ngrok (required for Twilio webhooks):**
   ```bash
   ngrok http 5050
   ```
   This creates a public URL like `https://abc123.ngrok.app`

3. **Update your Twilio webhook URLs** in your Twilio Console to point to your ngrok URL
   
4. **The dashboard will automatically connect** and show "FastAPI Server: Online"

5. **You can then make real calls** through the interface

### Connection Architecture:
- **Dashboard → FastAPI**: Direct connection via ngrok URL (configurable)
- **Twilio → FastAPI**: Public connection via ngrok URL for webhooks  
- Dashboard now connects to your ngrok URL: `https://cmac.ngrok.app`

### If your ngrok URL is different:
Set the environment variable `FASTAPI_URL` to your actual ngrok URL

### Test Mode (without FastAPI):
- Dashboard works in demonstration mode when FastAPI is offline
- Shows connection status and interface functionality  
- Try the "Demo Mode" button to see call simulation