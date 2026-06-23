import React, { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { setAuthTokenGetter } from "@workspace/api-client-react";

// Register custom fetch auth getter
setAuthTokenGetter(() => {
  return localStorage.getItem("chat_token");
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

import AuthPage from "./pages/auth";
import ChatPage from "./pages/chat";
import ProfilePage from "./pages/profile";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const token = localStorage.getItem("chat_token");
  
  useEffect(() => {
    if (!token) {
      setLocation("/");
    }
  }, [token, setLocation]);

  return token ? <>{children}</> : null;
}

function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const token = localStorage.getItem("chat_token");
  
  useEffect(() => {
    if (token) {
      setLocation("/chat");
    }
  }, [token, setLocation]);

  return !token ? <>{children}</> : null;
}

function Router() {
  return (
    <Switch>
      <Route path="/">
        <RedirectIfAuth>
          <AuthPage />
        </RedirectIfAuth>
      </Route>
      <Route path="/chat">
        <RequireAuth>
          <ChatPage />
        </RequireAuth>
      </Route>
      <Route path="/profile">
        <RequireAuth>
          <ProfilePage />
        </RequireAuth>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
