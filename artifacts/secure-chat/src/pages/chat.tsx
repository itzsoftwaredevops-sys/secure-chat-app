import React, { useEffect, useState, useRef } from "react";
import {
  useGetMe,
  useGetConversations,
  useGetMessages,
  useSendMessage,
  useGetUsers,
  useMarkMessageRead,
  useDeleteMessage,
  useGetOnlineUsers,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { format, differenceInSeconds } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Shield, Clock, Send, Search, Check, CheckCheck, User as UserIcon, LogOut } from "lucide-react";
import { io, Socket } from "socket.io-client";
import type { Message, User } from "@workspace/api-client-react/src/generated/api.schemas";

export default function ChatPage() {
  const { data: me } = useGetMe();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [timer, setTimer] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Sockets
  const socketRef = useRef<Socket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

  // Queries
  const { data: onlineUsersData } = useGetOnlineUsers({
    query: { refetchInterval: 5000 }
  });

  const { data: conversations = [] } = useGetConversations({
    query: { refetchInterval: 3000 }
  });
  
  const { data: messages = [], refetch: refetchMessages } = useGetMessages(selectedUserId!, {
    query: { 
      enabled: !!selectedUserId,
      refetchInterval: 2000
    }
  });

  const { data: searchResults = [] } = useGetUsers(
    { search: searchQuery },
    { query: { enabled: searchQuery.length > 1 } }
  );

  const sendMessageMutation = useSendMessage();
  const markReadMutation = useMarkMessageRead();
  const deleteMessageMutation = useDeleteMessage();

  useEffect(() => {
    if (messages.length > 0 && selectedUserId) {
      const unreadMessages = messages.filter(m => !m.isRead && m.senderId === selectedUserId);
      unreadMessages.forEach(m => {
        markReadMutation.mutate({ id: m.id });
      });
    }
  }, [messages, selectedUserId]);

  useEffect(() => {
    if (onlineUsersData) {
      setOnlineUsers(new Set(onlineUsersData.onlineUserIds));
    }
  }, [onlineUsersData]);

  useEffect(() => {
    const token = localStorage.getItem("chat_token");
    if (!token) return;

    const socket = io("/", {
      path: "/socket.io",
      auth: { token },
      transports: ["websocket"]
    });
    
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("joinRoom");
    });

    socket.on("userOnline", ({ userId }) => {
      setOnlineUsers(prev => new Set(prev).add(userId));
    });

    socket.on("userOffline", ({ userId }) => {
      setOnlineUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    });

    socket.on("typing", ({ userId }) => {
      setTypingUsers(prev => new Set(prev).add(userId));
      // Auto clear typing after 3s
      setTimeout(() => {
        setTypingUsers(prev => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      }, 3000);
    });

    socket.on("newMessage", () => {
      if (selectedUserId) refetchMessages();
    });

    return () => {
      socket.disconnect();
    };
  }, [selectedUserId, refetchMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedUserId) return;

    sendMessageMutation.mutate({
      data: {
        receiverId: selectedUserId,
        message: messageInput,
        timer: timer
      }
    }, {
      onSuccess: () => {
        setMessageInput("");
        refetchMessages();
      }
    });
  };

  const handleTyping = () => {
    if (socketRef.current && selectedUserId) {
      socketRef.current.emit("typing", { receiverId: selectedUserId });
    }
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 border-r border-border flex flex-col bg-card flex-shrink-0">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold">
            <Shield className="w-5 h-5" />
            <span>SecureChat</span>
          </div>
          <Link href="/profile" className="p-2 hover:bg-muted rounded-full transition-colors">
            <UserIcon className="w-5 h-5 text-muted-foreground" />
          </Link>
        </div>
        
        <div className="p-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input 
              placeholder="Search operatives..." 
              className="pl-9 bg-background border-border"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {searchQuery.length > 1 ? (
            <div className="p-2">
              <div className="text-xs text-muted-foreground mb-2 px-2 uppercase tracking-wider font-semibold">Search Results</div>
              {searchResults.map(user => (
                <button
                  key={user.id}
                  onClick={() => { setSelectedUserId(user.id); setSearchQuery(""); }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-muted rounded-lg transition-colors text-left"
                >
                  <Avatar>
                    <AvatarImage src={user.profilePicture || ""} />
                    <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 overflow-hidden">
                    <div className="font-medium truncate">{user.username}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-2">
              {conversations.map((conv) => {
                const isSelected = selectedUserId === conv.user.id;
                const isOnline = onlineUsers.has(conv.user.id) || conv.user.isOnline;
                return (
                  <button
                    key={conv.user.id}
                    onClick={() => setSelectedUserId(conv.user.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left mb-1 ${isSelected ? "bg-primary/10 border border-primary/20" : "hover:bg-muted border border-transparent"}`}
                  >
                    <div className="relative">
                      <Avatar>
                        <AvatarImage src={conv.user.profilePicture || ""} />
                        <AvatarFallback>{conv.user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      {isOnline && (
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-card rounded-full" />
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="flex justify-between items-center">
                        <span className="font-medium truncate">{conv.user.username}</span>
                        {conv.lastMessage && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(conv.lastMessage.createdAt), "HH:mm")}
                          </span>
                        )}
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-sm text-muted-foreground truncate">
                          {conv.lastMessage?.plainText || (conv.lastMessage ? "[Encrypted]" : "No messages")}
                        </span>
                        {conv.unreadCount > 0 && (
                          <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-background relative">
        {selectedUserId ? (
          <>
            {/* Chat Header */}
            <div className="h-16 border-b border-border flex items-center px-6 bg-card shrink-0">
              <div className="font-semibold flex items-center gap-2">
                <span>Chat</span>
                <span className="text-muted-foreground font-normal text-sm">|</span>
                <span className="text-primary tracking-wide">{conversations.find(c => c.user.id === selectedUserId)?.user.username || "Operative"}</span>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6" ref={scrollRef}>
              <div className="space-y-4">
                {messages.map((msg: Message) => {
                  const isMe = msg.senderId === me?.id;
                  return <MessageBubble key={msg.id} msg={msg} isMe={isMe} />;
                })}
              </div>
              {typingUsers.has(selectedUserId) && (
                <div className="mt-4 text-sm text-muted-foreground italic flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  Incoming transmission...
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-border bg-card shrink-0">
              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="icon" className={`shrink-0 ${timer ? "text-primary border-primary/50" : ""}`}>
                      <Clock className="w-5 h-5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2" side="top">
                    <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase">Self-destruct timer</div>
                    <div className="grid grid-cols-2 gap-1">
                      {[null, 10, 30, 60, 300].map(t => (
                        <Button
                          key={t === null ? 'off' : t}
                          variant={timer === t ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setTimer(t)}
                          className="justify-start text-xs"
                        >
                          {t === null ? "Off" : `${t < 60 ? t + 's' : (t/60) + 'm'}`}
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
                <Button type="submit" disabled={!messageInput.trim() || sendMessageMutation.isPending} size="icon">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <Shield className="w-16 h-16 mb-4 opacity-20" />
            <p>Select a channel to begin secure transmission</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg, isMe }: { msg: Message, isMe: boolean }) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!msg.expiresAt) return;
    
    const updateTimer = () => {
      const diff = differenceInSeconds(new Date(msg.expiresAt!), new Date());
      if (diff <= 0) {
        setTimeLeft(0);
      } else {
        setTimeLeft(diff);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [msg.expiresAt]);

  if (timeLeft === 0) return null; // Message expired

  return (
    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
      <div className={`max-w-[70%] rounded-xl p-3 ${
        isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-secondary text-secondary-foreground rounded-tl-sm"
      }`}>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.plainText || msg.encryptedMessage}</p>
        
        <div className={`flex items-center justify-end gap-2 mt-1 text-[10px] ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
          {msg.timer && (
            <span className="flex items-center gap-1 font-mono">
              <Clock className="w-3 h-3" />
              {timeLeft !== null ? timeLeft : msg.timer}s
            </span>
          )}
          <span>{format(new Date(msg.createdAt), "HH:mm")}</span>
          {isMe && (
            msg.isRead ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />
          )}
        </div>
      </div>
    </div>
  );
}
