import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  useGetMe,
  useGetConversations,
  useGetMessages,
  useSendMessage,
  useGetUsers,
  useMarkMessageRead,
  useDeleteMessage,
  useGetOnlineUsers,
  useSearchMessages,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { format, differenceInSeconds } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Shield, Clock, Send, Search, Check, CheckCheck,
  User as UserIcon, ArrowLeft, X, SearchCode,
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import type { Message, User, SearchResult } from "@workspace/api-client-react";
import { useNotifications } from "@/hooks/use-notifications";

/* ─────────────────────────────────────────────── */
/*  Helpers                                         */
/* ─────────────────────────────────────────────── */

/** Render a snippet string with **bold** markers into JSX spans */
function SnippetText({ snippet }: { snippet: string }) {
  const parts = snippet.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <mark key={i} className="bg-primary/30 text-foreground rounded px-0.5">
            {part.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

/* ─────────────────────────────────────────────── */
/*  Main page                                       */
/* ─────────────────────────────────────────────── */

type SidebarMode = "chats" | "search-users" | "search-messages";

export default function ChatPage() {
  const { data: me } = useGetMe();

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selectedUserIdRef = useRef<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [timer, setTimer] = useState<number | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  // Sidebar mode & search state
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("chats");
  const [userQuery, setUserQuery] = useState("");
  const [msgQuery, setMsgQuery] = useState("");
  const [debouncedMsgQuery, setDebouncedMsgQuery] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [expiredIds, setExpiredIds] = useState<Set<string>>(new Set());
  // Local overlay for delivered IDs — avoids refetch latency for tick upgrades
  const [deliveredIds, setDeliveredIds] = useState<Set<string>>(new Set());

  const { notify } = useNotifications();

  // Refs so socket callbacks always see fresh values without re-subscribing
  const conversationsRef = useRef<typeof conversations>([]);
  const meRef = useRef(me);
  useEffect(() => { meRef.current = me; }, [me]);

  // Keep ref in sync for socket callbacks
  useEffect(() => { selectedUserIdRef.current = selectedUserId; }, [selectedUserId]);

  // Debounce message search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedMsgQuery(msgQuery), 400);
    return () => clearTimeout(t);
  }, [msgQuery]);

  /* ── Queries ── */
  const { data: onlineUsersData } = useGetOnlineUsers(
    { query: { refetchInterval: 15000 } as any },
  );
  const { data: conversations = [], refetch: refetchConversations } = useGetConversations(
    { query: { refetchInterval: 8000 } as any },
  );
  const { data: messages = [], refetch: refetchMessages } = useGetMessages(selectedUserId!, {
    query: { enabled: !!selectedUserId } as any,
  });
  const { data: userSearchResults = [] } = useGetUsers(
    { search: userQuery },
    { query: { enabled: userQuery.length > 1 } as any },
  );
  const { data: msgSearchResults = [], isFetching: searchFetching } = useSearchMessages(
    { q: debouncedMsgQuery },
    { query: { enabled: debouncedMsgQuery.length > 1 } as any },
  );

  const sendMessageMutation = useSendMessage();
  const markReadMutation = useMarkMessageRead();
  const deleteMessageMutation = useDeleteMessage();

  /* ── Side effects ── */
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  useEffect(() => {
    if (onlineUsersData?.onlineUserIds) {
      setOnlineUsers(new Set(onlineUsersData.onlineUserIds));
    }
  }, [onlineUsersData]);

  useEffect(() => {
    if (!messages.length || !selectedUserId) return;
    messages
      .filter((m) => !m.isRead && m.senderId === selectedUserId)
      .forEach((m) => markReadMutation.mutate({ id: m.id }));
  }, [messages, selectedUserId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, expiredIds]);

  /* ── Socket (connect once on mount) ── */
  useEffect(() => {
    const token = localStorage.getItem("chat_token");
    if (!token) return;

    const socket = io("/", {
      path: "/socket.io",
      auth: { token },
      transports: ["websocket"],
    });
    socketRef.current = socket;

    socket.on("userOnline", ({ userId }: { userId: string }) => {
      setOnlineUsers((prev) => new Set(prev).add(userId));
    });
    socket.on("userOffline", ({ userId }: { userId: string }) => {
      setOnlineUsers((prev) => { const n = new Set(prev); n.delete(userId); return n; });
    });
    socket.on("typing", ({ userId }: { userId: string }) => {
      setTypingUsers((prev) => new Set(prev).add(userId));
      setTimeout(() => {
        setTypingUsers((prev) => { const n = new Set(prev); n.delete(userId); return n; });
      }, 3000);
    });
    socket.on("newMessage", (msg: Message) => {
      const active = selectedUserIdRef.current;
      const myId = meRef.current?.id;

      // Refresh data
      if (active && (msg.senderId === active || msg.receiverId === active)) {
        refetchMessages();
      }
      refetchConversations();

      // Push notification — only for incoming messages (not our own)
      if (msg.senderId !== myId) {
        const conv = conversationsRef.current.find(
          (c) => c.user.id === msg.senderId,
        );
        const senderName = conv?.user.username ?? "New message";
        const body = msg.plainText
          ? msg.plainText.slice(0, 100)
          : "🔒 Encrypted message";
        notify(`SecureChat — ${senderName}`, {
          body,
          tag: msg.senderId, // collapses multiple messages from same sender
        });
      }
    });
    socket.on("messageDelivered", ({ id }: { id: string }) => {
      setDeliveredIds((prev) => new Set(prev).add(id));
    });
    socket.on("messageExpired", ({ id }: { id: string }) => {
      setExpiredIds((prev) => new Set(prev).add(id));
      refetchConversations();
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Handlers ── */
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedUserId) return;
    const text = messageInput;
    setMessageInput("");
    sendMessageMutation.mutate(
      { data: { receiverId: selectedUserId, message: text, timer } },
      { onSuccess: () => refetchMessages() },
    );
  };

  const handleTyping = useCallback(() => {
    if (!socketRef.current || !selectedUserId) return;
    socketRef.current.emit("typing", { receiverId: selectedUserId });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("stopTyping", { receiverId: selectedUserId });
    }, 2000);
  }, [selectedUserId]);

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    setUserQuery("");
    setMsgQuery("");
    setSidebarMode("chats");
    setShowSidebar(false);
  };

  const handleExpireMessage = useCallback(
    (id: string) => {
      setExpiredIds((prev) => new Set(prev).add(id));
      deleteMessageMutation.mutate({ id });
    },
    [deleteMessageMutation],
  );

  const selectedUser = conversations.find((c) => c.user.id === selectedUserId)?.user;
  const visibleMessages = messages.filter((m) => !expiredIds.has(m.id));

  /* ── Render ── */
  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">

      {/* ══ SIDEBAR ══ */}
      <div className={`
        flex flex-col bg-card border-r border-border w-full md:w-80 md:flex flex-shrink-0
        ${showSidebar ? "flex" : "hidden"} md:flex
      `}>
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-primary font-bold">
            <Shield className="w-5 h-5" />
            <span>SecureChat</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              title="Search messages"
              onClick={() => setSidebarMode(sidebarMode === "search-messages" ? "chats" : "search-messages")}
              className={`p-2 rounded-full transition-colors ${sidebarMode === "search-messages" ? "bg-primary/20 text-primary" : "hover:bg-muted text-muted-foreground"}`}
            >
              <SearchCode className="w-4 h-4" />
            </button>
            <Link href="/profile" className="p-2 hover:bg-muted rounded-full transition-colors">
              <UserIcon className="w-5 h-5 text-muted-foreground" />
            </Link>
          </div>
        </div>

        {/* Search bar */}
        <div className="p-3 shrink-0">
          {sidebarMode === "search-messages" ? (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search message history..."
                className="pl-9 pr-8 bg-background border-border"
                value={msgQuery}
                onChange={(e) => setMsgQuery(e.target.value)}
              />
              {msgQuery && (
                <button
                  onClick={() => setMsgQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Find operatives..."
                className="pl-9 bg-background border-border"
                value={userQuery}
                onChange={(e) => {
                  setUserQuery(e.target.value);
                  setSidebarMode(e.target.value.length > 0 ? "search-users" : "chats");
                }}
              />
              {userQuery && (
                <button
                  onClick={() => { setUserQuery(""); setSidebarMode("chats"); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* List area */}
        <ScrollArea className="flex-1">
          {sidebarMode === "search-messages" ? (
            <MessageSearchResults
              query={debouncedMsgQuery}
              results={msgSearchResults as SearchResult[]}
              isFetching={searchFetching}
              onSelect={handleSelectUser}
            />
          ) : sidebarMode === "search-users" ? (
            <UserSearchList
              results={userSearchResults as User[]}
              onSelect={handleSelectUser}
            />
          ) : (
            <ConversationList
              conversations={conversations as any}
              selectedUserId={selectedUserId}
              onlineUsers={onlineUsers}
              onSelect={handleSelectUser}
            />
          )}
        </ScrollArea>
      </div>

      {/* ══ CHAT AREA ══ */}
      <div className={`
        flex-1 flex flex-col bg-background relative
        ${!showSidebar ? "flex" : "hidden"} md:flex
      `}>
        {selectedUserId ? (
          <>
            {/* Chat header */}
            <div className="h-16 border-b border-border flex items-center px-4 bg-card shrink-0 gap-3">
              <button
                className="md:hidden p-2 hover:bg-muted rounded-full transition-colors"
                onClick={() => setShowSidebar(true)}
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </button>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="relative">
                  <Avatar className="w-9 h-9">
                    <AvatarImage src={selectedUser?.profilePicture || ""} />
                    <AvatarFallback>{selectedUser?.username.slice(0, 2).toUpperCase() ?? "??"}</AvatarFallback>
                  </Avatar>
                  {selectedUser && onlineUsers.has(selectedUser.id) && (
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-card rounded-full" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{selectedUser?.username ?? "Operative"}</div>
                  <div className="text-xs text-muted-foreground">
                    {selectedUser && onlineUsers.has(selectedUser.id)
                      ? <span className="text-green-400">Online</span>
                      : "Offline"}
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6" ref={scrollRef}>
              <div className="space-y-3">
                {visibleMessages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isMe={msg.senderId === me?.id}
                    isDeliveredOverride={deliveredIds.has(msg.id)}
                    onExpire={handleExpireMessage}
                  />
                ))}
              </div>
              {typingUsers.has(selectedUserId) && (
                <div className="mt-4 text-sm text-muted-foreground italic flex items-center gap-2">
                  <div className="flex gap-1">
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                  Incoming transmission...
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-3 md:p-4 border-t border-border bg-card shrink-0">
              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className={`shrink-0 ${timer ? "text-primary border-primary/50" : ""}`}
                    >
                      <Clock className="w-5 h-5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-44 p-2" side="top">
                    <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase">
                      Self-destruct timer
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {([null, 10, 30, 60, 300] as const).map((t) => (
                        <Button
                          key={t === null ? "off" : t}
                          type="button"
                          variant={timer === t ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setTimer(t)}
                          className="justify-start text-xs"
                        >
                          {t === null ? "Off" : t < 60 ? `${t}s` : `${t / 60}m`}
                        </Button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Input
                  className="flex-1 bg-background"
                  placeholder="Type secure message..."
                  value={messageInput}
                  onChange={(e) => { setMessageInput(e.target.value); handleTyping(); }}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!messageInput.trim() || sendMessageMutation.isPending}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground select-none">
            <Shield className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-sm">Select a channel to begin secure transmission</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── */
/*  Sub-components                                  */
/* ─────────────────────────────────────────────── */

function MessageSearchResults({
  query,
  results,
  isFetching,
  onSelect,
}: {
  query: string;
  results: SearchResult[];
  isFetching: boolean;
  onSelect: (id: string) => void;
}) {
  if (!query || query.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
        <SearchCode className="w-8 h-8 opacity-20" />
        <p>Type to search your messages</p>
      </div>
    );
  }
  if (isFetching) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-1">
        <Search className="w-6 h-6 opacity-20" />
        <p>No messages found for "{query}"</p>
      </div>
    );
  }
  return (
    <div className="p-2 space-y-1">
      <div className="text-xs text-muted-foreground mb-2 px-2 uppercase tracking-wider font-semibold">
        {results.length} result{results.length !== 1 ? "s" : ""}
      </div>
      {results.map((r) => (
        <button
          key={r.message.id}
          onClick={() => onSelect(r.conversationUserId)}
          className="w-full flex items-start gap-3 p-3 hover:bg-muted rounded-lg transition-colors text-left"
        >
          <Avatar className="w-8 h-8 shrink-0 mt-0.5">
            <AvatarImage src={r.otherUser.profilePicture || ""} />
            <AvatarFallback className="text-xs">
              {r.otherUser.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-medium truncate">{r.otherUser.username}</span>
              <span className="text-xs text-muted-foreground shrink-0 ml-1">
                {format(new Date(r.message.createdAt), "MMM d")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
              <SnippetText snippet={r.snippet} />
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

function UserSearchList({
  results,
  onSelect,
}: {
  results: User[];
  onSelect: (id: string) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-1">
        <Search className="w-6 h-6 opacity-20" />
        <p>No operatives found</p>
      </div>
    );
  }
  return (
    <div className="p-2">
      <div className="text-xs text-muted-foreground mb-2 px-2 uppercase tracking-wider font-semibold">
        Operatives
      </div>
      {results.map((user) => (
        <button
          key={user.id}
          onClick={() => onSelect(user.id)}
          className="w-full flex items-center gap-3 p-3 hover:bg-muted rounded-lg transition-colors text-left"
        >
          <Avatar>
            <AvatarImage src={user.profilePicture || ""} />
            <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 overflow-hidden">
            <div className="font-medium truncate">{user.username}</div>
            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function ConversationList({
  conversations,
  selectedUserId,
  onlineUsers,
  onSelect,
}: {
  conversations: Array<{ user: User; lastMessage: Message | null; unreadCount: number }>;
  selectedUserId: string | null;
  onlineUsers: Set<string>;
  onSelect: (id: string) => void;
}) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
        <Shield className="w-8 h-8 opacity-20" />
        <p>No conversations yet</p>
        <p className="text-xs">Search for an operative above</p>
      </div>
    );
  }
  return (
    <div className="p-2">
      {conversations.map((conv) => {
        const isSelected = selectedUserId === conv.user.id;
        const isOnline = onlineUsers.has(conv.user.id) || conv.user.isOnline;
        return (
          <button
            key={conv.user.id}
            onClick={() => onSelect(conv.user.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left mb-1 border ${
              isSelected ? "bg-primary/10 border-primary/20" : "hover:bg-muted border-transparent"
            }`}
          >
            <div className="relative shrink-0">
              <Avatar>
                <AvatarImage src={conv.user.profilePicture || ""} />
                <AvatarFallback>{conv.user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              {isOnline && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-card rounded-full" />
              )}
            </div>
            <div className="flex-1 overflow-hidden min-w-0">
              <div className="flex justify-between items-center">
                <span className="font-medium truncate">{conv.user.username}</span>
                {conv.lastMessage && (
                  <span className="text-xs text-muted-foreground shrink-0 ml-1">
                    {format(new Date(conv.lastMessage.createdAt), "HH:mm")}
                  </span>
                )}
              </div>
              <div className="flex justify-between items-center mt-0.5">
                <span className="text-sm text-muted-foreground truncate">
                  {conv.lastMessage?.plainText || (conv.lastMessage ? "[Encrypted]" : "No messages")}
                </span>
                {conv.unreadCount > 0 && (
                  <span className="ml-1 shrink-0 bg-primary text-primary-foreground text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {conv.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MessageBubble({
  msg,
  isMe,
  isDeliveredOverride,
  onExpire,
}: {
  msg: Message;
  isMe: boolean;
  isDeliveredOverride: boolean;
  onExpire: (id: string) => void;
}) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const expiredRef = useRef(false);

  useEffect(() => {
    if (!msg.expiresAt) return;
    const tick = () => {
      const diff = differenceInSeconds(new Date(msg.expiresAt!), new Date());
      if (diff <= 0) {
        setTimeLeft(0);
        if (!expiredRef.current) { expiredRef.current = true; onExpire(msg.id); }
      } else {
        setTimeLeft(diff);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [msg.expiresAt, msg.id, onExpire]);

  if (timeLeft === 0) return null;

  const urgencyClass =
    timeLeft !== null && timeLeft <= 10
      ? "border border-destructive/60"
      : timeLeft !== null && timeLeft <= 30
      ? "border border-yellow-500/40"
      : "";

  return (
    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] md:max-w-[70%] rounded-xl p-3 ${
          isMe
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-secondary text-secondary-foreground rounded-tl-sm"
        } ${urgencyClass}`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {msg.plainText || msg.encryptedMessage}
        </p>
        <div className={`flex items-center justify-end gap-2 mt-1 text-[10px] ${
          isMe ? "text-primary-foreground/70" : "text-muted-foreground"
        }`}>
          {msg.timer && timeLeft !== null && (
            <span className={`flex items-center gap-1 font-mono ${timeLeft <= 10 ? "text-red-400 font-bold" : ""}`}>
              <Clock className="w-3 h-3" />
              {timeLeft}s
            </span>
          )}
          <span>{format(new Date(msg.createdAt), "HH:mm")}</span>
          {isMe && (() => {
            if (msg.isRead) {
              // ✓✓ teal — read
              return <CheckCheck className="w-3 h-3 text-primary" />;
            }
            if (msg.isDelivered || isDeliveredOverride) {
              // ✓✓ muted — delivered but not yet read
              return <CheckCheck className="w-3 h-3 opacity-70" />;
            }
            // ✓ single — sent, not yet delivered
            return <Check className="w-3 h-3 opacity-70" />;
          })()}
        </div>
      </div>
    </div>
  );
}
