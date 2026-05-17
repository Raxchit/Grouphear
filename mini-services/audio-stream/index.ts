import { createServer } from "http";
import { Server } from "socket.io";

const PORT = 3003;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// In-memory session state
interface Session {
  hostId: string;
  hostName: string;
  listeners: Map<string, { id: string; name: string }>;
  createdAt: number;
}

const sessions = new Map<string, Session>();

io.on("connection", (socket) => {
  console.log(`[Connect] ${socket.id}`);

  // Host creates a session
  socket.on("host:create", ({ hostName }: { hostName: string }) => {
    const sessionId = generateId();
    const session: Session = {
      hostId: socket.id,
      hostName: hostName || "Host",
      listeners: new Map(),
      createdAt: Date.now(),
    };
    sessions.set(sessionId, session);
    socket.join(`session:${sessionId}`);
    socket.data.sessionId = sessionId;
    socket.data.role = "host";
    console.log(`[Host] ${hostName} created session ${sessionId}`);
    socket.emit("host:created", { sessionId, hostName });
  });

  // Client discovers sessions
  socket.on("session:discover", () => {
    const activeSessions = Array.from(sessions.entries()).map(
      ([id, session]) => ({
        sessionId: id,
        hostName: session.hostName,
        listenerCount: session.listeners.size,
        createdAt: session.createdAt,
      })
    );
    socket.emit("session:discovered", activeSessions);
  });

  // Client joins a session
  socket.on(
    "session:join",
    ({
      sessionId,
      listenerName,
    }: {
      sessionId: string;
      listenerName: string;
    }) => {
      const session = sessions.get(sessionId);
      if (!session) {
        socket.emit("error", { message: "Session not found" });
        return;
      }
      session.listeners.set(socket.id, {
        id: socket.id,
        name: listenerName || "Listener",
      });
      socket.join(`session:${sessionId}`);
      socket.data.sessionId = sessionId;
      socket.data.role = "listener";

      // Notify host and others
      io.to(`session:${sessionId}`).emit("session:updated", {
        sessionId,
        listenerCount: session.listeners.size,
        listeners: Array.from(session.listeners.values()),
      });

      console.log(
        `[Join] ${listenerName} joined session ${sessionId} (${session.listeners.size} listeners)`
      );
    }
  );

  // Audio data relay: host sends audio chunks, relay to all listeners
  socket.on("audio:chunk", (data: { chunk: ArrayBuffer; timestamp: number }) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId || socket.data.role !== "host") return;

    // Relay to all listeners in the session
    socket.to(`session:${sessionId}`).emit("audio:chunk", {
      chunk: data.chunk,
      timestamp: data.timestamp,
    });
  });

  // Host sends audio metadata (sample rate, channels, etc.)
  socket.on(
    "audio:metadata",
    (data: { sampleRate: number; channels: number; mimeType: string }) => {
      const sessionId = socket.data.sessionId;
      if (!sessionId || socket.data.role !== "host") return;

      socket.to(`session:${sessionId}`).emit("audio:metadata", data);
    }
  );

  // Host stops streaming
  socket.on("host:stop", () => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;

    io.to(`session:${sessionId}`).emit("session:ended", { sessionId });
    cleanupSession(sessionId);
  });

  // Listener leaves
  socket.on("session:leave", () => {
    handleDisconnect(socket);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    handleDisconnect(socket);
  });
});

function handleDisconnect(socket: any) {
  const sessionId = socket.data.sessionId;
  if (!sessionId) return;

  const session = sessions.get(sessionId);
  if (!session) return;

  if (socket.data.role === "host") {
    // Host disconnected - end session
    io.to(`session:${sessionId}`).emit("session:ended", { sessionId });
    cleanupSession(sessionId);
    console.log(`[Host Disconnect] Session ${sessionId} ended`);
  } else {
    // Listener disconnected
    session.listeners.delete(socket.id);
    io.to(`session:${sessionId}`).emit("session:updated", {
      sessionId,
      listenerCount: session.listeners.size,
      listeners: Array.from(session.listeners.values()),
    });
    console.log(
      `[Listener Disconnect] Left session ${sessionId} (${session.listeners.size} remaining)`
    );
  }
}

function cleanupSession(sessionId: string) {
  sessions.delete(sessionId);
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

httpServer.listen(PORT, () => {
  console.log(`🎙️  Audio Stream Service running on port ${PORT}`);
});
