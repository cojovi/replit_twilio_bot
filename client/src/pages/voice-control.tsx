import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PhoneInput } from "@/components/ui/phone-input";
import { Phone, PhoneCall, PhoneOff, Settings, History, Server, Zap, Mic, Download, CheckCircle, XCircle, Clock, Loader2 } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  description: string;
}

interface CallRecord {
  id: string;
  phoneNumber: string;
  agent: string;
  status: 'completed' | 'failed' | 'in-progress';
  duration?: string;
  timestamp: string;
  error?: string;
}

interface CallStatus {
  isActive: boolean;
  phoneNumber?: string;
  agent?: string;
  status?: string;
  duration?: string;
  startTime?: number;
}

interface SystemStatus {
  fastapi: 'online' | 'offline';
  twilio: 'connected' | 'disconnected';
  openai: 'active' | 'inactive';
  websocket: 'connected' | 'standby' | 'disconnected';
}

export default function VoiceControl() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [callStatus, setCallStatus] = useState<CallStatus>({ isActive: false });
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    fastapi: 'online',
    twilio: 'connected',
    openai: 'active',
    websocket: 'standby'
  });
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch available agents
  const { data: agents = [], isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ['/api/agents']
  });

  // Fetch recent calls
  const { data: recentCalls = [], isLoading: callsLoading } = useQuery<CallRecord[]>({
    queryKey: ['/api/calls/recent']
  });

  // Fetch system status
  const { data: fetchedSystemStatus } = useQuery<SystemStatus>({
    queryKey: ['/api/status'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Update system status when data is fetched
  useEffect(() => {
    if (fetchedSystemStatus) {
      setSystemStatus(prev => ({ ...prev, ...fetchedSystemStatus }));
    }
  }, [fetchedSystemStatus]);

  // Make call mutation
  const makeCallMutation = useMutation({
    mutationFn: async ({ phoneNumber, agent }: { phoneNumber: string; agent: string }) => {
      const response = await apiRequest('POST', '/api/calls/make', { phoneNumber, agent });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Call Initiated",
          description: `Connecting to ${phoneNumber}...`,
        });
        setCallStatus({
          isActive: true,
          phoneNumber,
          agent: selectedAgent,
          status: 'connecting',
          startTime: Date.now()
        });
        startDurationTimer();
      } else {
        toast({
          title: "Call Failed",
          description: data.error || "Failed to initiate call",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Connection Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/calls/recent'] });
    }
  });

  // End call mutation
  const endCallMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/calls/end', {});
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Call Ended",
        description: "Call has been terminated",
      });
      resetCallStatus();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to end call: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const connect = () => {
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onopen = () => {
        setSystemStatus(prev => ({ ...prev, websocket: 'connected' }));
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      
      wsRef.current.onclose = () => {
        setSystemStatus(prev => ({ ...prev, websocket: 'disconnected' }));
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };
      
      wsRef.current.onerror = () => {
        setSystemStatus(prev => ({ ...prev, websocket: 'disconnected' }));
      };
    };
    
    connect();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, []);

  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case 'call_status':
        setCallStatus(prev => ({
          ...prev,
          status: data.status,
          ...(data.status === 'completed' || data.status === 'failed' ? { isActive: false } : {})
        }));
        
        if (data.status === 'completed' || data.status === 'failed') {
          toast({
            title: data.status === 'completed' ? "Call Completed" : "Call Failed",
            description: data.message || (data.status === 'completed' ? "Call ended successfully" : "Call failed"),
            variant: data.status === 'failed' ? "destructive" : "default",
          });
          resetCallStatus();
          queryClient.invalidateQueries({ queryKey: ['/api/calls/recent'] });
        }
        break;
      
      case 'system_status':
        setSystemStatus(prev => ({ ...prev, ...data.status }));
        break;
    }
  };

  const startDurationTimer = () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }
    
    durationIntervalRef.current = setInterval(() => {
      setCallStatus(prev => {
        if (prev.isActive && prev.startTime) {
          const elapsed = Date.now() - prev.startTime;
          const minutes = Math.floor(elapsed / 60000);
          const seconds = Math.floor((elapsed % 60000) / 1000);
          return {
            ...prev,
            duration: `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
          };
        }
        return prev;
      });
    }, 1000);
  };

  const resetCallStatus = () => {
    setCallStatus({ isActive: false });
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid phone number",
        variant: "destructive",
      });
      return;
    }
    
    if (!selectedAgent) {
      toast({
        title: "Agent Required",
        description: "Please select an AI agent",
        variant: "destructive",
      });
      return;
    }
    
    makeCallMutation.mutate({ phoneNumber, agent: selectedAgent });
  };

  const handleReset = () => {
    setPhoneNumber("");
    setSelectedAgent("");
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
      case 'connected':
      case 'active':
        return <div className="w-2 h-2 bg-twilio-success rounded-full" />;
      case 'standby':
        return <div className="w-2 h-2 bg-yellow-400 rounded-full" />;
      default:
        return <div className="w-2 h-2 bg-red-500 rounded-full" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-twilio-success';
      case 'failed':
        return 'text-red-500';
      case 'in-progress':
        return 'text-blue-500';
      default:
        return 'text-gray-500';
    }
  };

  const getCallIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-twilio-success" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'in-progress':
        return <Clock className="h-4 w-4 text-blue-500" />;
      default:
        return <Phone className="h-4 w-4 text-gray-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-twilio-red rounded-lg flex items-center justify-center">
                <Phone className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-twilio-text">AI Voice Assistant</h1>
                <p className="text-sm text-gray-600">Control Panel</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-twilio-success rounded-full"></div>
                <span className="text-sm text-gray-600">Server Online</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-twilio-text">FastAPI Server</div>
                <div className="text-xs text-gray-500">Port 8000</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Call Configuration Panel */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="flex items-center text-lg font-semibold text-twilio-text">
                  <Settings className="h-5 w-5 text-twilio-red mr-3" />
                  Call Configuration
                </CardTitle>
                <p className="text-sm text-gray-600">Configure and initiate AI voice calls</p>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Phone Number Input */}
                  <div>
                    <Label htmlFor="phoneNumber" className="text-sm font-medium text-twilio-text">
                      Phone Number
                    </Label>
                    <PhoneInput
                      value={phoneNumber}
                      onChange={setPhoneNumber}
                      placeholder="+1 (555) 123-4567"
                      className="mt-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">Enter a valid phone number with country code</p>
                  </div>

                  {/* Agent Selection */}
                  <div>
                    <Label htmlFor="agent" className="text-sm font-medium text-twilio-text">
                      AI Agent Personality
                    </Label>
                    <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                      <SelectTrigger className="mt-2">
                        <SelectValue placeholder="Select an AI agent..." />
                      </SelectTrigger>
                      <SelectContent>
                        {agentsLoading ? (
                          <SelectItem value="loading" disabled>Loading agents...</SelectItem>
                        ) : agents.length === 0 ? (
                          <SelectItem value="none" disabled>No agents available</SelectItem>
                        ) : (
                          agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name} - {agent.description}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-500 mt-1">Choose the AI personality for this call</p>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex space-x-4 pt-4">
                    <Button
                      type="submit"
                      disabled={makeCallMutation.isPending || callStatus.isActive}
                      className="flex-1 bg-twilio-red hover:bg-twilio-red/90 text-white"
                    >
                      {makeCallMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Initiating...
                        </>
                      ) : (
                        <>
                          <PhoneCall className="h-4 w-4 mr-2" />
                          Initiate Call
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleReset}
                      disabled={makeCallMutation.isPending}
                    >
                      Reset
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Recent Calls History */}
            <Card>
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="flex items-center text-lg font-semibold text-twilio-text">
                  <History className="h-5 w-5 text-twilio-red mr-3" />
                  Recent Calls
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {callsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : recentCalls.length === 0 ? (
                  <div className="text-center py-8">
                    <Phone className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">No recent calls</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recentCalls.map((call) => (
                      <div key={call.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center">
                            {getCallIcon(call.status)}
                          </div>
                          <div>
                            <div className="font-medium text-twilio-text">{call.phoneNumber}</div>
                            <div className="text-sm text-gray-500">Agent: {call.agent} • {call.timestamp}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-medium ${getStatusColor(call.status)}`}>
                            {call.status.charAt(0).toUpperCase() + call.status.slice(1)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {call.status === 'failed' ? call.error : call.duration ? `Duration: ${call.duration}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Status Panel */}
          <div className="space-y-6">
            {/* Current Call Status */}
            <Card>
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="flex items-center text-lg font-semibold text-twilio-text">
                  <PhoneCall className="h-5 w-5 text-twilio-red mr-3" />
                  Call Status
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {callStatus.isActive ? (
                  <div className="text-center">
                    <div className="w-16 h-16 bg-twilio-red rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                      <Phone className="h-8 w-8 text-white" />
                    </div>
                    <div className="text-sm font-medium text-twilio-text">Call in Progress</div>
                    <div className="text-xs text-gray-500 mt-1">{callStatus.duration || "00:00"}</div>
                    
                    <div className="space-y-3 mt-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Number:</span>
                        <span className="text-twilio-text">{callStatus.phoneNumber}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Agent:</span>
                        <span className="text-twilio-text">{callStatus.agent}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Status:</span>
                        <Badge variant="secondary" className="text-twilio-success">
                          {callStatus.status || "Connected"}
                        </Badge>
                      </div>
                    </div>
                    
                    <Button
                      onClick={() => endCallMutation.mutate()}
                      disabled={endCallMutation.isPending}
                      className="w-full mt-4 bg-red-500 hover:bg-red-600 text-white"
                    >
                      <PhoneOff className="h-4 w-4 mr-2" />
                      End Call
                    </Button>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <PhoneOff className="h-8 w-8 text-gray-400" />
                    </div>
                    <div className="text-sm font-medium text-gray-500">No Active Call</div>
                    <div className="text-xs text-gray-400 mt-1">Ready to initiate</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* System Status */}
            <Card>
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="flex items-center text-lg font-semibold text-twilio-text">
                  <Server className="h-5 w-5 text-twilio-red mr-3" />
                  System Status
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(systemStatus.fastapi)}
                      <span className="text-sm text-twilio-text">FastAPI Server</span>
                    </div>
                    <span className={`text-xs ${systemStatus.fastapi === 'online' ? 'text-twilio-success' : 'text-red-500'}`}>
                      {systemStatus.fastapi.charAt(0).toUpperCase() + systemStatus.fastapi.slice(1)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(systemStatus.twilio)}
                      <span className="text-sm text-twilio-text">Twilio API</span>
                    </div>
                    <span className={`text-xs ${systemStatus.twilio === 'connected' ? 'text-twilio-success' : 'text-red-500'}`}>
                      {systemStatus.twilio.charAt(0).toUpperCase() + systemStatus.twilio.slice(1)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(systemStatus.openai)}
                      <span className="text-sm text-twilio-text">OpenAI Realtime</span>
                    </div>
                    <span className={`text-xs ${systemStatus.openai === 'active' ? 'text-twilio-success' : 'text-red-500'}`}>
                      {systemStatus.openai.charAt(0).toUpperCase() + systemStatus.openai.slice(1)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(systemStatus.websocket)}
                      <span className="text-sm text-twilio-text">WebSocket</span>
                    </div>
                    <span className={`text-xs ${
                      systemStatus.websocket === 'connected' ? 'text-twilio-success' : 
                      systemStatus.websocket === 'standby' ? 'text-yellow-600' : 'text-red-500'
                    }`}>
                      {systemStatus.websocket.charAt(0).toUpperCase() + systemStatus.websocket.slice(1)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Connection Help */}
            {systemStatus.fastapi === 'offline' && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader className="border-b border-orange-200">
                  <CardTitle className="flex items-center text-lg font-semibold text-orange-800">
                    <Server className="h-5 w-5 text-orange-600 mr-3" />
                    FastAPI Connection Required
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="text-sm text-orange-800 space-y-3">
                    <p>To make real calls, your FastAPI service needs to be running:</p>
                    <div className="bg-orange-100 p-3 rounded-lg font-mono text-xs">
                      cd cmac_caller<br/>
                      python cmac_multi.py
                    </div>
                    <p className="text-xs text-orange-600">
                      Make sure your FastAPI server is running on port 8000, then the dashboard will connect automatically.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Quick Actions */}
            <Card>
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="flex items-center text-lg font-semibold text-twilio-text">
                  <Zap className="h-5 w-5 text-twilio-red mr-3" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-3">
                  <Button variant="outline" className="w-full justify-start">
                    <Mic className="h-4 w-4 text-twilio-red mr-3" />
                    <div className="text-left">
                      <div className="text-sm font-medium text-twilio-text">Test Audio</div>
                      <div className="text-xs text-gray-500">Check mic & speakers</div>
                    </div>
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    <Download className="h-4 w-4 text-twilio-red mr-3" />
                    <div className="text-left">
                      <div className="text-sm font-medium text-twilio-text">Export Logs</div>
                      <div className="text-xs text-gray-500">Download call logs</div>
                    </div>
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    <Settings className="h-4 w-4 text-twilio-red mr-3" />
                    <div className="text-left">
                      <div className="text-sm font-medium text-twilio-text">Settings</div>
                      <div className="text-xs text-gray-500">Configure system</div>
                    </div>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
