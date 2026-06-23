import React, { useState } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, ArrowLeft, LogOut, Clock } from "lucide-react";
import { format } from "date-fns";

export default function ProfilePage() {
  const { data: me } = useGetMe();
  const [, setLocation] = useLocation();

  const handleLogout = () => {
    localStorage.removeItem("chat_token");
    setLocation("/");
  };

  if (!me) return null;

  return (
    <div className="min-h-screen bg-background flex justify-center p-6">
      <div className="w-full max-w-2xl mt-12">
        <Link href="/chat" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Terminal
        </Link>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-8 border-b border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center border border-primary/50 text-2xl font-bold text-primary">
                  {me.username.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">{me.username}</h1>
                  <p className="text-muted-foreground">{me.email}</p>
                </div>
              </div>
              <Button variant="destructive" onClick={handleLogout} className="shrink-0">
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            </div>
          </div>

          <div className="p-8 space-y-8">
            <div className="grid gap-6">
              <div className="space-y-2">
                <Label>Operative ID</Label>
                <div className="font-mono text-sm bg-muted p-3 rounded border border-border text-muted-foreground">
                  {me.id}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <div className="flex items-center gap-2 p-3 border border-border rounded bg-background">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm font-medium">Online (Encrypted)</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Clearance Level</Label>
                  <div className="flex items-center gap-2 p-3 border border-border rounded bg-background">
                    <Shield className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">Standard</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Account Created</Label>
                <div className="flex items-center gap-2 p-3 border border-border rounded bg-background text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  {format(new Date(me.createdAt), "MMMM do, yyyy 'at' HH:mm:ss")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
