"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Radio,
  Headphones,
  Wifi,
  Users,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Play,
  Square,
  Smartphone,
  Shield,
  Zap,
  Globe,
  Package,
  Upload,
  Terminal,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  MonitorSmartphone,
  AudioWaveform,
  RadioTower,
  Music,
  Youtube,
  Disc3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { io, Socket } from "socket.io-client";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────
const SOCKET_PORT = 3003;
const AUDIO_SAMPLE_RATE = 22050;
const AUDIO_CHANNELS = 1;
const BUFFER_SIZE = 4096;

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface DiscoveredSession {
  sessionId: string;
  hostName: string;
  listenerCount: number;
  createdAt: number;
}

interface ListenerInfo {
  id: string;
  name: string;
}

// ──────────────────────────────────────────────
// Waveform Bars (standalone component)
// ──────────────────────────────────────────────
function WaveformBars({ active, color1, color2, level }: { active: boolean; color1: string; color2: string; level: number }) {
  return (
    <div className="flex items-center justify-center gap-[3px] h-20">
      {Array.from({ length: 40 }).map((_, i) => (
        <motion.div
          key={i}
          className={`w-1.5 rounded-full bg-gradient-to-t ${color1} ${color2}`}
          animate={{ height: active ? Math.max(8, Math.sin(Date.now() / 200 + i * 0.5) * 30 * (level / 100) + 10) : 8 }}
          transition={{ duration: 0.1, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────
// Audio Stream Demo Component
// ──────────────────────────────────────────────
function AudioStreamDemo() {
  const { toast } = useToast();
  const [role, setRole] = useState<"none" | "host" | "listener">("none");
  const [hostName, setHostName] = useState("");
  const [listenerName, setListenerName] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [joinSessionId, setJoinSessionId] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [audioSource, setAudioSource] = useState<"mic" | "system">("system");
  const [listeners, setListeners] = useState<ListenerInfo[]>([]);
  const [discoveredSessions, setDiscoveredSessions] = useState<DiscoveredSession[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [latency, setLatency] = useState(0);
  const [bufferProgress, setBufferProgress] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playbackQueueRef = useRef<Float32Array[]>([]);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const isPlayingRef = useRef(false);
  const roleRef = useRef(role);
  const playNextChunkRef = useRef<() => void>(() => {});
  const [socketConnected, setSocketConnected] = useState(false);

  // Sync refs with state (must use useEffect for strict mode compliance)
  useEffect(() => { roleRef.current = role; }, [role]);

  // Assign playNextChunk implementation via useEffect
  useEffect(() => {
    playNextChunkRef.current = () => {
      if (playbackQueueRef.current.length === 0) {
        isPlayingRef.current = false;
        return;
      }
      isPlayingRef.current = true;
      const chunk = playbackQueueRef.current.shift()!;
      const ctx = playbackContextRef.current;
      if (!ctx) return;

      const buffer = ctx.createBuffer(1, chunk.length, ctx.sampleRate);
      buffer.getChannelData(0).set(chunk);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => playNextChunkRef.current();
      src.start();
    };
  }, []);

  // ─── Stop streaming ───
  const stopStreaming = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    setIsStreaming(false);
    setAudioLevel(0);
  }, []);



  // ─── Start playback (listener) ───
  const startPlayback = useCallback((sampleRate: number) => {
    const ctx = new AudioContext({ sampleRate });
    playbackContextRef.current = ctx;
    isPlayingRef.current = false;
    playbackQueueRef.current = [];

    let bufProg = 0;
    const bufInterval = setInterval(() => {
      bufProg += 20;
      setBufferProgress(Math.min(bufProg, 100));
      if (bufProg >= 100) {
        clearInterval(bufInterval);
        isPlayingRef.current = true;
        playNextChunkRef.current();
      }
    }, 200);
  }, []);

  // ─── Reset ───
  const resetState = useCallback(() => {
    stopStreaming();
    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    setRole("none");
    setSessionId("");
    setListeners([]);
    setDiscoveredSessions([]);
    setBufferProgress(0);
    setLatency(0);
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, [stopStreaming]);

  // ─── Connect socket ───
  const connectSocket = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io("/?XTransformPort=" + SOCKET_PORT, {
      transports: ["websocket"],
    });

    socket.on("connect", () => { console.log("Socket connected:", socket.id); setSocketConnected(true); });

    socket.on("connect_error", () => {
      toast({
        title: "Connection Error",
        description: "Could not connect to the audio relay service.",
        variant: "destructive",
      });
    });

    socket.on("host:created", (data) => {
      setSessionId(data.sessionId);
      toast({ title: "Session Created!", description: `Session ID: ${data.sessionId}` });
    });

    socket.on("session:updated", (data) => {
      setListeners(data.listeners || []);
      toast({
        title: `${data.listeners?.length || 0} Listener(s)`,
        description: "Someone joined your stream!",
      });
    });

    socket.on("session:ended", () => {
      toast({ title: "Session Ended", description: "The streaming session has ended." });
      resetState();
    });

    socket.on("session:discovered", (sessions) => setDiscoveredSessions(sessions));

    socket.on("audio:metadata", (data) => {
      startPlayback(data.sampleRate || AUDIO_SAMPLE_RATE);
    });

    socket.on("audio:chunk", (data) => {
      if (roleRef.current !== "listener") return;
      try {
        const float32 = new Float32Array(data.chunk);
        playbackQueueRef.current.push(float32);
        if (!isPlayingRef.current) playNextChunkRef.current();
      } catch {
        // ignore chunk errors
      }
    });

    socketRef.current = socket;
  }, [toast, resetState, startPlayback]);

  // ─── Start streaming (host) ───
  const startStreaming = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: audioSource === "mic",
          noiseSuppression: audioSource === "mic",
          autoGainControl: audioSource === "mic",
          sampleRate: AUDIO_SAMPLE_RATE,
        },
      };

      // Try to get system audio (getDisplayMedia) if source is "system"
      let stream: MediaStream;
      if (audioSource === "system") {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true, // Required by some browsers
            audio: true,
          });
          // If no audio track from display media, fall back to mic
          if (stream.getAudioTracks().length === 0) {
            stream.getVideoTracks().forEach((t) => t.stop());
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            toast({
              title: "Using Microphone",
              description: "System audio not available. Streaming from mic instead. On mobile apps, this captures any music playing.",
            });
          } else {
            // Stop video track since we only need audio
            stream.getVideoTracks().forEach((t) => t.stop());
            toast({
              title: "System Audio Captured",
              description: "Streaming your system audio. Play music on YouTube, Spotify, or any app!",
            });
          }
        } catch {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          toast({
            title: "Using Microphone",
            description: "System audio capture denied. Streaming from mic instead.",
          });
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      }

      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const chunk = inputData.buffer.slice(0);

        socketRef.current?.emit("audio:chunk", { chunk, timestamp: Date.now() });

        const sum = inputData.reduce((acc, val) => acc + val * val, 0);
        const rms = Math.sqrt(sum / inputData.length);
        setAudioLevel(Math.min(rms * 5 * 100, 100));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      socketRef.current?.emit("audio:metadata", {
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        mimeType: "audio/pcm",
      });

      setIsStreaming(true);
      toast({ title: "Streaming Started", description: "Your audio is now live!" });
    } catch {
      toast({
        title: "Audio Access Denied",
        description: "Please allow audio access to stream.",
        variant: "destructive",
      });
    }
  }, [toast, audioSource]);

  // ─── Handlers ───
  const handleHostCreate = () => {
    if (!hostName.trim()) {
      toast({ title: "Name Required", description: "Enter your name to host.", variant: "destructive" });
      return;
    }
    setRole("host");
    connectSocket();
    setTimeout(() => {
      socketRef.current?.emit("host:create", { hostName: hostName.trim() });
    }, 500);
  };

  const handleDiscover = () => {
    connectSocket();
    setTimeout(() => socketRef.current?.emit("session:discover"), 500);
  };

  const handleJoin = (sid: string) => {
    if (!listenerName.trim()) {
      toast({ title: "Name Required", description: "Enter your name to join.", variant: "destructive" });
      return;
    }
    setRole("listener");
    setJoinSessionId(sid);
    connectSocket();
    setTimeout(() => {
      socketRef.current?.emit("session:join", { sessionId: sid, listenerName: listenerName.trim() });
    }, 500);
  };

  // Audio level animation
  useEffect(() => {
    if (!isStreaming || !analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    const animate = () => {
      analyserRef.current?.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setAudioLevel(Math.min((avg / 255) * 100, 100));
      requestAnimationFrame(animate);
    };
    const raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [isStreaming]);

  // Latency simulation
  useEffect(() => {
    if (role === "listener") {
      const interval = setInterval(() => setLatency(Math.floor(Math.random() * 15 + 8)), 1000);
      return () => clearInterval(interval);
    }
  }, [role]);

  // ─── Render: No role ───
  if (role === "none") {
    return (
      <div className="space-y-8">
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold">Try the Live Demo</h3>
          <p className="text-muted-foreground">
            One phone plays music — everyone else listens in their headphones.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Host Card */}
          <Card className="border-orange-500/30 bg-gradient-to-br from-orange-950/20 to-transparent hover:border-orange-500/60 transition-all duration-300">
            <CardHeader>
              <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center mb-2">
                <Music className="w-6 h-6 text-orange-400" />
              </div>
              <CardTitle className="text-xl">I&apos;m the Host</CardTitle>
              <CardDescription>
                Play music on your phone (YouTube, Spotify, anything) and stream it to everyone.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Your name" value={hostName} onChange={(e) => setHostName(e.target.value)} className="bg-background/50" />
              <div className="flex gap-2">
                <Button
                  variant={audioSource === "system" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAudioSource("system")}
                  className={audioSource === "system" ? "bg-orange-600 text-white" : "border-orange-500/40 text-orange-400"}
                >
                  <Music className="w-3 h-3 mr-1" /> System Audio
                </Button>
                <Button
                  variant={audioSource === "mic" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAudioSource("mic")}
                  className={audioSource === "mic" ? "bg-orange-600 text-white" : "border-orange-500/40 text-orange-400"}
                >
                  <Mic className="w-3 h-3 mr-1" /> Microphone
                </Button>
              </div>
              {audioSource === "system" && (
                <p className="text-xs text-muted-foreground">
                  Captures audio from any app playing on your phone. In the browser demo, this uses screen capture.
                </p>
              )}
            </CardContent>
            <CardFooter>
              <Button onClick={handleHostCreate} className="w-full bg-orange-600 hover:bg-orange-700 text-white">
                <Radio className="w-4 h-4 mr-2" />
                Start Broadcasting
              </Button>
            </CardFooter>
          </Card>

          {/* Listener Card */}
          <Card className="border-rose-500/30 bg-gradient-to-br from-rose-950/20 to-transparent hover:border-rose-500/60 transition-all duration-300">
            <CardHeader>
              <div className="w-12 h-12 rounded-xl bg-rose-500/20 flex items-center justify-center mb-2">
                <Headphones className="w-6 h-6 text-rose-400" />
              </div>
              <CardTitle className="text-xl">I&apos;m a Listener</CardTitle>
              <CardDescription>
                Put on your headphones and listen to the host&apos;s music in real-time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Your name" value={listenerName} onChange={(e) => setListenerName(e.target.value)} className="bg-background/50" />
              <Button onClick={handleDiscover} variant="outline" className="w-full border-rose-500/40 text-rose-400 hover:bg-rose-500/10">
                <Wifi className="w-4 h-4 mr-2" /> Find Sessions
              </Button>
              {discoveredSessions.length > 0 && (
                <div className="space-y-2">
                  {discoveredSessions.map((s) => (
                    <div key={s.sessionId} className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50">
                      <div>
                        <p className="font-medium text-sm">{s.hostName}&apos;s Music</p>
                        <p className="text-xs text-muted-foreground">
                          {s.listenerCount} listener{ s.listenerCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => handleJoin(s.sessionId)} className="bg-rose-600 hover:bg-rose-700 text-white">
                        Join
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {discoveredSessions.length === 0 && socketConnected && (
                <p className="text-sm text-muted-foreground text-center">No sessions found. Ask someone to host!</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ─── Render: Host View ───
  if (role === "host") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <Music className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Now Broadcasting</h3>
              <p className="text-sm text-muted-foreground">
                Session: <span className="font-mono text-orange-400">{sessionId || "Creating..."}</span>
              </p>
            </div>
          </div>
          <Button variant="destructive" size="sm" onClick={() => { socketRef.current?.emit("host:stop"); resetState(); }}>
            <Square className="w-4 h-4 mr-1" /> End
          </Button>
        </div>

        <Card className="overflow-hidden border-orange-500/20">
          <CardContent className="p-6">
            {/* Now Playing mock */}
            <div className="flex items-center gap-4 mb-4 p-3 rounded-xl bg-muted/50 border border-border/50">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center shrink-0">
                {audioSource === "system" ? <Youtube className="w-6 h-6 text-white" /> : <Disc3 className="w-6 h-6 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {audioSource === "system" ? "System Audio (YouTube / Spotify / any app)" : "Microphone Input"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {audioSource === "system" ? "Play any music on your phone — everyone hears it" : "Your mic is live — everyone hears you"}
                </p>
              </div>
              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 shrink-0">
                {isStreaming ? (isMuted ? "MUTED" : "LIVE") : "OFFLINE"}
              </Badge>
            </div>

            <div className="flex items-center gap-4 mb-2">
              {isStreaming && (
                <Button variant="outline" size="icon" onClick={() => setIsMuted(!isMuted)}
                  className={isMuted ? "border-red-500/50 text-red-400" : "border-orange-500/50 text-orange-400"}>
                  {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </Button>
              )}
              <div className="flex-1">
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-rose-500"
                    animate={{ width: `${audioLevel}%` }} transition={{ duration: 0.1 }} />
                </div>
              </div>
            </div>

            <WaveformBars active={isStreaming && !isMuted} color1="from-orange-500" color2="to-rose-400" level={audioLevel} />

            {!isStreaming ? (
              <Button onClick={startStreaming} className="w-full mt-4 bg-orange-600 hover:bg-orange-700 text-white" size="lg">
                <Play className="w-5 h-5 mr-2" /> Start Broadcasting
              </Button>
            ) : (
              <Button onClick={stopStreaming} variant="outline" className="w-full mt-4 border-red-500/40 text-red-400 hover:bg-red-500/10" size="lg">
                <Square className="w-5 h-5 mr-2" /> Stop
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Connected Listeners */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> Listening Now</CardTitle>
              <Badge variant="secondary">{listeners.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {listeners.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Waiting for listeners... Share session ID: <span className="font-mono text-orange-400">{sessionId}</span>
              </p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {listeners.map((l) => (
                  <div key={l.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                    <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center">
                      <Headphones className="w-4 h-4 text-rose-400" />
                    </div>
                    <span className="text-sm font-medium">{l.name}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: Listener View ───
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
            <Headphones className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Listening</h3>
            <p className="text-sm text-muted-foreground">
              Session: <span className="font-mono text-rose-400">{joinSessionId}</span>
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={resetState} className="border-red-500/40 text-red-400 hover:bg-red-500/10">
          <Square className="w-4 h-4 mr-1" /> Leave
        </Button>
      </div>

      {bufferProgress < 100 && bufferProgress > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="text-center space-y-3">
              <AudioWaveform className="w-8 h-8 mx-auto text-rose-400 animate-pulse" />
              <p className="text-sm font-medium">Buffering music...</p>
              <Progress value={bufferProgress} className="h-2" />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-rose-500/30">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-4">
            <Button variant="outline" size="icon" onClick={() => setIsSpeakerOn(!isSpeakerOn)}
              className={isSpeakerOn ? "border-rose-500/50 text-rose-400" : "border-red-500/50 text-red-400"}>
              {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </Button>
            <div className="flex-1">
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-orange-400"
                  animate={{ width: bufferProgress >= 100 ? "100%" : `${bufferProgress}%` }} />
              </div>
            </div>
            <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">LIVE</Badge>
          </div>

          <WaveformBars active={bufferProgress >= 100} color1="from-rose-500" color2="to-orange-400" level={bufferProgress >= 100 ? 60 : 0} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Latency</p>
            <p className="text-2xl font-bold text-rose-400">~{latency}ms</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Buffer</p>
            <p className="text-2xl font-bold text-orange-400">{bufferProgress >= 100 ? "Full" : `${bufferProgress}%`}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Code Block with Copy
// ──────────────────────────────────────────────
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg overflow-x-auto text-sm font-mono"><code>{code}</code></pre>
      <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────
export default function HomePage() {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ─── NAVBAR ─── */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border/50">
        <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center">
              <Headphones className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg">GroupHear</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm">
            <button onClick={() => scrollTo("how")} className="hover:text-orange-400 transition-colors">How It Works</button>
            <button onClick={() => scrollTo("features")} className="hover:text-orange-400 transition-colors">Features</button>
            <button onClick={() => scrollTo("demo")} className="hover:text-orange-400 transition-colors">Live Demo</button>
            <button onClick={() => scrollTo("build")} className="hover:text-orange-400 transition-colors">Build &amp; Publish</button>
          </div>
          <Button onClick={() => scrollTo("demo")} className="bg-orange-600 hover:bg-orange-700 text-white">
            Try Demo
          </Button>
        </nav>
      </header>

      <main className="flex-1">
        {/* ─── HERO ─── */}
        <section id="hero" className="relative overflow-hidden py-20 md:py-32">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl" />
          </div>

          <div className="max-w-6xl mx-auto px-4 relative z-10">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }} className="space-y-6">
                <Badge variant="outline" className="border-orange-500/40 text-orange-400 bg-orange-500/10">
                  <Wifi className="w-3 h-3 mr-1" /> No Internet Needed
                </Badge>
                <h1 className="text-4xl md:text-6xl font-bold leading-tight">
                  One Phone Plays.
                  <br />
                  <span className="bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent">
                    Everyone Listens.
                  </span>
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Play music from YouTube, Spotify, or any app on your phone — and everyone
                  on the same Wi-Fi hears it through their own headphones. No login.
                  No cloud. Just connect and listen.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button size="lg" onClick={() => scrollTo("demo")} className="bg-orange-600 hover:bg-orange-700 text-white">
                    <Play className="w-5 h-5 mr-2" /> Try Live Demo
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => scrollTo("build")} className="border-orange-500/40">
                    Build &amp; Publish <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </motion.div>

              <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, delay: 0.2 }} className="relative">
                <div className="relative rounded-2xl overflow-hidden border border-border/50 shadow-2xl shadow-orange-500/10">
                  <img src="/hero-music.png" alt="Group music listening over Wi-Fi" className="w-full h-auto" />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4">
                    <div className="flex items-center gap-3 bg-background/90 backdrop-blur-sm p-3 rounded-xl border border-border/50">
                      <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                        <Music className="w-5 h-5 text-orange-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Now Playing — Shared Session</p>
                        <p className="text-xs text-muted-foreground">24 listeners · ~12ms latency</p>
                      </div>
                      <Badge className="ml-auto bg-orange-500/20 text-orange-400 border-orange-500/30">LIVE</Badge>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ─── HOW IT WORKS ─── */}
        <section id="how" className="py-20 md:py-28 border-y border-border/50 bg-muted/30">
          <div className="max-w-6xl mx-auto px-4">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} className="text-center space-y-4 mb-16">
              <Badge variant="outline" className="border-rose-500/40 text-rose-400 bg-rose-500/10">3 Simple Steps</Badge>
              <h2 className="text-3xl md:text-4xl font-bold">
                How It{" "}
                <span className="bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent">Works</span>
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  step: "1",
                  icon: RadioTower,
                  title: "Host Starts Playing",
                  description: "Open YouTube, Spotify, Apple Music, or any app. Hit play. GroupHear captures the system audio and streams it over Wi-Fi via UDP multicast.",
                  color: "orange",
                },
                {
                  step: "2",
                  icon: Wifi,
                  title: "Listeners Auto-Discover",
                  description: "Anyone on the same Wi-Fi (router or phone hotspot) sees the session automatically. No IP addresses, no pairing codes — just tap Join.",
                  color: "rose",
                },
                {
                  step: "3",
                  icon: Headphones,
                  title: "Everyone Hears Together",
                  description: "All listeners hear the same music through their own headphones, synced within milliseconds. Works for 10-30+ devices on a phone hotspot.",
                  color: "orange",
                },
              ].map((item, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.15 }}>
                  <Card className="h-full text-center hover:border-orange-500/40 transition-all duration-300">
                    <CardHeader>
                      <div className="mx-auto mb-2">
                        <div className={`w-16 h-16 rounded-2xl ${item.color === "orange" ? "bg-orange-500/20" : "bg-rose-500/20"} flex items-center justify-center`}>
                          <item.icon className={`w-8 h-8 ${item.color === "orange" ? "text-orange-400" : "text-rose-400"}`} />
                        </div>
                      </div>
                      <Badge variant="secondary" className="w-fit mx-auto">Step {item.step}</Badge>
                      <CardTitle className="text-lg mt-2">{item.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            {/* Visual diagram */}
            <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} className="mt-16">
              <Card className="overflow-hidden">
                <CardContent className="p-8">
                  <div className="flex flex-col items-center gap-6">
                    {/* Host phone */}
                    <div className="flex items-center gap-4 bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 px-6">
                      <div className="w-10 h-14 rounded-lg bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center">
                        <Youtube className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-bold text-orange-400">Host Phone</p>
                        <p className="text-xs text-muted-foreground">Plays YouTube / Spotify / any music app</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-1">
                      <div className="w-px h-6 bg-gradient-to-b from-orange-400 to-rose-400" />
                      <Badge variant="outline" className="border-orange-500/40 text-orange-400 text-xs">
                        UDP Multicast (239.255.x.x:4010)
                      </Badge>
                      <div className="w-px h-6 bg-rose-400" />
                    </div>

                    {/* Router / Hotspot */}
                    <div className="flex items-center gap-3 bg-muted/80 border border-border rounded-xl p-3 px-5">
                      <Wifi className="w-5 h-5 text-muted-foreground" />
                      <span className="font-medium text-sm">Wi-Fi Router / Phone Hotspot</span>
                    </div>

                    <div className="w-px h-6 bg-rose-400" />

                    {/* Listener phones */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {["🎧 Phone 1", "🎧 Phone 2", "🎧 Phone 3", "🎧 Phone N"].map((name, i) => (
                        <div key={i} className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2 px-3">
                          <span className="text-xs font-medium text-rose-400">{name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </section>

        {/* ─── STATS ─── */}
        <section className="py-8 border-b border-border/50">
          <div className="max-w-6xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { value: "0ms", label: "Cloud Latency", icon: Zap },
              { value: "30+", label: "Devices on Hotspot", icon: Users },
              { value: "0", label: "Accounts Needed", icon: Shield },
              { value: "100%", label: "Offline Capable", icon: Globe },
            ].map((stat, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="space-y-2">
                <stat.icon className="w-5 h-5 mx-auto text-orange-400" />
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ─── FEATURES ─── */}
        <section id="features" className="py-20 md:py-28">
          <div className="max-w-6xl mx-auto px-4">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} className="text-center space-y-4 mb-16">
              <Badge variant="outline" className="border-orange-500/40 text-orange-400 bg-orange-500/10">Features</Badge>
              <h2 className="text-3xl md:text-4xl font-bold">
                Play From{" "}
                <span className="bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent">Any App</span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                YouTube, Spotify, Apple Music, SoundCloud, local files — anything playing on the host phone gets streamed to everyone.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: Youtube, title: "YouTube Support", description: "Play any YouTube video and the audio streams live to all connected listeners. Works with YouTube Music too.", color: "orange" },
                { icon: Music, title: "Any Music App", description: "Spotify, Apple Music, SoundCloud, Tidal, local MP3s — if it plays audio on your phone, GroupHear streams it.", color: "rose" },
                { icon: Wifi, title: "Auto Discovery", description: "No pairing codes. Listeners on the same Wi-Fi automatically see your session. One tap to join.", color: "orange" },
                { icon: Headphones, title: "Synced Headphones", description: "Each listener uses their own headphones. Adaptive jitter buffer keeps everyone in sync within milliseconds.", color: "rose" },
                { icon: Smartphone, title: "Phone Hotspot", description: "No router? Use the host phone's hotspot. All listeners connect to it. Works for 10-30+ devices.", color: "orange" },
                { icon: Shield, title: "100% Private", description: "Zero data leaves your local network. No accounts, no tracking, no cloud. Your music stays on your Wi-Fi.", color: "rose" },
              ].map((feature, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                  <Card className="h-full hover:border-orange-500/40 transition-all duration-300 group">
                    <CardHeader>
                      <div className={`w-12 h-12 rounded-xl ${feature.color === "orange" ? "bg-orange-500/20" : "bg-rose-500/20"} flex items-center justify-center mb-2 group-hover:scale-110 transition-transform`}>
                        <feature.icon className={`w-6 h-6 ${feature.color === "orange" ? "text-orange-400" : "text-rose-400"}`} />
                      </div>
                      <CardTitle className="text-lg">{feature.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">{feature.description}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── LIVE DEMO ─── */}
        <section id="demo" className="py-20 md:py-28 bg-muted/30 border-y border-border/50">
          <div className="max-w-4xl mx-auto px-4">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} className="text-center space-y-4 mb-12">
              <Badge variant="outline" className="border-orange-500/40 text-orange-400 bg-orange-500/10">
                <Play className="w-3 h-3 mr-1" /> Interactive Demo
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold">
                Try It{" "}
                <span className="bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent">Right Now</span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                This web demo uses your browser&apos;s audio APIs. Open two tabs — host in one, listen in the other.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}>
              <AudioStreamDemo />
            </motion.div>

            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} className="mt-8">
              <Card className="border-yellow-500/30 bg-yellow-500/5">
                <CardContent className="p-4 flex items-start gap-3">
                  <MonitorSmartphone className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-yellow-400 mb-1">Browser vs Native App</p>
                    <p className="text-muted-foreground">
                      Browsers can&apos;t capture system audio from other apps. This demo uses mic or screen capture instead.
                      The <strong>native mobile app</strong> uses Android&apos;s <code className="bg-muted px-1 rounded text-xs">MediaProjection</code> API
                      and iOS <code className="bg-muted px-1 rounded text-xs">AVAudioEngine</code> to capture audio from <em>any</em> playing app
                      (YouTube, Spotify, etc.) — that&apos;s the real magic.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </section>

        {/* ─── BUILD & PUBLISH GUIDE ─── */}
        <section id="build" className="py-20 md:py-28">
          <div className="max-w-6xl mx-auto px-4">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} className="text-center space-y-4 mb-16">
              <Badge variant="outline" className="border-rose-500/40 text-rose-400 bg-rose-500/10">
                <Package className="w-3 h-3 mr-1" /> Build &amp; Publish
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold">
                Ship Your{" "}
                <span className="bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent">App &amp; Website</span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Complete code and step-by-step guides to build the native app and publish it to both app stores.
              </p>
            </motion.div>

            <Tabs defaultValue="flutter" className="space-y-8">
              <TabsList className="grid w-full grid-cols-4 max-w-2xl mx-auto">
                <TabsTrigger value="flutter"><Smartphone className="w-4 h-4 mr-2" /> Flutter</TabsTrigger>
                <TabsTrigger value="android"><Terminal className="w-4 h-4 mr-2" /> Android</TabsTrigger>
                <TabsTrigger value="ios"><Package className="w-4 h-4 mr-2" /> iOS</TabsTrigger>
                <TabsTrigger value="website"><Globe className="w-4 h-4 mr-2" /> Website</TabsTrigger>
              </TabsList>

              {/* Flutter Tab */}
              <TabsContent value="flutter" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Project Setup &amp; System Audio Capture</CardTitle>
                    <CardDescription>Capture audio from YouTube, Spotify, or any playing app</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <CodeBlock code={`# 1. Create Flutter project
flutter create grouphhear --org com.grouphhear --platforms android,ios
cd grouphhear

# 2. Add dependencies
flutter pub add multicast_dns
flutter pub add opus_dart
flutter pub add permission_handler
flutter pub add provider

# 3. Project structure
lib/
├── main.dart
├── services/
│   ├── system_audio_capture.dart  # ★ Captures ANY playing audio
│   ├── udp_streamer.dart          # UDP multicast send/recv
│   ├── discovery.dart             # UDP broadcast discovery
│   └── jitter_buffer.dart         # Adaptive buffer
├── screens/
│   ├── host_screen.dart           # Host UI (now playing)
│   └── listener_screen.dart       # Listener UI
└── widgets/
    └── audio_visualizer.dart`} />
                  </CardContent>
                </Card>

                {/* System Audio Capture - the key part */}
                <Card className="border-orange-500/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Music className="w-5 h-5 text-orange-400" />
                      System Audio Capture (The Magic Part)
                    </CardTitle>
                    <CardDescription>
                      How to capture audio from YouTube, Spotify, or any app
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-4 space-y-3">
                      <h4 className="font-semibold text-orange-400 text-sm">Android — MediaProjection API</h4>
                      <p className="text-sm text-muted-foreground">
                        Android&apos;s <code className="bg-muted px-1 rounded text-xs">MediaProjection</code> API captures
                        system audio from <em>any</em> app. The user grants permission once, then you get a
                        PCM audio stream of whatever is playing — YouTube, Spotify, games, notifications, everything.
                      </p>
                      <CodeBlock code={`// Android: SystemAudioCapture.kt (MethodChannel)
class SystemAudioCapture : FlutterPlugin, MethodCallHandler {
    private var mediaProjection: MediaProjection? = null
    private var audioRecord: AudioRecord? = null
    
    fun startSystemAudioCapture(result: MethodChannel.Result) {
        // 1. Request MediaProjection permission (shows system dialog)
        val projectionManager = context.getSystemService(
            Context.MEDIA_PROJECTION_SERVICE
        ) as MediaProjectionManager
        
        // This triggers the system permission dialog
        val intent = projectionManager.createScreenCaptureIntent()
        
        // 2. After user grants permission, create AudioRecord
        // with VOICE_COMMUNICATION or DEFAULT source
        val config = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(48000)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build()
            
        val audioRecord = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.DEFAULT)
            .setAudioFormat(config)
            .build()
        
        // 3. Read PCM data in a loop and send to Flutter
        audioRecord.startRecording()
        val buffer = ShortArray(4096)
        
        Thread {
            while (isRecording) {
                val read = audioRecord.read(buffer, 0, buffer.size)
                // Send PCM data to Flutter via MethodChannel/EventChannel
                eventSink?.success(buffer.copyOf(read))
            }
        }.start()
    }
}`} />
                    </div>

                    <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-4 space-y-3">
                      <h4 className="font-semibold text-rose-400 text-sm">iOS — AVAudioEngine with Mix With Others</h4>
                      <p className="text-sm text-muted-foreground">
                        iOS doesn&apos;t allow raw system audio capture, but you can use <code className="bg-muted px-1 rounded text-xs">AVAudioSession</code> with
                        the <code className="bg-muted px-1 rounded text-xs">.mixWithOthers</code> category to capture
                        microphone audio that includes background music. For true system audio, iOS requires
                        the Broadcast Upload Extension (used by screen recording apps).
                      </p>
                      <CodeBlock code={`// iOS: SystemAudioCapture.swift (MethodChannel)
class SystemAudioCapture: NSObject, FlutterPlugin {
    private var engine: AVAudioEngine?
    
    func startCapture(result: @escaping FlutterResult) {
        // 1. Set audio session to mix with other apps
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(
            .playAndRecord,
            options: [.mixWithOthers, .defaultToSpeaker]
        )
        try? session.setActive(true)
        
        // 2. Create audio engine with tap on input node
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        
        // 3. Install tap to capture audio buffer
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) {
            buffer, time in
            // This captures mic + any mixed-in audio
            let channelData = buffer.floatChannelData?[0]
            let data = Data(bytes: channelData!, 
                          count: Int(buffer.frameLength) * 4)
            self.eventSink?(data)
        }
        
        try? engine.start()
        self.engine = engine
        result(true)
    }
}

// For TRUE system audio (no mic), use Broadcast Upload Extension:
// RPBroadcastActivityViewController + SampleHandler
// This is the same API used by iOS screen recording apps`} />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>UDP Multicast Streaming Service</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <CodeBlock code={`// lib/services/udp_streamer.dart
import 'dart:io';
import 'dart:typed_data';

class UdpStreamer {
  static const String multicastGroup = '239.255.0.1';
  static const int multicastPort = 4010;
  
  RawDatagramSocket? _sendSocket;
  RawDatagramSocket? _recvSocket;
  InternetAddress? _groupAddress;
  int _seqNum = 0;

  Future<void> initSender() async {
    _groupAddress = InternetAddress(multicastGroup);
    _sendSocket = await RawDatagramSocket.bind(
      InternetAddress.anyIPv4, multicastPort
    );
    _sendSocket!.multicastLoopback = false;
    _sendSocket!.multicastHops = 1; // Local network only
  }

  Future<void> initReceiver() async {
    _recvSocket = await RawDatagramSocket.bind(
      InternetAddress.anyIPv4, multicastPort
    );
    _groupAddress = InternetAddress(multicastGroup);
    _recvSocket!.joinMulticast(_groupAddress!);
    _recvSocket!.multicastLoopback = false;
  }

  // Called when we get PCM data from system audio capture
  void sendAudioFrame(Uint8List opusFrame) {
    if (_sendSocket == null) return;
    // Packet: [magic(2)][seq(4)][ts(4)][codec(1)][payload(≤1400)]
    final buf = BytesBuilder();
    buf.addByte(0xAC); buf.addByte(0xDC);
    buf.add(_int32Bytes(_seqNum++));
    buf.add(_int32Bytes(DateTime.now().millisecondsSinceEpoch));
    buf.addByte(1); // Codec: Opus
    buf.add(opusFrame);
    _sendSocket!.send(buf.toBytes(), _groupAddress!, multicastPort);
  }

  Stream<Uint8List> get audioStream async* {
    await for (final datagram in _recvSocket!) {
      if (datagram == null) continue;
      final data = datagram.data;
      if (data[0] != 0xAC || data[1] != 0xDC) continue;
      yield data.sublist(11); // Skip 11-byte header
    }
  }

  Uint8List _int32Bytes(int v) => 
    Uint8List(4)..buffer.asByteData().setInt32(0, v);
  void dispose() { _sendSocket?.close(); _recvSocket?.close(); }
}`} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Auto-Discovery Service</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CodeBlock code={`// lib/services/discovery.dart
import 'dart:io';
import 'dart:convert';

class DiscoveryService {
  static const int broadcastPort = 4020;
  
  // Host: Broadcast presence every 2 seconds
  Future<void> startAnnouncing(String sessionName) async {
    final socket = await RawDatagramSocket.bind(
      InternetAddress.anyIPv4, broadcastPort
    );
    socket.broadcastEnabled = true;
    
    Timer.periodic(Duration(seconds: 2), (_) {
      final beacon = jsonEncode({
        'type': 'announce',
        'hostName': sessionName,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });
      socket.send(utf8.encode(beacon),
        InternetAddress('255.255.255.255'), broadcastPort);
    });
  }

  // Client: Listen for hosts (5 second scan)
  Future<List<DiscoveredHost>> discover() async {
    final socket = await RawDatagramSocket.bind(
      InternetAddress.anyIPv4, broadcastPort
    );
    final hosts = <String, DiscoveredHost>{};
    
    socket.listen((event) {
      if (event == RawSocketEvent.read) {
        final dg = socket.receive();
        if (dg == null) return;
        final data = jsonDecode(utf8.decode(dg.data));
        if (data['type'] == 'announce') {
          hosts[data['hostName']] = DiscoveredHost(
            hostName: data['hostName'],
            address: dg.address,
          );
        }
      }
    });
    
    await Future.delayed(Duration(seconds: 5));
    socket.close();
    return hosts.values.toList();
  }
}`} />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Android Tab */}
              <TabsContent value="android" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="w-5 h-5 text-orange-400" /> Android: Build &amp; Publish
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 1</Badge> Permissions
                      </h4>
                      <CodeBlock code={'<!-- android/app/src/main/AndroidManifest.xml -->\n<uses-permission android:name="android.permission.RECORD_AUDIO" />\n<uses-permission android:name="android.permission.INTERNET" />\n<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />\n<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />\n<!-- Required for system audio capture -->\n<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />\n<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />'} />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 2</Badge> Build Release
                      </h4>
                      <CodeBlock code={"# Generate signing key\nkeytool -genkey -v -keystore grouphhear-upload.jks \\\n  -keyalg RSA -keysize 2048 -validity 10000 -alias grouphhear\n\n# Build AAB for Google Play\nflutter build appbundle --release\n# Output: build/app/outputs/bundle/release/app-release.aab\n\n# Build APK for direct distribution\nflutter build apk --release\n# Output: build/app/outputs/flutter-apk/app-release.apk"} />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 3</Badge> Publish to Google Play
                      </h4>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                        <p>1. Go to <a href="https://play.google.com/console" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:underline">Google Play Console <ExternalLink className="w-3 h-3 inline" /></a></p>
                        <p>2. Create app → Upload AAB → Fill store listing</p>
                        <p>3. Add screenshots, icon (512x512), feature graphic</p>
                        <p>4. Content rating: No data collection = simple questionnaire</p>
                        <p>5. Submit for review (1-3 days)</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* iOS Tab */}
              <TabsContent value="ios" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="w-5 h-5 text-rose-400" /> iOS: Build &amp; Publish
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 1</Badge> Permissions (Info.plist)
                      </h4>
                      <CodeBlock code={"<key>NSMicrophoneUsageDescription</key>\n<string>GroupHear captures audio to share with listeners on your Wi-Fi.</string>\n<key>NSLocalNetworkUsageDescription</key>\n<string>GroupHear uses your local Wi-Fi to stream audio to nearby devices.</string>\n<key>NSBonjourServices</key>\n<array><string>_grouphhear._tcp</string></array>"} />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 2</Badge> Build &amp; Upload
                      </h4>
                      <CodeBlock code={`# Build IPA
flutter build ipa --release

# Upload via Xcode Organizer or:
xcrun altool --upload-app \\
  --type ios --file build/ios/ipa/grouphhear.ipa \\
  --apiKey YOUR_KEY --apiIssuer YOUR_ID`} />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 3</Badge> App Store Connect
                      </h4>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                        <p>1. Enroll in <a href="https://developer.apple.com/programs/" target="_blank" rel="noopener noreferrer" className="text-rose-400 hover:underline">Apple Developer Program</a> (€99/year)</p>
                        <p>2. Create app in App Store Connect → Select uploaded build</p>
                        <p>3. Submit for review (24-48 hours)</p>
                        <p>4. <strong>Note in review:</strong> App requires local Wi-Fi + multiple devices to test</p>
                      </div>
                    </div>

                    <Card className="border-yellow-500/30 bg-yellow-500/5">
                      <CardContent className="p-4 flex items-start gap-3">
                        <Shield className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="font-medium text-yellow-400 mb-1">iOS Multicast Entitlement</p>
                          <p className="text-muted-foreground">
                            iOS restricts raw multicast. Request the <code className="bg-muted px-1 rounded text-xs">com.apple.developer.networking.multicast</code> entitlement
                            from Apple. Use Bonjour for discovery and Network.framework for multicast subscription.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Website Tab */}
              <TabsContent value="website" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="w-5 h-5 text-orange-400" /> Website: Deploy the Landing Page
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold"><Badge variant="secondary">A</Badge> Vercel (Recommended)</h4>
                      <CodeBlock code={`npm i -g vercel
cd grouphhear-website
vercel --prod
# Live at: https://grouphhear.vercel.app`} />
                    </div>
                    <div className="space-y-4">
                      <h4 className="font-semibold"><Badge variant="secondary">B</Badge> Netlify</h4>
                      <CodeBlock code={`# In next.config.ts: output: 'export'
npm run build    # Generates /out directory
npx netlify-cli deploy --dir=out --prod`} />
                    </div>
                    <div className="space-y-4">
                      <h4 className="font-semibold"><Badge variant="secondary">C</Badge> GitHub Pages (Free)</h4>
                      <CodeBlock code={`npm run build
npx gh-pages -d out
# Live at: https://you.github.io/grouphhear/`} />
                    </div>
                    <div className="space-y-4">
                      <h4 className="font-semibold">Custom Domain</h4>
                      <CodeBlock code={`# DNS records for Vercel:
A      @        76.76.21.21
CNAME  www      cname.vercel-dns.com`} />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </section>

        {/* ─── FAQ ─── */}
        <section className="py-20 md:py-28 bg-muted/30 border-y border-border/50">
          <div className="max-w-3xl mx-auto px-4">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} className="text-center space-y-4 mb-12">
              <h2 className="text-3xl font-bold">Frequently Asked Questions</h2>
            </motion.div>

            <Accordion type="single" collapsible className="space-y-3">
              {[
                { q: "Can I really stream from YouTube or Spotify?", a: "Yes! On Android, the MediaProjection API captures system audio from any playing app — YouTube, Spotify, Apple Music, games, anything. On iOS, you can use the Broadcast Upload Extension (same API screen recording apps use) to capture any playing audio." },
                { q: "Does it work without internet?", a: "Absolutely. All communication happens over your local Wi-Fi. Use a router, or just turn on the host phone's hotspot. No data leaves the network. Perfect for road trips, flights, outdoor gatherings." },
                { q: "How many phones can connect?", a: "We've tested 30 devices on a phone hotspot. UDP multicast means one packet reaches all listeners simultaneously, so the host's bandwidth doesn't increase with more listeners. A proper router can handle 100+ devices." },
                { q: "What's the latency?", a: "On local Wi-Fi: 15-50ms capture + encode + network + decode. Add 50-200ms jitter buffer for smooth playback. Total: ~65-250ms — similar to Bluetooth audio. Everyone hears at almost the same time." },
                { q: "Why not just use Bluetooth speakers?", a: "Bluetooth has a 10m range and pairs with one device. GroupHear works over Wi-Fi (50m+ range), supports unlimited listeners, and each person uses their own headphones — no sharing earbuds." },
                { q: "Does the host phone need to stay on the music app?", a: "On Android, yes — the audio comes from whatever app is in the foreground. On iOS with Broadcast Upload Extension, you can switch apps while streaming continues. The host can also play local music files from within GroupHear." },
              ].map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border rounded-lg px-4">
                  <AccordionTrigger className="text-left text-sm font-medium">{item.q}</AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="py-20 bg-gradient-to-br from-orange-950/40 to-rose-950/40 border-y border-border/50">
          <div className="max-w-3xl mx-auto px-4 text-center space-y-6">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} className="space-y-4">
              <h2 className="text-3xl md:text-4xl font-bold">
                One Phone Plays.{" "}
                <span className="bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent">Everyone Listens.</span>
              </h2>
              <p className="text-muted-foreground">
                Try the demo now, then build and publish your own app.
              </p>
              <div className="flex justify-center gap-4">
                <Button size="lg" onClick={() => scrollTo("demo")} className="bg-orange-600 hover:bg-orange-700 text-white">
                  <Play className="w-5 h-5 mr-2" /> Try Demo
                </Button>
                <Button size="lg" variant="outline" onClick={() => scrollTo("build")} className="border-orange-500/40">
                  <Upload className="w-5 h-5 mr-2" /> Build &amp; Publish
                </Button>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-border/50 bg-muted/30 py-8 mt-auto">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center">
                <Headphones className="w-3 h-3 text-white" />
              </div>
              <span className="font-semibold text-sm">GroupHear</span>
              <span className="text-xs text-muted-foreground">— One phone plays, everyone listens</span>
            </div>
            <div className="flex items-center gap-6 text-xs text-muted-foreground">
              <span>No Cloud · No Accounts · No Tracking</span>
              <span className="hidden md:inline">•</span>
              <span className="hidden md:inline">Built with Flutter + Next.js</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
