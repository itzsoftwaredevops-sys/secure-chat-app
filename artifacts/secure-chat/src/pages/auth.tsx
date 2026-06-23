import React, { useState } from "react";
import { useLogin, useRegister } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Shield } from "lucide-react";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const loginMutation = useLogin();
  const registerMutation = useRegister();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isLogin) {
      loginMutation.mutate(
        { data: { email, password } },
        {
          onSuccess: (data) => {
            localStorage.setItem("chat_token", data.token);
            setLocation("/chat");
          },
          onError: (err: any) => {
            toast({
              title: "Login failed",
              description: err.message || "Invalid credentials",
              variant: "destructive",
            });
          },
        }
      );
    } else {
      registerMutation.mutate(
        { data: { email, password, username } },
        {
          onSuccess: (data) => {
            localStorage.setItem("chat_token", data.token);
            setLocation("/chat");
          },
          onError: (err: any) => {
            toast({
              title: "Registration failed",
              description: err.message || "Could not create account",
              variant: "destructive",
            });
          },
        }
      );
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative noise/gradient */}
      <div className="absolute inset-0 pointer-events-none opacity-20" style={{ background: "radial-gradient(circle at 50% 0%, hsl(var(--primary)/0.2), transparent 50%)" }} />
      
      <div className="w-full max-w-md relative z-10">
        <div className="mb-8 flex flex-col items-center">
          <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 border border-primary/20">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Secure Chat</h1>
          <p className="text-muted-foreground mt-2 text-sm">Encrypted. Private. Ephemeral.</p>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-2xl p-6 overflow-hidden relative">
          <div className="flex mb-6 bg-muted p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${isLogin ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${!isLogin ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              Register
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.form
              key={isLogin ? "login" : "register"}
              initial={{ opacity: 0, x: isLogin ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isLogin ? 20 : -20 }}
              transition={{ duration: 0.2 }}
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="bg-background"
                    placeholder="agent47"
                  />
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-background"
                  placeholder="agent@agency.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-background"
                  placeholder="••••••••"
                />
              </div>

              <Button
                type="submit"
                className="w-full mt-6"
                disabled={loginMutation.isPending || registerMutation.isPending}
              >
                {isLogin ? "Access Terminal" : "Initialize Account"}
              </Button>
            </motion.form>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
