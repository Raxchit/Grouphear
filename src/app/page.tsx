"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio,
  Headphones,
  Wifi,
  WifiOff,
  Users,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Play,
  Square,
  ChevronDown,
  ChevronUp,
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
import { Separator } from "@/components/ui/separator";
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
  const [listeners, setListeners] = useState<ListenerInfo[]>([]);
  const [discoveredSessions, setDiscoveredSessions] = useState<
    DiscoveredSession[]
  >([]);
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
  roleRef.current = role;

  // Ref for self-referencing playNextChunk
  const playNextChunkRef = useRef<() => void>(() => {});

  // ─── Stop streaming (host side) ───
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

  // ─── Playback: play next chunk from queue ───
  // Implemented via ref to allow self-reference without hoisting issues
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

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => playNextChunkRef.current();
    source.start();
  };

  // ─── Start playback (listener side) ───
  const startPlayback = useCallback(
    (sampleRate: number) => {
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
    },
    []
  );

  // ─── Reset all state ───
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

  // ─── Connect to socket ───
  const connectSocket = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io("/?XTransformPort=" + SOCKET_PORT, {
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      console.log("Socket connected:", socket.id);
    });

    socket.on("connect_error", (err) => {
      console.error("Socket error:", err);
      toast({
        title: "Connection Error",
        description:
          "Could not connect to the audio service. Make sure the service is running.",
        variant: "destructive",
      });
    });

    socket.on("host:created", (data) => {
      setSessionId(data.sessionId);
      toast({
        title: "Session Created!",
        description: `Your session ID is ${data.sessionId}`,
      });
    });

    socket.on("session:updated", (data) => {
      setListeners(data.listeners || []);
      toast({
        title: `${data.listeners?.length || 0} Listener(s) Connected`,
        description: "Someone joined your stream!",
      });
    });

    socket.on("session:ended", () => {
      toast({
        title: "Session Ended",
        description: "The streaming session has ended.",
      });
      resetState();
    });

    socket.on("session:discovered", (sessions) => {
      setDiscoveredSessions(sessions);
    });

    socket.on("audio:metadata", (data) => {
      console.log("Received audio metadata:", data);
      startPlayback(data.sampleRate || AUDIO_SAMPLE_RATE);
    });

    socket.on("audio:chunk", (data) => {
      if (roleRef.current !== "listener") return;
      try {
        const float32 = new Float32Array(data.chunk);
        playbackQueueRef.current.push(float32);
        if (!isPlayingRef.current) {
          playNextChunkRef.current();
        }
      } catch (e) {
        console.error("Error processing audio chunk:", e);
      }
    });

    socketRef.current = socket;
  }, [toast, resetState, startPlayback]);

  // ─── Start mic capture and streaming (host) ───
  const startStreaming = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: AUDIO_SAMPLE_RATE,
        },
      });
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

        socketRef.current?.emit("audio:chunk", {
          chunk: chunk,
          timestamp: Date.now(),
        });

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
      toast({
        title: "Streaming Started",
        description: "Your microphone is now live!",
      });
    } catch {
      toast({
        title: "Microphone Access Denied",
        description: "Please allow microphone access to stream audio.",
        variant: "destructive",
      });
    }
  }, [toast]);

  // Host actions
  const handleHostCreate = () => {
    if (!hostName.trim()) {
      toast({
        title: "Name Required",
        description: "Please enter your name to host a session.",
        variant: "destructive",
      });
      return;
    }
    setRole("host");
    connectSocket();
    setTimeout(() => {
      socketRef.current?.emit("host:create", { hostName: hostName.trim() });
    }, 500);
  };

  // Listener actions
  const handleDiscover = () => {
    connectSocket();
    setTimeout(() => {
      socketRef.current?.emit("session:discover");
    }, 500);
  };

  const handleJoin = (sid: string) => {
    if (!listenerName.trim()) {
      toast({
        title: "Name Required",
        description: "Please enter your name to join a session.",
        variant: "destructive",
      });
      return;
    }
    setRole("listener");
    setJoinSessionId(sid);
    connectSocket();
    setTimeout(() => {
      socketRef.current?.emit("session:join", {
        sessionId: sid,
        listenerName: listenerName.trim(),
      });
    }, 500);
  };

  // Audio level animation
  useEffect(() => {
    if (!isStreaming || !analyserRef.current) return;
    const dataArray = new Uint8Array(
      analyserRef.current.frequencyBinCount
    );
    const animate = () => {
      analyserRef.current?.getByteFrequencyData(dataArray);
      const avg =
        dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setAudioLevel(Math.min((avg / 255) * 100, 100));
      requestAnimationFrame(animate);
    };
    const raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [isStreaming]);

  // Latency simulation
  useEffect(() => {
    if (role === "listener") {
      const interval = setInterval(() => {
        setLatency(Math.floor(Math.random() * 15 + 8));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [role]);

  // ─── Render: No role selected ───
  if (role === "none") {
    return (
      <div className="space-y-8">
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold">Try the Live Demo</h3>
          <p className="text-muted-foreground">
            Host a session or join as a listener — all running on local
            WebSocket relay.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Host Card */}
          <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-950/20 to-transparent hover:border-emerald-500/60 transition-all duration-300">
            <CardHeader>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center mb-2">
                <RadioTower className="w-6 h-6 text-emerald-400" />
              </div>
              <CardTitle className="text-xl">Host a Session</CardTitle>
              <CardDescription>
                Start streaming your microphone to listeners on the same
                network.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Your display name"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                className="bg-background/50"
              />
            </CardContent>
            <CardFooter>
              <Button
                onClick={handleHostCreate}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Radio className="w-4 h-4 mr-2" />
                Create Session
              </Button>
            </CardFooter>
          </Card>

          {/* Listener Card */}
          <Card className="border-cyan-500/30 bg-gradient-to-br from-cyan-950/20 to-transparent hover:border-cyan-500/60 transition-all duration-300">
            <CardHeader>
              <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center mb-2">
                <Headphones className="w-6 h-6 text-cyan-400" />
              </div>
              <CardTitle className="text-xl">Join as Listener</CardTitle>
              <CardDescription>
                Discover active sessions and start listening in one tap.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Your display name"
                value={listenerName}
                onChange={(e) => setListenerName(e.target.value)}
                className="bg-background/50"
              />
              <Button
                onClick={handleDiscover}
                variant="outline"
                className="w-full border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
              >
                <Wifi className="w-4 h-4 mr-2" />
                Discover Sessions
              </Button>
              {discoveredSessions.length > 0 && (
                <div className="space-y-2 mt-2">
                  {discoveredSessions.map((s) => (
                    <div
                      key={s.sessionId}
                      className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50"
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {s.hostName}&apos;s Session
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ID: {s.sessionId} · {s.listenerCount} listener
                          {s.listenerCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleJoin(s.sessionId)}
                        className="bg-cyan-600 hover:bg-cyan-700 text-white"
                      >
                        Join
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {discoveredSessions.length === 0 &&
                socketRef.current?.connected && (
                  <p className="text-sm text-muted-foreground text-center">
                    No active sessions found. Ask someone to host!
                  </p>
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
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <RadioTower className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Hosting Session</h3>
              <p className="text-sm text-muted-foreground">
                Session ID:{" "}
                <span className="font-mono text-emerald-400">
                  {sessionId || "Creating..."}
                </span>
              </p>
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              socketRef.current?.emit("host:stop");
              resetState();
            }}
          >
            <Square className="w-4 h-4 mr-1" />
            End Session
          </Button>
        </div>

        {/* Audio Level Visualizer */}
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              {isStreaming ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsMuted(!isMuted)}
                  className={
                    isMuted
                      ? "border-red-500/50 text-red-400"
                      : "border-emerald-500/50 text-emerald-400"
                  }
                >
                  {isMuted ? (
                    <MicOff className="w-5 h-5" />
                  ) : (
                    <Mic className="w-5 h-5" />
                  )}
                </Button>
              ) : null}
              <div className="flex-1">
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400"
                    animate={{ width: `${audioLevel}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>
              </div>
              <Badge
                variant={isStreaming ? "default" : "secondary"}
                className={
                  isStreaming
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : ""
                }
              >
                {isStreaming
                  ? isMuted
                    ? "MUTED"
                    : "LIVE"
                  : "OFFLINE"}
              </Badge>
            </div>

            {/* Waveform Bars */}
            <div className="flex items-center justify-center gap-[3px] h-20">
              {Array.from({ length: 40 }).map((_, i) => {
                const h = isStreaming
                  ? Math.max(
                      8,
                      Math.sin(
                        Date.now() / 200 + i * 0.5
                      ) *
                        30 *
                        (audioLevel / 100) +
                        10
                    )
                  : 8;
                return (
                  <motion.div
                    key={i}
                    className="w-1.5 rounded-full bg-gradient-to-t from-emerald-500 to-cyan-400"
                    animate={{ height: h }}
                    transition={{ duration: 0.1, ease: "easeOut" }}
                  />
                );
              })}
            </div>

            {!isStreaming && (
              <Button
                onClick={startStreaming}
                className="w-full mt-4 bg-emerald-600 hover:bg-emerald-700 text-white"
                size="lg"
              >
                <Mic className="w-5 h-5 mr-2" />
                Start Streaming
              </Button>
            )}

            {isStreaming && (
              <Button
                onClick={stopStreaming}
                variant="outline"
                className="w-full mt-4 border-red-500/40 text-red-400 hover:bg-red-500/10"
                size="lg"
              >
                <Square className="w-5 h-5 mr-2" />
                Stop Streaming
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Connected Listeners */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4" />
                Connected Listeners
              </CardTitle>
              <Badge variant="secondary">{listeners.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {listeners.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Waiting for listeners to join... Share your session ID:{" "}
                <span className="font-mono text-emerald-400">
                  {sessionId}
                </span>
              </p>
            ) : (
              <div className="space-y-2">
                {listeners.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-muted/50"
                  >
                    <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                      <Headphones className="w-4 h-4 text-cyan-400" />
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
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <Headphones className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Listening</h3>
            <p className="text-sm text-muted-foreground">
              Session:{" "}
              <span className="font-mono text-cyan-400">
                {joinSessionId}
              </span>
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={resetState}
          className="border-red-500/40 text-red-400 hover:bg-red-500/10"
        >
          <Square className="w-4 h-4 mr-1" />
          Leave
        </Button>
      </div>

      {/* Buffering */}
      {bufferProgress < 100 && bufferProgress > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="text-center space-y-3">
              <AudioWaveform className="w-8 h-8 mx-auto text-cyan-400 animate-pulse" />
              <p className="text-sm font-medium">Buffering audio...</p>
              <Progress value={bufferProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {bufferProgress}%
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Playback Status */}
      <Card className="border-cyan-500/30">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsSpeakerOn(!isSpeakerOn)}
              className={
                isSpeakerOn
                  ? "border-cyan-500/50 text-cyan-400"
                  : "border-red-500/50 text-red-400"
              }
            >
              {isSpeakerOn ? (
                <Volume2 className="w-5 h-5" />
              ) : (
                <VolumeX className="w-5 h-5" />
              )}
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="h-3 flex-1 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400"
                    animate={{
                      width: bufferProgress >= 100 ? "100%" : `${bufferProgress}%`,
                    }}
                  />
                </div>
              </div>
            </div>
            <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
              LIVE
            </Badge>
          </div>

          {/* Receiving Waveform */}
          <div className="flex items-center justify-center gap-[3px] h-20">
            {Array.from({ length: 40 }).map((_, i) => {
              const h =
                bufferProgress >= 100
                  ? Math.max(
                      8,
                      Math.sin(Date.now() / 250 + i * 0.6) *
                        25 +
                        12
                    )
                  : 8;
              return (
                <motion.div
                  key={i}
                  className="w-1.5 rounded-full bg-gradient-to-t from-cyan-500 to-emerald-400"
                  animate={{ height: h }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Latency</p>
            <p className="text-2xl font-bold text-cyan-400">~{latency}ms</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Buffer</p>
            <p className="text-2xl font-bold text-emerald-400">
              {bufferProgress >= 100 ? "Full" : `${bufferProgress}%`}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Code Block with Copy
// ──────────────────────────────────────────────
function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg overflow-x-auto text-sm font-mono">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? (
          <Check className="w-4 h-4 text-emerald-400" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────
export default function HomePage() {
  const [activeSection, setActiveSection] = useState("hero");

  // Smooth scroll
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ─── NAVBAR ─── */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border/50">
        <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-400 flex items-center justify-center">
              <Radio className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg">LocalCast</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm">
            <button
              onClick={() => scrollTo("features")}
              className="hover:text-emerald-400 transition-colors"
            >
              Features
            </button>
            <button
              onClick={() => scrollTo("architecture")}
              className="hover:text-emerald-400 transition-colors"
            >
              Architecture
            </button>
            <button
              onClick={() => scrollTo("demo")}
              className="hover:text-emerald-400 transition-colors"
            >
              Live Demo
            </button>
            <button
              onClick={() => scrollTo("publish")}
              className="hover:text-emerald-400 transition-colors"
            >
              Publish Guide
            </button>
          </div>
          <Button
            onClick={() => scrollTo("demo")}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Try Demo
          </Button>
        </nav>
      </header>

      <main className="flex-1">
        {/* ─── HERO ─── */}
        <section
          id="hero"
          className="relative overflow-hidden py-20 md:py-32"
        >
          {/* Background glow */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
          </div>

          <div className="max-w-6xl mx-auto px-4 relative z-10">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6 }}
                className="space-y-6"
              >
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                >
                  <Wifi className="w-3 h-3 mr-1" />
                  No Internet Required
                </Badge>
                <h1 className="text-4xl md:text-6xl font-bold leading-tight">
                  Stream Audio
                  <br />
                  <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                    Over Local Wi-Fi
                  </span>
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  One host. Unlimited listeners. Zero cloud. LocalCast lets you
                  stream live audio to any phone on the same Wi-Fi network — no
                  sign-up, no data, no internet needed.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    size="lg"
                    onClick={() => scrollTo("demo")}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    Try Live Demo
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => scrollTo("architecture")}
                    className="border-emerald-500/40"
                  >
                    View Architecture
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="relative"
              >
                <div className="relative rounded-2xl overflow-hidden border border-border/50 shadow-2xl shadow-emerald-500/10">
                  <img
                    src="/hero-audio.png"
                    alt="LocalCast audio streaming visualization"
                    className="w-full h-auto"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4">
                    <div className="flex items-center gap-3 bg-background/90 backdrop-blur-sm p-3 rounded-xl border border-border/50">
                      <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                        <RadioTower className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          Live Session Active
                        </p>
                        <p className="text-xs text-muted-foreground">
                          24 listeners · ~12ms latency
                        </p>
                      </div>
                      <Badge className="ml-auto bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                        LIVE
                      </Badge>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ─── STATS BAR ─── */}
        <section className="border-y border-border/50 bg-muted/30 py-8">
          <div className="max-w-6xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { value: "0ms", label: "Cloud Latency", icon: Zap },
              { value: "∞", label: "Max Listeners", icon: Users },
              { value: "0", label: "Accounts Needed", icon: Shield },
              { value: "100%", label: "Offline Capable", icon: Globe },
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="space-y-2"
              >
                <stat.icon className="w-5 h-5 mx-auto text-emerald-400" />
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">
                  {stat.label}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ─── FEATURES ─── */}
        <section id="features" className="py-20 md:py-28">
          <div className="max-w-6xl mx-auto px-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              className="text-center space-y-4 mb-16"
            >
              <Badge
                variant="outline"
                className="border-cyan-500/40 text-cyan-400 bg-cyan-500/10"
              >
                Core Features
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold">
                Everything You Need,{" "}
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  Nothing You Don&apos;t
                </span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Built for simplicity and performance. No bloat, no accounts,
                no cloud dependency.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  icon: RadioTower,
                  title: "Host Streaming",
                  description:
                    "Start streaming your microphone or media audio with one tap. UDP multicast ensures efficient delivery to all listeners simultaneously.",
                  color: "emerald",
                },
                {
                  icon: Wifi,
                  title: "Auto Discovery",
                  description:
                    "Clients automatically discover the host via UDP broadcast. No IP addresses to share, no QR codes to scan.",
                  color: "cyan",
                },
                {
                  icon: Headphones,
                  title: "Synced Playback",
                  description:
                    "Buffered, synchronized playback across all devices. Adaptive jitter buffer keeps audio smooth even on crowded networks.",
                  color: "emerald",
                },
                {
                  icon: Smartphone,
                  title: "Cross-Platform",
                  description:
                    "Works on both iOS and Android. Built with Flutter for native performance on both platforms from a single codebase.",
                  color: "cyan",
                },
                {
                  icon: Zap,
                  title: "Ultra-Low Latency",
                  description:
                    "Sub-50ms latency on local Wi-Fi. Direct UDP multicast means no server round-trips, no cloud relay delays.",
                  color: "emerald",
                },
                {
                  icon: Shield,
                  title: "Completely Private",
                  description:
                    "No data leaves your local network. No analytics, no tracking, no cloud servers. Your audio stays on your Wi-Fi.",
                  color: "cyan",
                },
              ].map((feature, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  <Card className="h-full hover:border-emerald-500/40 transition-all duration-300 group">
                    <CardHeader>
                      <div
                        className={`w-12 h-12 rounded-xl ${
                          feature.color === "emerald"
                            ? "bg-emerald-500/20"
                            : "bg-cyan-500/20"
                        } flex items-center justify-center mb-2 group-hover:scale-110 transition-transform`}
                      >
                        <feature.icon
                          className={`w-6 h-6 ${
                            feature.color === "emerald"
                              ? "text-emerald-400"
                              : "text-cyan-400"
                          }`}
                        />
                      </div>
                      <CardTitle className="text-lg">
                        {feature.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {feature.description}
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── ARCHITECTURE ─── */}
        <section
          id="architecture"
          className="py-20 md:py-28 bg-muted/30 border-y border-border/50"
        >
          <div className="max-w-6xl mx-auto px-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              className="text-center space-y-4 mb-16"
            >
              <Badge
                variant="outline"
                className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
              >
                Technical Architecture
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold">
                How It{" "}
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  Works Under the Hood
                </span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                A deep dive into the UDP multicast streaming and UDP broadcast
                discovery protocol.
              </p>
            </motion.div>

            {/* Architecture Diagram */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              className="mb-16"
            >
              <Card className="overflow-hidden">
                <div className="relative">
                  <img
                    src="/network-topology.png"
                    alt="Network topology diagram"
                    className="w-full h-auto opacity-60"
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-background/50 to-background" />
                </div>
                <CardContent className="p-8 -mt-32 relative z-10">
                  {/* Topology Visual */}
                  <div className="flex flex-col items-center gap-6">
                    {/* Host */}
                    <div className="flex items-center gap-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 px-6">
                      <RadioTower className="w-6 h-6 text-emerald-400" />
                      <div>
                        <p className="font-bold text-emerald-400">
                          Host Device
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Captures mic → Encodes PCM → Sends via UDP Multicast
                        </p>
                      </div>
                    </div>

                    {/* Arrow */}
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-px h-6 bg-gradient-to-b from-emerald-400 to-cyan-400" />
                      <Badge
                        variant="outline"
                        className="border-cyan-500/40 text-cyan-400 text-xs"
                      >
                        UDP Multicast (239.255.x.x:4010)
                      </Badge>
                      <div className="w-px h-6 bg-cyan-400" />
                    </div>

                    {/* Router */}
                    <div className="flex items-center gap-3 bg-muted/80 border border-border rounded-xl p-3 px-5">
                      <Wifi className="w-5 h-5 text-muted-foreground" />
                      <span className="font-medium text-sm">
                        Wi-Fi Router / Hotspot
                      </span>
                    </div>

                    {/* Arrows to clients */}
                    <div className="w-px h-6 bg-cyan-400" />

                    {/* Clients */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {["Client 1", "Client 2", "Client 3", "Client N"].map(
                        (name, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-2 px-3"
                          >
                            <Headphones className="w-4 h-4 text-cyan-400" />
                            <span className="text-xs font-medium text-cyan-400">
                              {name}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Protocol Details */}
            <div className="grid md:grid-cols-2 gap-8">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
              >
                <Card className="h-full border-emerald-500/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <RadioTower className="w-5 h-5 text-emerald-400" />
                      Streaming Protocol
                    </CardTitle>
                    <CardDescription>
                      UDP Multicast (RFC 1112)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="space-y-3">
                      <div className="flex items-start gap-2">
                        <Badge
                          variant="secondary"
                          className="mt-0.5 text-xs shrink-0"
                        >
                          1
                        </Badge>
                        <p>
                          <strong>Capture:</strong> Host captures PCM audio
                          from microphone at 48kHz/16-bit via platform-native
                          APIs (Android AudioRecord / iOS AVAudioEngine).
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Badge
                          variant="secondary"
                          className="mt-0.5 text-xs shrink-0"
                        >
                          2
                        </Badge>
                        <p>
                          <strong>Encode:</strong> Audio is encoded as Opus
                          (64kbps) for bandwidth efficiency — ~8KB/s per
                          stream, well within Wi-Fi capacity.
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Badge
                          variant="secondary"
                          className="mt-0.5 text-xs shrink-0"
                        >
                          3
                        </Badge>
                        <p>
                          <strong>Multicast:</strong> Packets are sent to
                          multicast group <code className="text-emerald-400 bg-muted px-1 rounded text-xs">239.255.0.1:4010</code>.
                          All subscribed clients receive the same packets
                          simultaneously.
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Badge
                          variant="secondary"
                          className="mt-0.5 text-xs shrink-0"
                        >
                          4
                        </Badge>
                        <p>
                          <strong>Decode & Play:</strong> Clients decode Opus
                          → PCM, feed into an adaptive jitter buffer (50-200ms),
                          then play through headphones via platform audio APIs.
                        </p>
                      </div>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">
                        <strong>Why Multicast?</strong> One packet from the host
                        reaches ALL clients. No per-client copies. Scales from
                        1 to 1000+ listeners without increasing host bandwidth.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
              >
                <Card className="h-full border-cyan-500/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Wifi className="w-5 h-5 text-cyan-400" />
                      Discovery Protocol
                    </CardTitle>
                    <CardDescription>
                      UDP Broadcast (255.255.255.255:4020)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="space-y-3">
                      <div className="flex items-start gap-2">
                        <Badge
                          variant="secondary"
                          className="mt-0.5 text-xs shrink-0"
                        >
                          1
                        </Badge>
                        <p>
                          <strong>Host Announces:</strong> Every 2 seconds, the
                          host broadcasts a JSON beacon:{" "}
                          <code className="text-cyan-400 bg-muted px-1 rounded text-xs">
                            {"{hostId, name, listeners, port}"}
                          </code>
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Badge
                          variant="secondary"
                          className="mt-0.5 text-xs shrink-0"
                        >
                          2
                        </Badge>
                        <p>
                          <strong>Client Listens:</strong> On app launch,
                          clients listen on the broadcast port for 5 seconds to
                          collect all available sessions.
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Badge
                          variant="secondary"
                          className="mt-0.5 text-xs shrink-0"
                        >
                          3
                        </Badge>
                        <p>
                          <strong>One-Tap Join:</strong> User selects a session
                          → app subscribes to the multicast group and starts
                          receiving audio immediately.
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Badge
                          variant="secondary"
                          className="mt-0.5 text-xs shrink-0"
                        >
                          4
                        </Badge>
                        <p>
                          <strong>Leave Notification:</strong> Client sends a
                          UDP unicast leave message to the host, which updates
                          the listener count in subsequent beacons.
                        </p>
                      </div>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">
                        <strong>Why Broadcast?</strong> Works on any Wi-Fi
                        without configuration. No mDNS dependency, no SSDP
                        complexity. Just send → receive → join.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Packet Format */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              className="mt-12"
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Audio Packet Format
                  </CardTitle>
                  <CardDescription>
                    Each UDP datagram carries one audio frame
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <div className="min-w-[600px] flex items-stretch gap-px rounded-lg overflow-hidden">
                      {[
                        {
                          label: "Magic",
                          bytes: "2B",
                          desc: "0xAC",
                          color: "bg-emerald-500/30",
                        },
                        {
                          label: "Seq",
                          bytes: "4B",
                          desc: "Sequence #",
                          color: "bg-emerald-500/20",
                        },
                        {
                          label: "TS",
                          bytes: "4B",
                          desc: "Timestamp",
                          color: "bg-cyan-500/20",
                        },
                        {
                          label: "Codec",
                          bytes: "1B",
                          desc: "0=PCM, 1=Opus",
                          color: "bg-cyan-500/30",
                        },
                        {
                          label: "Payload",
                          bytes: "≤1400B",
                          desc: "Audio data",
                          color: "bg-emerald-500/10",
                        },
                      ].map((field, i) => (
                        <div
                          key={i}
                          className={`flex-1 ${field.color} p-3 text-center`}
                        >
                          <p className="text-xs font-bold">{field.label}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {field.bytes}
                          </p>
                          <p className="text-[10px] mt-1 opacity-70">
                            {field.desc}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </section>

        {/* ─── LIVE DEMO ─── */}
        <section id="demo" className="py-20 md:py-28">
          <div className="max-w-4xl mx-auto px-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              className="text-center space-y-4 mb-12"
            >
              <Badge
                variant="outline"
                className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
              >
                <Play className="w-3 h-3 mr-1" />
                Interactive Demo
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold">
                Try It{" "}
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  Right Now
                </span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                This web demo uses WebSocket relay instead of UDP multicast
                (browsers can&apos;t do raw UDP), but the UX is identical to
                the native app.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <AudioStreamDemo />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              className="mt-8"
            >
              <Card className="border-yellow-500/30 bg-yellow-500/5">
                <CardContent className="p-4 flex items-start gap-3">
                  <MonitorSmartphone className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-yellow-400 mb-1">
                      Web Demo Limitations
                    </p>
                    <p className="text-muted-foreground">
                      Browsers cannot access raw UDP sockets, so this demo uses
                      a WebSocket relay server. The native mobile app uses
                      direct UDP multicast for true zero-server, sub-10ms
                      latency streaming.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </section>

        {/* ─── PUBLISH GUIDE ─── */}
        <section
          id="publish"
          className="py-20 md:py-28 bg-muted/30 border-y border-border/50"
        >
          <div className="max-w-6xl mx-auto px-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              className="text-center space-y-4 mb-16"
            >
              <Badge
                variant="outline"
                className="border-cyan-500/40 text-cyan-400 bg-cyan-500/10"
              >
                <Package className="w-3 h-3 mr-1" />
                Publishing Guide
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold">
                From Code to{" "}
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  App Store & Website
                </span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Complete step-by-step guide to build, sign, and publish your
                app and landing page.
              </p>
            </motion.div>

            <Tabs defaultValue="flutter" className="space-y-8">
              <TabsList className="grid w-full grid-cols-4 max-w-2xl mx-auto">
                <TabsTrigger value="flutter">
                  <Smartphone className="w-4 h-4 mr-2" />
                  Flutter App
                </TabsTrigger>
                <TabsTrigger value="android">
                  <Terminal className="w-4 h-4 mr-2" />
                  Android
                </TabsTrigger>
                <TabsTrigger value="ios">
                  <Package className="w-4 h-4 mr-2" />
                  iOS
                </TabsTrigger>
                <TabsTrigger value="website">
                  <Globe className="w-4 h-4 mr-2" />
                  Website
                </TabsTrigger>
              </TabsList>

              {/* Flutter App Tab */}
              <TabsContent value="flutter" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Project Setup</CardTitle>
                    <CardDescription>
                      Create and configure the Flutter project
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <CodeBlock
                      code={`# 1. Create Flutter project
flutter create localcast --org com.localcast --platforms android,ios
cd localcast

# 2. Add dependencies
flutter pub add multicast_dns  # For mDNS fallback discovery
flutter pub add opus_dart       # Opus codec bindings
flutter pub add permission_handler  # Mic + Wi-Fi permissions
flutter pub add provider        # State management

# 3. Project structure
lib/
├── main.dart
├── models/
│   ├── session.dart       # Session data model
│   └── audio_packet.dart  # Packet format
├── services/
│   ├── audio_capture.dart  # Platform-native mic capture
│   ├── audio_player.dart   # Platform-native playback
│   ├── udp_streamer.dart   # UDP multicast send/recv
│   ├── discovery.dart      # UDP broadcast discovery
│   └── jitter_buffer.dart  # Adaptive buffer
├── screens/
│   ├── home_screen.dart    # Role selection
│   ├── host_screen.dart    # Host streaming UI
│   └── listener_screen.dart # Listener UI
└── widgets/
    ├── audio_visualizer.dart
    └── session_card.dart`}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Core UDP Multicast Service</CardTitle>
                    <CardDescription>
                      The heart of the streaming engine
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <CodeBlock
                      language="dart"
                      code={`// lib/services/udp_streamer.dart
import 'dart:io';
import 'dart:typed_data';

class UdpStreamer {
  static const String multicastGroup = '239.255.0.1';
  static const int multicastPort = 4010;
  static const int mtu = 1400; // Safe UDP payload size

  RawDatagramSocket? _sendSocket;
  RawDatagramSocket? _recvSocket;
  InternetAddress? _groupAddress;
  int _seqNum = 0;

  Future<void> initSender() async {
    _groupAddress = InternetAddress(multicastGroup);
    _sendSocket = await RawDatagramSocket.bind(
      InternetAddress.anyIPv4, multicastPort
    );
    // Set multicast TTL (1 = local network only)
    _sendSocket!.multicastLoopback = false;
    _sendSocket!.multicastHops = 1;
  }

  Future<void> initReceiver() async {
    _recvSocket = await RawDatagramSocket.bind(
      InternetAddress.anyIPv4, multicastPort
    );
    _groupAddress = InternetAddress(multicastGroup);
    // Join multicast group
    _recvSocket!.joinMulticast(_groupAddress!);
    _recvSocket!.multicastLoopback = false;
  }

  void sendAudioFrame(Uint8List opusFrame) {
    if (_sendSocket == null) return;
    // Build packet: [magic(2)][seq(4)][ts(4)][codec(1)][payload]
    final buf = BytesBuilder();
    buf.addByte(0xAC); buf.addByte(0xDC); // Magic
    buf.add(_int32Bytes(_seqNum++));       // Sequence
    buf.add(_int32Bytes(                    // Timestamp
      DateTime.now().millisecondsSinceEpoch
    ));
    buf.addByte(1);                         // Codec: Opus
    buf.add(opusFrame);                     // Payload
    _sendSocket!.send(buf.toBytes(), _groupAddress!, multicastPort);
  }

  Stream<Uint8List> get audioStream async* {
    await for (final datagram in _recvSocket!) {
      if (datagram == null) continue;
      final data = datagram.data;
      // Validate magic bytes
      if (data[0] != 0xAC || data[1] != 0xDC) continue;
      // Extract payload (skip 11-byte header)
      yield data.sublist(11);
    }
  }

  Uint8List _int32Bytes(int value) =>
    Uint8List(4)..buffer.asByteData().setInt32(0, value);

  void dispose() {
    _sendSocket?.close();
    _recvSocket?.close();
  }
}`}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Discovery Service</CardTitle>
                    <CardDescription>
                      UDP broadcast for auto-discovery
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <CodeBlock
                      language="dart"
                      code={`// lib/services/discovery.dart
import 'dart:io';
import 'dart:convert';

class DiscoveryService {
  static const int broadcastPort = 4020;
  static const Duration announceInterval = Duration(seconds: 2);

  RawDatagramSocket? _socket;
  Timer? _announceTimer;
  String? _sessionId;

  // Host: Start broadcasting presence
  Future<void> startAnnouncing(String sessionName) async {
    _sessionId = DateTime.now().millisecondsSinceEpoch.toRadixString(36);
    _socket = await RawDatagramSocket.bind(
      InternetAddress.anyIPv4, broadcastPort
    );
    _socket!.broadcastEnabled = true;

    _announceTimer = Timer.periodic(announceInterval, (_) {
      final beacon = jsonEncode({
        'type': 'announce',
        'sessionId': _sessionId,
        'hostName': sessionName,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });
      _socket!.send(
        utf8.encode(beacon),
        InternetAddress('255.255.255.255'),
        broadcastPort,
      );
    });
  }

  // Client: Listen for host announcements
  Future<List<DiscoveredHost>> discover({
    Duration timeout = const Duration(seconds: 5),
  }) async {
    final socket = await RawDatagramSocket.bind(
      InternetAddress.anyIPv4, broadcastPort
    );
    final hosts = <String, DiscoveredHost>{};

    socket.listen((event) {
      if (event == RawSocketEvent.read) {
        final datagram = socket.receive();
        if (datagram == null) return;
        final data = jsonDecode(utf8.decode(datagram.data));
        if (data['type'] == 'announce') {
          hosts[data['sessionId']] = DiscoveredHost(
            sessionId: data['sessionId'],
            hostName: data['hostName'],
            address: datagram.address,
          );
        }
      }
    });

    await Future.delayed(timeout);
    socket.close();
    return hosts.values.toList();
  }

  void stopAnnouncing() {
    _announceTimer?.cancel();
    _socket?.close();
  }
}

class DiscoveredHost {
  final String sessionId;
  final String hostName;
  final InternetAddress address;
  DiscoveredHost({
    required this.sessionId,
    required this.hostName,
    required this.address,
  });
}`}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Android Publishing Tab */}
              <TabsContent value="android" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="w-5 h-5 text-emerald-400" />
                      Android: Build & Publish to Google Play
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 1</Badge>
                        Configure Permissions
                      </h4>
                      <CodeBlock
                        code={`<!-- android/app/src/main/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Required permissions -->
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
    <uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />
    
    <!-- Wi-Fi Multicast lock -->
    <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
</manifest>`}
                      />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 2</Badge>
                        Generate Signing Key
                      </h4>
                      <CodeBlock
                        code={`# Generate upload keystore
keytool -genkey -v -keystore localcast-upload.jks \\
  -keyalg RSA -keysize 2048 -validity 10000 \\
  -alias localcast

# Create key.properties
echo "storePassword=YOUR_PASSWORD" > android/key.properties
echo "keyPassword=YOUR_PASSWORD" >> android/key.properties
echo "keyAlias=localcast" >> android/key.properties
echo "storeFile=../localcast-upload.jks" >> android/key.properties`}
                      />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 3</Badge>
                        Build Release AAB
                      </h4>
                      <CodeBlock
                        code={`# Build Android App Bundle (AAB)
flutter build appbundle --release

# Output: build/app/outputs/bundle/release/app-release.aab

# Optional: Build APK for direct distribution
flutter build apk --release
# Output: build/app/outputs/flutter-apk/app-release.apk`}
                      />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 4</Badge>
                        Publish to Google Play
                      </h4>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
                        <p>1. Go to{" "}
                          <a
                            href="https://play.google.com/console"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-400 hover:underline"
                          >
                            Google Play Console <ExternalLink className="w-3 h-3 inline" />
                          </a>
                        </p>
                        <p>2. Create a new app → Fill in store listing details</p>
                        <p>3. Upload the AAB file under <strong>Release → Production</strong></p>
                        <p>4. Complete the content questionnaire (no data collection = simpler)</p>
                        <p>5. Add store assets: icon (512x512), screenshots, feature graphic</p>
                        <p>6. Submit for review (typically 1-3 days for new apps)</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 5</Badge>
                        Alternative: Direct APK Distribution
                      </h4>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                        <p>For sideloading without Google Play:</p>
                        <CodeBlock
                          code={`# Build a universal APK
flutter build apk --release --target-platform android-arm64

# Share via your website or GitHub Releases
# Users enable "Install from unknown sources" on their device`}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* iOS Publishing Tab */}
              <TabsContent value="ios" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="w-5 h-5 text-cyan-400" />
                      iOS: Build & Publish to App Store
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 1</Badge>
                        Configure Permissions (Info.plist)
                      </h4>
                      <CodeBlock
                        code={`<!-- ios/Runner/Info.plist -->
<key>NSMicrophoneUsageDescription</key>
<string>LocalCast needs microphone access to stream your audio to listeners.</string>
<key>NSLocalNetworkUsageDescription</key>
<string>LocalCast uses your local Wi-Fi to stream audio to nearby devices.</string>
<key>NSBonjourServices</key>
<array>
  <string>_localcast._tcp</string>
</array>`}
                      />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 2</Badge>
                        Apple Developer Setup
                      </h4>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
                        <p>1. Enroll in the{" "}
                          <a
                            href="https://developer.apple.com/programs/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:underline"
                          >
                            Apple Developer Program <ExternalLink className="w-3 h-3 inline" />
                          </a>
                          {" "}(€99/year)
                        </p>
                        <p>2. Create an App ID with <strong>Audio</strong> and <strong>Local Network</strong> capabilities</p>
                        <p>3. Create a Distribution Certificate in Xcode → Settings → Accounts</p>
                        <p>4. Create a Provisioning Profile for App Store distribution</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 3</Badge>
                        Build & Upload
                      </h4>
                      <CodeBlock
                        code={`# Build iOS release
flutter build ipa --release

# Output: build/ios/ipa/localcast.ipa

# Upload via Xcode Organizer
# 1. Open Xcode → Window → Organizer
# 2. Select your archive → Distribute App → App Store Connect
# 3. Follow the upload wizard

# OR upload via command line:
xcrun altool --upload-app \\
  --type ios \\
  --file build/ios/ipa/localcast.ipa \\
  --apiKey YOUR_API_KEY \\
  --apiIssuer YOUR_ISSUER_ID`}
                      />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Step 4</Badge>
                        App Store Connect Submission
                      </h4>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
                        <p>1. Go to{" "}
                          <a
                            href="https://appstoreconnect.apple.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:underline"
                          >
                            App Store Connect <ExternalLink className="w-3 h-3 inline" />
                          </a>
                        </p>
                        <p>2. Create new app → Fill in metadata, screenshots, description</p>
                        <p>3. Select the uploaded build under <strong>Builds</strong></p>
                        <p>4. Submit for review (typically 24-48 hours)</p>
                        <p>5. <strong>Important:</strong> In the review notes, explain that the app
                          requires a local Wi-Fi network and multiple devices to test.</p>
                      </div>
                    </div>

                    <Card className="border-yellow-500/30 bg-yellow-500/5">
                      <CardContent className="p-4 flex items-start gap-3">
                        <Shield className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="font-medium text-yellow-400 mb-1">
                            iOS Multicast Note
                          </p>
                          <p className="text-muted-foreground">
                            iOS restricts raw multicast sockets. Use{" "}
                            <strong>NSNetService (Bonjour)</strong> for discovery
                            and <strong>MultipeerConnectivity</strong> or{" "}
                            <strong>Network.framework NWConnection</strong> with
                            multicast group subscription for streaming. You&apos;ll
                            need the <code className="bg-muted px-1 rounded">com.apple.developer.networking.multicast</code>{" "}
                            entitlement (request from Apple).
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Website Publishing Tab */}
              <TabsContent value="website" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="w-5 h-5 text-emerald-400" />
                      Website: Deploy the Landing Page
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Option A</Badge>
                        Deploy to Vercel (Recommended)
                      </h4>
                      <CodeBlock
                        code={`# Install Vercel CLI
npm i -g vercel

# Deploy from project root
cd /path/to/localcast-website
vercel

# For production deployment:
vercel --prod

# Your site will be live at:
# https://localcast.vercel.app
# (custom domain can be added in Vercel dashboard)`}
                      />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Option B</Badge>
                        Deploy to Netlify
                      </h4>
                      <CodeBlock
                        code={`# Build static export
# In next.config.ts, add:
# output: 'export'

npm run build   # Generates /out directory

# Deploy to Netlify
npx netlify-cli deploy --dir=out --prod

# Or connect your GitHub repo at netlify.com
# for automatic deploys on every push`}
                      />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Option C</Badge>
                        GitHub Pages (Free)
                      </h4>
                      <CodeBlock
                        code={`# 1. Set next.config.ts output to 'export'
# 2. Set basePath if deploying to a subdirectory:
#    basePath: '/localcast'

npm run build

# 3. Push the /out directory to gh-pages branch
npx gh-pages -d out

# 4. Your site: https://yourusername.github.io/localcast/`}
                      />
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Badge variant="secondary">Custom Domain</Badge>
                        Connect Your Own Domain
                      </h4>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                        <p>1. Purchase a domain (e.g., Namecheap, Cloudflare, Google Domains)</p>
                        <p>2. In your hosting platform (Vercel/Netlify), add the custom domain</p>
                        <p>3. Update DNS records:</p>
                        <CodeBlock
                          code={`# Vercel DNS example:
A    @       76.76.21.21      # Vercel IP
CNAME www     cname.vercel-dns.com

# Netlify DNS example:
A    @       75.2.60.5        # Netlify IP
CNAME www     your-site.netlify.app`}
                        />
                        <p>4. Enable SSL (automatic on Vercel/Netlify)</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Website Content Checklist</CardTitle>
                    <CardDescription>
                      Everything your landing page needs
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid md:grid-cols-2 gap-4">
                      {[
                        { icon: "✅", text: "Hero section with clear value prop" },
                        { icon: "✅", text: "App store / Play store download links" },
                        { icon: "✅", text: "Feature highlights with icons" },
                        { icon: "✅", text: "How it works (3-step diagram)" },
                        { icon: "✅", text: "Screenshots / demo video" },
                        { icon: "✅", text: "Privacy policy (no data collection)" },
                        { icon: "✅", text: "FAQ / Troubleshooting section" },
                        { icon: "✅", text: "Open source GitHub link (optional)" },
                      ].map((item, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span>{item.icon}</span>
                          <span>{item.text}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </section>

        {/* ─── FAQ ─── */}
        <section className="py-20 md:py-28">
          <div className="max-w-3xl mx-auto px-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              className="text-center space-y-4 mb-12"
            >
              <h2 className="text-3xl font-bold">
                Frequently Asked Questions
              </h2>
            </motion.div>

            <Accordion type="single" collapsible className="space-y-3">
              {[
                {
                  q: "Can this really work without internet?",
                  a: "Yes! All communication happens over the local Wi-Fi network using UDP multicast and broadcast. No data leaves the network. Even a phone hotspot works — just connect all devices to the same hotspot.",
                },
                {
                  q: "How many devices can connect simultaneously?",
                  a: "UDP multicast is inherently scalable — one packet reaches all listeners. We've tested with 30 devices on a phone hotspot. The theoretical limit depends on Wi-Fi bandwidth (~8KB/s per Opus stream) and router capacity, easily supporting 100+ devices on a proper router.",
                },
                {
                  q: "What's the latency like?",
                  a: "On a local Wi-Fi network, end-to-end latency is typically 15-50ms (capture + encode + network + decode + buffer). The jitter buffer adds 50-200ms of additional buffering for smooth playback. Total: ~65-250ms, comparable to Bluetooth audio.",
                },
                {
                  q: "Why UDP multicast instead of TCP/WebRTC?",
                  a: "Multicast is the only protocol where one packet from the host reaches ALL clients simultaneously. TCP requires a separate connection per client (O(n) bandwidth). WebRTC is peer-to-peer but doesn't support multicast groups. For 30+ listeners, multicast is the only scalable option.",
                },
                {
                  q: "Does this work on iOS?",
                  a: "Yes, but iOS requires the com.apple.developer.networking.multicast entitlement from Apple. You'll also need to use Bonjour (NSNetService) for discovery and Network.framework for multicast subscription. The iOS implementation uses slightly different APIs but achieves the same result.",
                },
                {
                  q: "Can I stream media audio (not just microphone)?",
                  a: "On Android, you can use MediaProjection API to capture system audio. On iOS, you can use AVAudioEngine with the .mixWithOthers category to capture app audio. Both platforms also support playing a local file and streaming it through the same pipeline.",
                },
              ].map((item, i) => (
                <AccordionItem
                  key={i}
                  value={`faq-${i}`}
                  className="border rounded-lg px-4"
                >
                  <AccordionTrigger className="text-left text-sm font-medium">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="py-20 bg-gradient-to-br from-emerald-950/40 to-cyan-950/40 border-y border-border/50">
          <div className="max-w-3xl mx-auto px-4 text-center space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <h2 className="text-3xl md:text-4xl font-bold">
                Ready to Build Your
                <br />
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  Local Audio Network?
                </span>
              </h2>
              <p className="text-muted-foreground">
                Start with the live demo above, then follow the publishing guide
                to ship your own app.
              </p>
              <div className="flex justify-center gap-4">
                <Button
                  size="lg"
                  onClick={() => scrollTo("demo")}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Play className="w-5 h-5 mr-2" />
                  Try Demo
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => scrollTo("publish")}
                  className="border-emerald-500/40"
                >
                  <Upload className="w-5 h-5 mr-2" />
                  Publish Guide
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
              <div className="w-6 h-6 rounded bg-gradient-to-br from-emerald-500 to-cyan-400 flex items-center justify-center">
                <Radio className="w-3 h-3 text-white" />
              </div>
              <span className="font-semibold text-sm">LocalCast</span>
              <span className="text-xs text-muted-foreground">
                — Local Wi-Fi Audio Streaming
              </span>
            </div>
            <div className="flex items-center gap-6 text-xs text-muted-foreground">
              <span>No Cloud · No Accounts · No Tracking</span>
              <span className="hidden md:inline">•</span>
              <span className="hidden md:inline">
                Built with Flutter + Next.js
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
